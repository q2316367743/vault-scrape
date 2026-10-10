# 资料库（Jellyfin / Emby 式媒体库）

## 1. 定位与契约

资料库是影视墙的**归口单位**，也是刮削的**唯一入口配置**。这一轮把媒体数据层推倒重建成了 Jellyfin 式模型，规则如下：

- 一个资料库 = **名称 + 类型 + 一组媒体目录（可多根、可跨存储） + 一组刮削器（可为空） + 库级选项**。不再是「一个存储一个根目录」。
- 配置真相在 **SQLite**（`library` / `library_path`），**不再有 JSON 配置文件**（旧的 `~/.vault-scrape/media/libraries.json` 已废弃）。
- **目录不许重叠**：同一条「连接 + 路径」只能属于一个库，且**不同库的目录之间不许互相嵌套或相同**（本库草稿内部同理）。保存时被拒的三种文案：
  - 同库重复：`媒体目录重复添加：X`；
  - 同库嵌套：`媒体目录不能互相嵌套：A 与 B`；
  - 跨库重叠：`媒体目录与资料库「N」的 X 重叠，请改用不重叠的目录`。

  理由：`media_source` 以「连接 + 路径」唯一，目录嵌套会让**同一个文件被两个库争抢**，并让被包含的那个库多出一批无源孤儿条目、把计数撑大（Jellyfin 同样禁止重叠的资料库目录）。旧的「精确归属」规则（`findPathOwner` / `LibraryPathOwner` / 「该路径已属于资料库「X」」）已删除。**没有「不属任何资料库」的电影条目**——影视墙只列各库的条目。
- **类型（`type`）建库后不可修改**：当前 `LibraryType` 只有 `'movie'`，类型决定扫描时按哪份后缀清单识别媒体文件（见 §4.2）。类型与后缀是「索引口径」的一部分，中途改会让已索引的条目变成孤儿，所以只允许新建时选。
- 索引结果是**条目化**的：`media_item`（movie / folder）→ `media_source`（一个条目多源，本阶段一源）→ `media_image`（primary / backdrop / thumb / logo / banner / other）。刮削元数据写在**条目**上，重扫只更新媒体源，**元数据与图片不会丢**。
- 删除库只删配置与库内的条目 / 媒体源 / 图片行（`removeLibrary` = `purgeLibraryMedia` + `deleteLibrary`），**磁盘文件一个都不动**；删除存储则级联删掉它名下的库与媒体行（见 [存储页](../page/02-storage-page.md)）。
- 刮削器**只来自资料库**：连接的 `FileConnection` 上已经**没有** `scrapers` 字段（`scraperIdsOf` / `usesAllScrapers` / `describeScrapers` 一并下线），存储页只留 NSFW。**空的 `scrapers` 数组 = 该库不刮削**，不再回落到「存储（连接）的刮削器」。

## 2. 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/common/types/library/index.ts` | `MediaLibrary` / `LibraryType` / `LIBRARY_TYPES` / `LIBRARY_TYPE_LABELS` / `libraryTypeLabel()` / 草稿 / 摘要 / 扫描结果 / 进度事件 / 任务结果 |
| `src/common/types/library/error.ts` | `LibraryErrorCode` / `LibraryError` / `describeLibraryError` |
| `src/common/types/library/result.ts` | IPC 信封 `LibraryResult<T>` 与 `libraryOk` / `libraryFail` |
| `src/common/types/setting/librarySetting.ts` | `SettingLibrary.extensions`、`DEFAULT_LIBRARY_EXTENSIONS`、`LIBRARY_EXTENSION_LIMIT`、`normalizeExtensionList()`、`libraryExtensionsOf()` |
| `src/common/types/plugin/builtin.ts` | `R18_OFFLINE_PLUGIN_ID = 'r18-offline'`（内置 R18 离线数据包，唯一一份） |
| `src/common/types/file/path.ts` | 连接内路径工具：`FILE_ROOT`、`normalizeRemotePath`、`isRemotePathInside()`（重叠判定）、`dirnameRemotePath()` 等 |
| `src/main/src/db/schema/library.ts` | `library` / `library_path` 表定义 |
| `src/main/src/db/repo/libraryRepo.ts` | 资料库仓储（`isSameOrInsidePath`、`findLibraryByPath`、行级增删改） |
| `src/main/src/modules/library/libraryStore.ts` | 校验与增删改、**`normalizePaths()` 重叠规则**、库摘要（含 `coverUrlsOf()`）、按存储级联清理 |
| `src/main/src/modules/library/libraryScan.ts` | 扫描编排：单例互斥、取消、清理、**按库类型取后缀**、自动刮削四分支 |
| `src/main/src/modules/library/libraryScrape.ts` | 待刮削候选、同目录同番号去重、按目录分组启动任务、空刮削器拒绝 |
| `src/main/src/modules/library/libraryIpc.ts` | `library:*` 通道注册与入参收窄 |
| `src/main/src/modules/library/libraryEvents.ts` | 扫描进度广播 |
| `src/main/src/modules/media/mediaIndexer.ts` | 目录游标 BFS、条目 / 媒体源 / 图片落库、配合 `extensions` 判定视频、清理未扫到的行 |
| `src/main/src/modules/media/mediaWall.ts` | 首页 / 整墙与详情读模型、`browseLibrary` 逐级浏览 |
| `src/main/src/modules/media/mediaProtocol.ts` | `storage://` 私有协议（媒体源与图片的取值 / Range 流式、视频路径自愈入口） |
| `src/main/src/modules/media/mediaLocator.ts` | 播放期按「文件名 + 字节数」在资料库范围内找回被移动的视频（见 §4.5） |
| `src/main/src/modules/media/mediaAppData.ts` | 伪连接 `appdata` 与 `~/.vault-scrape/media/images` 根目录 |
| `src/main/src/modules/scrape/scrapeLocalAsset.ts` | `imageSaveMode='appdata'` 的图片落到条目目录 |
| `src/renderer/src/windows/main/pages/media/` | 影视墙首页 / 内容页 / 详情页与资料库抽屉、表单（抽屉与表单在 `media/library/`） |
| `src/renderer/src/windows/main/pages/setting/components/SettingLibraryPanel.vue` | 「设置 → 资料库」面板：逐类型编辑媒体后缀 |
| `resources/drizzle/0001_smooth_micromacro.sql` | `library` 加 `type` 列的迁移（`ALTER TABLE \`library\` ADD \`type\` text DEFAULT 'movie' NOT NULL;`） |

## 3. 数据结构

`library` 表（14 列，`src/main/src/db/schema/library.ts`）：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | `randomUUID()` |
| `name` | text | 名称，最长 64 字符，不能为空 |
| `type` | text | 库类型，`$type<LibraryType>()`，默认 `'movie'`（迁移 `0001_smooth_micromacro.sql` 加列）；**建库后不可改** |
| `scrapers` | text | 刮削器插件 id 数组（JSON 数组），**空数组表示该库不刮削** |
| `nsfw_protection` | integer | NSFW 保护，默认 `true`（草稿未显式给 `false` 时按 `true`） |
| `write_nfo` | integer | 写入 NFO，默认 `true` |
| `rename_enabled` | integer | 成功后重命名，默认 `false`（仅显式 `true` 才开） |
| `move_enabled` | integer | 成功后移动，默认 `false` |
| `move_directory` | text | 移动目标目录（连接内路径，空串 = 连接根） |
| `image_save_mode` | text | `media`（影片同目录）/ `appdata`（应用数据目录），默认 `media`；非法值回落 `media` |
| `last_scan_at` | integer | 上次扫描完成时间；取消的扫描**不更新** |
| `last_scrape_at` | integer | 上次刮削时间 |
| `created_at` / `updated_at` | integer | 毫秒时间戳 |

索引：无（按主键访问）。

`library_path` 表（5 列）：一个库的多个媒体目录。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | `randomUUID()` |
| `library_id` | text | 所属资料库 |
| `connection_id` | text | 存储连接 id |
| `path` | text | 连接内目录路径（`/` = 连接根） |
| `created_at` | integer | 毫秒时间戳 |

索引：`idx_library_path_library`（library_id）、唯一索引 `idx_library_path_conn_path`（connection_id, path）——后者是「一条目录只属于一个库」的兜底，嵌套重叠由 `normalizePaths()` 在保存时先拦下。

条目侧三张表（`media_item` 26 列 / `media_source` 12 列 / `media_image` 9 列）的逐列说明见 [SQLite 存储](../data/01-sqlite-storage.md)。

`media_item.has_nfo`（迁移 `0002_damp_mandarin.sql` 加列）是**扫描拥有**的列：扫描时同目录存在 `movie.nfo` 或与视频同名的 `.nfo` 就置 1。它现在只是「磁盘上有没有 NFO」的事实标记，**不参与任何界面判定**——影视墙不按刮削与否分类，旧的「是否刮削 = `scraped_at > 0` 或 `has_nfo > 0` 或有图片」三口径连同 `mediaWall.scrapedOf()` 与 `countScrapedMovieItems()` 一起下线（`has_nfo` 列保留，避免改动表结构与迁移）；**刮削队列**仍只看 `scrapedAt === 0`（见 §5）。

契约类型（`src/common/types/library/index.ts`）：

- `LibraryType = 'movie'`；`LIBRARY_TYPES = ['movie']`；`LIBRARY_TYPE_LABELS = { movie: '影视' }`；`libraryTypeLabel(type)` 对脏数据回落显示 `type` 本身。
- `MediaLibrary`：`{ id, name, type, scrapers, paths: MediaLibraryPath[], nsfwProtection, writeNfo, renameEnabled, moveEnabled, moveDirectory, imageSaveMode, lastScanAt, lastScrapeAt, createdAt, updatedAt }`——**顶层没有 `connectionId` / `rootPath`**，目录在 `paths` 里；`path` 一律是**连接内绝对路径**（`/` = 连接根）。
- `MediaLibraryPath`：`{ id, connectionId, path }`；草稿里是 `MediaLibraryPathDraft`（无 `id`）。
- `MediaLibraryDraft`：`id` 缺省 = 新建；`type` 也在这里。
- `MediaLibrarySummary extends MediaLibrary`：多出 `videoCount`（`countMovieItems`）与 **`coverUrls: string[]`**——封面拼贴用的最多 4 张 `storage://` 地址，按**最近添加**排序，空数组时卡片退化成文字封面（`libraryStore.coverUrlsOf()`，常量 `COVER_URL_LIMIT = 4`）。
- `LibraryScanResult`：`{ library, indexedFiles, indexedVideos, removedItems, skippedDirs, pending, message, autoScrape, autoScrapeSkipped }`——注意是 `removedItems`（被清掉的条目数），不是旧的 `removedFiles`。
- `LibraryProgressEvent`：`{ libraryId, phase: 'scan', scannedDirs, indexedFiles, currentPath, finished, cancelled }`。
- `LibraryTaskResult`：`{ taskId, total }`。
- `LibraryImageSaveMode`：`'media' | 'appdata'`，标签在 `LIBRARY_IMAGE_SAVE_MODE_LABELS`（「与影片同目录」/「应用数据目录」）。

## 4. 扫描（`libraryScan.ts` + `mediaIndexer.ts`）

### 4.1 编排

- **全局单例**：扫描状态在主进程模块级变量里（`scanningId`），第二个请求直接返回 `busy`「已有扫描任务在运行，请稍候」。扫描不受窗口开关影响，界面靠 `library:running` 复原按钮状态。
- 入参校验：空 id → `invalidArgument`；库不存在 → `notFound`；没有任何目录 → `invalidArgument`「请至少添加一个媒体目录」；任一路径的连接不存在 → `connectionMissing`。
- **后缀清单来自库类型**：`extensions = libraryExtensionsOf(loadSetting().library, library.type)`，逐目录传给 `indexLibraryPath(library, libPath, { scanId, extensions, isCancelled, onDir })`。设置里改了后缀，**下一次扫描**才生效。
- `scanId = randomUUID()`，本次扫描的所有媒体源行都带上它，用作「这次扫到了什么」的凭据。
- 对库的**每一个** `library_path` 各跑一次遍历，结果累加；进度用 `library:progress` 推给所有窗口。
- 扫完 → 清理 → `patchLibrary({ lastScanAt })` → 统计 `pending` → 按设置决定是否自动刮削（见 4.4）。
- **取消**（`library:cancelScan`）：空闲时返回 `false`；扫描中置取消标志，遍历在下一个目录边界检查并抛 `LibraryError('cancelled')`。取消**不清理、不更新 `lastScanAt`**，先推一条 `cancelled: true` 的进度事件，再以 `cancelled` 错误信封返回。

### 4.2 目录遍历与「哪些算视频」

- 每个根目录一条**游标 BFS**（队列 + `depth`），`MAX_SCAN_ENTRIES = 200_000`、`MAX_SCAN_DEPTH = 32`，任一触顶就把结果标成 `truncated`（提示「已达扫描上限，结果可能不完整」）。
- **根目录列目录失败直接抛错** `scanFailed`「无法读取媒体目录：<原因>」；**子目录失败只计数** `skippedDirs` 并继续（提示「跳过 N 个读不到的目录」）。
- 被跳过的目录路径会一并交给清理阶段（`skippedPaths`）：这些目录**没扫到 ≠ 内容已删**，所以清理时会避开这些前缀，不删它们下面的媒体源、条目与图片（避免一次网络抖动就清掉刮削成果）。
- 目录按需生成 `type='folder'` 条目串起父子层级（`ensureFolderItem`）；**连接根 `/` 不建条目**，其下第一层目录的 `parentId` 为空串。
- **只把扩展名命中当前库后缀清单的文件建成 `movie` 条目**：判定在 `mediaIndexer.ts` 的私有 `isVideoExtension(extensions, extname)`（`extname` 去点转小写后 `extensions.includes`），**扫描器里不再有硬编码后缀**；`indexImages()` 也用同一份清单判定「视频基名」，顺带索引图片（见 4.3）。
- 后缀清单的默认值与清洗规则见[设置项清单 · 资料库](../setting/02-setting-items.md)（默认 `mp4 / mkv / avi / mov / wmv / flv / webm / ts / m2ts / mpg / mpeg / rmvb`，上限 64 个，清空回落默认值）。

### 4.3 确定性 ID 与 upsert

所有 ID 都是 `sha1(输入).slice(0, 32)` 的**十六进制前 32 位**（`mediaIndexer.ts` 的 `hashId`）；同一路径无论扫多少次都得到同一个 ID，所以重扫只更新、不产生重复行：

| 对象 | 输入 | 说明 |
| --- | --- | --- |
| movie 条目 | `item\n{connectionId}\n{path}` | 与库无关，同一个文件在哪个库都是同一条目 |
| folder 条目 | `folder\n{libraryId}\n{connectionId}\n{dirPath}` | **含 libraryId**，同一目录在两个库里是两条目录条目 |
| 媒体源 | `source\n{connectionId}\n{path}` | 与条目一一对应（本阶段一源） |
| 图片 | `image\n{connectionId}\n{path}` | |

- `movie` 条目**已存在时只更新 `parentId` 与 `hasNfo`**（都是扫描拥有的列，后者记同目录有没有 NFO）——文件名与番号交给刮削结果，重扫不会把刮削出来的标题覆盖回文件名。
- `media_source` 走 `upsertSource`（冲突目标是唯一索引 `(connection_id, path)`），只刷新扫描拥有的列：`item_id` / `library_id` / `name` / `extname` / `mime` / `size` / `modified_at` / `indexed_at` / `scan_id`；**`id` 不变**。
- 图片：只有**命中词表**的图片会入库（词表即刮削器 `resolveAssetFile` 写出来的那些名字），其余名字（`logo` / `banner` / `landscape` 等）一律忽略：
  - 与视频**同名**（去掉扩展名一致）的图片挂到该影片，按该文件的用途定 `type`；
  - 目录级**固定名**按用途定 `type` 并挂目录条目：`poster` / `cover` / `folder` → `primary`，`thumb` / `thumb1` → `thumb`，`fanart` / `backdrop` / `background` → `backdrop`，`still` / `still1` / `screenshot` → `still`（剧照）；
  - `<视频基名>-<固定名>` 这种**前缀名**（刮削器 `naming.assetNaming = 'movie'` 或 `forceMovieStyle` 时的产物，如 `ABC-123-thumb.jpg`）按同一词表定用途，并挂到基名对应的影片条目；
  - `extrafanart` / `extrathumbs` 子目录里的图算**上一层目录**影片的产出（锚点取父目录；父目录本身也是 extra 目录时再上一层，用于多集作品的 `S2`）；
  - 影片挂到所在目录的 `folder` 条目，所以「目录级固定名」通常落在影片的父条目上，读封面时按 4.4 之后的兜底链取。
- 连接根没有目录条目时，该目录只有一个视频就挂给它，多个视频则放弃（避免张冠李戴）。

### 4.4 清理与自动刮削

全部根目录扫完后执行一次 `cleanupUnseen(libraryId, scanId, keepImages)`：

1. 先删掉本次**没有**扫到源的 **movie** 条目（`deleteItemsWithoutSource` 显式过滤 `type='movie'`），并删掉这些条目的图片；返回的条目数就是 `LibraryScanResult.removedItems`；
2. 再删掉本次没被扫到的 `media_source` 行（`deleteSourcesNotInScan`，条件 `scan_id <> 本次 scanId`）；
3. 最后清掉磁盘上已消失的**刮削产物图**：上面词表里的固定名，以及 `<视频基名>-<固定名>` 前缀名（`isScanOwnedImagePath()`），且本次没见到；用户自己放的其他图片不在清理范围内。

随后 `autoScrape(library, pending)` 按固定顺序判断（**前四条任一命中都只影响自动刮削，扫描结果本身照常返回**），原因原样进 `autoScrapeSkipped`：

| 顺序 | 情况 | `autoScrapeSkipped` 文案 |
| --- | --- | --- |
| 1 | 设置里关掉了开关（`scrape.autoScrapeAfterScan`，见 [设置项清单](../setting/02-setting-items.md)） | 设置中已关闭「扫描后自动刮削」 |
| 2 | `library.scrapers.length === 0`（空刮削器 = 不刮削） | 该资料库未配置刮削器，已跳过刮削 |
| 3 | 没有 `scrapedAt = 0` 的影片（`pending === 0`） | 没有待刮削的影片 |
| 4 | 已有刮削任务在运行（`isScrapeRunning()`） | 已有刮削任务在运行，可稍后手动刮削 |

四条都不命中时启动刮削并把任务快照放进 `autoScrape`（`ScrapeTaskSnapshot | null`）；启动本身抛错时把中文原因写进 `autoScrapeSkipped`。

### 4.5 播放期路径自愈（`mediaLocator.ts` + `mediaProtocol.ts`）

`media_source.path` 只在**扫描**与**刮削改名 / 移动**时更新。用户在文件管理器里把影片挪走（例如挪进自己建的 `failed/` 目录）又不重扫，索引里的路径就是死的：`storage://` 请求在 `stat` 处抛 ENOENT，被收敛成 404——而封面 / 缩略图往往还留在原地，所以表现为「**图片正常、视频 404**」。

- **触发**：`handleVideoRequest()` 把 `client.stat(target.path)` 包进 try/catch，只有 `isNotFoundError(error)`（ENOENT / `FileError` 的 `notFound`）且请求来自**媒体源**（不是图片）时才尝试自愈；其它错误照旧走原来的 404 + 去重日志。
- **查找**（`mediaLocator.locateMovedFile()`）：先在同目录 `client.list(dirname(path))` 快查一次（同目录改名、移进子目录最常见），再回到该**资料库配置的媒体目录**（`getLibrary(libraryId).paths` 里 `connectionId` 匹配的那些，`/` = 连接根）做广度优先遍历。匹配条件是**文件名等价（trim + 忽略大小写）+ 字节数相同**，不做标题 / 番号模糊匹配——宁可继续 404，也不放错片子。
- **上限**：单次最多检查 `MAX_ENTRIES = 20_000` 个条目、递归 `MAX_DEPTH = 8` 层，超限即放弃；单个目录列不出来（没权限 / 断线 / 已删除）只跳过该目录。
- **写回**：命中后用 `updateSourcePath(source.id, …)` 只改 `media_source` 的 `path` / `name` / `extname` / `mime` / `size` / `modified_at`——**source id 不变**，`storage://` 地址与远端缓存都不失效；`media_item.path` / `parentId` 不动。成功记一条 info 日志「索引路径失效，已按文件名找回：<旧> → <新>」；写库失败（新路径已被别的媒体源占用）只记 warn，本次播放照常返回。
- **找不到的缓存**：结论按「资料库 + 连接 + 文件名 + 字节数」缓存 `MISS_TTL_MS = 60_000`，播放器反复重试同一个源时不会一遍遍遍历整个资料库。
- **并发去重**：主进程里同一个媒体源的并发 Range 请求共享一次查找（`healing: Map<sourceId, Promise<FileEntry | null>>`）。
- **不做**：不主动扫盘、不监听文件系统、不新增 IPC、不改表结构。真删掉的文件仍然 404，渲染层由 `MediaPlayer.vue` 的封面兜底层提示「文件可能已被移动或删除……也可以在影视墙里对资料库重新扫描一次」。

## 5. 刮削（`libraryScrape.ts`）

- **候选**：本库里 `scrapedAt === 0` 的**影片**条目（`listPendingMovieItems`）。`pendingEntries(libraryId)` 顺便做去重：同目录 + 同番号只留第一条，其余带上 `duplicateOf = 先出现者的名称`（任务里会被置为 `skipped`）。番号以 `extractKeyword(item.name)` 的解析结果为准，解析为空才退回条目上的 `num`。
- **空刮削器 = 不刮削**：`runPlan()` 在 `plan.library.scrapers.length === 0` 时抛 `LibraryError('pluginMissing', '该资料库未配置刮削器（空刮削器表示不刮削），请先在资料库设置里选择')`。不会再回落到存储的刮削器（连接上已没有该字段）。配了但都不可用时仍是 `资料库配置的刮削器均不可用，请重新选择`。
- **任务名**：`资料库 · <库名称>`。
- **一次只跑一组**：`planLibraryScrape(libraryId, itemIds?)` 按 `(connectionId, 所属根目录)` 把候选分组（任务表只支持一个「连接 + 目录」，同一任务只能有一个 `dirPath` 基准），**只取条目最多的那一组**启动，其余条目保持 `scrapedAt = 0` 留待下次（要再点一次「刮削」才会轮到下一组）。没有可跑的组时返回 `null`：`library:scrape` 报 `notFound`「资料库里没有待刮削的影片」，按 id 刮削报「所选影片已不在待刮削列表中」。
- **策略在任务启动时从资料库快照**：`renameEnabled` / `moveEnabled` / `moveDirectory` / `writeNfo` / `imageSaveMode` 全库级，`scraperIds` 取该库的 `scrapers`。
- **单文件成功后**：`updateItemMetadata(itemId, …)` 写回条目元数据（标题 / 番号 / 简介 / 评分 / 类型 / 外部 ID 等），`replaceItemImages(itemId, images)` 整体替换条目图片；改名 / 移动则就地 `updateSourcePath(source.id, …)`，**媒体源 id 不变**（磁盘上 `storage://` 地址因此不会失效）。
- **进度复用刮削模块**：库侧不新增 `scrape:*` 进度通道，任务列表、`scrape:progress`、取消 / 继续全部走[刮削模块](../scrape/01-scrape-module.md)。
- **重启后的「继续」**：`taskScrapers` / `taskLibraries` 是内存映射，重启即丢；`resumeScrapeTask` 先用 `findLibraryByPath(task.connectionId, task.dirPath)` 按 `(connectionId, dirPath)` 找回所属库，再回落该库的 `scrapers`；找不到库时抛 `pluginMissing`「找不到任务所属的资料库，请重新选择刮削器」。
- **新建库默认勾选内置离线包**：表单只在新库里 `scrapers` 为空、且候选项包含 `R18_OFFLINE_PLUGIN_ID`（`'r18-offline'`，定义在 `src/common/types/plugin/builtin.ts`）时默认勾上它；插件不可用（未启用 / 加载失败）时保持不勾，不替用户写一个不可用的 id。
- 资料库不重复下载：取消 / 失败的文件仍是 `pending`，`scrapedAt` 保持 0，所以下次扫描后的待刮削列表里还会出现。

## 6. IPC 契约与错误码

| 通道 | 入参 | 返回 |
| --- | --- | --- |
| `library:list` | — | `MediaLibrary[]` |
| `library:save` | `{ draft: MediaLibraryDraft }` | `MediaLibrary` |
| `library:remove` | `{ libraryId }` | `boolean`（配置 + 库内条目 / 媒体源 / 图片行） |
| `library:scan` | `{ libraryId }` | `LibraryScanResult`（长任务，完成后才 resolve） |
| `library:cancelScan` | — | `boolean` |
| `library:scrape` | `{ libraryId }` | `LibraryTaskResult`（整个库的待刮削候选，空刮削器时以 `pluginMissing` 拒绝） |
| `library:running` | — | `boolean`（主进程是否有扫描在跑） |
| `library:progress` | 主进程 → 渲染层推送 | `LibraryProgressEvent` |

- 所有 invoke 返回信封 `LibraryResult<T>`（`{ ok: true, data }` / `{ ok: false, code, message }`），**不跨 IPC 抛异常**。
- 渲染层出口是 `@/api` 的 `libraryApi`（`list` / `save` / `remove` / `scan` / `cancelScan` / `scrape` / `running` / `onProgress`）。
- 需要按具体影片刮削时走**刮削域**的 `scrape:start { libraryId, itemIds }`（工作台与「勾选刮削」用），`itemIds` 是 `media_item.id` 列表；`library:scrape` 只接受 `libraryId`（整库候选）。两条路径最终都进 `startLibraryScrape` / `startLibraryScrapeByIds`，空 `itemIds` 报 `invalidArgument`「请至少选择一个待刮削的影片」。
- 错误码（`src/common/types/library/error.ts`），渲染层只按 `code` 分支，`message` 仅用于展示：

| code | 默认文案 | 实际抛出点 |
| --- | --- | --- |
| `notFound` | 资料库不存在 | 库不存在；「资料库里没有待刮削的影片」「所选影片已不在待刮削列表中」 |
| `invalidArgument` | 资料库参数不合法 | 名称空 / 目录为空 / **同库目录重复、同库目录嵌套、与其它库目录重叠** / 缺少 id |
| `connectionMissing` | 所属存储不存在，请先在存储页创建 | 保存与扫描时目录指向的连接已不存在 |
| `busy` | 已有任务在运行，请稍候 | 第二个扫描请求 |
| `scanFailed` | 扫描失败 | 根目录读不到；遍历中的其它异常（`扫描失败：<原因>`） |
| `scrapeFailed` | 刮削启动失败 | 启动刮削时非 `ScrapeError` 的异常 |
| `pluginMissing` | 没有可用的刮削插件，请先在插件页安装并启用插件 | 运行时该库 `scrapers` 为空（自定义文案「该资料库未配置刮削器（空刮削器表示不刮削），请先在资料库设置里选择」）；重启后找不到任务所属库 |
| `cancelled` | 扫描已取消 | 用户取消扫描 |
| `unknown` | 未知错误 | 兜底 |

## 7. 库级选项

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `type` | `'movie'` | 库类型（当前只有「影视」）；决定扫描用哪份后缀清单，**建库后不可修改** |
| `nsfwProtection` | `true`（库列默认）/ 表单新建时关闭 | 落库并在资料库抽屉里显示 NSFW 标签；**已接入判定链路**：墙面卡片与详情页按「全局 NSFW 开关 + 存储 `nsfw` 标记 + 库级 `nsfwProtection`」任一命中即遮罩（`MediaWallItem.nsfwProtected` 由墙面下发） |
| `writeNfo` | `true` | 刮削后是否写 NFO |
| `renameEnabled` | `false` | 是否按命名模板重命名视频 |
| `moveEnabled` | `false` | 是否把视频移到 `moveDirectory` |
| `moveDirectory` | `''` | 移动目标目录（连接内路径；空串 = 连接根）；未开移动时该字段存空串 |
| `imageSaveMode` | `media` | `media` = 图片落在影片同目录；`appdata` = 落在 `~/.vault-scrape/media/images/<itemId>/`，用伪连接 `appdata` 经 `storage://` 读取 |
| `scrapers` | 新建时默认勾 `r18-offline` | 刮削器插件 id 列表；**空数组 = 不刮削**（扫描照常，只是不自动刮削、不能手动刮削） |

## 8. 与「工作台 / 影视墙 / 存储页」的关系

- **入口分工**：**扫描**只在影视墙的资料库抽屉里；**刮削**有两个入口——资料库抽屉的「刮削」（整库待刮削候选）与工作台的逐级勾选（`scrape:start { libraryId, itemIds }`）。工作台**不再扫盘、不再自己建索引**。
- **影视墙**：[影视墙页面](../page/04-media-wall-page.md)分首页（`/media`：资料库横排 + 最近添加 / 推荐两排）与内容页（`/media/library?libraryId=…`，空串 = 全部影片）；只列各资料库的 `type='movie'` 条目（不属于任何库的影片不会出现在墙上），封面取条目自己的 primary 图、否则退回父目录条目的 primary 图；`indexedAt` = 最新媒体源的 `indexed_at`。**影视墙不按刮削与否分类**（没有「待刮削 / 已刮削」标记、排序与统计，详情页也没有「刮削状态」格）。
- **工作台**：[工作台页面](../page/03-workspace-page.md)先用 `scrape:browse { libraryId, dirPath }` 逐级浏览（返回 `MediaBrowseEntry`，含 movie / folder），再勾选启动。
- **存储页**：[存储页](../page/02-storage-page.md)删连接时主进程会级联 `deleteLibrariesByConnection(connectionId)`（删库 + 媒体条目 / 媒体源 / 图片），避免留下悬空数据；连接上不再有刮削器配置。
- **数据落盘位置**：

| 内容 | 位置 |
| --- | --- |
| 资料库配置与全部索引 | `~/.vault-scrape/db/vault-scrape.db`（`library` / `library_path` / `media_item` / `media_source` / `media_image`） |
| 远端视频 / 图片缓存 | `~/.vault-scrape/cache/media/<媒体ID>`（上限 512MB，超了按 mtime 剪到 80%） |
| `imageSaveMode='appdata'` 的图片 | `~/.vault-scrape/media/images/<itemId>/` |
| 刮削运行日志 | `~/.vault-scrape/log/scrape/<任务名>-YYYYMMDD-HHmmss.log`（开关见设置页） |
| ~~旧资料库配置~~ | `~/.vault-scrape/media/libraries.json` **已废弃，不再读写** |
| 旧的整库文件 | 上一版本的本机库已归档为 `vault-scrape.db.old-20261010`，下次启动新建空库并依次执行 `0000_heavy_hardball.sql` + `0001_smooth_micromacro.sql`（见 [SQLite 存储](../data/01-sqlite-storage.md)） |

## 9. 已知限制

- **多目录资料库一次只刮一组**：任务表只支持一个「连接 + 目录」，`planLibraryScrape` 只取条目最多的那一组，其余条目 `scrapedAt` 保持 0，要再次触发刮削才会轮到下一组（见 §5）。
- **目录条目不会随磁盘上的目录消失而删除**：清理只针对失去媒体源的 `movie` 条目（`deleteItemsWithoutSource` 显式过滤 `type='movie'`），所以删掉一个空目录后，对应的 `folder` 条目会残留（没有子项的空目录条目仍在，只在浏览时表现为空文件夹）。
- **改名 / 移动只更新媒体源**：刮削改名或移动后只改 `media_source.path`，条目上的 `media_item.path` 仍是扫描时的路径（详情页的「所在目录」等展示按主源取，不受影响）。
- **类型只有一个、且不能改**：`LIBRARY_TYPES` 当前只有 `'movie'`，新增类型需要同时补 `LIBRARY_TYPE_LABELS` 与 `DEFAULT_LIBRARY_EXTENSIONS`；已有库的类型锁死是刻意设计（改类型会让已索引条目变成孤儿）。
- **本阶段没有剧集 / 季 / 集的解析**：只有 `movie` 与 `folder` 两种条目。`media_item.type` 的 schema 注释写着「series 等后续再接」，但当前类型联合只声明了 `movie` / `folder`，`series` / `season` / `episode` 既没有类型也没有扫描、详情实现。
- **没有增量扫描，也没有实时监控**：每次扫描都把整库重新走一遍，靠 `scanId` 对比来做清理；磁盘变动必须手动点「扫描」才会反映。唯一例外是 §4.5 的**播放期路径自愈**：只在起播 `stat` 报「文件不存在」时按文件名 + 字节数找回一次，不改条目、不做全库扫描。
- **没有库封面列**：`library` 表没有封面字段；首页资料库卡片的四宫格是**影片封面拼贴**（`MediaLibrarySummary.coverUrls`，最多 4 张、按最近添加排序），不是库自己的封面。
- 路径冲突统一报 `invalidArgument`：同库重复报「媒体目录重复添加」，同库嵌套报「媒体目录不能互相嵌套：A 与 B」，跨库重叠报「媒体目录与资料库「N」的 X 重叠，请改用不重叠的目录」——旧的 `findPathOwner` 精确归属规则与 `pathOverlap` 错误码都已移除。
- 扫描上限是**全局计数**（`listed > 200_000` 即停），触顶时结果可能不完整，只给 `truncated` 提示、不做断点续扫。

## 10. 手工验证清单

按项目约定只跑 `yarn run typecheck`（不 build、不写测试），运行时行为手工验证：

1. 新建资料库：影视墙首页 →「资料库」→「新建」，填名称、加两个不同存储的媒体目录（**必须用「选择目录」弹窗从存储里挑**，不能填本机路径），刮削器默认已勾上「R18 离线数据包」→ 保存。抽屉里该行显示类型标签、「2 个目录」「1 个刮削器」，首页资料库横排多出该库卡片。
2. 类型不可改：新建时类型下拉可用（只有「影视」）；保存后重新打开编辑抽屉，类型下拉应为禁用（说明「类型创建后不可修改」）。
3. 目录重叠三种报错：同一个库内加两条相同目录 → 保存报「存在重复的根目录，请合并后再保存」（渲染层拦下，不发请求）；在库里加一条与**其它库**目录相同的目录 → 主进程报「媒体目录与资料库「X」的 Y 重叠，请改用不重叠的目录」；把库 A 的目录设成库 B 目录的父目录（或子目录）→ 同样被拒（嵌套）。以上报错后不要把库写进数据库。
4. 只填名称、或某行目录没选存储 / 没选目录就保存 → 分别报「请至少添加一个媒体目录」「请为每个媒体目录选择存储」「请为每个媒体目录选择目录」；一个存储都没有时提示「请先到「存储」页新建数据源」。
5. 后缀清单：在「设置 → 资料库」里把 `mp4` 删掉后重新扫描某库 → 该库的 `.mp4` 文件不再入库（墙上消失，`indexedVideos` 减少）；清空整个清单失焦 → 提示「至少要保留一个后缀，已回落默认值」并恢复默认 12 个后缀；粘进一堆大写、带点、重复的后缀 → 失焦后被清洗成小写去点去重。
6. 点「扫描」：抽屉顶部出现进度（遍历目录数 / 索引文件数 / 当前目录），按钮变「取消扫描」；完成后「影片 N 部」「上次扫描」更新，`skippedDirs` / 截顶会在提示里以中文说明。
7. 扫描期间再点一次「扫描」（或另一个库的「扫描」）→ 报「已有扫描任务在运行，请稍候」。
8. 扫描进行中点「取消扫描」→ 进度事件带 `cancelled`、返回「扫描已取消」，且**本次不做清理、`上次扫描` 不变**；再扫一次能正常跑完。
9. 多层目录：`库/番号A/番号A.mp4` 这类结构扫描后，影视墙能看到该影片，工作台从库根逐级点进去也能看到同一批条目（目录条目为 `folder`）。
10. 重扫不丢元数据：刮削成功一个影片后手动再扫一次，标题 / 封面都还在（只刷新了媒体源的大小与时间）。
11. 磁盘上删掉一个视频后再扫描：该影片从墙上消失，提示里的「清理 N 个失效条目」与 `removedItems` 对得上；库内其它影片不受影响。
12. 目录级封面：在影片所在目录放 `poster.jpg` 与 `fanart.jpg`，扫描后影视墙该影片（或它所在目录的子项）应显示封面；把这两个文件删掉再扫，封面消失。
13. 首页封面拼贴：给库里最近的几个影片刮出封面后回首页，该库卡片显示最多 4 张的四宫格（按最近添加排序）；不足 4 张按实际张数，没有封面时显示文字占位。
14. 自动刮削四种跳过原因（顺序固定）：设置里关掉「扫描后自动刮削」→「设置中已关闭「扫描后自动刮削」」；把库的刮削器全部取消后扫描 →「该资料库未配置刮削器，已跳过刮削」；没有任何未刮削影片 →「没有待刮削的影片」；已有任务在跑 →「已有刮削任务在运行，可稍后手动刮削」。四种情况**扫描结果都正常返回**（影片数、上次扫描照样更新）。
15. 空刮削器不能刮削：抽屉里该行标签显示「不刮削」、「刮削」按钮禁用（悬停提示「该资料库未配置刮削器，不执行刮削」）；绕过界面直接调 `library:scrape` → 报「该资料库未配置刮削器（空刮削器表示不刮削），请先在资料库设置里选择」。
16. 多媒体目录一次一组：给一个库挂两个目录、各放若干未刮削影片，点一次「刮削」→ 任务只包含条目最多的那一组，另一组条目 `scrapedAt` 仍为 0；再点一次「刮削」才轮到它。
17. 改后缀影响扫描、但不影响已入库条目：把某个后缀从清单删掉再扫，该类型的媒体源被清理、条目从墙上消失；重新加回去再扫，文件重新入库（是**新条目**，原来的刮削元数据不会自动回来）。
18. 重启后「继续」：刮削任务跑到一半取消 → 重启应用 → 在工作台点「继续」，任务应能找回所属库与刮削器并接着跑（`taskLibraries` / `taskScrapers` 内存态丢失后按 `(connectionId, dirPath)` 回落）。
19. `imageSaveMode='appdata'`：把库的图片保存位置设成「应用数据目录」后刮削，图片落到 `~/.vault-scrape/media/images/<itemId>/`，且在影视墙上能正常显示（伪连接 `appdata`）。
20. 删除资料库：确认文案写明只删配置与库内影片记录；删完该库从首页横排 / 内容页消失、它的影片从墙上移除，磁盘文件仍在。
21. 删除一个存储：刷新影视墙，该存储名下的资料库全部消失，库内影片也从墙上移除（级联删除媒体行）；刮削任务记录保留。
22. 子目录读不到时不误删：让某个子目录暂时读不到（如远端权限或短时断连）后点「扫描」→ 提示「跳过 N 个读不到的目录」，**该目录下的影片不会从墙上消失**，也不会出现「清理 N 个失效条目」；恢复后再扫仍正常。
23. 首页两排与「全部影片」：库里既有老片也有新入库影片时回首页，应看到「最近添加」「推荐」两排（各排最多 24 条，`MEDIA_HOME_ROW_LIMIT`，整排无内容则整排不渲染），**不应出现「待刮削」排**；点右上「全部影片」进入 `/media/library`（不带 `libraryId`），标题为「全部影片」、摘要不含「K 个资料库」；在首页搜索框输入关键词回车 → 跳 `/media/library?keyword=…`，关键词为空时不带该参数。
24. **播放期路径自愈**：在文件管理器里把某个已入库的 `.mp4` 挪到库里别的子目录（例如手工建的 `failed/`），**不要重扫**，回到详情页点播放 → 应能正常起播、能拖进度；主进程日志（`~/.vault-scrape/db` 的 `log` 表或日志页）应有一条 info「索引路径失效，已按文件名找回：<旧路径> → <新路径>」，且 `media_source.path` 已更新到新位置、`id` 没变（封面等 `storage://` 地址不受影响）；再点一次播放不再触发查找。若把视频**改名**（文件名变了）或**真删掉**，则仍应 404，详情页播放器显示封面 + 「视频读不出来……也可以在影视墙里对资料库重新扫描一次」。自愈只对视频生效（`media_source`），图片按原路径读。
25. **封面回退到快照**：影片所在目录只放 `thumb.jpg`（不放 `poster`）→ 扫描后墙上卡片、详情页大封面与播放器封面都应是这张缩略图；再补一张 `poster.jpg` 重扫 → 回到主图优先。刮削器写的 `{视频基名}-thumb.jpg`、`{视频基名}-poster.jpg` 与 `extrafanart/still1.jpg` 同样要被收录（`extrafanart` 里的图算上一层目录影片的产出）。
