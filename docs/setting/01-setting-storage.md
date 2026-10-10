# 设置存储

## 实现思路

设置全部是键值对，因此不建表、不进数据库，而是以单个 JSON 文件落盘。主进程是设置的「数据家」：读操作走内存缓存（命中时零磁盘 IO），写操作是唯一的落盘入口，写完后同步刷新缓存。渲染进程只按分组读写，不接触文件路径。

按分组读写而不是整树读写，是为了让每个设置面板各自独立保存：`saveGroup` 在写入时会先读回整树、只替换目标分组，再整体写回文件，因此各面板之间不会互相覆盖。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/common/types/setting/shared.ts` | 归一化原语：`toSource` / `readString` / `readNumber` / `readBoolean` / `readEnum` / `readStringArray` |
| `src/common/types/setting/<组>Setting.ts` | 各组的 `interface` + `buildSettingXxx()` + `normalizeSettingXxx(raw)` |
| `src/common/types/setting/index.ts` | `SettingSchema`、`SettingGroupKey`、`SETTING_GROUP_KEYS`、`settingNormalizers`、`buildSetting()`、`normalizeSetting()` |
| `src/main/src/modules/setting/settingStore.ts` | 缓存 + 读写文件 + `saveSettingGroup` |
| `src/main/src/modules/setting/settingIpc.ts` | `registerSettingIpc()` |
| `src/preload/src/modules/setting/settingChannels.ts` | 通道常量（契约） |
| `src/preload/src/modules/setting/setting.ts` | `settingApi` |
| `src/renderer/src/api/setting.ts` | 渲染层统一出口 |
| `src/renderer/src/windows/main/store/setting/useSettingGroup.ts` | `createSettingGroupStore()` 工厂 |
| `src/renderer/src/windows/main/store/setting/SettingXxxStore.ts` | 八个分组的 store（`app` / `library` / `scrape` / `network` / `translate` / `naming` / `download` / `file`） |
| `src/renderer/src/windows/main/pages/setting/` | 设置页面与各面板 |

## 数据结构

```ts
interface SettingSchema {
  app: SettingApp            // 主题 / NSFW 保护 / 演员头像目录
  library: SettingLibrary    // 各资料库类型的媒体后缀清单
  scrape: SettingScrape      // 刮削节奏与剧照目录名
  network: SettingNetwork    // 网络连接
  translate: SettingTranslate// 翻译服务
  naming: SettingNaming      // 命名规则
  download: SettingDownload  // 下载选项
  file: SettingFile          // 文件行为
}
```

字段与默认值见 [02-setting-items.md](./02-setting-items.md)。站点账号参数不在设置里：由插件声明为环境变量，存在插件自己的索引文件中，因此设置页也没有账号分组。

落盘路径：`~/.vault-scrape/setting/settings.json`，内容形如：

```json
{
  "app": { "nsfwProtection": false, "actorAvatarDir": "" },
  "library": { "extensions": { "movie": ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "ts", "m2ts", "mpg", "mpeg", "rmvb"] } },
  "scrape": { "concurrency": 3, "requestDelay": 1, "restAfterCount": 50, "restDuration": 60, "fanartDirName": "extrafanart" },
  "naming": { "fileTemplate": "{num} {title} ({year}) [{providerId}]", "assetNaming": "fixed", "...": "..." }
}
```

旧文件里的 `path` 组与已移除的三个 `file` 开关在下次写盘时消失（归一化只按已知分组与字段读取，无需迁移）。

## API 契约

IPC 通道（`SettingChannels`）：

| 通道 | 载荷 → 返回 |
| --- | --- |
| `setting:getAll` | 无 → `SettingSchema` |
| `setting:getGroup` | `SettingGroupKey` → 该组设置 |
| `setting:saveGroup` | `(key, value)` → 归一化后的整树设置 |

主进程函数：

- `loadSetting(): SettingSchema`：缓存为空时读盘，读盘失败回落默认值并打印 `[setting] 设置读取失败，使用默认配置`。
- `saveSettingGroup<K extends SettingGroupKey>(key: K, value: unknown): SettingSchema`：归一化单组 → 读回整树 → 替换该组 → `mkdirSync(dirname, { recursive: true })` → `writeFileSync(file, JSON.stringify(next, null, 2))` → 刷新缓存 → 返回归一化后的整树（渲染层不使用返回值）。

渲染进程通过 `settingApi`（由 `@/api` 再导出）调用：`settingApi.getAll()`、`settingApi.getGroup(key)`、`settingApi.saveGroup(key, value)`。

## 渲染层接入方式

`useSettingGroup.ts` 提供工厂：

```ts
export function createSettingGroupStore<K extends SettingGroupKey>(
  id: string,
  key: K,
  onSaved?: () => void
)
```

内部行为：`setting` 初始值为 `buildSetting()[key]`（先有可渲染的默认值），随后异步 `getGroup(key)` 拉取真实值覆盖；对 `setting` 做 `watchDebounced(..., { debounce: 300, deep: true })` 自动调用 `saveGroup(key, value)`，成功后触发 `onSaved`。因此页面里只需要：

```ts
const { setting } = storeToRefs(useSettingNamingStore())
```

另外用一个同步 `deep` watcher 记录「用户是否改过这个分组」，`getGroup` 回填前先看这个标记：**用户已经改过就丢弃回填结果**。旧实现是无条件 `setting.value = group`，一旦用户在加载返回前点了开关，就会被旧值整体覆盖——界面上开关弹回，磁盘上只剩覆盖后的旧值，连「点过」的痕迹都留不下（详见「注意事项」）。

不做「数据已就绪」守卫是有意的：首启无文件时 `getGroup` 返回的就是归一化后的默认值，回填后会被防抖回写一次，从而生成一份完整的配置文件（不需要等「加载完成」再渲染控件）。

## 注意事项

- 归一化是安全边界：外部手工编辑过的文件里，类型不对、枚举越界、负数都会回落默认值，不会污染内存态。
- 应用外修改 JSON 文件不会被感知（缓存不会失效）。这是当前契约内不支持的场景，需要重载时才生效。
- `saveGroup` 写的是整份文件（读回整树后整体覆盖），所以不要在文件里手工塞入未在 `SettingSchema` 中登记的字段，它们会在下次保存时丢失。
- 新增一组设置的固定动作：① 写 `<组>Setting.ts` 三件套；② 在 `setting/index.ts` 登记（`SettingSchema`、`SETTING_GROUP_KEYS`、`settingNormalizers`、`buildSetting`、`normalizeSetting`）；③ 在 `store/setting/` 加一个 `createSettingGroupStore` 实例并导出；④ 在设置页加面板；⑤ 更新 `02-setting-items.md`。IPC 通道无需新增。
- **传给 IPC 的载荷必须是纯值**：`@/api/setting` 出口（`src/renderer/src/api/setting.ts`）会先 `toRaw` 再 `structuredClone`，所以 `settingApi.saveGroup(key, value)` 可以直接传响应式对象；但新增的任何 IPC 出口都要自己保证纯值——Vue 的 `ref/reactive` 会把对象包成 Proxy，Proxy 无法通过 IPC 的结构化克隆（报 `#<Object> could not be cloned`），表现为主进程一个字节都收不到、设置改了不生效且重启被重置。
- 自动保存失败会 `logger.error('设置分组保存失败', error)`，并按 store 实例一次性 `MessagePlugin.error` 提示，不再静默失败。
- 自动保存有 300ms 防抖：改动后立刻退出应用（不足 300ms）可能丢掉最后一笔写入；退出前 flush 属于后续增强。
- **加载回填不能无条件覆盖**：`getGroup` 是异步的，用户完全可能在它返回前就点了开关。回填前必须检查「用户是否已改」（同步 deep watcher + `applyingRemote` 标记区分自己写入），否则用户的点击会被旧值冲掉——界面上开关弹回，磁盘上什么痕迹都没有，排查时会误判成「开关坏了」。任何新的设置分组都继承这套保护，无需自己处理。
- **依赖设置分组的模块级缓存要挂在 `onSaved` 上，不能挂在「值变化」上**：值变化发生在点击瞬间，而落盘要等 300ms 防抖，此时主进程缓存还是旧值，刷新会读到旧值。应用分组就是这么接的：`SettingAppStore.ts` 传入 `() => void refreshNsfwProtection()`，否则 NSFW 开关要整页刷新才生效（影视墙等页面表现为「设置没生效」）。
