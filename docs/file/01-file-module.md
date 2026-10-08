# 文件模块（本地 / WebDAV / SMB）

## 1. 模块定位

文件模块是「一个接口 + 多个实现」：`FileClient` 定义统一能力，`LocalFileClient`、`WebdavFileClient`、`SmbFileClient` 各自适配一种协议。实现全部运行在**主进程**（渲染层无法直接访问 fs / 网络协议库），渲染层只通过 IPC 使用，命令式地拿到 `FileResult` 信封。

它的下游是刮削模块：刮削流程只需「列目录 → 读 NFO / 图片 → 写回」，因此本模块只暴露文件级能力，不做媒体库解析。

本轮范围：接口 + 三个实现 + 连接配置存储 + IPC 契约 + 公共类型 + 文档。**不含连接管理 UI**；界面随后落在独立的一级页面「存储」（见[存储管理页面](../page/02-storage-page.md)），渲染层直接调用 `@/api/file`。

## 2. 目录结构

```
src/common/types/file/          # 三端共享的纯类型与纯函数（不含运行时依赖）
├── error.ts                    # FileErrorCode（13 个）+ FileError + describeFileError
├── path.ts                     # 统一 POSIX 路径：归一化 / 拼接 / 父目录 / 扩展名 / 拆段
├── entry.ts                    # FileEntry 统一形状 + MIME 兜底表 + 排序
├── connection.ts               # 三种连接与草稿的形状 + describeConnection
├── request.ts                  # 各 IPC 方法的请求载荷
├── transfer.ts                 # 传输进度 / 结束事件
├── result.ts                   # FileResult 信封 + fileOk / fileFail / isFileOk
└── index.ts                    # 再导出

src/main/src/modules/file/      # 主进程实现
├── FileClient.ts               # FileClient 接口 + AbstractFileClient 基类
├── withTimeout.ts              # 单次操作超时
├── fileErrorUtils.ts           # 底层异常 → FileError 收敛
├── streamCopy.ts               # 流式复制 + 进度 + 失败清理
├── fileConnectionStore.ts      # 连接配置落盘（safeStorage 加密密码）
├── fileClientManager.ts        # 按连接 id 缓存客户端实例
├── fileTransferRegistry.ts     # 上传 / 下载登记、取消与进度推送
├── fileIpc.ts                  # 18 个 invoke + 2 个推送通道
└── impl/
    ├── local/localPath.ts      # 连接内路径 ↔ 本机绝对路径 + 越界防护
    ├── local/LocalFileClient.ts
    ├── webdav/WebdavFileClient.ts
    ├── smb/smbErrors.ts        # NT 状态码 → FileError
    └── smb/SmbFileClient.ts

src/preload/src/modules/file/
├── fileChannels.ts             # 通道名常量（main 通过别名 ~ 引用同一份）
└── file.ts                     # fileApi：invoke 封装 + 事件订阅（返回取消订阅函数）

src/renderer/src/api/file.ts    # 渲染层唯一出口：export const fileApi = window.preload.file
```

## 3. FileClient 接口与统一语义

`FileClient`（`src/main/src/modules/file/FileClient.ts`）共 14 个方法：`init`、`dispose`、`stat`、`exists`、`list`、`mkdir`、`createFile`、`readText`、`writeText`、`move`、`copy`、`remove`、`upload`、`download`，外加只读属性 `protocol`。

统一语义（三实现必须一致，`AbstractFileClient` 负责公共部分）：

| 约定 | 说明 |
| --- | --- |
| 路径 | 一律是 POSIX 路径，`/` 与 `''` 都表示连接根；进入实现前先过 `normalizeRemotePath`：反斜杠转正斜杠、折叠重复斜杠、解析 `.` 与 `..`，`..` 越出根目录抛 `invalidPath` |
| 根目录保护 | `remove` / `move` / `copy` / `upload` 的目标不允许是连接根，抛 `invalidPath` |
| `overwrite` | 默认 `false`，目标已存在时抛 `alreadyExists`；`true` 时覆写（SMB 先删后写） |
| `mkdir` | `recursive` 默认 `true`；SMB 逐级 `createDirectory`，中间层已存在视为成功 |
| `remove` | `recursive` 默认 `true`；目录非空且 `recursive: false` 抛 `notEmpty` |
| `move` / `copy` | 仅限**同一连接内**；目标父目录不存在时按底层错误收敛为 `notFound`，不自动建父目录 |
| `readText` | 只用于 NFO / JSON 等小文件；大文件一律走 `upload` / `download` 的流式通道 |
| 超时 | 每个方法都被 `run()` 包住，超时抛 `timeout`（默认取设置 `network.timeout`，非法值回落 30 秒） |
| 错误 | 实现内部只抛 `FileError`；非 `FileError` 由 `fileErrorUtils.toFileError` 按 Node 错误码 / HTTP 状态码 / 兜底码收敛 |

`upload` / `download` 的 `localPath` 是**本机绝对路径**，不受连接根限制（上传的源、下载的落点都在本机任意位置）；`localPath` 越界防护只对「连接内路径 → 本机路径」方向生效。

## 4. 三种实现的方法映射

| 能力 | 本地磁盘（Local） | WebDAV | SMB（SMB2/2.1） |
| --- | --- | --- | --- |
| `list` | `readdir(withFileTypes)` + 逐项 `stat` | `getDirectoryContents(path, { details: true }).data` | `readDirectory(path)` |
| `stat` | `stat`（目录走 dirent 判定） | `stat(path, { details: true })`，收窄 `FileStat \| ResponseDataDetailed` | `readDirectory(父目录)` 按文件名命中（根目录本地合成） |
| `exists` | `stat` 是否成功 | `exists(path)` | 同上，靠 `findEntry` |
| `mkdir` | `mkdir({ recursive })` | `createDirectory({ recursive })` | 逐级 `createDirectory`，`alreadyExists` 视为成功 |
| `createFile` | `open(flag: overwrite ? 'w' : 'wx')` 后关闭 | `putFileContents(remote, '')` | `createFile(remote)` / `createFile(remote, content)` |
| `readText` | `readFile(utf-8)` | `getFileContents({ format: 'text' })`，返回值统一转文本 | `readFile(remote).toString('utf-8')` |
| `writeText` | `writeFile` | `putFileContents` | `createFile(remote, content)`（写前按 `overwrite` 预处理） |
| `move` | `rename`（先查目标） | `moveFile`（服务端 MOVE） | 按源类型 `renameDirectory` / `renameFile` |
| `copy` | `cp({ recursive })` | `copyFile`（服务端 COPY） | **无服务端复制**：目录逐项递归、文件走读流 → 写流 |
| `remove` | `rm({ recursive })` | `deleteFile`（集合递归），`recursive: false` 先 PROPFIND 判空 | 目录递归删子项后 `removeDirectory` |
| `upload` | `createReadStream` → `createWriteStream` | `putFileContents(remote, withProgress(流), { overwrite, contentLength })` | `await createFileWriteStream` → 流复制 |
| `download` | `createReadStream` → 本机 `createWriteStream` | `createReadStream` → `copyProgressSourceToLocalFile` | `await createFileReadStream` → 流复制 |
| `init` / `dispose` | 建根目录客户端 / 空实现 | 探测根目录 / HTTP 无状态，空实现 | `authenticate` + `connectTree(share)` / `client.close()` |

关于 WebDAV 的类型细节（webdav@5 的坑，改实现前务必先读）：

- `stat()` 无论带不带 `{ details: true }` 都返回 `FileStat | ResponseDataDetailed<FileStat>`，必须用 `'data' in info` 收窄；
- `getFileContents()` 的 `format` 只有 `'text' | 'binary'`，**没有** `'stream'`，大文件下载只能走 `createReadStream`；
- `createReadStream()` / `createWriteStream()` 返回库自己的 `ReadableLike` / `WritableLike`（不满足 node `Readable` / `Writable` 接口），因此 `streamCopy.ts` 额外提供 `ProgressSource` 这个最小结构接口与 `withProgress`；
- `AuthType` 是**字符串枚举**（`AuthType.Auto` 等），不是字面量联合，`basic` 在库里的名字是 `AuthType.Password`。

## 5. 连接配置与密码存储

- 落盘位置：`~/.vault-scrape/file/connections.json`（与 `setting/settings.json` 相互独立，同样是主进程唯一写入口），形状为 `{ version: 1, connections: [...] }`。
- 密码永不落明文：优先用 Electron `safeStorage`（系统钥匙串）加密，存成 `safe:<base64>`；钥匙串不可用时回落 `plain:<base64>` 并在控制台告警。
- 对外形状只有 `hasPassword: boolean`；`loadConnectionPassword()` 只在主进程内部使用。解密失败抛 `authFailed`，文案提示「已保存的密码无法解密，请重新填写密码」。
- 草稿（Draft）语义：`id` 缺省 = 新建；`password` 为 `undefined` = 保持已存密码，空串 = 清空。
- 落盘前校验：名称不能为空；本地根目录不能为空；WebDAV 地址必须是合法 URL；SMB 主机与共享名不能为空、端口必须是 1–65535 的整数。校验失败抛 `invalidArgument`（中文提示）。
- 读取失败（文件损坏 / JSON 非法）一律 `console.error` 后回落空列表，不阻塞启动；逐条归一化时 `id` 或 `name` 为空的记录会被丢弃。

## 6. IPC 通道与信封

所有 invoke 都返回 `FileResult<T>` 信封——`{ ok: true, data }` 或 `{ ok: false, code, message }`，**不抛异常**（contextBridge 传递自定义错误的附加属性不可靠，`code` 会丢）。渲染层只按 `code` 分支，`message` 仅用于展示。

| 通道 | 载荷 | 返回 |
| --- | --- | --- |
| `file:listConnections` | — | `FileConnection[]` |
| `file:saveConnection` | `FileConnectionDraft` | `FileConnection`（保存后自动失效旧客户端） |
| `file:deleteConnection` | `connectionId` | `boolean` |
| `file:testConnection` | `FileConnectionDraft` | `ConnectionTestResult`（临时建连后必定释放，永不抛错） |
| `file:disposeConnection` | `connectionId` | `boolean`（释放缓存的客户端实例） |
| `file:list` / `file:stat` / `file:exists` / `file:readText` | `FileTargetRequest{ connectionId, path }` | `FileEntry[]` / `FileEntry` / `boolean` / `string` |
| `file:mkdir` | `FileMkdirRequest` | `void` |
| `file:createFile` | `FileCreateRequest` | `void` |
| `file:writeText` | `FileWriteTextRequest` | `void` |
| `file:move` / `file:copy` | `{ connectionId, from, to, overwrite? }` | `void` |
| `file:remove` | `FileRemoveRequest` | `void` |
| `file:upload` / `file:download` | `FileUploadRequest` / `FileDownloadRequest` | `FileTransferStart{ transferId }` |
| `file:cancelTransfer` | `transferId` | `boolean`（`false` 表示已结束或不存在） |
| `file:transferProgress`（main → renderer 推送） | `FileTransferProgressEvent` | — |
| `file:transferDone`（main → renderer 推送） | `FileTransferDoneEvent` | — |

重试策略：读类通道（`list` / `stat` / `exists` / `readText`）按设置 `network.retryCount` 重试，只重试 `network` / `timeout`，间隔 300ms；写类通道一律不重试，保证非幂等语义不被悄悄放大。

错误码（`FileErrorCode`，共 13 个）：`notFound`、`alreadyExists`、`notDirectory`、`notEmpty`、`permissionDenied`、`invalidPath`、`invalidArgument`、`authFailed`、`unsupported`、`network`、`timeout`、`cancelled`、`unknown`。

## 7. 传输进度与取消

`upload` / `download` **立即返回 `transferId`**，不等传输结束：

1. `fileTransferRegistry.startTransfer` 生成 `randomUUID()` 与 `AbortController`，立刻把 `{ transferId }` 交给渲染层；
2. 实现层通过 `onProgress(transferred, total)` 回调上报，`ProgressTransform` 按 200ms 节流并在收尾补一次最终值，主进程转成 `file:transferProgress` 推送；
3. 传输结束（成功或失败）必定推送一次 `file:transferDone`，失败时展开 `describeFileError` 的 `code` 与中文 `message`；
4. `file:cancelTransfer` 会 abort 对应控制器：`AbortError` / `TimeoutError` 被收敛成 `cancelled`，并删除写了一半的本地文件（`copyProgressSourceToLocalFile`）或远端文件（上传的 `cleanupTarget`）；
5. 发起 invoke 的 `WebContents` 已销毁时静默丢弃事件，不做任何等待。

## 8. 能力矩阵与已知限制

| 限制 | 说明 |
| --- | --- |
| SMB 协议版本 | 只协商 SMB 2.0.2 / 2.1，**不支持 SMB1**，也不支持 SMB3 加密；连不上新版 Windows 默认共享时优先怀疑这一点 |
| SMB 无服务端复制 / 无 mkdir -p | 复制是「读流 → 写流」，大目录复制慢且占用主进程；目录只能逐级创建 |
| SMB 无可靠 stat | 只能用 `readDirectory(父目录)` 按文件名命中，目录路径上的 `exists` 不可靠 |
| WebDAV 无超时参数 | `createClient` 不接受 `timeout`；超时只是本模块 `withTimeout` 的兜底，**不会真正中断已发出的 HTTP 请求** |
| 跨连接移动 / 复制 | 不支持（请求里只有一个 `connectionId`）；需要跨连接请走「下载 → 上传」 |
| 本地根逃逸 | `resolveInsideRoot` 用 `startsWith(root + sep)` 复核，但不解析符号链接——根目录内的软链接可以指向根外（已知限制） |
| 根目录删除 | 明确禁止，抛 `invalidPath` |
| 0 字节文件 | 正常支持（`contentLength: 0`、空流均可） |
| 大文件 | 一律流式，禁止整文件读入内存；`readText` 只用于 NFO / JSON 小文件 |
| 名称冲突 | 默认 `overwrite: false`，渲染层需要覆盖时必须显式传 `true` |

## 9. 手工验证清单

按项目约定（只做 `yarn typecheck`），运行时行为由使用者手工验证。建议顺序：

1. `yarn typecheck` 全绿。
2. 启动 `yarn dev`，在渲染层控制台用 `@/api/file` 的出口逐条调：
   - `listConnections()` → 首次为空数组；
   - `saveConnection({ protocol: 'local', name: '本机测试', rootPath: '<某个真实目录>' })` → 返回带 `id` 的连接；
   - `list({ connectionId, path: '/' })` → 返回目录条目并按「目录在前」排序；
   - `mkdir` / `createFile` / `writeText` / `readText` / `stat` / `exists` / `move` / `copy` / `remove` 各走一遍，重点确认：目标已存在时不带 `overwrite` 报 `alreadyExists`、非空目录 `recursive: false` 报 `notEmpty`、删除 `/` 报 `invalidPath`；
   - `upload` / `download` 大文件（>1GB）观察 `file:transferProgress` 是否节流推送、`file:transferDone` 是否只推一次；传输中 `cancelTransfer(transferId)` 后确认半成品被清理。
3. WebDAV：填 Alist / Nextcloud 的地址、账号、密码，`testConnection` 成功后再重复第 2 步；`authType` 分别试 `auto` / `basic`（库内为 Password）/ `digest`。
4. SMB：填 Windows 或 Samba 的 `host` / `share` / 账号（域可空），确认写入、目录递归删除、跨目录移动；若报 `authFailed` 而密码正确，先确认服务端未禁用 SMB2。
5. 密码安全性：检查 `~/.vault-scrape/file/connections.json` 中 WebDAV / SMB 的 `secret` 是否为 `safe:` 前缀（钥匙串可用时）；手工把 `secret` 改坏后再 `list` 该连接，应得到 `authFailed` 并提示重新填写密码。
