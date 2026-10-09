# 刮削模块（主进程）

## 1. 定位与入口

刮削模块把「选中一个存储 → 扫描根目录 → 按插件顺序刮削 → 按设置落盘」这条链路做成**主进程单例任务**：任务与逐文件结果先落 sqlite，再向渲染层推送进度事件，因此渲染窗口关闭、切换 tab 或重新打开后，拉一次快照就能复原进度。

- 渲染层入口：工作台页面（[工作台页面](../page/03-workspace-page.md)），只经 `@/api` 的 `scrapeApi` 调用，不触碰 `window.preload`。
- preload 桥：`src/preload/src/modules/scrape/scrape.ts`（`scrapeApi`）与 `scrapeChannels.ts`（通道常量，主进程通过别名 `~` 引用同一份定义）。
- 主进程实现：`src/main/src/modules/scrape/`。
- 公共类型：`src/common/types/scrape/`（`keyword` / `media` / `asset` / `naming` / `nfo` / `error` / `result` / `task`）。
- 数据表：`task`（任务）与 `scrape_file`（逐文件结果），见 [SQLite 存储](../data/01-sqlite-storage.md)。

`scrape_file` 一行 = 一个待刮削文件的最终状态：

| 字段 | 含义 |
| --- | --- |
| `id` | `${taskId}:${path}`，任务内唯一 |
| `taskId` / `path` / `name` | 所属任务、扫描时的原始连接内路径、文件名 |
| `keyword` | 文件名解析出的搜索关键词 |
| `status` | `pending` / `running` / `success` / `failed` / `skipped` |
| `pluginId` / `title` | 最终命中的插件与插件标题，未命中为空串 |
| `coverId` / `coverPath` | 本次刮削产出的封面资源 id 与远端路径（按 `poster` → `thumb` → `fanart` 取第一张），空串表示没有封面；渲染层用它拼 `storage://` 地址显示封面 |
| `message` | 结果说明（含失败原因或重命名后的新路径） |
| `updatedAt` | 毫秒时间戳 |

## 2. 目录结构

```
src/main/src/modules/scrape/
├── scrapeRunner.ts       # 任务编排：单任务互斥、并发调度、取消 / 继续、启动时中断标记
├── scrapeFileJob.ts      # 单文件流水线：插件顺序与补全、命名、下载、NFO、移动
├── scrapeVideo.ts        # 根目录扫描（只读一层）与重复番号判定
├── scrapePluginData.ts   # vm 沙箱返回值按结构收窄（候选 / 详情 / 资源）
├── scrapeMatcher.ts      # 候选选择
├── scrapeAssets.ts       # 资源下载到临时目录 + 清理
├── scrapeLogFile.ts      # 「保存日志到文件」的落盘日志
├── scrapeEvents.ts       # 进度广播给所有窗口
└── scrapeIpc.ts          # IPC handler 与入参收窄

src/common/types/scrape/
├── keyword.ts   # 视频扩展名、关键词与番号解析、分盘标记
├── media.ts     # 分盘标记归一化、partTokenOf
├── asset.ts     # 资源 kind → 文件名 / 相对路径的落盘计划
├── naming.ts    # 命名模板渲染、清洗、截断
├── nfo.ts       # NFO XML 生成
├── error.ts     # ScrapeErrorCode / ScrapeError / describeScrapeError
├── result.ts    # IPC 信封（ScrapeResult）
└── task.ts      # 任务快照、逐文件记录、扫描条目、进度事件
```

## 3. 根目录扫描

`listRootVideos({ connectionId, dirPath })`：

- **只读根目录一层，不递归子目录**（对齐「只读取根目录文件」的需求）；`dirPath` 经 `normalizeRemotePath` 归一。
- 只取 `type === 'file'` 且扩展名命中 `SCRAPE_VIDEO_EXTENSIONS`（`mp4` / `mkv` / `avi` / `mov` / `webm` / `wmv` / `flv` / `ts` 等，见 `src/common/types/scrape/keyword.ts`）的条目。
- 按文件名 `localeCompare` 排序，保证「第一次出现的那个」在重复判定里稳定。
- `keyword` 由 `extractKeyword(name)` 解析（番号识别失败时退回清洗后的关键词），`num` 为 `normalizeNum` 后的番号；同番号的后出现文件写 `duplicateOf = 先出现的路径`，任务里会被置为 `skipped`（`与 … 同番号，已跳过`），避免重复下载资源。
- 「重复」判定与跳过都由主进程完成，渲染层只负责展示与禁止勾选。
- **扫描即建索引**：进入过滤逻辑之前先调 `indexDirectory(connectionId, dirPath)`（见 [资源索引](../resource/01-resource-index.md)），把该目录下**所有文件**写进 `resource` 表，并直接复用返回的目录项做后续过滤——扫描因此只向远端列一次目录。

## 4. 任务与调度（`scrapeRunner.ts`）

- **同时在跑的任务只有一个**：第二次「开始」直接返回 `busy` 错误信封。
- 并发度来自 `scrape.concurrency`（默认 3），用游标式 worker 池消费待刮削队列；每处理 `scrape.restAfterCount` 个文件（默认 50，0 表示不休息）插入 `scrape.restDuration` 秒（默认 60）的休息，请求之间的节奏延迟由 HTTP 客户端按 `scrape.requestDelay` 处理。
- 每个文件的状态变化都**先写 `scrape_file` 再广播** `scrape:progress`（任务快照 + 本次变化的文件）。
- `cancel(taskId)` 把任务置为 `paused`，未处理的文件仍是 `pending`，因此可以「继续」；`resume(taskId)` 只把 `pending` 的文件重新入队。
- 应用启动时 `markInterruptedOnStartup()` 把残留的 `running` 任务标记为 `interrupted`（`src/main/index.ts` 在启动日志之后调用，并写一条 warn 日志），避免界面上永远停着「刮削中」。
- 单文件失败只累计 `failed` 并写结果行，**不中断**其余文件；任务终态：失败数为 0 → `success`，否则 `failed`，消息形如 `完成 X 个，失败 Y 个，跳过 Z 个`。
- 任务进入终态（含取消 / 中断）后调用 `rebuildIndexAfterTask()`：对本次的 `dirPath` 重建资源索引；开启了「成功后移动文件」时，再对 `successOutputDir` 对应的目录重建一次（新位置的文件要有索引才能显示封面）。重建失败只记 warn，不影响任务结果。
- 启动前的入参校验：路径必须位于 `dirPath` 之下（`dirname` 必须等于 `dirPath`，否则 `invalidArgument`）；没有可用插件时返回 `pluginMissing`。
- **可用插件按存储过滤**：`usablePlugins(connectionId)` 取该连接的 `scrapers` 配置——
  - 空数组（未配置）= 不限制，使用全部「已启用且 `loadError` 为空」的插件；
  - 非空 = 只保留 id 在配置里、且当前可用（已启用、编译通过）的插件，**顺序仍沿用插件页保存的顺序**，不会按配置顺序重排；
  - 配置里失效的 id（插件被删/停用/编译失败）在运行时直接跳过，不在界面上自动清除。
  过滤后为空时抛 `pluginMissing`，两种文案区分原因：`没有可用的刮削插件，请先在插件页安装并启用插件`（无配置且一个插件都没有）/ `该存储配置的刮削器均不可用，请在存储设置中重新选择`（配置了但都失效）。
- 所选文件全部被判定为重复时不启动任务，直接返回 `success` 快照（`所选文件均被判定为重复，无需刮削`）。

## 5. 单文件流水线（`scrapeFileJob.ts`）

`runFileJob(context)` 按顺序做四件事：**跨插件补全 → 计算命名与工作目录 → 下载资源 → 写 NFO 与移动视频**。

1. **跨插件补全**：按可用插件顺序，第一个插件先 `search(keyword)` → 选择候选 → `detail(movieId)`；拿到详情后，只对「仍缺失的、且被下载选项勾选的」封面类（`thumb` / `poster` / `fanart`）调 `covers`、花絮类（`still` / `trailer`）调 `extras`。`isSatisfied(detail, assets, enabled)` 命中即 `break`——即「A 插件只刮到 NFO、B 插件补封面」的补全语义，同时提前停止避免多余请求。
   - 候选选择由 `scrapeMatcher.ts` 的 `pickCandidate(candidates, num, keyword)` 负责（番号优先、关键词兜底）。
   - 单个插件抛错只 `log.warn` 后继续下一个插件，不让一个坏插件毁掉整个文件。
   - 到最后一个插件都没有可信详情时：按 `file.moveAfterFailure` 决定是否移入失败目录，结果行状态 `failed`、消息 `未找到匹配的刮削结果`。
2. **命名**：`renderTemplate(naming.fileTemplate, detail, naming)` → `sanitizeName` → `truncateName(..., naming.fileNameMaxLength)`，为空时回落到原文件名；再按 `naming.partStyle` 用 `normalizePartToken(partTokenOf(原文件名), partStyle)` 把分盘标记（CD/PART/DISC）附在末尾，避免模板同名导致 CD1/CD2 互相覆盖。成功后不重命名时，视频名与附属文件基名都取原文件名。
3. **资源落盘**：逐个被勾选的 kind、逐条资源调用 `resolveAssetFile` 得到文件名与相对路径，再由 `writeAsset` 落盘：
   - `keepXxx` 为真且目标已存在 → 跳过（消息记「目标已存在，按保留设置跳过」）；
   - 否则 `mkdir(父目录, recursive)` → 下载到临时文件 → `client.upload(localPath, target, { overwrite: true })` → `finally` 清理临时文件；
   - 单条资源失败只 `log.warn` 并计数，不影响其它资源。
   - 文件名映射（`forceMovieStyle` 或 `naming.assetNaming === 'movie'` 时统一加 `{视频基名}-` 前缀）：

     | kind | 文件名 | 位置 |
     | --- | --- | --- |
     | `thumb` | `[前缀]thumb.{ext}` | 工作目录 |
     | `poster` | `[前缀]poster.{ext}` | 工作目录 |
     | `fanart` | `[前缀]fanart.{ext}` | 工作目录 |
     | `still` | `[前缀]still{序号}.{ext}` | `path.fanartDirName`（默认 `extrafanart`），多集作品的第 2 集起再加一层 `S{集数}` |
     | `trailer` | `[前缀]trailer[序号].{ext}` | 工作目录 |

     扩展名由 URL 推断（`assetExtension`，图片兜底 `jpg`、视频兜底 `mp4`）。
4. **NFO 与移动**：`download.generateNfo` 为真时按 `download.nfoFileNaming` 写 NFO（`movie` → `movie.nfo`；`filename` → `{基名}.nfo`；`both` → 两者，基名为 `movie` 时去重），`keepNfo` 为真且已存在则跳过。最后 `file.renameAfterSuccess` 决定视频最终名，目标路径与原始路径不同时 `client.move(overwrite: false)`，移动失败抛 `ScrapeError('moveFailed')`。

流水线还会顺带记录本次产出的封面：资源循环里把第一张 `thumb` / `poster` / `fanart` 的落盘路径记进 `coverByKind`（**按 keep 设置跳过、但目标文件已存在时同样记录**，因为文件本来就在那儿），成功返回时按 `poster` → `thumb` → `fanart` 顺序挑一张，以 `ScrapeCoverRef { kind, path, id }` 形式挂在 `ScrapeJobOutcome.cover` 上；`id = resourceIdOf(connectionId, path)`。任务调度把它写进 `scrape_file.cover_id` / `cover_path`，渲染层据此拼出 `storage://` 封面地址。失败或未产出封面时两个字段为空串。

工作目录由 `file.moveAfterSuccess` 决定：为真时取 `path.successOutputDir`（空串=原地；以 `/` 开头按连接内绝对路径；否则视为连接根下的子目录），为假时**留在原地**（即视频仍在根目录）；失败文件同理按 `path.failedOutputDir` 移动。

## 6. 资源下载与日志落文件

- `scrapeAssets.ts`：`downloadAssetToTemp(asset, signal)` 把资源下载到 `tmpdir()/vault-scrape-scrape` 下的随机文件名，重试次数沿用 `network.retryCount`（间隔 500ms），取消时抛 `ScrapeError('cancelled')`，最终失败抛 `downloadFailed`；返回的 `cleanup()` 负责删除临时文件（调用方在 `finally` 里执行）。资源请求方法只认 `asset.method === 'POST'`，缺省为 GET。
- `scrapeLogFile.ts`：`createScrapeRunLog(taskName)` 对应「文件行为 → 保存日志到文件」。开关 `file.saveLogToFile` 为假时所有方法都是空操作且**不创建目录**；为真时写入 `~/.vault-scrape/log/scrape/{清洗后的任务名}-YYYYMMDD-HHmmss.log`（用 `appendFile` + 一次 `mkdir(recursive)`），同时仍写数据库日志（`appendLog`）。文件写失败只 `console.error`，**绝不再写数据库日志**，避免日志失败递归。

## 7. IPC 契约与错误码

| 通道 | 入参 | 返回 |
| --- | --- | --- |
| `scrape:listVideos` | `{ connectionId, dirPath }` | `ScrapeScanEntry[]` |
| `scrape:start` | `{ connectionId, dirPath, paths }` | 任务快照 |
| `scrape:cancel` | `{ taskId }` | 任务快照 |
| `scrape:resume` | `{ taskId }` | 任务快照 |
| `scrape:getTask` | `{ taskId }` | `{ task, files }` |
| `scrape:listTasks` | `{ limit? }` | 最近任务列表 |
| `scrape:running` | — | 主进程是否有任务在跑 |
| `scrape:progress` | 主进程 → 渲染层推送 | `{ task, file }` |

- 所有 invoke 都返回信封 `ScrapeResult<T>`（`{ ok: true, data }` / `{ ok: false, code, message }`），**不跨 IPC 抛异常**：`contextBridge` 传递自定义错误的附加属性不可靠。
- 错误码见 `src/common/types/scrape/error.ts`：`busy` / `notFound` / `invalidArgument` / `unsupported` / `pluginMissing` / `downloadFailed` / `writeFailed` / `moveFailed` / `nfoFailed` / `cancelled` / `unknown`，每个都有中文文案；渲染层只按 `code` 做逻辑判断，不解析 `message`。

## 8. 手工验证清单

按项目约定只跑 `yarn typecheck`（不 build、不写测试），运行时行为手工验证：

1. 在工作台选一个本地数据源与根目录，点「扫描根目录」：只应出现根目录一层内的视频文件，子目录里的文件不应出现。
2. 同一目录放两个同番号文件（如 `ABC-001.mp4` 与 `ABC-001-CD2.mp4`）：后者应带「重复」标记且无法勾选。
3. 启动任务：任务卡片出现进度，逐行状态从「待刮削」变为「刮削中 → 已完成」；把窗口切到别的 tab 再回来、或关掉窗口重开，进度与结果应保持不变。
4. 只启用「A 插件只给 NFO、B 插件给封面」的组合：结果行应显示命中的插件，且封面文件确实出现（验证跨插件补全）。
5. 把「文件行为 → 成功后不重命名」打开：NFO 与封面文件名应与视频文件同名（`{基名}.nfo`、`{基名}-poster.jpg` 等）。
6. 关闭「成功后移动文件」：视频与附属文件应留在根目录；开启并设置成功目录后，结果行消息里应带上新的路径。
7. 打开「文件行为 → 保存日志到文件」：`~/.vault-scrape/log/scrape/` 下应出现本次任务的日志文件；关掉开关后不应新增文件、也不应新增目录。
8. 任务跑一半点「取消」，再点「继续」：剩余文件应继续执行；跑到一半强制退出应用后重开，任务状态应显示「已中断」而不是「刮削中」。
9. 编辑数据源、只勾选一个刮削器后保存：扫描并启动任务，结果行里的插件应只出现勾选的那个；把该插件停用后再启动，应提示「该存储配置的刮削器均不可用，请在存储设置中重新选择」；清空勾选（不选任何刮削器）后应回到「全部已启用插件」。
10. 刮削一个能产出封面的文件：结果行的「封面」列应显示图片；开启 NSFW 保护且该数据源标记了 NSFW 时，封面先显示遮罩、点击后才能看到；重启应用后封面仍应显示（封面走 `scrape_file` 兜底，不依赖索引重建）。
