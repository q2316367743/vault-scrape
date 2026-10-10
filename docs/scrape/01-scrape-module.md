# 刮削模块（主进程）

## 1. 定位与入口

刮削模块把「选一个资料库 → 逐级浏览勾选影片（或整库待刮削候选）→ 按插件顺序刮削 → 按资料库策略落盘」这条链路做成**主进程单例任务**：任务与逐文件结果先落 sqlite，再向渲染层推送进度事件，因此渲染窗口关闭、切换 tab 或重新打开后，拉一次快照就能复原进度。

- 渲染层入口有两个：工作台页面（[工作台页面](../page/03-workspace-page.md)）逐级浏览后勾选启动；影视墙资料库抽屉里的整库「刮削」（[影视墙页面](../page/04-media-wall-page.md)）。两处都只经 `@/api` 的 `scrapeApi` / `libraryApi` 调用，不触碰 `window.preload`。
- **候选与刮削器都来自资料库**：候选是本库 `scrapedAt = 0` 的影片条目，刮削器是 `library.scrapers`（见 [资料库](../media/01-media-library.md)）。工作台**不再扫盘、不再自己建索引**，`FileConnection` 上也已经没有 `scrapers` 字段。
- preload 桥：`src/preload/src/modules/scrape/scrape.ts`（`scrapeApi`）与 `scrapeChannels.ts`（通道常量，主进程通过别名 `~` 引用同一份定义）。
- 主进程实现：`src/main/src/modules/scrape/`。
- 公共类型：`src/common/types/scrape/`（`keyword` / `media` / `asset` / `naming` / `nfo` / `error` / `result` / `task`）。
- 数据表：`task`（任务）与 `scrape_file`（逐文件结果），见 [SQLite 存储](../data/01-sqlite-storage.md)。

`scrape_file` 一行 = 一个待刮削文件的最终状态：

| 字段 | 含义 |
| --- | --- |
| `id` | `${taskId}:${扫描时的 path}`，任务内唯一 |
| `taskId` / `path` / `name` | 所属任务、扫描时的原始连接内路径、文件名 |
| `itemId` | 本次刮削的条目 ID（`media_item.id`）；解析不到条目时为空串 |
| `finalPath` | 流水线算出的最终路径（成功重命名 / 移动之后）；未改名时与 `path` 相同，改名 / 移动后由 `updateSourcePath` 同步写回 `media_source.path`，两者始终一致 |
| `keyword` | 文件名解析出的搜索关键词 |
| `status` | `pending` / `running` / `success` / `failed` / `skipped` |
| `pluginId` / `title` | 最终命中的插件与插件标题，未命中为空串 |
| `message` | 结果说明（含失败原因或重命名后的新路径） |
| `updatedAt` | 毫秒时间戳 |

条目元数据与图片不再走 `scrape_file`：刮削成功后由单文件流水线直接写进 `media_item` / `media_image`（见第 5 节），`scrape_file` 只保留任务内的进度与结果。

## 2. 目录结构

```
src/main/src/modules/scrape/
├── scrapeRunner.ts       # 任务编排：单任务互斥、并发调度、取消 / 继续、启动时中断标记、按条目启动（startScrapeTaskForEntries）
├── scrapeFileJob.ts      # 单文件流水线：插件顺序与补全、命名、下载、NFO、移动、条目元数据与图片回写
├── scrapeLocalAsset.ts   # `imageSaveMode='appdata'` 时把资源写进 `~/.vault-scrape/media/images/<itemId>/`
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

## 3. 候选来源：资料库的待刮削条目

刮削不再由「选存储 + 扫一层根目录」发起，候选与刮削器全部来自资料库（[资料库](../media/01-media-library.md)）：

- `libraryScrape.pendingEntries(libraryId)` 取本库 `scrapedAt === 0` 的**影片**条目（`listPendingMovieItems`）；主源取 `path` 与条目 `path` 相同的那条，没有就用第一条；`keyword` 由 `extractKeyword(item.name)` 解析，识别不到时退回条目上的 `num`。**注意**：扫描后条目即使已有 NFO / 图片（影视墙显示「已刮削」），只要没真跑过刮削，`scrapedAt` 仍是 0，依旧会出现在候选里——展示口径与刮削队列口径是两件事。
- **同目录 + 同番号只留第一条**：以「目录 + 番号（或清洗后的关键词）」为键，后出现的候选带 `duplicateOf = 先出现者的名称`，任务里会被置为 `skipped`（`与 … 同番号，已跳过`），避免重复下载资源。判定完全在主进程完成，渲染层只负责展示与禁止勾选。
- **一次只跑一组**：`planLibraryScrape(libraryId, itemIds?)` 按 `(connectionId, 所属根目录)` 分组（同一个任务只能有一个 `dirPath` 基准，`owningPath` 取最长命中的库内根目录），只启动条目最多的那一组，其余保持 `scrapedAt = 0` 留待下次。
- 工作台的逐级浏览也归资料库：`scrape:browse { libraryId, dirPath }` 直接读 `mediaWall.browseLibrary`（条目在上次扫描时已经建好），**刮削阶段不再扫盘、也没有 `indexDirectory` 建索引这一步**。
- **视频扩展名判定改由「设置 → 资料库」的后缀清单决定**：扫描建条目时 `libraryScan` 用 `libraryExtensionsOf(loadSetting().library, library.type)` 取该库类型的清单，作为 `extensions` 传给 `indexLibraryPath`，`mediaIndexer.ts` 的私有 `isVideoExtension(extensions, extname)` 逐文件判定（**扫描器不再有硬编码后缀**）。`src/common/types/scrape/keyword.ts:11` 的 `SCRAPE_VIDEO_EXTENSIONS` 与 `keyword.ts:132` 的 `isVideoExt()` 保留，但**扫描链路已不再用它们**；`isVideoExt()` 仍被 `src/common/types/media/source.ts:121` 用来判断媒体源类型（`if (isVideoExt(ext) || type.startsWith('video/')) return 'video'`），所以它们不是死代码，不要删除。
- **两个入口，最终都进同一个任务**：`library:scrape { libraryId }`（资料库抽屉的整库「刮削」→ `startLibraryScrape`，候选 = 全库 `scrapedAt = 0` 的影片）与 `scrape:start { libraryId, itemIds }`（工作台勾选 → `startLibraryScrapeByIds`，`itemIds` 是 **`media_item.id`** 列表，不是路径或文件名）。`library:scrape` 在 `planLibraryScrape` 返回空时报 `notFound`「资料库里没有待刮削的影片」；按 id 刮削时空列表报 `invalidArgument`「请至少选择一个待刮削的影片」、所选都已不在待刮削列表时同样报 `notFound`。
- **空刮削器 = 不刮削**：两条入口最终都由 `libraryScrape.runPlan()` 在启动任务前检查 `library.scrapers.length === 0` 并抛 `pluginMissing`，**不再回落到存储（连接）的刮削器**（连接上已没有 `scrapers` 字段）。资料库表单允许一个刮削器都不勾选，此时该库照常扫描，只是没有自动 / 手动刮削入口。
- **自动刮削的四种跳过原因**：扫描完成后 `libraryScan.autoScrape(library, pending)` 按固定顺序判断——① 设置 `scrape.autoScrapeAfterScan` 关闭 →「设置中已关闭「扫描后自动刮削」」；② 该库 `scrapers` 为空 →「该资料库未配置刮削器，已跳过刮削」；③ `pending === 0` →「没有待刮削的影片」；④ 已有刮削任务在跑 →「已有刮削任务在运行，可稍后手动刮削」。四种情况都只影响自动刮削，**扫描结果本身照常返回**（见 [资料库](../media/01-media-library.md)）。

## 4. 任务与调度（`scrapeRunner.ts`）

- **同时在跑的任务只有一个**：第二次「开始」直接返回 `busy` 错误信封。
- 并发度来自 `scrape.concurrency`（默认 3），用游标式 worker 池消费待刮削队列；每处理 `scrape.restAfterCount` 个文件（默认 50，0 表示不休息）插入 `scrape.restDuration` 秒（默认 60）的休息，请求之间的节奏延迟由 HTTP 客户端按 `scrape.requestDelay` 处理。
- 每个文件的状态变化都**先写 `scrape_file` 再广播** `scrape:progress`（任务快照 + 本次变化的文件）。
- `cancel(taskId)` 把任务置为 `paused`，未处理的文件仍是 `pending`，因此可以「继续」；`resume(taskId)` 只把 `pending` 的文件重新入队，并沿用该任务启动时记下的刮削器绑定（`taskScrapers: Map<taskId, string[]>`）与所属库（`taskLibraries: Map<taskId, libraryId>`）。这两份映射在内存里，**应用重启后丢失**：继续旧任务时先用 `findLibraryByPath(task.connectionId, task.dirPath)` 按 `(connectionId, dirPath)` 找回所属资料库，再回落该库的 `scrapers`；连库都找不到时抛 `pluginMissing`「找不到任务所属的资料库，请重新选择刮削器」。
- 应用启动时 `markInterruptedOnStartup()` 把残留的 `running` 任务标记为 `interrupted`（`src/main/index.ts` 在启动日志之后调用，并写一条 warn 日志），避免界面上永远停着「刮削中」。
- 单文件失败只累计 `failed` 并写结果行，**不中断**其余文件；任务终态：失败数为 0 → `success`，否则 `failed`，消息形如 `完成 X 个，失败 Y 个，跳过 Z 个`。
- 任务进入终态（含取消 / 中断）后**不再重建任何索引**（`rebuildIndexAfterTask()` 已随资源索引一起删除）：改名 / 移动由 `updateSourcePath` 就地更新 `media_source.path`（媒体源 id 不变），条目元数据与图片由流水线直接写 `media_item` / `media_image`，影视墙下次取数就是新状态。工作台与资料库因此都不需要「刮削完再扫一遍」。
- 启动前的入参校验（`assertInside`）：路径必须位于 `dirPath` 的**子树内**（等于根路径、或以 `根 + '/'` 开头；`dirPath` 为 `/` 时放行全部），否则 `invalidArgument`（文案 `文件不在所选根目录下：<路径>`）。这比早期「必须直接位于根目录之下」放宽了一层，资料库才能把整个子树的视频排进同一个任务；没有可用插件时返回 `pluginMissing`。
- **每个文件按自己所在目录处理**：工作目录取 `dirnameRemotePath(item.path)`，命名产出与成功后移动都落在文件自己的目录，而不是整批共用一个 `dirPath`（工作台只扫一层时两者恰好相同，资料库递归扫描时不同）。
- **可用插件只认资料库绑定**：`usablePlugins(scraperIds)`——`scraperIds` 一定来自 `library.scrapers`，**不再回落到存储配置**（连接上已没有 `scrapers` 字段）：
  - 只保留 id 在库配置里、且当前可用（已启用、编译通过）的插件，**顺序仍沿用插件页保存的顺序**，不会按配置顺序重排；
  - 库里失效的 id（插件被删 / 停用 / 编译失败）在运行时直接跳过，不在界面上自动清除（保存资料库时表单会把它们补进穿梭框右侧、标注「（已失效）」显示）。
  过滤后为空时抛 `pluginMissing`，两种文案区分原因：`该资料库未配置刮削器（空刮削器表示不刮削），请先在资料库设置里选择`（库上没配，`libraryScrape.runPlan` 在启动任务前就拦下）/ `资料库配置的刮削器均不可用，请重新选择`（配了但都失效）。
- 所选文件全部被判定为重复时不启动任务，直接返回 `success` 快照（`所选文件均被判定为重复，无需刮削`）。
- **按条目启动**：`startScrapeTaskForEntries({ connectionId, libraryId, dirPath, taskName, entries, scraperIds })` 是任务启动的**唯一入口**，两个入口最终都走它（资料库抽屉的整库「刮削」由 `planLibraryScrape` 产出一组条目；工作台走 `scrape:start { libraryId, itemIds }` → `startLibraryScrapeByIds`）。它依次校验：正在跑 → `busy`；缺数据源 / 缺资料库 ID / 条目为空 → `invalidArgument`；库不存在 → `notFound`；路径不在 `dirPath` 子树内 → `invalidArgument`；刮削器不可用 → `pluginMissing`。启动时把 `scraperIds` 与 `libraryId` 分别记进 `taskScrapers` / `taskLibraries` 供「继续」沿用；`taskName` 为空时回落目录名（`basenameRemotePath(dirPath)`，根目录给「根目录」），资料库传的是 `资料库 · <名称>`。

## 5. 单文件流水线（`scrapeFileJob.ts`）

`runFileJob(context)` 按顺序做四件事：**跨插件补全 → 计算命名与工作目录 → 下载资源 → 写 NFO 与移动视频**。

1. **跨插件补全**：按可用插件顺序，第一个插件先 `search(keyword)` → 选择候选 → `detail(movieId)`；拿到详情后，只对「仍缺失的、且被下载选项勾选的」封面类（`thumb` / `poster` / `fanart`）调 `covers`、花絮类（`still` / `trailer`）调 `extras`。`isSatisfied(detail, assets, enabled)` 命中即 `break`——即「A 插件只刮到 NFO、B 插件补封面」的补全语义，同时提前停止避免多余请求。
   - 候选选择由 `scrapeMatcher.ts` 的 `pickCandidate(candidates, num, keyword)` 负责（番号优先、关键词兜底）。
   - 单个插件抛错只 `log.warn` 后继续下一个插件，不让一个坏插件毁掉整个文件。
   - 到最后一个插件都没有可信详情时：失败的文件留在原目录不动（原 `file.moveAfterFailure` 与 `path.failedOutputDir` 已随设置瘦身删除），结果行状态 `failed`、消息 `未找到匹配的刮削结果`。
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
     | `still` | `[前缀]still{序号}.{ext}` | `scrape.fanartDirName`（默认 `extrafanart`），多集作品的第 2 集起再加一层 `S{集数}` |
     | `trailer` | `[前缀]trailer[序号].{ext}` | 工作目录 |

     扩展名由 URL 推断（`assetExtension`，图片兜底 `jpg`、视频兜底 `mp4`）。
4. **NFO 与移动**：库级 `writeNfo` 为真时按全局 `naming.nfoFileNaming` 写 NFO（`movie` → `movie.nfo`；`filename` → `{基名}.nfo`；`both` → 两者，基名为 `movie` 时去重），全局 `download.keepNfo` 为真且已存在则跳过。最后库级 `renameEnabled` 决定视频最终名（为假时保持原文件名与原基名），目标路径与原始路径不同时 `client.move(overwrite: false)`，移动失败抛 `ScrapeError('moveFailed')`。算出的最终路径随 `ScrapeJobOutcome.finalPath` 写进 `scrape_file.final_path`，同时 `updateSourcePath(source.id, …)` 把 `media_source` 就地更新（未改名时等于扫描时的 `path`）。

流水线还负责把结果**直接写回条目**：`updateItemMetadata(entry.itemId, metadataOf(detail, entry.num, pluginId))` 整组覆盖刮削元数据（标题 / 番号 / 简介 / 评分 / 类型 / 外部 ID / `scrapedAt` / `scraperId`），`replaceItemImages(entry.itemId, images)` 整组替换条目图片。**落盘后不需要额外通知扫描**：下一次扫描会按用途把这些产物（固定名、`{视频基名}-` 前缀名与 `extrafanart` 下的 `stillN`）收进 `media_image`，并据此把条目算成「已刮削」（见 [资料库](../media/01-media-library.md)）。图片落盘位置由**库级** `imageSaveMode` 决定：

- `media`（默认）：与视频同目录，文件名沿用上表的 kind 映射，图片行的 `connectionId` 是真实连接；
- `appdata`：写进 `~/.vault-scrape/media/images/<itemId>/`（`writeAppDataAsset` 把相对路径里的分隔符换成下划线，不建多级子目录），图片行的 `connectionId` 是伪连接 `appdata`，地址 `storage://appdata/<图片ID>/<文件名>` 由协议层用 `net.fetch(pathToFileURL)` 直读，并复核路径确实在该目录之下。

写库失败只影响这一个文件的结果行，不影响任务其余文件；条目图片在没有刮到图片时保持原样。

工作目录由**库级** `moveEnabled` / `moveDirectory` 决定：开启时取 `resolveOutputDir(policy.moveDirectory, context.dirPath)`（空串 = 原地；以 `/` 开头按连接内绝对路径；否则视为连接根下的子目录），关闭时**留在原地**并在 `renameEnabled` 为假时保持原文件名；失败文件同样留在原目录不动。

## 6. 资源下载与日志落文件

- `scrapeAssets.ts`：`downloadAssetToTemp(asset, signal)` 把资源下载到 `tmpdir()/vault-scrape-scrape` 下的随机文件名，重试次数沿用 `network.retryCount`（间隔 500ms），取消时抛 `ScrapeError('cancelled')`，最终失败抛 `downloadFailed`；返回的 `cleanup()` 负责删除临时文件（调用方在 `finally` 里执行）。资源请求方法只认 `asset.method === 'POST'`，缺省为 GET。
- `scrapeLogFile.ts`：`createScrapeRunLog(taskName)` 对应「文件行为 → 保存日志到文件」。开关 `file.saveLogToFile` 为假时所有方法都是空操作且**不创建目录**；为真时写入 `~/.vault-scrape/log/scrape/{清洗后的任务名}-YYYYMMDD-HHmmss.log`（用 `appendFile` + 一次 `mkdir(recursive)`），同时仍写数据库日志（`appendLog`）。文件写失败只 `console.error`，**绝不再写数据库日志**，避免日志失败递归。

## 7. IPC 契约与错误码

| 通道 | 入参 | 返回 |
| --- | --- | --- |
| `scrape:browse` | `{ libraryId, dirPath }` | `MediaBrowseEntry[]`（`dirPath` 为 `/` 表示库根） |
| `scrape:start` | `{ libraryId, itemIds }` | 任务快照 |
| `scrape:cancel` | `{ taskId }` | 任务快照 |
| `scrape:resume` | `{ taskId }` | 任务快照 |
| `scrape:getTask` | `{ taskId }` | `{ task, files }` |
| `scrape:listTasks` | `{ limit? }` | 最近任务列表 |
| `scrape:running` | — | 主进程是否有任务在跑 |
| `scrape:progress` | 主进程 → 渲染层推送 | `{ task, file }` |

- 所有 invoke 都返回信封 `ScrapeResult<T>`（`{ ok: true, data }` / `{ ok: false, code, message }`），**不跨 IPC 抛异常**：`contextBridge` 传递自定义错误的附加属性不可靠。
- 错误码见 `src/common/types/scrape/error.ts`：`busy` / `notFound` / `invalidArgument` / `unsupported` / `pluginMissing` / `downloadFailed` / `writeFailed` / `moveFailed` / `nfoFailed` / `cancelled` / `unknown`，每个都有中文文案；渲染层只按 `code` 做逻辑判断，不解析 `message`。
- 资料库**不新增 `scrape:*` 通道**：库侧在主进程内部调 `startScrapeTaskForEntries()`，因此任务列表、进度事件、取消 / 继续全部复用这一套；工作台只额外用 `scrape:browse` 拿逐级目录（读的是 `mediaWall.browseLibrary`，见 [资料库](../media/01-media-library.md)）。
- 资料库自己的入口在 `library` 域：`library:scan` / `library:cancelScan` / `library:scrape { libraryId }` / `library:progress`，契约与错误码见 [资料库](../media/01-media-library.md)。

## 8. 手工验证清单

按项目约定只跑 `yarn typecheck`（不 build、不写测试），运行时行为手工验证：

1. 在工作台选一个资料库，逐级点进目录：应看到该库扫描出来的目录与影片（不再有「扫描根目录」这个动作；扫描只在影视墙的资料库抽屉里）。
2. 同一目录放两个同番号文件（如 `ABC-001.mp4` 与 `ABC-001-CD2.mp4`）：后者应带「重复」标记且无法勾选。
3. 启动任务：任务卡片出现进度，逐行状态从「待刮削」变为「刮削中 → 已完成」；把窗口切到别的 tab 再回来、或关掉窗口重开，进度与结果应保持不变。
4. 只启用「A 插件只给 NFO、B 插件给封面」的组合：结果行应显示命中的插件，且封面文件确实出现（验证跨插件补全）。
5. 把资料库的「重命名文件」关掉：NFO 与封面文件名应与视频原文件名同名（`{基名}.nfo`、`{基名}-poster.jpg` 等）。
6. 关闭资料库的「移动文件」：视频与附属文件应留在原目录；开启并填写「目标目录」后，结果行消息里应带上新的路径。
7. 打开「文件行为 → 保存日志到文件」：`~/.vault-scrape/log/scrape/` 下应出现本次任务的日志文件；关掉开关后不应新增文件、也不应新增目录。
8. 任务跑一半点「取消」，再点「继续」：剩余文件应继续执行；跑到一半强制退出应用后重开，任务状态应显示「已中断」而不是「刮削中」。
9. 编辑资料库、只保留一个刮削器后保存：启动任务，结果行里的插件应只出现选中的那个；把该插件停用后再启动，应提示「资料库配置的刮削器均不可用，请重新选择」。**一个刮削器都不选**时表单允许保存（空 = 不刮削）：该库的「刮削」按钮变为禁用，扫描后自动刮削回报「该资料库未配置刮削器，已跳过刮削」，绕过界面直接调 `library:scrape` 报「该资料库未配置刮削器（空刮削器表示不刮削），请先在资料库设置里选择」。
10. 刮削一个能产出封面的文件：结果行的「封面」列应显示图片（图片已作为条目图片写进 `media_image`，影视墙上同一影片的封面也应更新）；开启 NSFW 保护且该库标记了 NSFW 时，封面先显示遮罩、点击后才能看到；重启应用后封面仍应显示。
11. 从资料库启动一个跨多层的刮削任务（影视墙 →「资料库」→「刮削」）：任务应出现在本页任务列表、任务名形如 `资料库 · 名称`，结果行分布在不同子目录里；刮削成功后影视墙上该影片的标题与封面**直接更新**（不再需要「刮削完再扫一遍」这一步）。
12. 一个资料库挂两个媒体目录、各放若干未刮削影片：点一次「刮削」只启动条目最多的那一组，另一组条目 `scrapedAt` 仍为 0；再点一次「刮削」才轮到它（见 §3「一次只跑一组」）。
13. `itemId` 口径：在工作台勾选若干行启动后，对应 `scrape_file.item_id` 应等于这些条目的 `media_item.id`（不是路径、也不是文件名）；在资料库抽屉反向操作 `scrape:start` 时传一个不存在的 id，应报「所选影片已不在待刮削列表中」。
