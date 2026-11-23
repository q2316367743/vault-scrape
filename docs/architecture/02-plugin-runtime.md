# 插件运行期架构（core / 窗口 / 媒体 / 长任务）

本文只讲插件化之后的运行期契约，替代原 Electron 的「主进程 + preload + IPC」三件套。

## 1. 运行单元

| 单元 | 位置 | 职责 | 限制 |
| --- | --- | --- | --- |
| core | `src-dashou/index.ts` → `src-dashou/core.mjs` | 数据库、文件、网络、刮削、插件沙箱、离线包、媒体服务、创建播放窗口 | 有 Node；宿主对「窗口 → core」的单次调用 30s 超时 |
| 主窗口 | `src/windows/main/` + `index.html` | 全部管理界面 | 沙箱页面，无 Node；只能 `@dashou/api` |
| 播放窗口 | `src/windows/play/` + `play.html` | 内置 artplayer 播放 + 侧栏选集 | 由 core 动态创建；页面也在包内 `ui/` 下 |

`src-dashou/plugin.json` 里只声明主窗口；播放窗口在用户点「播放」时由 core 调
`ctx.window.create` + `ctx.webview.createWebview` 创建（label 固定 `play`，页面 `ui/play.html`）。

## 2. core 启动时序

`onReady(ctx)` 里按顺序做四件事，全部在宿主「上报 ready / 建窗」之前：

1. `setHost(ctx)` + `initPaths({ data, config, cache, log, temp, pluginRoot })`：后续模块用 `dataPath()` / `configPath()` / `cachePath()` / `logPath()` / `tempPath()` 按语义拼目录；
2. `initDb()`：`node:sqlite` 打开 `db/vault-scrape.db`，执行 `assets/schema.sql`；
3. `registerLongJobs()`：把可能超过 30s 的操作登记进长任务表；
4. `await startMediaServer()`：起本机 HTTP 媒体服务，并把基地址写进 `@common` 的 `mediaBase`。

随后标记上次残留的 `running` 任务为中断、写启动日志、异步跑离线数据包检查（只提示、不自动下载）。

`definePluginApi()` 本身仍是纯描述表；窗口关闭时 `onWindowClosed` 收播放窗口的摊，`onBeforeQuit` 释放文件连接与媒体服务。

## 3. API 层：窗口 → core

- 总表在 `src-dashou/core/api.ts`，键是扁平 camelCase（`actorList`、`fileUpload`、`mediaWall`……），
  每个域一个 `modules/<域>/<域>Api.ts`；
- 窗口侧统一从 `src/api/` 取：每个域一个薄包装，内部用 `invoke('plugin:api|<method>', args)`；
- 域内错误在 core 内部抛，**只有 API 边界**转成各域信封（`ActorResult` / `FileResult` / `MediaResult` …），
  窗口拿到的是 `{ ok, data | code, message }`，不抛异常（对话框等少数接口除外）；
- 新增一个方法：core 域文件里加实现 → `core/api.ts` 的 `api` 自动包含 → 窗口 `src/api/<域>.ts` 加包装。

## 4. 事件：core → 窗口

`src/common/channels.ts` 的 `CORE_EVENTS` 是唯一事件名清单：

| 事件 | 触发方 | 负载 |
| --- | --- | --- |
| `scrape:progress` | 刮削任务 | `ScrapeProgressEvent` |
| `library:progress` | 资料库扫描 | `LibraryProgressEvent` |
| `actor:progress` | 演员补全队列 | `ActorScrapeStatus` |
| `file:transferProgress` / `file:transferDone` | 上传 / 下载 | `FileTransfer*Event` |
| `offline:progress` / `offline:done` / `offline:updateAvailable` | 离线数据包 | `Offline*` |
| `player:switch` | 播放窗口已存在时换片 | `PlayerLoadResult` |
| `player:status` | 播放状态快照 | `PlayerStatus` |
| `core:job:done` | 长任务结束 | `{ jobId, ok, result | message }` |

core 用 `emit` 广播（窗口不在时宿主丢弃），播放窗口换片用 `ctx.event.emitTo('play', …)` 定向。
窗口侧 `src/api/events.ts` 把异步的 `listen` 包成「订阅立即返回取消函数」。

## 5. 长任务（30s 上限）

宿主对「窗口 → core」的单次请求有 30 秒硬超时，以下操作必须走长任务通道：

- 资料库扫描、单条手动匹配、演员抓取、演员图片导入、条目翻译、插件导入 / 插件调用；
- 系统选择框（用户可能在框里停留很久）；
- 删除远端文件、连接测试、清除刮削 NFO。

实现：`core/runtime/jobs.ts` 维护 `method → handler` 表；窗口调 `coreJob({ method, args })` 拿 `jobId`，
后台执行完广播 `core:job:done`；`src/api/job.ts` 在挂载前注册常驻监听，按 `jobId` 把结果交还给 Promise。
任务本身不因窗口关闭而取消（扫描 / 抓取继续，进度照广播）。

> 注意：系统选择框走的是长任务，但 core 调 `ctx.dialog.open` 本身还受 30s 能力超时限制；
> 用户在框里停留超过 30 秒仍会失败，窗口侧把它转成「选择超时，请重新选择。」。

## 6. 媒体地址与流

原 `storage://` 私有协议换成 **core 里的本机 HTTP 服务**（`core/modules/media/mediaServer.ts`）：

- 只绑 `127.0.0.1`，随机端口 + 一次性 token：`http://127.0.0.1:<port>/p/<token>/...`；
- 路径形状与旧地址一致：`{存储ID}/{媒体ID}/{文件名}`、`{连接ID}/path/{编码路径}`、`actor/{图片ID}/{文件名}`；
- 服务把请求原样交给 `handleMediaRequest`（`mediaProtocol.ts`）：视频按 Range 读（本机 / WebDAV / SMB / OpenList），
  图片与 NFO 走本机缓存；失败 404 + 日志；
- 启动后调用 `setMediaBaseUrl(baseUrl)`，`buildMediaUrl()` / `buildActorImageUrl()` / `buildFilePreviewUrl()`
  生成的就是可播放地址；窗口侧在 `initAppInfo()` 时拿同一个基地址注入自己那份 `@common`；
- CSP 由清单顶层 `csp` 追加 `img-src / media-src / connect-src http://127.0.0.1:*`。

## 7. 数据与密钥

可写数据按语义分到宿主给的六类目录，统一由 `core/runtime/paths.ts` 注入（`onReady` 里 `initPaths(ctx.paths.*)`），
业务模块只调 `dataPath()` / `configPath()` / `cachePath()` / `logPath()` / `tempPath()`：

| 目录 | 落盘内容 |
| --- | --- |
| `ctx.paths.data` | 系统库 `db/vault-scrape.db`、离线库 `db/r18.db*`、演员图片 `media/actor/`、用户导入的插件源码 `plugin/<kind>/<id>.js` |
| `ctx.paths.config` | 设置 `settings.json`、连接配置 `connections.json`、插件索引 `plugin/<kind>/plugins.json`、窗口 UI 偏好 `ui-prefs.json`、密钥 `secret.key` |
| `ctx.paths.cache` | 远端媒体 / 预览下载缓存 `media/` |
| `ctx.paths.log` | 刮削任务文件日志 `scrape/` |
| `ctx.paths.temp` | 刮削资源下载临时文件 `scrape/`（宿主启动时清理） |
| `ctx.paths.pluginRoot` | 只读包内资源（`assets/schema.sql` 建表 SQL） |

- 离线包（`r18.db.import` / `.old` / 下载包）整体留在 `data/db/`：换库靠同目录 `renameSync` 原子替换，
  跨卷（data 与 temp 可能不同盘）会 EXDEV；下载包需跨会话保留，temp 启动即清。
- 窗口偏好（主题档位、侧栏折叠、各页选中项）经 `uiPrefsGetAll` / `uiPrefsSet` 存 `config/ui-prefs.json`，
  窗口侧 `src/global/UiPrefs.ts` 是 live computed + 异步落盘，不再用 localStorage（沙箱数据会被清理）。
- 表结构 = `src-dashou/assets/schema.sql`；仓储在 `core/db/repo/`，统一用 `columns.ts` 的 camelCase 列清单；
- 布尔列（`nsfw_protection` / `local_first` / `move_enabled` / `locked`）在 SQLite 里是 0/1，
  仓储映射时用 `boolOf()` 转成 boolean，写入时转回 0/1；
- 敏感值（连接密码、插件环境变量）用 `utils/secretCodec.ts` 的 AES-256-GCM 加密，
  密钥是配置目录里的 `secret.key`（首次运行生成，0600）。

**ctx 能力 vs Node 内置的边界**（按搭手官方口径）：路径、窗口、对话框、事件、平台判断、日志这些
「宿主可感知」的能力一律走 ctx——`ctx.paths` 六类目录、`ctx.window` / `ctx.dialog` / `ctx.event`，
平台用 `await ctx.os.platform()`（core-base 声明 `os:allow-platform`），core 日志统一走 `ctx.log`
（经 `core/runtime/host.ts` 的 `log()`，不走网关、无需权限），诊断用的 `process.versions.node` 保留。
数据库、媒体流式传输、刮削 HTTP、本机媒体服务则继续用 core 的 Node 内置能力：`node:sqlite` 提供关系表 /
事务 / WAL（`ctx.store` 是 ≤1MB 的 KV，无法表达），媒体文件靠 `createReadStream` 流式传输（`ctx.fs` 只有整包
读写，大文件会爆内存），刮削请求需要跟随重定向 / http / 并发（`ctx.http` 仅 https、不跟随重定向、单包 8MB）。
宿主文档明确 core 的 `fs` / `http` 是「便利 + 审计」而非安全边界，这些用法本身合规。

## 8. 已知边界

- 插件没有托盘 / 自动更新 / 自定义协议；窗口关闭由用户显式操作，`resident: true` 让 core 在窗口关光后继续跑长任务；
- 播放只能用内置 artplayer，mpv 相关模块已删除；
- 系统选择框单次停留上限 30 秒（宿主能力超时）；
- 远端文件操作（列表 / 读写 / 删除）也受 30s 上限约束；特别慢的 NAS 上可能出现超时后操作仍在后台完成的情况，
  此时以重新拉取的结果为准。
