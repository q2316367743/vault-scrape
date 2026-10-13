# 刮削模块（主进程）

## 1. 定位与入口

刮削模块把「选一个资料库 → 逐级浏览勾选影片（或整库待刮削候选）→ 按**影片信息插件**顺序刮削 → 按资料库策略落盘」这条链路做成**主进程单例任务**：任务与逐文件结果先落 sqlite，再向渲染层推送进度事件，因此渲染窗口关闭、切换 tab 或重新打开后，拉一次快照就能复原进度。

- 渲染层入口只剩一个：影视墙资料库抽屉里的整库「刮削」（[影视墙页面](../page/04-media-wall-page.md)），由 `startLibraryScrape` 取本库全部待刮削候选。原「工作台」（选资料库 → 逐级浏览 → 勾选影片排队）已整体下线，刮削的进度 / 取消 / 继续 / 逐文件结果改在概览页看（[刮削进度与详情页](../page/03-scrape-detail-page.md)）。调用只经 `@/api` 的 `scrapeApi` / `libraryApi`，不触碰 `window.preload`。
- **候选与刮削器都来自资料库**：候选是本库 `scrapedAt = 0` **且 `has_nfo = 0`** 的**影片**条目（剧集库则是 `scrapedAt = 0` 且 `has_nfo = 0` 的**剧集**条目，见 §3 与 §5.3），刮削器是 `library.scrapers`（见 [资料库](../media/01-media-library.md)）。这里存的 id 是**影片信息插件**（`kind: 'movie'`）的 id，运行时从影片类别注册表 `moviePlugins` 取用，演员信息插件不参与影片刮削。**刮削阶段不扫盘、也不自己建索引**，`FileConnection` 上已经没有 `scrapers` 字段。按库类型分派（影片版 / 剧集版）收口在 `libraryScrapeDispatch.ts` 的 `isTvLibrary()`。
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
├── scrapeRunSlot.ts      # 运行槽位单例（takeRunSlot / releaseRunSlot / currentRun / isRunActive），批量任务与手动匹配共用
├── scrapeManualPolicy.ts # 手动匹配的策略小模块：任务名前缀、forced 内存表（rememberForced / forcedOf / forgetForced）、applyForcedMatch（localFirst:false + CLEAR_KEEP）、assertManualTaskResumable（重启后拒绝继续）
├── scrapeUsablePlugins.ts # 「资料库刮削器 ∩ 可用插件」挑选（usablePlugins / assertUsablePlugins / LibraryPlugins），任务与手动匹配共用
├── scrapeFileJob.ts      # 单文件流水线**编排**：本地优先、跨影片信息插件补全、命名、下载、NFO、移动（目录型条目整体改名）、条目回写，最后挂参演演员并排队补全
├── scrapeSeriesJob.ts    # 剧集流水线**编排**（`runSeriesJob`）：一次处理**整部剧**——剧集目录改名、季目录对齐、tvshow.nfo / season.nfo / 每集 NFO 与集文件命名移动（见 §5.3）
├── scrapeJobTypes.ts     # 流水线的上下文与结果类型（ScrapeJobContext / ScrapeJobOutcome / ScrapeSettingsSnapshot / ScrapeLibraryPolicy / ScrapePluginRef，后者指向影片信息插件）
├── scrapeJobPlan.ts      # 计算与下载：基名、资源计划、跨影片信息插件收集（collectFromPlugins）、本地图片就位、向连接上传（downloadAsset）
├── scrapeJobApply.ts     # 写回与收尾：元数据映射（metadataOf，`genres` 供剧集 NFO 的 `<genre>`）、媒体源路径刷新（refreshSourcePath 单文件条目 / refreshItemDir 目录型条目）、还原记录合并（mergeRestoreFiles / carryRestore，剧集与影片共用）、搬空后删原目录
├── scrapeSeriesAssets.ts # 剧集资源落盘：远端集索引（indexRemoteEpisodes，键 `<季>:<集号>`）、单张 kind 取舍、剧照命名、搬空目录清理（pruneEmptyDirs）
├── scrapeLayout.ts       # 目录规范：文件夹名 / 影片文件名 / NFO 文件名（三者同名）与工作目录解析（剧集流水线复用它的 movieFileName / nfoFileName）
├── scrapeLocalMeta.ts    # 本地优先：读同目录本地 NFO（parseNfoXml）与本地图片并归类（**剧集流水线暂不支持本地优先**）
├── scrapePluginData.ts   # vm 沙箱返回值按结构收窄（候选 / 详情 / 资源；含分集 `episode.plot`）
├── scrapeMatcher.ts      # 候选选择：影片 pickCandidate（先按番号，对不上回落标题判定）、剧集 pickSeriesCandidate（年份池 + 标题判定，剧集没有番号）
├── scrapeAssets.ts       # 资源下载到临时目录 + 清理
├── scrapeLogFile.ts      # 「保存日志到文件」的落盘日志
├── scrapeEvents.ts       # 进度广播给所有窗口
└── scrapeIpc.ts          # IPC handler 与入参收窄

src/common/types/scrape/
├── keyword.ts   # 视频扩展名、关键词与番号解析、分盘标记
├── media.ts     # 分盘标记归一化、partTokenOf
├── asset.ts     # 资源 kind → 文件名 / 相对路径的落盘计划
├── naming.ts    # 命名模板渲染、清洗、截断；剧集多的 renderSeasonFolderName / renderEpisodeTemplate
├── nfo.ts       # NFO XML 生成（含供影视墙「还原刮削前」使用的还原记录，剧集共用这套 appendRestore / parseNfoRestore）
├── tvNfo.ts     # 剧集 NFO 三件套：buildTvShowNfoXml / buildSeasonNfoXml / buildEpisodeNfoXml（第 4 参都是还原记录）
├── error.ts     # ScrapeErrorCode / ScrapeError / describeScrapeError
├── result.ts    # IPC 信封（ScrapeResult）
└── task.ts      # 任务快照、逐文件记录、扫描条目、进度事件
```

> 命名规则（季号 / 集号 / 花絮目录与文件名 / 剧集关键词 / 影片名与版本）已统一到 `src/common/types/media/mediaRules.ts`：剧集与影片**共用同一套纯函数**（`parseEpisodeNumbers` / `seasonNumberOfDir` / `isExtraVideoDir` / `extraKindOfName` / `seriesKeywordOf` / `seriesYearOf` / `parseMediaName` / `isVersionOfFolder`），原来的 `src/common/types/scrape/episode.ts` 已删除。

## 3. 候选来源：资料库的待刮削条目

刮削不再由「选存储 + 扫一层根目录」发起，候选与刮削器全部来自资料库（[资料库](../media/01-media-library.md)）：

- `libraryScrape.pendingEntries(libraryId)` 取本库 `scrapedAt === 0` **且 `has_nfo = 0`** 的**影片**条目（`listPendingMovieItems`）；**主源统一走 `primarySourceOf(item, listSourcesByItem(item.id))`**（`mediaWall.ts`）：先取 `path` 与条目 `path` 相同的那条媒体源（文件型条目），否则取「基础名与条目目录名相同」的那个版本（**目录型条目**，见 §5.1），再退回第一条；`keyword` 由 `extractKeyword(item.name)` 解析，识别不到时退回条目上的 `num`。**注意**：`has_nfo` 由扫描维护，含义是「磁盘上已有 NFO」——这类条目**视为已经刮过，不再进候选**（自动刮削与整库 / 按 id 批量刮削都排除掉它），只能从详情页「更多 → 手动匹配」手动刮（见 [手动匹配](../media/04-manual-match.md)）；反过来，条目只有图片、`scrapedAt` 仍是 0 且没有 NFO 时照样在候选里——展示口径与刮削队列口径是两件事。
- **体积过滤**：库级 `minFileSizeMb`（新建库默认 `DEFAULT_MIN_FILE_SIZE_MB` = 10，`0` = 不过滤）在 `collectCandidates` 里直接排除小于该体积的媒体源（`source.size > 0 && size < minBytes`；读不到体积时放行），与扫描的过滤是同一口径（见 [资料库](../media/01-media-library.md)）。
- **同目录 + 同番号只留第一条**：以「目录 + 番号（或清洗后的关键词）」为键，后出现的候选带 `duplicateOf = 先出现者的名称`，任务里会被置为 `skipped`（`与 … 同番号，已跳过`），避免重复下载资源。判定完全在主进程完成，渲染层只负责展示与禁止勾选。
- **剧集库的候选是「整部剧」**：`libraryScrapeDispatch.pendingEntries` 在 `type === 'tv'` 时走 `pendingSeriesEntries` → `collectSeriesCandidates`，取本库 `scrapedAt === 0` **且 `has_nfo = 0`** 的 **series 条目**（`listPendingSeriesItems` + `seriesStatsOf`）——剧集目录下已有 `tvshow.nfo` 的整部剧同样视为已刮过，只能在剧集详情页手动刮；**不做体积过滤、剧集之间不去重**，`keyword = seriesKeywordOf(item.name)`（**剧集目录名**，清洗后去掉结尾年份，见 §5.3）、`num` 恒为空串。分组仍按 `(connectionId, owningPath)` 分组、一次只跑一组，任务行的 `path` 就是**剧集目录**（`scrapeRunner.runFiles` 里 `dirPath = isSeries ? item.path : dirnameRemotePath(item.path)`），一次任务处理整个剧集。
- **一次只跑一组**：`planLibraryScrape(libraryId, itemIds?)` 按 `(connectionId, 所属根目录)` 分组（同一个任务只能有一个 `dirPath` 基准，`owningPath` 取最长命中的库内根目录），只启动条目最多的那一组，其余保持 `scrapedAt = 0` 留待下次。
- 目录浏览也归资料库：`scrape:browse { libraryId, dirPath }` 直接读 `mediaWall.browseLibrary`（条目在上次扫描时已经建好）；渲染层当前没有调用方，**通道保留**（后续做「按条目挑片」入口时直接复用）。**刮削阶段不再扫盘、也没有 `indexDirectory` 建索引这一步**。
- **视频扩展名判定改由「设置 → 资料库」的后缀清单决定**：扫描建条目时 `libraryScan` 用 `libraryExtensionsOf(loadSetting().library, library.type)` 取该库类型的清单，作为 `extensions` 传给 `indexLibraryPath`，`mediaIndexer.ts` 的私有 `isVideoExtension(extensions, extname)` 逐文件判定（**扫描器不再有硬编码后缀**）。`src/common/types/scrape/keyword.ts:11` 的 `SCRAPE_VIDEO_EXTENSIONS` 与 `keyword.ts:132` 的 `isVideoExt()` 保留，但**扫描链路已不再用它们**；`isVideoExt()` 仍被 `src/common/types/media/source.ts:121` 用来判断媒体源类型（`if (isVideoExt(ext) || type.startsWith('video/')) return 'video'`），所以它们不是死代码，不要删除。
- **两个入口，最终都进同一个任务**：`library:scrape { libraryId }`（资料库抽屉的整库「刮削」→ `startLibraryScrape`，候选 = 全库 `scrapedAt = 0` 且 `has_nfo = 0` 的影片）与 `scrape:start { libraryId, itemIds }`（按条目挑片 → `startLibraryScrapeByIds`，`itemIds` 是 **`media_item.id`** 列表，不是路径或文件名；渲染层当前没有调用方，通道保留）。`library:scrape` 在 `planLibraryScrape` 返回空时报 `notFound`「资料库里没有待刮削的影片」；按 id 刮削时空列表报 `invalidArgument`「请至少选择一个待刮削的影片」、所选都已不在待刮削列表时同样报 `notFound`。**剧集库同一入口换文案**：「资料库里没有待刮削的剧集」/「请至少选择一个待刮削的剧集」/「所选剧集已不在待刮削列表中」。
- **空刮削器 = 不刮削**：两条入口最终都由 `libraryScrape.runPlan()` 在启动任务前检查 `library.scrapers.length === 0` 并抛 `pluginMissing`，**不再回落到存储（连接）的刮削器**（连接上已没有 `scrapers` 字段）。资料库表单允许一个刮削器都不勾选，此时该库照常扫描，只是没有自动 / 手动刮削入口。
- **自动刮削的四种跳过原因**：扫描完成后 `libraryScan.autoScrape(library, pending)` 按固定顺序判断——① 设置 `scrape.autoScrapeAfterScan` 关闭 →「设置中已关闭「扫描后自动刮削」」；② 该库 `scrapers` 为空 →「该资料库未配置刮削器，已跳过刮削」；③ `pending === 0` →「没有待刮削的条目」（影片库数影片、剧集库数剧集，**带 NFO 的条目不算待刮削**）；④ 已有刮削任务在跑 →「已有刮削任务在运行，可稍后手动刮削」。四种情况都只影响自动刮削，**扫描结果本身照常返回**（见 [资料库](../media/01-media-library.md)）。

## 4. 任务与调度（`scrapeRunner.ts`）

- **同时在跑的任务只有一个**：第二次「开始」直接返回 `busy` 错误信封。这个「单例」由 `scrapeRunSlot.ts` 承载（`takeRunSlot(taskId)` / `releaseRunSlot()` / `currentRun()` / `isRunActive()`），**批量任务与详情页的手动匹配共用它**——谁在跑，另一方拿到的都是 `busy`（互斥而不是排队，手动匹配见 [手动匹配](../media/04-manual-match.md)）。
- 并发度来自 `scrape.concurrency`（默认 3），用游标式 worker 池消费待刮削队列；每处理 `scrape.restAfterCount` 个文件（默认 50，0 表示不休息）插入 `scrape.restDuration` 秒（默认 60）的休息，请求之间的节奏延迟由 HTTP 客户端按 `scrape.requestDelay` 处理。
- 每个文件的状态变化都**先写 `scrape_file` 再广播** `scrape:progress`（任务快照 + 本次变化的文件）。
- `cancel(taskId)` 把任务置为 `paused`，未处理的文件仍是 `pending`，因此可以「继续」；`resume(taskId)` 只把 `pending` 的文件重新入队，并沿用该任务启动时记下的刮削器绑定（`taskScrapers: Map<taskId, string[]>`）与所属库（`taskLibraries: Map<taskId, libraryId>`）。这两份映射在内存里，**应用重启后丢失**：继续旧任务时先用 `findLibraryByPath(task.connectionId, task.dirPath)` 按 `(connectionId, dirPath)` 找回所属资料库，再回落该库的 `scrapers`；连库都找不到时抛 `pluginMissing`「找不到任务所属的资料库，请重新选择刮削器」。**手动匹配建的任务在重启后直接拒绝继续**：它靠内存里的 `forced` 才能保证「还是用户选的那条候选」，重启后这份内存态已丢，`resume` 调 `scrapeManualPolicy.assertManualTaskResumable(taskId, task.name)`（按任务名前缀 `手动匹配 ` 识别、`forcedOf(taskId)` 判在不在）抛 `invalidArgument`「手动匹配的任务在应用重启后无法继续，请在详情页重新手动匹配」（同一次运行内可正常继续 / 取消）。
- 应用启动时 `markInterruptedOnStartup()` 把残留的 `running` 任务标记为 `interrupted`（`src/main/index.ts` 在启动日志之后调用，并写一条 warn 日志），避免界面上永远停着「刮削中」。
- 单文件失败只累计 `failed` 并写结果行，**不中断**其余文件；任务终态：失败数为 0 → `success`，否则 `failed`，消息形如 `完成 X 个，失败 Y 个，跳过 Z 个`。
- 任务进入终态（含取消 / 中断）后**不再重建任何索引**（`rebuildIndexAfterTask()` 已随资源索引一起删除）：改名 / 移动由 `updateSourcePath` 就地更新 `media_source.path`（媒体源 id 不变），条目元数据与图片由流水线直接写 `media_item` / `media_image`，影视墙下次取数就是新状态。资料库因此不需要「刮削完再扫一遍」。
- 启动前的入参校验（`assertInside`）：路径必须位于 `dirPath` 的**子树内**（等于根路径、或以 `根 + '/'` 开头；`dirPath` 为 `/` 时放行全部），否则 `invalidArgument`（文案 `文件不在所选根目录下：<路径>`）。这比早期「必须直接位于根目录之下」放宽了一层，资料库才能把整个子树的视频排进同一个任务；没有可用插件时返回 `pluginMissing`。
- **每个文件按自己所在目录处理**：工作目录取 `dirnameRemotePath(item.path)`，命名产出与成功后移动都落在文件自己的目录，而不是整批共用一个 `dirPath`（早期「只扫一层」的入口与整库递归扫描的差别就在这里）。
- **可用插件只认资料库绑定**：`usablePlugins(scraperIds)`（`scrapeUsablePlugins.ts`，任务与手动匹配共用）从**影片信息插件**注册表 `moviePlugins` 里取候选——`scraperIds` 一定来自 `library.scrapers`，**不再回落到存储配置**（连接上已没有 `scrapers` 字段）：
  - 只保留 id 在库配置里、且当前可用（已启用、编译通过）的插件，**顺序仍沿用插件页保存的顺序**，不会按配置顺序重排；
  - 库里失效的 id（插件被删 / 停用 / 编译失败）在运行时直接跳过，不在界面上自动清除（保存资料库时表单会把它们补进刮削器多选项、label 标注「（已失效）」显示，取消勾选才丢弃）。
  过滤后为空时抛 `pluginMissing`，两种文案区分原因：`该资料库未配置刮削器（空刮削器表示不刮削），请先在资料库设置里选择`（库上没配，`libraryScrape.runPlan` 在启动任务前就拦下）/ `资料库配置的刮削器均不可用，请重新选择`（配了但都失效）。
- 所选文件全部被判定为重复时不启动任务，直接返回 `success` 快照（`所选文件均被判定为重复，无需刮削`）。
- **按条目启动**：`startScrapeTaskForEntries({ connectionId, libraryId, dirPath, taskName, entries, scraperIds, forced? })` 是任务启动的**唯一入口**，三个入口最终都走它（资料库抽屉的整库「刮削」由 `planLibraryScrape` 产出一组条目；按条目挑片走 `scrape:start { libraryId, itemIds }` → `startLibraryScrapeByIds`；详情页「手动匹配」由 `scrapeManualMatch.matchItemManually` 直接调它）。它依次校验：正在跑 → `busy`；缺数据源 / 缺资料库 ID / 条目为空 → `invalidArgument`；库不存在 → `notFound`；路径不在 `dirPath` 子树内 → `invalidArgument`；刮削器不可用 → `pluginMissing`。启动时把 `scraperIds` 与 `libraryId` 分别记进 `taskScrapers` / `taskLibraries` 供「继续」沿用，`forced` 非空时调 `scrapeManualPolicy.rememberForced(taskId, forced)` 记进内存表（见 §5.2）；`taskName` 为空时回落目录名（`basenameRemotePath(dirPath)`，根目录给「根目录」），资料库传的是 `资料库 · <名称>`，手动匹配传的是 `手动匹配 <名字>`。

## 5. 单文件流水线（`scrapeFileJob.ts`）

`runFileJob(context)` 按顺序做这些事：**本地优先读取 → 跨影片信息插件补全 → 计算基名与影片文件夹 → 资源落盘 → 写 NFO → 移动视频并回写库 → 回写条目元数据与图片 → 挂参演演员并排队补全**。编排留在 `scrapeFileJob.ts`（264 行），计算与写回拆在 `scrapeJobPlan.ts` / `scrapeJobApply.ts`，上下文类型在 `scrapeJobTypes.ts`——三者都只被本流水线使用，行为与拆分前一致。

### 5.1 目录规范

刮削后的影片**一定**落在影片文件夹里，且文件夹名 = 影片文件名 = NFO 文件名 = `base`（文件名以父文件夹全名为前缀 —— 对齐 Jellyfin）：

```text
<工作目录>/<base>/
├── <base>.<ext>          # 影片文件（扩展名沿用原文件）
├── <base>.nfo            # NFO（唯一一份，不再区分 movie.nfo / 文件名.nfo）
├── poster.jpg            # kind=poster  → MediaImageType primary
├── backdrop.jpg          # kind=fanart  → backdrop
├── thumb.jpg             # kind=thumb   → thumb
├── banner.jpg            # kind=banner  → banner（插件没给就不生成）
├── logo.png              # kind=logo    → logo（插件没给就不生成）
└── extrafanart/          # 目录名取 `scrape.fanartDirName`（默认 extrafanart）
    ├── fanart1.jpg       # kind=still
    └── fanart2.jpg
```

- **先判条目形态**（`scrapeFileJob.ts:74-75`）：`dirTyped = getItem(entry.itemId)?.path === context.dirPath && item.path !== entry.path`。目录型条目 = 条目 `path` 是**影片文件夹**、任务行 `path`（`entry.path`）是里面的主版本视频，于是 `context.dirPath`（`dirnameRemotePath(entry.path)`）正好等于影片文件夹；文件型条目 = 条目 `path` 就是视频文件（散装、未成目录）。两形态走两条路：
  - **目录型（Jellyfin 规范形态，占多数）**：`base` 从**目录名**算起（`originalBase = basenameRemotePath(context.dirPath)`，本地 NFO 也按目录名找），要改名就 `client.move(context.dirPath, movieDir)` **整体搬这个目录**，视频文件名**一个都不改** —— 多版本靠 `- 1080p` / `- dc` 这类后缀区分，改名会毁掉版本信息（并且会把其中一个版本挑出来当正片）；搬完 `refreshItemDir(client, connectionId, entry.itemId, movieDir)` 一次性把条目 `path` 与**所有**媒体源路径挪到新目录；**移动失败回落为「保持原目录」**（warn `影片目录改名失败（保持原目录）：…`、`base = 原目录名`，绝不退化成文件型条目），WebDAV 这类连接对目录移动能力不确定时要靠这条兜底；搬走后**不做**空父目录清理（`context.dirPath` 指的是已经搬走的旧路径）。
  - **文件型**：视频 `client.move(entry.path, <movieDir>/<base><ext>)`（已在目标位置就不动），成功后就地 `refreshSourcePath(...)` 刷新这个源，再按设置决定要不要删搬空的原目录。
- 工作目录（`rootDir`）= 库级 `moveEnabled` 为真时取 `resolveOutputDir(policy.moveDirectory, context.dirPath)`（空串 = 原地；以 `/` 开头按连接内绝对路径；否则视为连接根下的子目录）；否则 —— **目录型条目或当前目录已经叫 `base`**（上次刮削的成果）时取它的**上一层**（否则会套娃成 `<base>/<base>/`），其余取 `context.dirPath`。**「移动」只是把整个影片文件夹挪到目标目录**：无论开不开移动，影片都会先进 `<工作目录>/<base>/`。
- 资料库根自己就是影片文件夹时（库直接指向某个影片目录，条目是目录型）只在原地按规范改名，不再套一层。
- 文件名映射由 `src/common/types/scrape/asset.ts` 的 `resolveAssetName(kind, source, index, context)` 给出（`source` 是插件 URL 或本地已有文件名）：`thumb` / `poster` / `fanart` / `banner` / `logo` 是固定名（`FIXED_BASE_NAMES`，fanart → `backdrop`），`still` → `fanart<序号>.<ext>` 落在 `fanartDirName` 下，`trailer` → `trailer[序号].<ext>`；`naming.assetNaming === 'movie'` 时统一加 `{base}-` 前缀。扩展名由 URL / 原文件名推断（`assetExtension`；图片兜底 `jpg`、`logo` 兜底 `png`、视频兜底 `mp4`）。

### 5.2 流水线顺序

1. **本地优先**（库级 `localFirst` 为真时）：`scrapeLocalMeta.readLocalMeta(client, { dirPath, originalBase, fanartDirName })` 读同目录的本地 NFO（候选 `${原基名}.nfo` → `movie.nfo`，用 `parseNfoXml` 解析；**目录型条目的「原基名」就是影片目录名**，而 `readLocalNfo` **只接受根元素 `<movie>`** —— 同一目录里放着 `tvshow.nfo` / `season.nfo` 之类时不会被当成影片元数据，解析不出或种类不符都当作没有）与本地图片（固定名 / `{原基名}-` 前缀名 / 与影片同名的图 / `extrafanart` 下的全部图片，按 `LocalImage.kind` 归类）。`needRemote = 没有可用本地详情 || 某个启用 kind 本地没有 || 本地 NFO 缺关键信息（needsRemoteInfo：缺简介、缺演员、片商 / 厂牌 / 系列全空）`——命中才联网，且**只补缺的**：`mergeDetail(本地, 远程)` 逐字段以本地非空值优先。本地详情够用且不缺资源时，结果行插件列写「本地 NFO」，一次网络请求都不发。
2. **跨影片信息插件补全**：按可用插件顺序，第一个插件先 `search(keyword)` → `pickCandidate(candidates, num, keyword)` 选候选 → `detail(movieId)`；拿到详情后，只对「仍缺失的、且被下载选项勾选的」封面类（`thumb` / `poster` / `fanart` / `banner` / `logo`，走 `covers`）与花絮类（`still` / `trailer`，走 `extras`）请求资源。`isSatisfied(detail, assets, enabled)` 计入本地已就位的 kind，命中即 `break`——即「A 插件只刮到 NFO、B 插件补封面」的补全语义，同时提前停止避免多余请求。单个插件抛错只 `log.warn` 后继续下一个插件，不让一个坏插件毁掉整个文件。到最后一个插件都没有可信详情时：结果行 `failed`、消息 `未找到匹配的刮削结果`，文件留在原目录不动（原 `file.moveAfterFailure` 与 `path.failedOutputDir` 已随设置瘦身删除）。
    **强制候选**：`ScrapeJobContext.forced = { pluginId, movieId }`（`scrapeJobTypes.ts`）非空且命中当前插件时，**跳过 `search` 与候选挑选**，直接用该 `movieId` 调 `detail`，其余（`covers` / `extras` 补全、`isSatisfied` 提前停止）不变。它由详情页「手动匹配」随任务传入：`scrapeManualMatch.matchItemManually` → `startScrapeTaskForEntries({ …, forced })` → `scrapeManualPolicy` 的内存表（`rememberForced` / `forcedOf`）→ `execute()` 取出后经 `applyForcedMatch(policy, settings, forced)` ① 把 `forced` 传给 `runFiles` / `ScrapeJobContext`，② 把 policy 改成 `localFirst: false`，③ 把 `settings.download` 的 5 个 `keepXxx` 全置 false（`CLEAR_KEEP`），任务结束时 `forgetForced(task.id)`。影片与剧集共用同一个 `collectFromPlugins`，所以两条流水线都支持（见 [手动匹配](../media/04-manual-match.md)）。
   **候选匹配口径**（`scrapeMatcher.ts`）：`num` 非空时先找 `isSameNum` 相等的候选；**对不上不再直接判失败**，而是与没有 `num` 时同路走**标题判定**——唯一候选 → 候选标题包含关键词 → 关键词包含候选标题（`normalizeNum` 后 ≥3 字符才算，多条命中取**标题最长**的一条）。这条回落是给**没有番号概念**的插件（如 [TMDB](../plugin/05-tmdb-plugin.md)）留的路：`Inception.2010.1080p.BluRay.mkv` 会被宿主猜出番号 `INCEPTION 2010`（见 §3），而插件候选不带番号，硬卡番号就永远匹配不上；副作用是番号对不上的成人站点插件也会转向标题判定。
3. **命名（一定会重命名，没有开关）**：`base = resolveVideoBase(detail, originalBase, naming)` = `renderTemplate(naming.fileTemplate, detail, naming)` → `sanitizeName` → `truncateName(..., naming.fileNameMaxLength)`，为空时回落到原文件名；再按 `naming.partStyle` 用 `normalizePartToken(partTokenOf(原文件名), partStyle)` 把分盘标记（CD/PART/DISC）附在末尾，避免模板同名导致 CD1/CD2 互相覆盖。`base` 同时决定文件夹名、影片文件名与 NFO 文件名。
4. **资源落盘**：
   - 本地图片先「就位」（`adoptLocalImage`）：目标规范名已存在就直接沿用；否则 `client.move` 到规范名（同一目录内改名），失败只 `log.warn` 并按原路径入库，不中断；`poster` / `thumb` / `fanart` / `banner` / `logo` 这类单张 kind 只取本地第一张，`still` 全收。
   - 缺的 kind 再联网下载：`keepXxx` 为真且目标已存在 → 跳过（消息记「目标已存在，按保留设置跳过」）；否则 `ensureParent(mkdir recursive)` → 下载到临时文件 → `client.upload(localPath, target, { overwrite: true })` → `finally` 清理临时文件；单条资源失败只计数，不影响其它资源与任务其余文件。
   - 每个落盘成功的资源都进 `planted`，最后统一转成 `media_image` 行（`connectionId` 就是真实连接，**图片一定与影片同目录**，没有 `imageSaveMode`）。
5. **NFO 一律写**：`buildNfoXml(detail, settings.naming, artworkOf(planted), restore)` 写到 `<base>.nfo`（`overwrite: true`），并带上 `<thumb aspect="poster">` / `<banner>` / `<logo>` / `<fanart>` 等图片标签，让 NFO 自带封面信息。写成功后，如果这一步读过一份路径不同的本地 NFO，就删掉它（信息已经并进新 NFO，留着只会两份不一致）。
   NFO 末尾还会写一段**还原记录**，供影视墙的「还原刮削前」用（见[影视墙页面 §4](../page/04-media-wall-page.md)）：`<originalfilename>` 是刮削前的视频文件名、`<originaldirectory>` 是刮削前所在目录，另外本次**真的写下或搬过**的附属文件各一条 `<plantedfile relative="…" original="…" />`——联网下载的图片 / 预告片没有 `original`（还原时直接删），被 `adoptLocalImage` 改名就位的本地图片带 `original`（还原时搬回去）；沿用磁盘上已有文件（保留设置跳过）与没挪过位置的本地图片都不进记录，免得还原时删掉用户自己的文件。取值时机在移动视频之前，此时 `context.dirPath` + `entry.name` 正是刮削前的位置。如果这一步读到的旧本地 NFO 里已经带还原记录，新 NFO **原样沿用最外层那一份**位置（`fileName` / `directory` 保持最初的值），文件记录则是「本次写下 / 搬动的 + 旧的、这次没再出现的搬动记录（原文件还在时）」的合并结果——所以反复刮削后还原仍然回到最初的位置；旧版本刮削的 NFO 没有这段记录时，还原退化成「只清数据 + 删 NFO」。
6. **移动视频并回写**（按形态走两条路，形态判定见 5.1）：
   - **目录型**：整个影片目录已在第 2 步改好名（`client.move(context.dirPath, movieDir)`），这一步**不动视频文件名**，只用 `<movieDir>/<原视频名>` 作为结果行里的新路径 / `finalPath`；条目路径与**所有**媒体源路径已由 `refreshItemDir` 一次性改完，也不做空目录清理（`context.dirPath` 已是搬走的旧路径）。
   - **文件型**：`client.move(entry.path, <movieDir>/<base><ext>, { overwrite: false })`（已在目标位置就不动），失败抛 `ScrapeError('moveFailed')`；成功后就地 `refreshSourcePath(context, targetPath)` 更新 `media_source.path`（源 id 不变），`settings.file.removeEmptyFolder` 为真时再删掉搬空的原目录（`removeSourceFolderIfEmpty`：原目录不等于影片目录、不是连接根、不在该库的根目录清单里、且 `list` 为空才删）。

之后把结果**直接写回条目**：`updateItemMetadata(entry.itemId, metadataOf(detail, entry.num, pluginId, entry.itemId))` 整组覆盖刮削元数据（标题 / 番号 / 简介 / 评分 / 类型 / 片商 / **厂牌 / 系列 / 导演** / 外部 ID / `scrapedAt` / `scraperId`；本地优先跳过联网时沿用上次的 `providerIds` / `scraperId`）。`metadataOf` 里片商 / 厂牌 / 系列 / 导演是**各自一列**（`detail.maker` / `label` / `series` / `director`），只有 `studio` 仍进 JSON 列 `studios`——以前这四项被压进 `studios` 或干脆丢掉，详情页要显示就只能去读磁盘 NFO，现在直读库（见[影视墙页面 §4](../page/04-media-wall-page.md)）。`replaceItemImages(entry.itemId, images)` 整组替换条目图片（**注意**：它先整组 delete 再 upsert，所以本地保留下来的图片也必须进 `images`，否则会被删掉）。**落盘后不需要额外通知扫描**：下一次扫描会按用途把这些产物（固定名、`{视频基名}-` 前缀名与 `extrafanart` 下的 `fanartN`）收进 `media_image`，并据此把条目算成「已刮削」（见 [资料库](../media/01-media-library.md)）。

写库失败只影响这一个文件的结果行，不影响任务其余文件；条目图片在没有刮到图片时保持原样。

7. **参演演员接线**：`enqueueItemActorScrape(entry.itemId, detail.actors ?? [], settings.scrape.actorScrape, context.signal)`——先把详情里的演员名单按「姓名 → 别名 → 新建档案」解析，再整组写进 `media_cast`（只存 `item_id` + 姓名归一化键 + 出演顺序，**不存演员 ID**），然后按设置把资料不全（`scrapedAt = 0` / 没头像 / 没生日）的演员排进演员域的串行抓取队列。**名单为空时不动名单**，避免只想补元数据的重刮把已有演员清掉；这一步的异常只写一条 warn 日志（`演员信息写入失败：…`），不影响本文件的刮削结果。同一份名单在**扫描**时也会由 NFO 的 `<actor>` 补齐（未刮削且有 NFO 的条目，见[资料库](../media/01-media-library.md) 4.2）；演员两侧的策略见[演员模块](../actor/01-actor-module.md)。

结果行消息形如 `插件 r18-offline，6 个资源，NFO {base}.nfo，→ /电影/{base}/{base}.mkv`（没有命中插件时插件列写「本地 NFO」，没有产出资源时也会照实写 `0 个资源`）。

### 5.3 剧集库：一次处理整部剧（`scrapeSeriesJob.ts`）

剧集库的一个任务行就是一个**剧集目录**，由 `runSeriesJob(context)` 一次性完成「剧集 → 季 → 集」三层产物；纯 IO 辅助拆在同目录的 `scrapeSeriesAssets.ts`（远端集索引、资源落盘、搬空目录清理）。完整口径（扫描层级、读模型、还原）见 [剧集支持](../media/02-series-support.md)。

**搜索关键字（这是剧集与影片最大的差别）**：剧集用**剧集目录名**当关键词——`entry.keyword = seriesKeywordOf(item.name)`（`extractKeyword` 清洗后**去掉结尾年份**，`Show 2019` → `Show`；年份另有用途），命不中再回落剧集名；`pickSeriesCandidate(candidates, keyword, year)` 先按详情年份（`candidate.date` 前缀）筛出一个池子（池空则退回全部候选），再在池子里按**标题判定**挑一条：**唯一候选** → 「标题 / 番号包含关键词」（`normalizeNum` 后至少 3 个字符才参与）→ 「关键词包含候选标题」（同样 ≥3 字符才算，多条命中取**标题最长**的一条，用来兜住「剧集目录名比插件标题长」如 `The Office US` / `The Last of Us 最后生还者`）；全都不中返回 `null`，换下一个插件，**剧集没有番号**。剧集只发一次 `search`，没有「搜不到再搜一次」的二次查询。

**命名与产物三件套**：模板默认 `seriesFolderTemplate = '{title} ({year})'`、`seasonFolderTemplate = 'Season {season}'`、`episodeFileTemplate = '{showTitle} S{season}E{episode}'`（渲染函数 `renderSeasonFolderName` / `renderEpisodeTemplate`）。剧集目录 = 剧集文件夹，季目录渲染为空时回落 `'Season ' + padNumber(season)`，**集 NFO 与集文件同名**（`nfoFileName(集基名)`），每集剧照是 `<集基名>-thumb.<ext>`（`EPISODE_THUMB_SUFFIX = '-thumb'`），集文件扩展名沿用源文件：

```text
<剧集目录>/                    # seriesFolderTemplate；资料库根自己就是剧集目录时不改名
├── tvshow.nfo                 # buildTvShowNfoXml(…, seriesRestore)
├── poster.jpg / backdrop.jpg / thumb.jpg / banner.jpg / logo.png
└── Season 01/                 # renderSeasonFolderName
    ├── season.nfo             # buildSeasonNfoXml(…, seasonRestore)
    ├── poster.jpg
    ├── Show S01E01.mkv        # renderEpisodeTemplate，扩展名沿用源文件
    ├── Show S01E01.nfo        # buildEpisodeNfoXml（含还原记录）
    └── Show S01E01-thumb.jpg
```

**流程**：① `pickSeriesCandidate` 取详情（拿不到 → 结果行 `failed`「未找到匹配的刮削结果」，目录不动）；② 算剧集目录名后整树 `client.move` + `replacePathPrefix(libraryId, 旧前缀, 新前缀)`——**一次改写 `media_item` / `media_source` / `media_image` 三类路径，条目 id 与父子关系不动**，移动失败降级为逐集移动并 warn；③ 剧集级资源 + `tvshow.nfo`（`landAssets` + `carryRestore` + `mergeRestoreFiles`）；④ 逐季建季目录 + 季海报 + `season.nfo`；⑤ 逐集改名 / 移动 + 剧照 + 集 NFO + 回写元数据（`updateItemMetadata` + `updateItem` + `replaceItemImages`）；⑥ 剧集条目回写 + `enqueueItemActorScrape` + `pruneEmptyDirs`（只删空目录，跳过 `/`、库根及其祖先）。

**同集多版本**：同一季同集号的多个文件（`S01E01.mkv` + `S01E01 - 1080p.mkv`）在扫描侧合成**一条** `episode`（条目 `path` = 自然序第一个，即主版本）。刮削时**只有主版本**会被改名 / 移动 —— `scrapeSeriesJob.ts:267-270` 的 `isPrimary = episodeItem === null || episodeItem.path === file.path`，非主版本 `finalBase = finalPath === targetPath ? base : baseNameOf(file.name)` 保持原文件名；但**每个版本各自写一份自己的同名集 NFO**（扫描侧逐个版本试读，见[资料库 §4.6](../media/01-media-library.md)），元数据只回写一次。详情页本期只播主版本，版本切换 UI 留后续。

**剧集还原记录**：三件套都带还原记录，与影片共用 `nfo.ts` 的 `appendRestore` / `parseNfoRestore`。剧集根记「原剧集目录名 + 原目录」，季记季目录，**集记「原集文件名 + 原目录」**（这是「还原刮削前」逐集搬回的唯一依据）；旧 NFO 里的记录由 `mergeRestoreFiles` 合并、位置沿用最外层那一份，所以反复刮削仍回到最初位置；`carryRestore(context, nfoPath, fallback)` 负责在移动前后把记录带到新路径。

**注意**：剧集库**暂不支持**「优先读取本地 NFO 和图片」（`localFirst`，本地 kind 传空集合）、不做体积过滤、剧集之间不去重；资料库根自己就是剧集目录时只建季目录、不改剧集目录名，并 warn「剧集目录就是资料库目录，只在它下面按规范建季目录：…」。

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
| `scrape:match` | `{ itemId, pluginId, movieId }` | `ScrapeMatchResult`：`{ itemId, taskId }`（只等建任务，不等刮削） |
| `scrape:progress` | 主进程 → 渲染层推送 | `{ task, file }` |

- 所有 invoke 都返回信封 `ScrapeResult<T>`（`{ ok: true, data }` / `{ ok: false, code, message }`），**不跨 IPC 抛异常**：`contextBridge` 传递自定义错误的附加属性不可靠。
- 错误码见 `src/common/types/scrape/error.ts`：`busy` / `notFound` / `invalidArgument` / `unsupported` / `pluginMissing` / `downloadFailed` / `writeFailed` / `moveFailed` / `nfoFailed` / `cancelled` / `unknown`，每个都有中文文案；渲染层只按 `code` 做逻辑判断，不解析 `message`。
- 资料库**不新增 `scrape:*` 通道**：库侧在主进程内部调 `startScrapeTaskForEntries()`，因此任务列表、进度事件、取消 / 继续全部复用这一套；`scrape:browse` 只用来拿逐级目录（读的是 `mediaWall.browseLibrary`，见 [资料库](../media/01-media-library.md)），渲染层当前没有调用方。
- 资料库自己的入口在 `library` 域：`library:scan` / `library:cancelScan` / `library:scrape { libraryId }` / `library:progress`，契约与错误码见 [资料库](../media/01-media-library.md)。
- `scrape:match` 是**手动匹配的建任务入口**：它在主进程内调 `matchItemManually()`——先按资料库口径校验条目 / 插件 / 候选（失败走 `describeScrapeError` 的中文文案），再用 `startScrapeTaskForEntries({ …, forced })` **建一条单文件任务并立即返回 `{ itemId, taskId }`**，不等待流水线。所以它写 `task` / `scrape_file`、照常广播 `scrape:progress`，任务名形如 `手动匹配 <名字>`，概览页与 `/overview/scrape?taskId=…` 都能看到、也能取消。批量任务在跑时返回 `busy`，反之手动匹配在跑时批量任务也拿到 `busy`（共用运行槽位）；重启后这类任务不允许「继续」。完整交互与注意事项见 [手动匹配](../media/04-manual-match.md)。

## 8. 手工验证清单

按项目约定只跑 `yarn typecheck`（不 build、不写测试），运行时行为手工验证：

1. 在影视墙的资料库抽屉点「刮削」启动一次整库刮削：概览页（[刮削进度与详情页](../page/03-scrape-detail-page.md)）的进度卡片与刮削记录应出现该任务，任务名形如 `资料库 · 名称`。
2. 同一目录放两个同番号文件（如 `ABC-001.mp4` 与 `ABC-001-CD2.mp4`）：后者应被置为「已跳过」，说明是「与 … 同番号，已跳过」。
3. 启动任务：概览页的进度卡片出现进度（进详情页能看到逐文件状态从「待刮削」变为「刮削中 → 已完成」）；把窗口切到别的 tab 再回来、或关掉窗口重开，进度与结果应保持不变。
4. 只启用「A 插件只给 NFO、B 插件给封面」的组合：结果行应显示命中的插件，且封面文件确实出现（验证跨插件补全）。
5. 刮一个文件：应生成 `<工作目录>/<基名>/`，里面是 `<基名>.<ext>`、`<基名>.nfo`（与文件夹同名）与 `poster.jpg` / `backdrop.jpg` / `thumb.jpg`（`banner.jpg` / `logo.png` 只在插件给了同类型资源时才有）；打开 NFO 应能看到 `<thumb aspect="poster">poster.jpg</thumb>` 等图片标签，以及末尾的还原记录 `<originalfilename>` / `<originaldirectory>`（第一次刮削时后者就是原目录，前者是刮削前的文件名）。
   - 反复刮削：把影片连同本地图片一起刮两次，还原记录里的位置应停在**最初**那一份，图片记录不重复。
   - 文件记录：目录里先放好 `poster.jpg` 并开启「优先读取本地 NFO 和图片」，刮削后 `poster.jpg` 被改名成规范名时，NFO 里应出现带 `original` 的 `<plantedfile relative="…" original="…" />`（`original` 指向改名前的位置）；插件联网下载的 `backdrop.jpg` / `trailer.mp4` 应记成不带 `original` 的 `<plantedfile relative="…" />`（还原时直接删）；开着保留设置、沿用了磁盘上已有文件时不该记这一条（还原时不动用户自己的文件）。
   - 旧版本 NFO 兼容：手工把现有 NFO 里的还原记录删掉再刮一次 → 新 NFO 里应重新写好本次的位置（记录不丢失，仍然可还原）。
6. 关闭资料库的「移动文件」：影片文件夹应建在原目录下；开启并填写「目标目录」后，整个文件夹出现在目标目录里，结果行消息应带上新的路径。
7. 打开「文件行为 → 保存日志到文件」：`~/.vault-scrape/log/scrape/` 下应出现本次任务的日志文件；关掉开关后不应新增文件、也不应新增目录。
8. 任务跑一半点「取消」，再点「继续」：剩余文件应继续执行；跑到一半强制退出应用后重开，任务状态应显示「已中断」而不是「刮削中」。
9. 编辑资料库、只保留一个刮削器后保存：启动任务，结果行里的插件应只出现选中的那个；把该插件停用后再启动，应提示「资料库配置的刮削器均不可用，请重新选择」。**一个刮削器都不选**时表单允许保存（空 = 不刮削）：该库的「刮削」按钮变为禁用，扫描后自动刮削回报「该资料库未配置刮削器，已跳过刮削」，绕过界面直接调 `library:scrape` 报「该资料库未配置刮削器（空刮削器表示不刮削），请先在资料库设置里选择」。
10. 刮削一个能产出封面的文件：结果行的「封面」列应显示图片（图片已作为条目图片写进 `media_image`，影视墙上同一影片的封面也应更新）；开启 NSFW 保护且该库标记了 NSFW 时，封面先显示遮罩、点击后才能看到；重启应用后封面仍应显示。
11. 从资料库启动一个跨多层的刮削任务（影视墙 →「资料库」→「刮削」）：任务应出现在概览页的刮削记录里、任务名形如 `资料库 · 名称`，结果行分布在不同子目录里；刮削成功后影视墙上该影片的标题与封面**直接更新**（不再需要「刮削完再扫一遍」这一步）。
12. 一个资料库挂两个媒体目录、各放若干未刮削影片：点一次「刮削」只启动条目最多的那一组，另一组条目 `scrapedAt` 仍为 0；再点一次「刮削」才轮到它（见 §3「一次只跑一组」）。
13. 开「优先读取本地 NFO 和图片」：把一个已有完整 `movie.nfo` 与 `poster.jpg` 的目录扫成条目再刮削，结果行插件列应为「本地 NFO」、不应发网络请求；随后手工删掉本地 NFO 里的简介再刮一次，应只联网补缺失的信息，本地已有的字段不被覆盖。
14. 把资料库的「文件过滤」设为 100（MB）：小于 100MB 的视频既不进扫描结果，也不进待刮削候选；填 0 时全部放行。
15. `itemId` 口径：`scrape:start` 的 `itemIds` 必须是 `media_item.id`（不是路径、也不是文件名），落库后对应的 `scrape_file.item_id` 应等于这些 id；传一个不存在的 id 应报「所选影片已不在待刮削列表中」。
16. 刮一个带参演演员的文件（已启用**演员信息插件**即 `actor` 类插件）：影片详情页的「参演演员」条应出现头像 + 姓名，点击能跳到演员详情；开着「自动抓取演员资料」时日志里应出现「自动补全演员资料（…，N 张图片）」，关掉后只挂关联、不抓资料；把已挂好演员的影片重刮一次（详情里没有演员名单）时关联不应被清空。
17. **剧集任务 = 整部剧一次**：新建一个「剧集」库（`Season 01/S01E01.mkv`、`Season 01/S01E02.mkv`）扫出剧集条目后点「刮削」→ 任务名仍是 `资料库 · 名称`，**一条任务行对应整部剧**（任务行的 `path` 就是剧集目录），结果消息形如 `插件 X，2 集，1 季，2 个剧集资源，…`；刮完影视墙上该剧的标题与封面**直接更新**（同样不需要「刮削完再扫一遍」）。
18. **剧集产物与关键字口径**：刮一部目录名带年份的剧（如 `Some Show 2019/`）→ 搜索关键词应是**去掉年份的剧集目录名** `Some Show`（可在插件日志里核对），产物为 `tvshow.nfo` + `Season 01/season.nfo` + `Show S01E01.mkv` / `Show S01E01.nfo` + `Show S01E01-thumb.jpg`（季目录与集文件名都按命名模板，集 NFO 与集文件同名），剧集目录按 `{title} ({year})` 改名；`tvshow.nfo` 末尾能看到还原记录（剧集根记原剧集目录名与原目录、集 NFO 记原集文件名与原目录）。
19. **剧集刮削与还原闭环**：把剧集（连同季目录）刮一遍再走「还原刮削前」→ 剧集目录改回原名、集文件改回原名并搬回旧季目录；**季目录名不回改**（旧季目录由集文件搬回时重建），刮削时新建的季目录搬空后会被当空目录删掉。剧集在资料库扫描侧的用例见 [资料库 §10](../media/01-media-library.md)、界面侧见 [影视墙页面 §8](../page/04-media-wall-page.md)。
20. **番号对不上时的回落**（§5.2 候选匹配口径）：给影片库配上没有番号概念的插件（如 [TMDB](../plugin/05-tmdb-plugin.md)），放进 `Inception.2010.1080p.BluRay.mkv`（宿主会猜出番号 `INCEPTION 2010`）→ 应正常匹配候选并刮出中文标题 / 简介 / 封面，而不是「未找到匹配的刮削结果」；再放一个插件里查不到的文件（如 `没有这部电影.2024.mkv`）→ 仍应失败，说明回落没有退化成乱猜。剧集侧对应场景：剧集目录名比插件标题长（`The Office US` / `The Last of Us 最后生还者`）时应命中同剧候选。
21. **手动匹配**（详情页「更多 → 手动匹配」，见 [手动匹配](../media/04-manual-match.md)）：
    - 影片库配 TMDB：输入**纯数字** tmdbid → 应只出一条候选（走 `detail` 直查 + `covers` 补封面，不发 `search`）；点「使用所选」后弹窗**立刻关闭**并跳到刮削进度详情页，页面上能看到任务名 `手动匹配 <名字>`、逐文件状态从「待刮削」走到「已完成」；跑完后回详情页刷新，标题 / 简介 / 封面已更新、磁盘上是与自动刮削同形的产物（同名文件夹 + NFO + 图片，位置按库的「移动文件」设置）；已有旧 `poster.jpg` 时也应被新封面覆盖（手动匹配忽略「保留已有图片」）。
    - 同一输入框填关键字 → 走 `search` 出多条候选，多插件时结果合并、每行标注来源插件。
    - 受保护的条目（NSFW 命中）→ 输入框占位符是番号，搜索只走 `search`；列表封面仍按保护口径打码。
    - 资料库 `scrapers` 为空或插件都停用 → 弹窗只显示「去资料库配置」的提示，**不出现搜索框**。
    - 先启动一次整库刮削，再开手动匹配 → 点「使用所选」立即提示「已有刮削任务在运行，请先等待或取消」；反过来在手动匹配跑的时候启动整库刮削也应同样被挡。
    - 进度页手动匹配这条任务可以「取消」；**重启应用后**再点它的「继续」应提示「手动匹配的任务在应用重启后无法继续，请在详情页重新手动匹配」。
22. **目录型条目 + 多版本合并**（扫描与刮削的接缝）：影片库里放 `Mr. Nobody (2009)/Mr. Nobody (2009) - 1080p.mkv` 与 `Mr. Nobody (2009)/Mr. Nobody (2009) - 2160p.mp4` → 扫描后影视墙只有**一条**该影片（标题用**目录名整名**，不该被截成 `Mr`），详情页能播（主版本）；删掉 1080p 那个文件再扫一次，条目、标题、封面仍在（只少一条 `media_source`，`scraped_at` 不被清零）；抓一下条目 `path` 应等于影片目录。
23. **花絮不入库**：同一影片目录里放整名就叫 `sample.mkv` 的文件，再加 `trailers/xxx.mkv`、`featurettes/xxx.mkv` → 扫描结果里不该出现任何独立影片条目，也不该进待刮削候选（花絮目录整棵不下钻）。
24. **扫描读 NFO（不联网）**：手工放一份 `movie.nfo`（根 `<movie>`，含 `<title>` / `<plot>` / `<actor>`）再扫描 → 墙上标题、简介已来自 NFO、参演演员已挂上，该条目 `scrapedAt` 仍是 0，但 `has_nfo` 已置 1 —— **不再进待刮削候选**（点「刮削」报「没有待刮削的条目」），只能在详情页「更多 → 手动匹配」手动刮；再把 `tvshow.nfo` 放进同一目录 → 不该被当成影片元数据（根元素不符，按种类丢弃）。
25. **刮目录型条目**：给一个已有多个版本的影片目录配好插件后刮削 → 目录被改成 `<片名 (年份)>/`、**里面所有视频的文件名一个都没动**（`- 1080p` 后缀必须保留）、目录里出现 `<目录名>.nfo`，结果行消息带上新路径；随后重扫仍是同一条目，**不会裂成「两个影片」**（目录型不改文件名正是为了这个）。
26. **NFO 三类都能读到（剧集）**：给剧集目录放 `tvshow.nfo`、季目录放 `season.nfo`、集放与集文件同名的 NFO → 扫描后剧集 / 季 / 集三层 `hasNfo` 都为真，三层标题与简介都入库（原先「剧集写 `tvshow.nfo` 却扫不到」的 bug 已修）。
