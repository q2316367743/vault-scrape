# 存储插件架构（storage 插件类别）

## 目标
把现有 `node:vm` 插件机制扩展出第四个类别 `storage`（存储），使网盘等云端存储能以「导入 JS 插件 → 存储页新增该类型连接」的方式接入。本期只做架构 + 示例插件模板，真实网盘（123pan 等）下一期迁移。**第一版插件为只读**：浏览、扫描入库、读 NFO、播放；写回操作统一返回「该存储暂不支持此操作」（刮削流程对写回失败已有容错，只写 warn 日志不中断，天然兼容）。

## 核心设计（借鉴 boxplayer 的解耦）
插件只做「元数据 + 拿下载直链」，字节流由宿主统一处理：
- `list` / `stat` / `resolve` 三个必需方法都是 HTTP JSON 交互，现有沙箱 `ctx.request` 完全够用；
- `readRange`（播放 Range）、`readText`、`download` 由宿主实现：调插件 `resolve` 拿 `{ url, headers?, ttlSeconds? }` 直链 → 宿主发 Range 请求构造真正的 Node `Readable`。写一次，所有存储插件共用，且 `storage://` 每次请求都重新 resolve，直链过期天然自愈。

## 契约定义（新增 `src/common/types/plugin/storage.ts`）
```ts
// 方法签名统一 (input, env, ctx)，env = 连接配置（含已解密敏感字段）
list(input: { path: string; cursor?: string }, env, ctx)
  → { entries: PluginStorageEntry[]; nextCursor?: string }   // nextCursor 非空则继续翻页
stat(input: { path: string }, env, ctx)          → PluginStorageEntry
resolve(input: { path: string }, env, ctx)       → { url: string; headers?: Record<string,string>; ttlSeconds?: number }

interface PluginStorageEntry { path: string; name: string; type: 'file' | 'dir'; size?: number; modifiedAt?: number }
```
- `path` 为连接内 POSIX 路径（`/` 为根），插件内部自行做路径→网盘 ID 的解析与缓存（文档中给出建议）；
- 宿主把 `PluginStorageEntry` 归一化补全成 `FileEntry`（parent/extname/mime 走现有 MIME 兜底表）；`FileClient.list` 契约是全量数组，宿主按 `nextCursor` 循环拉全（带上限保护）；
- 配置字段：存储插件沿用 `env` 声明连接字段模板，`PluginEnvField` 新增 `secret?: boolean`。**取值挂在连接上而非插件上**（同一插件可建多个连接）：非 secret 字段明文存 `config` 可回显；secret 字段经 safeStorage 加密，UI 不回显（空串=清空、缺省=保持，复用密码语义）。

## 实施步骤

### 1. common 契约层
- `plugin/kind.ts`：`PluginKind` 加 `'storage'`，方法表 required `['list','stat','resolve']`、optional `[]`，补 LABELS/DESCRIPTIONS 文案；
- `plugin/define.ts`：`PluginMethod` 加 `'list' | 'stat' | 'resolve'`；
- `plugin/normalize.ts`：新增 `normalizeStorageListResult / normalizeStorageEntry / normalizeStorageResolveResult`（跨 realm 归一化，照抄现有模式）；
- `plugin/index.ts`：`PluginEnvField` 加 `secret?: boolean`；
- `file/connection.ts`：抽出 `BuiltinFileProtocol = 'local' | 'webdav' | 'smb'`，`FileProtocol = BuiltinFileProtocol | (string & {})`（保留字面量补全提示）；`FILE_PROTOCOLS` 保持内置三项；新增 `PluginConnection`（`{ id, name, protocol: 插件id, hasPassword, config }`）与 `PluginConnectionDraft`，`FileConnection/FileConnectionDraft` 联合扩展，`describeConnection` 加分支（「插件名 + 连接名」）。

### 2. 主进程插件侧（加类别，多为机械改动）
- `pluginRuntime.ts`：`readHandlers` 加三个方法、新增 `buildStoragePlugin`（含归一化校验：`url` 必填字符串）；
- `pluginRegistries.ts`：加 `storagePlugins` 单例；
- `pluginIpc.ts`：已按 `PLUGIN_KINDS` 循环注册，自动生效；invoke payload 增加 `input`（对象）字段透传给 storage 方法；
- `preload/plugin.ts`：加 `storage: createBridge('storage')` + invoke 快捷方法；
- 渲染层路由：加 `/plugin/storage` 子路由（插件页 tab 已由 `PLUGIN_KINDS` 驱动，自动出现）；storage 类别不渲染试运行面板，配置区块隐藏（env 挂连接，不走插件级配置）。

### 3. 主进程文件模块
- 新增 `modules/file/impl/plugin/directLinkStream.ts`：node http/https 发 Range GET（跟随 302 最多 5 跳、透传 headers、校验 206），返回 Node `Readable`；
- 新增 `modules/file/impl/plugin/PluginFileClient.ts` implements FileClient：
  - `list`（游标循环拉全，上限保护）、`stat`、`exists`（stat 捕获 notFound）；
  - `readRange`/`download`/`readText` = `resolve` 直链 + `directLinkStream`（readText 限 10MB；直链按 path 缓存 ttlSeconds，缺省 300s）；
  - `mkdir/createFile/writeText/move/copy/remove/upload` 抛 `FileError('unsupported', '该存储暂不支持此操作')`（错误码若不存在则在 file 错误码集中补充）；
  - 插件未安装/停用：init 报 `notFound`「存储插件未安装或已停用」；
- `fileClientManager.ts`：`createClient` 改注册表——内置三协议走原分支，其余按插件 id 构造 `PluginFileClient`；
- `fileConnectionStore.ts`：新增 `StoredPluginConnection`（`config` + `secrets` 两块，secrets 经 secretCodec 加密）；`normalizeStored/buildStored/toPublicConnection` 扩展插件分支（normalize 不校验插件存在性，运行时才报错）；保存时从 `storagePlugins` 注册表查声明表分拣 secret 字段并校验必填；新增 `loadConnectionConfig(id)` 供 PluginFileClient 取解密后的完整配置。

### 4. 渲染层存储页
- `useConnectionForm.ts`：支持插件协议的表单状态（协议切换时按插件 `envFields` 初始化字段、buildDraft 组装 config、secret 字段不回显）；
- 新增 `storage/modals/PluginConnectionFields.vue`：按声明表动态渲染字段（secret 用密码输入不回显，其余普通输入），避免 ConnectionDialogContent 超 300 行；
- `storageUtils.ts`：`PROTOCOL_ICONS/PROTOCOL_HINTS` 改为 `Record<BuiltinFileProtocol, ...>`，插件协议统一用 cloud 图标 + 从插件 meta 取名称/描述；
- 协议选择列表 = 内置 3 项 + 已启用的存储插件（`pluginApi.storage.list()`）；
- `UseFileConnections.ts` 的 `protocol === 'local'` 分支适配联合扩展。

### 5. 示例插件 + 文档
- 新增 `resources/plugin-examples/storage-demo.js`（约 200 行）：面向假想 JSON API 的极简网盘插件（token env + 分页 list + 路径→id 解析示例 + resolve 直链），作为下一期迁移 123pan 的模板骨架，代码注释详尽；
- 新增 `docs/plugin/11-storage-plugins.md`：storage 契约（方法表、IO 形状、env/secret、连接级配置、只读边界、性能建议）；
- 更新 `docs/file/01-file-module.md`（FileProtocol 开放化、PluginFileClient、直链流、工厂注册表）、`docs/plugin/01-plugin-module.md`（类别三→四）、`docs/page/02-storage-page.md`（动态表单）、`docs/README.md` 索引。

## 明确不做（本期）
- 写类方法（mkdir/writeText/upload 等）——方法表 optional 留空，下一期按需扩展，契约签名 `(input, env, ctx)` 已为其留好演进空间；
- 插件页 storage 试运行面板、连接列表的「插件已停用」状态标记（本期以打开时报错文案兜底）；
- 大文件上传、真实网盘插件、SOCKS5、utilityProcess 隔离。

## 验证
仅跑 `yarn typecheck`（遵守 RL-07）；示例插件与后续真实插件的连通性由你用真实环境验证。