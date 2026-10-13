# 存储插件（kind: 'storage'）

存储插件把「网盘等云端存储」接入文件模块：用户在插件页「存储」tab 导入 JS 插件后，即可在存储页「新建数据源」时选择该插件类型，按插件声明的字段填写连接配置，像本地 / WebDAV / SMB 一样浏览、扫描入库、读 NFO、播放。

**第一版只读**：插件方法表只有 `list` / `stat` / `resolve` 三个必需方法；写类操作（新建 / 写入 / 移动 / 删除 / 上传）由宿主统一返回「该存储暂不支持此操作」。刮削链路对写回失败已有容错（只写 warn 日志不中断），因此刮削元数据仍会正常进本地库，只是不写回网盘。

完整示例：[resources/plugin-examples/storage-demo.js](../../resources/plugin-examples/storage-demo.js)——面向假想 JSON API 的骨架，也是真实网盘插件（123pan 等）的迁移模板。

## 1. 核心设计：插件只出直链，字节流归宿主

借鉴网盘播放器的通用解耦：**插件只负责元数据（列目录 / 查条目）与解析下载直链，一切字节流由宿主拿直链自行完成**。

| 操作 | 谁实现 | 说明 |
| --- | --- | --- |
| `list` / `stat` | 插件 | 普通 HTTP JSON 交互，沙箱 `ctx.request` 完全够用 |
| `resolve` → `{ url, headers?, ttlSeconds? }` | 插件 | 直链 + 防盗链请求头 + 有效期 |
| `readRange`（播放 Range） | 宿主 | 拿直链发 Range 请求 → 真 node `Readable`（`directLinkStream.ts`） |
| `readText`（NFO / JSON） | 宿主 | 直链读全文，上限 10 MB |
| `download`（图片缓存等） | 宿主 | 直链流式落盘 |

这样设计的收益：

- `readRange` 是 `storage://` 播放的核心（`FileClient` 契约要求返回真 node `Readable`），沙箱里造不出 Node 流——把这一层放宿主，写一次所有存储插件共用；
- `storage://` 的每个 Range 请求都会重新走 `FileClient.readRange`，直链过期天然自愈；宿主另有按 path 的直链缓存（`ttlSeconds`，缺省 300 秒），有效期内不打网盘 API；
- `readRange` 遇「直链失效」（403 / 404 / 410）会绕过缓存重新 `resolve` 一次再试，播放中途换链无感。

## 2. 插件契约

```js
definePlugin({
  meta: { kind: 'storage', id, name, version, author?, description? },
  env: [ /* 连接配置字段模板，见第 3 节 */ ],
  list(input, env, ctx): Promise<{ entries: PluginStorageEntry[]; nextCursor?: string }>,
  stat(input, env, ctx): Promise<PluginStorageEntry>,
  resolve(input, env, ctx): Promise<{ url: string; headers?: Record<string, string>; ttlSeconds?: number }>
})
```

三个方法全部必填（`PLUGIN_KIND_METHODS.storage`），方法签名统一 `(input, env, ctx)`：

```ts
interface PluginStorageEntry {
  /** 连接内 POSIX 路径，`/` 为连接根（与 FileEntry.path 同一口径） */
  path: string
  /** 名称，不含父路径；缺省时宿主从 path 末段推断 */
  name: string
  type: 'file' | 'directory'
  /** 字节数；目录缺省或 0 */
  size?: number
  /** 毫秒时间戳；不可得缺省 */
  modifiedAt?: number
}

// list 的入参：cursor 是上一次返回的 nextCursor，首页不传；cursor 内容完全由插件自定义
interface PluginStorageListInput { path: string; cursor?: string }
```

- 宿主把 `PluginStorageEntry` 归一化并补全成 `FileEntry`（`parent` / `extname` / `mime` 按 MIME 兜底表推断），非法条目丢弃、单页上限 500 条；
- `FileClient.list` 的契约是全量数组：宿主按 `nextCursor` 循环翻页（单页 500 条 × 上限 200 页，全量上限 5 万条，超出截断并写 warn 日志）；
- `stat` 对不存在的路径抛错即可，宿主按 `notFound` 收敛；`resolve` 返回无效数据时宿主报「没有返回有效的下载地址」；
- **方法之间互调用顶层函数 + 闭包**（宿主重建插件时方法会被单独摘出调用，方法内不要用 `this`），见示例插件。

## 3. 连接配置字段（env 声明的特殊语义）

存储插件沿用 `env` 声明字段表，但**取值挂在连接上而不是插件上**——同一个插件可以建多个连接（不同账号 / 不同根目录），每个连接各填一份：

```js
env: [
  { key: 'baseUrl', label: '接口地址', required: true, placeholder: 'https://...', description: '...' },
  { key: 'accessToken', label: '访问令牌', required: true, secret: true }
]
```

- `secret: true` 的字段：safeStorage 加密落盘（钥匙串不可用回落 base64 并写 warn），界面用密码框且**不回显**，明文永不跨 IPC；对外只有连接的 `hasPassword` 掩码；
- 其余字段：明文存连接的 `config`，界面可回显；
- 保存时宿主按声明表校验必填（缺 required 报「请先填写「××」」），secret 字段与密码同约定：**缺省 = 保持已存值，空串语义不用于清空**（与连接密码行为一致，已存的 secret 无法通过留空清除）；
- 插件页「存储」tab 不出现配置区块（配置在存储页的连接上填），`envReady` 恒为 true，也不支持试运行（`plugin:storage:invoke` 直接返回 unsupported）。

## 4. 路径与文件 ID（插件作者必读）

宿主全链路（资料库、媒体源、`storage://` 播放、路径自愈）用的都是**连接内 POSIX 路径**，而网盘 API 普遍按「文件 ID」寻址。翻译工作在插件侧完成，建议：

- 维护「路径 → ID」缓存（`父ID + 段名 → ID`），列目录时顺手填充；
- 缓存未命中时逐级从根目录往下找（每级一次列目录调用）；
- 缓存挂在插件闭包里即可，连接存活期间有效（`PluginFileClient` 每个连接一个实例）。

## 5. 直链行为约定（宿主侧，`directLinkStream.ts`）

- GET 请求，Range 头形如 `bytes=start-end`（闭区间，与 `FileClient.readRange` 一致）；
- 跟随 301 / 302 / 307 / 308 重定向（上限 5 跳，跨协议允许），防盗链请求头重定向后原样携带；
- Range 请求只接受 206；无 Range（download / readText 场景）接受 200；
- 403 / 404 / 410 → `notFound`（调用方会重新 resolve 再试一次）；401 → `authFailed`；其余 5xx/网络错误 → `network`；
- 超时沿用设置里的网络超时；返回的流支持 `destroy()` 取消。

## 6. 宿主侧实现

| 位置 | 职责 |
| --- | --- |
| `src/common/types/plugin/storage.ts` | 契约类型（入参 / 返回形状） |
| `src/common/types/plugin/normalize.ts` | 三个方法返回值的跨 realm 归一化 |
| `src/main/src/modules/plugin/pluginRuntime.ts` | `buildStoragePlugin`：方法表校验、宿主 realm 重建、返回值归一化 |
| `src/main/src/modules/plugin/pluginRegistry.ts` | `invokeStorageMethod(id, method, input, env)`：主进程内部调用入口（对象入参、env 来自连接、按 method 收窄返回类型） |
| `src/main/src/modules/file/impl/plugin/PluginFileClient.ts` | `FileClient` 实现：元数据走插件、直链缓存、readRange/readText/download 宿主实现、写操作 unsupported |
| `src/main/src/modules/file/impl/plugin/directLinkStream.ts` | 直链字节流（Range / 重定向 / 失效判定） |
| `src/main/src/modules/file/fileClientManager.ts` | 工厂：内置三协议之外一律按插件 id 构造 `PluginFileClient` |
| `src/main/src/modules/file/fileConnectionStore.ts` | 插件连接落盘：`config`（明文）+ `secrets`（密文），声明表来自 `storagePlugins.readPluginEnv` |
| `src/renderer/.../storage/composables/useStoragePlugins.ts` | 渲染层：已启用插件列表、字段声明拉取、插件名映射 |

## 7. 本期不做（后续项）

- 写类方法（`mkdir` / `writeText` / `upload` 等）：方法表 optional 留空，签名 `(input, env, ctx)` 已留好演进空间；届时 `writeText` 可由宿主经 `upload`（base64 小文件整传）统一实现；
- 插件页存储类别的试运行面板；
- 连接列表对「插件已停用 / 已删除」的状态标记（当前打开连接时以「存储插件不可用」文案兜底）；
- 大文件上传到网盘（分片协议复杂）；utilityProcess 子进程隔离（与插件机制共用的后续项）。
