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
| `src/renderer/src/windows/main/store/setting/SettingXxxStore.ts` | 七个分组 store |
| `src/renderer/src/windows/main/pages/setting/` | 设置页面与各面板 |

## 数据结构

```ts
interface SettingSchema {
  path: SettingPath          // 目录与路径
  scrape: SettingScrape      // 刮削节奏
  network: SettingNetwork    // 网络连接
  translate: SettingTranslate// 翻译服务
  naming: SettingNaming      // 命名规则
  download: SettingDownload  // 下载选项
  file: SettingFile          // 文件行为
}
```

字段与默认值见 [02-setting-items.md](./02-setting-items.md)。账号设置尚未接入，因此不在 `SettingSchema` 中。

落盘路径：`~/.vault-scrape/setting/settings.json`，内容形如：

```json
{
  "path": { "actorAvatarDir": "", "successOutputDir": "", "failedOutputDir": "", "fanartDirName": "extrafanart" },
  "scrape": { "concurrency": 3, "requestDelay": 1, "restAfterCount": 50, "restDuration": 60 },
  "naming": { "folderTemplate": "{num}", "fileTemplate": "{num} {title}", "...": "..." }
}
```

## API 契约

IPC 通道（`SettingChannels`）：

| 通道 | 载荷 → 返回 |
| --- | --- |
| `setting:getAll` | 无 → `SettingSchema` |
| `setting:getGroup` | `SettingGroupKey` → 该组设置 |
| `setting:saveGroup` | `(key, value)` → 归一化后的该组设置 |

主进程函数：

- `loadSetting(): SettingSchema`：缓存为空时读盘，读盘失败回落默认值并打印 `[setting] 设置读取失败，使用默认配置`。
- `saveSettingGroup<K extends SettingGroupKey>(key: K, value: unknown): SettingSchema[K]`：归一化单组 → 读回整树 → 替换该组 → `mkdirSync(dirname, { recursive: true })` → `writeFileSync(file, JSON.stringify(next, null, 2))` → 刷新缓存 → 返回归一化结果。

渲染进程通过 `settingApi`（由 `@/api` 再导出）调用：`settingApi.getAll()`、`settingApi.getGroup(key)`、`settingApi.saveGroup(key, value)`。

## 渲染层接入方式

`useSettingGroup.ts` 提供工厂：

```ts
export function createSettingGroupStore<K extends SettingGroupKey>(id: string, key: K)
```

内部行为：`setting` 初始值为 `buildSetting()[key]`（先有可渲染的默认值），随后异步 `getGroup(key)` 拉取真实值覆盖；对 `setting` 做 `watchDebounced(..., { debounce: 300, deep: true })` 自动调用 `saveGroup(key, value)`。因此页面里只需要：

```ts
const { setting } = storeToRefs(useSettingNamingStore())
```

不做「数据已就绪」守卫是有意的：即使拉取失败或首启无文件，默认值也会被回写一次，从而生成一份完整的配置文件。

## 注意事项

- 归一化是安全边界：外部手工编辑过的文件里，类型不对、枚举越界、负数都会回落默认值，不会污染内存态。
- 应用外修改 JSON 文件不会被感知（缓存不会失效）。这是当前契约内不支持的场景，需要重载时才生效。
- `saveGroup` 写的是整份文件（读回整树后整体覆盖），所以不要在文件里手工塞入未在 `SettingSchema` 中登记的字段，它们会在下次保存时丢失。
- 新增一组设置的固定动作：① 写 `<组>Setting.ts` 三件套；② 在 `setting/index.ts` 登记（`SettingSchema`、`SETTING_GROUP_KEYS`、`settingNormalizers`、`buildSetting`、`normalizeSetting`）；③ 在 `store/setting/` 加一个 `createSettingGroupStore` 实例并导出；④ 在设置页加面板；⑤ 更新 `02-setting-items.md`。IPC 通道无需新增。
