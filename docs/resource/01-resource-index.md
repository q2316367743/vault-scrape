# 资源索引与 `storage://` 私有协议

## 实现思路

扫描媒体库时顺手把该目录下的**所有文件**写进 `resource` 表（资源索引），每个文件得到一个稳定的资源 ID；
渲染层要显示这些文件（刮削产出的封面，以及影视墙上的视频封面）时，不拼绝对路径、也不经过 IPC 传字节，而是使用私有协议地址：

```
storage://<存储ID>/<资源ID>/<原始文件名>.<原始拓展名>
```

例如 `storage://9f1c.../3a7be51c9d0f4e21/poster.jpg`。

这样做的两个目的：

1. **媒体库**：有了索引，列表/详情/播放都可以只依赖资源 ID 与查询接口，不必每次去远端列目录；
2. **显示刮削结果**：封面图直接交给 `<img>`（组件内部是 `<t-image>`），由主进程按需读取本地文件或拉取远端文件，渲染层不接触文件系统。

文件名段只用于可读性与调试，协议定位完全靠存储 ID + 资源 ID，因此文件被改名/移动后旧地址依然能解析到新位置（索引重建后 ID 会变，界面上会重新生成地址）。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/common/types/resource/index.ts` | 三端共享的纯类型与纯函数：`ResourceKind`、`ResourceItem`、`resourceKindOf()`、`buildResourceUrl()`、`parseResourceUrl()` |
| `src/main/src/db/schema/resource.ts` | `resource` 表定义 |
| `src/main/src/db/repo/resourceRepo.ts` | 索引仓储（按目录整体替换、按 id 查询、按数据源清理、按 kind 列出与取最新索引时间） |
| `src/main/src/modules/resource/resourceIndex.ts` | `resourceIdOf()` 与 `indexDirectory()`（列目录 + 写索引） |
| `src/main/src/modules/resource/resourceProtocol.ts` | 特权协议登记与 `storage://` 请求处理（本地直读 / 远端缓存） |

## 资源 ID

```ts
resourceIdOf(connectionId, path) = sha1(`${connectionId}\n${path}`).slice(0, 16)
```

- 确定性：同一存储下的同一路径永远得到同一个 ID，重复扫描不会造成地址漂移；
- 16 位十六进制（64 bit）足够避免同一存储内的碰撞，同时让地址保持简短；
- 协议处理时用 `^[0-9a-f]{16}$` 校验，非法 ID 直接 404。

注意这个函数放在主进程（依赖 `node:crypto`），`src/common/types/resource/` 里**不允许出现 `node:*` 导入**——渲染层会打包这份类型。

## 建立索引的时机

| 时机 | 入口 | 行为 |
| --- | --- | --- |
| 工作台扫描根目录 | `scrapeVideo.ts` 的 `listRootVideos()` | 先 `indexDirectory()` 拿目录项，再在内存里做视频过滤 / 排序 / 番号判重（扫描不再二次请求远端） |
| 刮削任务收尾 | `scrapeRunner.ts` 的 `rebuildIndexAfterTask()` | 任务进入终态后重建 `dirPath`；若配置了整库移动，再重建 `successOutputDir` 对应目录（失败只记 warn，不影响任务结果） |
| 删除数据源 | `fileIpc.ts` 的 `deleteConnection` 通道 | `deleteResourceByConnection()` 清掉该存储的全部索引，避免留下悬空资源 ID |

`indexDirectory(connectionId, dirPath)` 只列**一层**（与扫描口径一致），写库包在 try/catch 里：索引写失败只写一条 `scope: 'resource'` 的 warn 日志，绝不因此让扫描或刮削失败。

## 协议注册

```ts
// app ready 之前
protocol.registerSchemesAsPrivileged([
  { scheme: 'storage', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])
// app ready 之后、开窗之前
protocol.handle('storage', (request) => handleResourceRequest(request))
```

调用点在 `src/main/index.ts`：`registerResourceScheme()` 在模块顶层（ready 之前），`registerResourceProtocol()` 在 `registerIpc()` 之后、`createWindow()` 之前。

渲染层的 CSP 必须放行该协议，否则封面会静默变成空白：

```
img-src 'self' data: storage:
```

**注意**：`standard: true` 会把 URL 的 host 段小写化，因此存储 ID 必须是小写（现有 id 为小写 `randomUUID()`，符合）。

## 请求处理

1. `parseResourceUrl()` 解析出 `connectionId` / `resourceId` / `fileName`，解析失败或两段 ID 不合规 → `404`；
2. 解析目标文件，顺序如下：
   - `getResourceById(resourceId)`，并要求 `row.connectionId === connectionId`（跨存储访问一律 404）；
   - 兜底：`findScrapeFileByCoverId(resourceId)` 拿到任务行，校验任务所属存储后使用 `cover_path`。
     这条兜底让**封面不依赖索引重建**也能显示（例如索引重建失败或尚未重建）。
3. 按协议分派：
   - `local`：`resolveInsideRoot(connection.rootPath, row.path)` 校验不越根后，用 `net.fetch(pathToFileURL(...))` 直接把本地文件作为响应；Range、流式由 `net.fetch` 自己处理，不把整文件读进内存；
   - `webdav` / `smb`：先落到本地缓存 `~/.vault-scrape/cache/resource/<resourceId>`，再走同样的 `net.fetch`。
4. 任何异常都只记日志并返回 `404`，不让协议处理抛错（抛错会变成渲染层的网络错误噪音）。

### 远端缓存

- 命中判定：文件存在且大小与索引记录一致（兜底路径没有 size 时只要文件存在即算命中）；
- 写入：先下到 `<目标>.<randomUUID>.tmp` 再 `rename`，避免半截文件被当成缓存；
- 并发去重：同一个资源 ID 的并发请求共享一个 `Promise`（`pending` Map），不会重复下载；
- 剪枝：每次下载完成后最多每 60 秒检查一次，缓存超过 512MB 时按 mtime 从旧到新删除，直到降到 80%；
- 本轮不是完整的 LRU 实现：只按大小上限 + mtime 剪枝，够用且实现简单；缓存被清空只会导致下一次重新下载。

## 日志

同一资源 ID 的失败日志 60 秒内只记一条（`warnOnce`），避免界面上一次渲染几十张图时刷满日志。
日志 `scope` 为 `resource`。

## 限制与后续

- **索引查询的 IPC 仍然很窄**：`resource` 表已就位，但 `db` 域不为它开查询通道；影视墙通过 `media` 域的 `media:wall` 一次性拉全部 `kind = 'video'` 的资源（`listResourceByKind` + `maxResourceIndexedAt`，见 [影视墙页面](../page/04-media-wall-page.md)），`listResourceByDir` / `countResource` 只被主进程自己用。影视墙还会顺带读 `kind = 'nfo'` 与 `kind = 'image'` 的索引，用来判断「同目录有没有刮削产出」并取同目录封面——只查索引、不读文件内容。按目录分页浏览的媒体库页面仍未实现。
- **大文件流式播放**：本地路径已经由 `net.fetch` 支持 Range；远端（WebDAV/SMB）仍是「整文件落缓存后再响应」，播放器拖动进度条要等首次下载完成。
- **目录嵌套**：同一存储的库根不应互相嵌套，索引按「最后一次扫描的目录」整体替换，嵌套时外层的索引会被内层扫描覆盖对应路径。
- **失效资源**：索引被清理后，`storage://` 地址会返回 404，界面表现为图片空白（不报错）。
