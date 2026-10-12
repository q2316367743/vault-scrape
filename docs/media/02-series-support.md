# 剧集支持（series / season / episode）

剧集支持是资料库的第二种库类型：**影视库（`movie`）一部电影 = 一条影片（影片目录里的多版本视频合并成一条），剧集库（`tv`）一整部剧 = 一条剧集**。
文档面向上游改动者：只要读这一篇，就能改扫描、刮削、读模型、详情页与「还原刮削前」任何一层。

> 相关文档：[资料库（扫描 / 索引）](./01-media-library.md)、[刮削模块](../scrape/01-scrape-module.md)、[影视墙页面](../page/04-media-wall-page.md)、[SQLite 存储](../data/01-sqlite-storage.md)、[插件模块](../plugin/01-plugin-module.md)。

## 1. 范围与口径

| 维度 | 影视库 `movie` | 剧集库 `tv` |
| --- | --- | --- |
| 条目粒度 | 一部电影 = 一条 `media_item`（影片目录里的多个版本合并成一条 + 多条媒体源） | **一整部剧 = 一条** `media_item`（`type = 'series'`） |
| 墙面卡片 | 一个视频一张卡 | 整部剧一张卡（`MediaWallItem.type = 'series'`，没有番号、没有 `playUrl`） |
| 刮削任务行 | 一个视频一次（候选 = 待刮影片条目） | **一次处理整个剧集**（候选 = 待刮 `series` 条目，任务行 `path` 就是剧集目录） |
| 搜索关键词 | 文件名 / 番号 | **剧集目录名**（`seriesKeywordOf`） |
| 播放 | 条目自己的媒体源 | 由详情页的**选集状态**决定播哪一集 |
| 刮削产物 | `<片名 (年份)>/<片名 (年份)>.mkv` + 同名 `.nfo` + 图片（目录型条目整体改名；多版本只改主版本） | `tvshow.nfo` + `season.nfo` + 每集 NFO + 每集剧照 |

三条铁律（跨层一致）：

1. **只认文件名 / 目录名，不猜**：解析不出季、集号的文件不入库（计 `skippedVideos`），匹配不出的候选返回 `null`；
2. **身份按「连接 + 路径」**：`media_item` 只有一张表，剧集树用 `parent_id` 串起来，刮削改名后 id 不变、重扫不造重复（见 §3.3）；
3. **不新增表（只加两列）**：剧集三层全部落在 `media_item` 的 `type = 'series' | 'season' | 'episode'` 上（见 §3），DB 层另外只在增量迁移 `0001_familiar_lifeguard.sql` 里给 `media_item` 加了 `season_number` / `episode_number` 两列（见 §3.2 与 [SQLite 存储](../data/01-sqlite-storage.md)）。

## 2. 资料库类型与分派

- 契约类型：`src/common/types/library/index.ts` 的 `LibraryType = 'movie' | 'tv'`；`LIBRARY_TYPES` 是资料库表单类型选项的来源，`LIBRARY_TYPE_LABELS`（`tv: '剧集'`）与 `libraryTypeLabel` 负责展示文案。
- 库级选项 `type` 建库后不可修改（同 `data/01`）；`MediaLibrarySummary.videoCount` 的口径随库类型走 —— **影视库数影片、剧集库数剧集（整部剧集算一条）**。
- **分派收口在 `src/main/src/modules/library/libraryScrapeDispatch.ts`**（文件头明写「库类型判断收口在这里」）：`isTvLibrary(libraryId) = requireLibrary(libraryId).type === 'tv'`，三个入口按库类型二选一：

  | 入口 | 剧集版（`libraryScrape.ts`） | 影片版 |
  | --- | --- | --- |
  | `pendingEntries(libraryId)` | `pendingSeriesEntries` | `pendingMovieEntries` |
  | `startLibraryScrape(libraryId, …)` | `startSeriesLibraryScrape` | 影片版同名流程 |
  | `startLibraryScrapeByIds(libraryId, ids)` | `startSeriesLibraryScrapeByIds` | 影片版同名流程 |

  三个调用点已改指这一层：`libraryScan.ts`（扫描后自动刮削）、`libraryIpc.ts`（资料库抽屉）、`scrapeIpc.ts`。
- 后缀清单也按库类型取：`libraryExtensionsOf(loadSetting().library, library.type)`。

## 3. 扫描：三层条目怎么建

引擎是 `src/main/src/modules/media/mediaSeriesIndexer.ts`（`indexSeriesLibraryPath`），入口在 `libraryScan.ts:73` 的 `scanLibrary`：

```ts
const isTv = library.type === 'tv'
// 扫描：剧集走 indexSeriesLibraryPath，影片走 indexLibraryPath
// 清理：剧集走 cleanupSeriesUnseen，影片走 cleanupUnseen
```

扫描仍是游标 BFS（`MAX_SCAN_ENTRIES` / `MAX_SCAN_DEPTH` 复用 `mediaIndexer.ts`），子目录读失败只计 `skippedDirs` + `skippedPaths`，根目录读不到抛 `LibraryError('scanFailed', '无法读取媒体目录：…')`；扫完 `cleanupSeriesUnseen(libraryId, scanId, keepImages, skippedDirs)` 依次删「没源头的 episode 条目 → 没孩子的 season / series 条目 → 孤儿图片 → 本次没见过的媒体源」，返回被删的 **series** 条目数（也就是扫描结果里的「剧集数」）。

### 3.1 目录角色判定（只看目录名与直接内容）

| 目录形态 | 判定 | 建成什么 |
| --- | --- | --- |
| `Show/S01E01.mkv`（剧集目录里直接放视频） | 直接含视频 | 一个 `series` 条目 + 一个**隐式季**条目（路径就是剧集目录，季号取文件名里的季号） |
| `Show/Season 01/S01E01.mkv` | 含「季目录」子目录 | `series` + `season`（路径 = 季目录，`name` = 目录名） |
| `Show/Season 01/S01E01.mkv` + `S01E01 - 1080p.mkv` | 文件名解析出**同一个 `(季, 集)`** | **合成一条 `episode`**：条目 `path` 取自然序第一个（主版本），每个文件各写一条 `media_source`（对齐 Jellyfin 的「同集多版本」） |
| `Show/Season 01/CD1/…mkv`（季目录下更深一层） | 沿用父级季上下文 | **不新建条目**，集仍挂那一季 |
| `Show/Extras/…`、`Featurettes`、`Sample`、`Behind the Scenes`、`Deleted Scenes`、`Interviews`、`Shorts`、`Trailers` | `isExtraVideoDir` 命中 | **整棵子树跳过**，里面的视频不入库（目录里的 `xxx-sample.mkv` 这类花絮文件也被 `extraKindOfName` 过滤） |
| `Show/Specials/…`、`SP`、`OVA`、`OAD`、`特别篇`、`番外`、`特典` | `seasonNumberOfDir` → 0 | 正常建季条目，季号 0 |

> ⚠️ 代码实况：`EXTRA_DIR_PATTERN`（`src/common/types/media/mediaRules.ts:28`）**不含 `ova` / `oad`**，这两个词在 `SPECIAL_DIR_PATTERN`（`src/common/types/media/mediaRules.ts:25`）里，所以 OVA / OAD 目录按「季 0」处理，不是跳过。

资料库根目录自己就是剧集目录时（库直接指向某个剧集文件夹）照常建剧集条目，但**刮削阶段不会给它改名**（见 §4.2 的 `libraryRoots` 判断）。

### 3.2 季号与集号

- **季号**：目录名写明时以目录为准（`seasonNumberOfDir`，`src/common/types/media/mediaRules.ts:131`：`Season 01` / `S1` / `Series 2` → 数字；`第2季` / `第二季` / `2季` → 数字，中文数字借 `chineseToNumber` 支持到 99；特别篇目录 → 0）；目录名没写（剧集目录里直接放视频）时用**文件名里的季号**。
- **集号只认文件名**：`src/common/types/media/mediaRules.ts:175` 的 `parseEpisodeNumbers(fileName, fallbackSeason): EpisodeNumber | null`（`EpisodeNumber{ season, episode }`；原来是剧集专属的 `src/common/types/scrape/episode.ts`，该文件已删除、规则统一进 `mediaRules.ts`），优先级固定：

  1. `S01E02` / `s1e2` / `S01.EP02`：`/(?:^|[^0-9a-z])s\s*0*(\d{1,2})[\s._-]*e(?:p)?\s*0*(\d{1,3})/i`（季号覆盖兜底季号）；
  2. `1x02`：`/(?:^|[^0-9a-z])0*(\d{1,2})\s*x\s*0*(\d{1,3})(?:[^0-9a-z]|$)/i`；
  3. `EP02` / `E02` / `Episode 2`：`/(?:^|[^0-9a-z])(?:e(?:p)?|episode)[\s._-]*0*(\d{1,3})(?:[^0-9a-z]|$)/i`（季号用兜底值）；
  4. `第02集` / `第2话` / `第3話` / `第4期`：`/第\s*0*(\d{1,3})\s*[集话話期]/`（季号用兜底值）；
  5. 兜底：先剔除分辨率 / 编码（`QUALITY_PATTERN`：`1080p` / `x265` / `hevc`…）与季标记（`SEASON_MARKER_PATTERN`：`S02` / `Season 2` / `第2季`），再取**第一个独立数字**（限定 1–3 位，四位年份天然不命中），`<= 0` 跳过；
  6. 全都不中就返回 `null` → 文件不入库，计入 `skippedVideos`。

- **多集文件**（`S01E01E02`、`S01E01-E02`）按**第一集**处理（第 1 条规则先命中）。
- **两列落在 `media_item` 上**：季号写 `media_item.season_number`、集号写 `media_item.episode_number`（`src/main/src/db/schema/mediaItem.ts`）。这两列由增量迁移 `resources/drizzle/0001_familiar_lifeguard.sql`（`ALTER TABLE media_item ADD season_number` / `ADD episode_number`，都 `DEFAULT 0 NOT NULL`）引入；`movie` / `folder` / `series` 两列恒 0，`season` 只用 `season_number`（特别篇 0），`episode` 两列都有值（`episode_number` 从 1 开始，`season_number = 0` 表示特别篇）。基线 `0000_moaning_black_panther.sql` 里 `media_item` 是 26 列，加完这两列是 28 列；另有与剧集无关的 `0002_soft_masked_marvel.sql`（`maker` / `label` / `series` / `director` 四列，详情页元信息落库，见[数据存储](../data/01-sqlite-storage.md)），加完是 32 列。
- **集条目的归属**：季目录里的集 `parent_id = 季条目`；剧集目录里直接放的集 `parent_id = 剧集条目`，但 `seasonNumber` 仍是真实季号 —— **读取侧（`mediaSeriesRepo.seriesStatsOf` / `loadSeriesDetail`）必须把这两种都算进同一季**。

### 3.3 确定性 ID 与「同类型」认领

条目层（ID / 认领 / 写入）都在 `src/main/src/modules/media/mediaSeriesItems.ts`，`mediaSeriesIndexer.ts` 只管目录遍历、图片归属与清理。

```ts
seriesItemId(libraryId, connectionId, dirPath)                  // sha1('series\n' + libraryId + '\n' + connectionId + '\n' + dirPath)
seasonItemId(libraryId, connectionId, dirPath, seasonNumber)    // sha1('season\n' + … + '\n' + seasonNumber)
episodeItemId(connectionId, path)                               // sha1('episode\n' + connectionId + '\n' + path)
```

- 都是 `sha1(input).slice(0,32)`（32 位十六进制，与影片条目同一形态；`hashId` 定义在 `mediaScanCommon.ts`）。
- 季 ID **带季号**，因为「剧集目录里直接放视频」时多个隐式季共用剧集目录这一条路径，只靠路径会撞 ID；集 ID **不含 libraryId**（与 `mediaSourceId` 同口径）。
- **身份认领**统一走 `findOwnedItem(connectionId, itemPath, videoPaths, type)`（`mediaScanCommon.ts:29`，影片与剧集共用），三层依次找：①按**条目路径** `findItemByPath`（要求 `type` 相同）；②按**关联视频路径**查 `media_source` 再取条目；③把关联视频路径当条目路径再查一次。都没有才用确定性 ID 造新条目 —— 所以「同一集的另一个版本被扫到」会认回同一条 `episode`，「同一视频换目录」也不会造重复。
- 季的认领要**同时看路径与季号**：`ensureSeasonItem` 先 `findItemByPath` 且要求 `seasonNumber` 与本次一致，再退回按 `seasonItemId` 找，都没有才新建（`hasNfo` = 目录里有 `season.nfo` / `seasonNN.nfo`）。
- `ensureSeriesItem` 已存在时只 `updateItem(id, { parentId: '', hasNfo })`（**名字交给刮削**），新建时 `name = basenameRemotePath(dirPath)`；`ensureSeasonItem` 已存在时 `updateItem(id, { parentId, seasonNumber, hasNfo })`。
- 扫描只改**结构列**（`path` / `parentId` / `seasonNumber` / `episodeNumber` / `hasNfo`），**只有 `scrapedAt === 0` 时才顺带更新 `name`**：多版本合成一集时主版本路径变了要跟着改 `path`，但已刮削的集标题不能被重扫覆盖。
- 刮削改名走 `replacePathPrefix`（见 §4.4），**id 与 parentId 一律不动**，重扫靠路径 / 媒体源就地认领，既不会造重复、也不会丢已写好的元数据。

### 3.4 扫描期的图片与 NFO

- 与集同名（含带扩展名）的图当**集主图**；`<集名>-poster.jpg` 这类前缀名按 `imageTypeOfBaseName` 判用途、挂到集上；其余固定名（`poster` / `backdrop` / `banner` / `logo` / `fanart`…）挂**当前目录**的条目（剧集或季）；`extrafanart` / `extrathumbs` 里的图挂上一层条目（`extraArtAnchor`）。
- **NFO 三层各自读入库**（`mediaNfoScan.ts`，**未刮削的条目才读**）：剧集目录的 `tvshow.nfo`、季目录的 `season.nfo`（或 `seasonNN.nfo`，`seasonNfoOf`）、与集文件同名的 `<集名>.nfo`（同一集多个版本逐个试，`importEpisodeNfo`）。读之前**按根元素校验种类**（要 `<tvshow>` / `<season>` / `<episodedetails>`，对不上就当没有 —— 这是修「`tvshow.nfo` 扫描不到」的根因所在：`parseNfoXml` 原先只认 `<movie>` 根，现在按根元素分派出 `kind`）；命中就把元数据写条目（`applyScannedMetadata`，**只写传进来的列、不动 `scraped_at`**）、演员写 `media_cast` + 建演员档案（`syncItemCast`）。**`hasNfo` 仍按「目录里有没有对应 NFO」判定**（`collectNfoBases` + `hasNfoEvidence` / `tvShowNfoOf` / `seasonNfoOf`），与读库是两件事；读文件失败静默跳过。

## 4. 刮削：一次处理一整部剧

### 4.1 候选与入口

`src/main/src/modules/library/libraryScrape.ts` 的文件头写明两条候选口径：

- **影片库**：候选是视频文件（`scrapedAt === 0` 的 `movie` 条目），关键词按文件名解析番号、做体积过滤（`minFileSizeMb`）、按「同目录 + 同番号」去重；
- **剧集库**：候选是**剧集目录**（`scrapedAt === 0` 的 `series` 条目，`listPendingSeriesItems`），`collectSeriesCandidates` 组装：

  ```ts
  { itemId, connectionId, path: item.path, name: item.name,
    size: own?.sizeBytes ?? 0, modifiedAt: own?.modifiedAt ?? 0,
    keyword: seriesKeywordOf(item.name), num: '' }
  ```

  **不做体积过滤**（扫描阶段已按同一门槛筛过）、**剧集之间不去重**。

- 计划与调度沿用影片那套：`planSeriesLibraryScrape` 用 `pickBestGroup` 按 `(connectionId, owningPath)` 分组、取条目最多的一组，一次只跑一组；空计划报 `LibraryError('notFound', '资料库里没有待刮削的剧集')`，`startSeriesLibraryScrapeByIds([])` 报 `invalidArgument('请至少选择一个待刮削的剧集')`。
- `scrapeRunner.ts:213-263` 的 `runFiles(..., isSeries)`：任务行 `dirPath = isSeries ? item.path : dirnameRemotePath(item.path)`（**剧集的任务行 path 就是剧集目录**），随后 `isSeries ? runSeriesJob(...) : runFileJob(...)`。
- 剧集入口是 `src/main/src/modules/scrape/scrapeSeriesJob.ts` 的 `runSeriesJob(context)`（412 行），纯 IO 辅助拆到 `src/main/src/modules/scrape/scrapeSeriesAssets.ts`（120 行）。

### 4.2 流水线八步（`runSeriesJob`）

1. **取详情**：`collectFromPlugins(context, enabled, new Set(), (cands) => pickSeriesCandidate(cands, entry.keyword, seriesYearOf(entry.name)))`；没拿到 detail 直接 `{ status: 'failed', message: '未找到匹配的刮削结果', finalPath: entry.path }`。
2. **算剧集目录名**：`seriesBase = renderTemplate(naming.seriesFolderTemplate, detail, naming).trim() || entry.name`。
   - `policy.libraryRoots.includes(context.dirPath)` 时**就地**、只建季目录，并 warn「剧集目录就是资料库目录，只在它下面按规范建季目录：…」；
   - 否则 `policy.moveEnabled` 时落到 `joinRemotePath(resolveOutputDir(policy.moveDirectory, context.dirPath), seriesBase)`；没开移动时，目录名已经是 `seriesBase` 就地不动，否则落到同级的 `seriesBase`。
3. **整树改名**：`client.move(context.dirPath, seriesDir, { overwrite: false })` + `replacePathPrefix(policy.libraryId, context.dirPath, seriesDir)`（一次改写 `media_item` / `media_source` / `media_image` 三类路径，**id / parentId 不动**）；移动失败降级为「逐集移动」并 warn「剧集目录整理失败，改为逐个整理集文件：…」。
4. **季条目对齐**：`listSeasonItems` 取已有季，缺的用 `seasonItemId` 补建。
5. **剧集级产物**：`landAssets(...)`（剧集目录下的海报 / 背景图 / 徽标等）+ `carryRestore(context, seriesNfoPath, { fileName: entry.name, directory: context.dirPath, files: [] })` 生成**剧集根还原记录** + `mergeRestoreFiles` 合并本地 `tvshow.nfo` 里原有的记录 + `client.writeText(seriesNfoPath, buildTvShowNfoXml(detail, naming, artworkOf(plantedSeries), seriesRestore), { overwrite: true })`。
6. **逐季**：季目录名 `renderSeasonFolderName(naming.seasonFolderTemplate, detail, naming, season).trim() || 'Season ' + padNumber(season)` → `mkdir` → 季海报 + `season.nfo`（`buildSeasonNfoXml`，含季级还原记录）。
7. **逐集**（季内）：
   - 集文件名 `renderEpisodeTemplate(naming.episodeFileTemplate, detail, naming, { showTitle, season, episode, episodeTitle, fileName })`，渲染为空则回落 `baseNameOf(file.name)`；
   - **只有主版本会搬**：`isPrimary = (getItem(file.itemId)?.path ?? file.path) === file.path`；`isPrimary && targetPath !== file.path` 才 `client.move(file.path, joinRemotePath(seasonDir, movieFileName(base, extensionOf(file.name))))` + `refreshSourcePath(client, connectionId, file.itemId, file.path, targetPath)`（**扩展名沿用源文件**）。同一集的其它版本目标名与主版本**完全相同**、搬过去必然撞车，所以原地不动：`finalBase = finalPath === targetPath ? base : baseNameOf(file.name)`（`scrapeSeriesJob.ts:284`）；
   - 剧照按「季 + 集号」匹配 `asset.episode?.index === episodeNumber`，落 `<集基础名>-thumb.<ext>`（`EPISODE_THUMB_SUFFIX = '-thumb'`）；
   - 集 NFO 与**自己那份集文件**同名：写入目标是最终路径的 `nfoFileName(finalBase)`，沿用旧 NFO 的还原记录（`carryRestore(oldNfoPath)` + `mergeRestoreFiles`），写完若 `nfoTarget !== oldNfoPath` 且旧文件还在就删掉旧的 —— **同一集的多个版本各自有一份以自己文件名命名的 NFO**（扫描侧会逐个版本试读，见 §3.4）；
   - `updateItemMetadata(file.itemId, { ...metadataOf(…), title, num: '', overview, premiereDate, runtimeMinutes, providerIds })` + `updateItem(file.itemId, { parentId: seasonItem, seasonNumber: season, episodeNumber })`；**条目名只在主版本上更新**（`if (isPrimary) updateItem(file.itemId, { name: basenameRemotePath(finalPath) })`）+ `replaceItemImages`。
8. **收尾**：剧集条目 `updateItem(entry.itemId, { path: seriesDir, name: seriesBase })`（仅当整树移动过）+ `updateItemMetadata(entry.itemId, metadataOf(detail, entry.num, pluginId, entry.itemId))` + `replaceItemImages` + `enqueueItemActorScrape(entry.itemId, detail.actors ?? [], settings.scrape.actorScrape, signal)`；最后 `pruneEmptyDirs(context, [...oldDirs].filter(d => d !== seriesDir))`。结果 message 形如 `插件 X，N 集，N 季，N 个剧集资源，N 个 NFO，…`。

> 剧集库**暂不支持「优先本地 NFO」**（`localFirst`），见 §10。

### 4.3 搜索关键词与候选匹配

- **关键词 = 剧集目录名**：`libraryScrape.ts:107` 用 `seriesKeywordOf(item.name)`；`item.name` 在扫描期就是 `basenameRemotePath(剧集目录)`（刮削后被刮削标题覆盖，是同一个字段）。`seriesKeywordOf`（`src/common/types/media/mediaRules.ts:212`）先用与影片一致的 `extractKeyword` 清洗，再**去掉结尾的年份**（`Show 2019` → `Show`）—— 年份留着会让「包含关键词」匹配失败，年份另有用途（`seriesYearOf`，`mediaRules.ts:218`）。
- **只发一次 `search`**：`scrapeJobPlan.ts:152` 对每个插件调 `invokePlugin(plugin.id, 'search', { keyword: context.entry.keyword })`，**没有「按目录名搜不到再拿剧集名重搜一次」的二次查询**；`scrapeSeriesJob.ts:5` 注释里的「剧集目录名或剧集名」指的是同一件事。
- **匹配器 `pickSeriesCandidate(candidates, keyword, year)`**（`scrapeMatcher.ts`，剧集没有番号）：
  1. `year` 是 4 位时先筛 `(candidate.date ?? '').startsWith(year)`，池非空只用这个池，否则用全量；
  2. 池内只有一个候选 → 直接取；
  3. 否则取标题 / 番号「包含关键词」的候选（`containsKeyword`：`normalizeNum` 后长度 ≥ 3 才算，判据是 `normalizeNum(title) + normalizeNum(candidateNum)` 包含 `normalizeNum(keyword)`）；
  4. 再反过来判「关键词包含候选标题」（`pickLongestTitle`：候选标题 `normalizeNum` 后长度 ≥ 3 才算，**多条命中取标题最长的一条**）—— 用来兜住「剧集目录名比插件标题长」的情况（`The Office US` / `The Last of Us 最后生还者`，TMDB 这类插件的标题只是其中一段）；
  5. 全都不中返回 `null`（不改判成硬凑），由调用方换下一个插件。
  `containsKeyword` / `pickLongestTitle` 的「≥3 个字符」门槛意味着过短的目录名（如 `SP`）不参与包含判定。
  第 4 步与影片侧的回落共用 `pickByTitle`（`pickCandidate` 在「有番号但对不上」时也走这套标题判定，见 [刮削模块 §5.2](../scrape/01-scrape-module.md)）。

### 4.4 资源落盘与目录清理（`scrapeSeriesAssets.ts`）

| 导出 | 作用 |
| --- | --- |
| `indexRemoteEpisodes(detail)` | 把 `detail.episodes` 编成 `Map<`${season ?? 1}:${index}`, PluginEpisode>`，重复键取第一条 |
| `AssetLanding{ dir, context, assets, kinds }` | 一次资源落盘的目标 |
| `landAssets(context, landing, into)` | 落盘资源，返回失败条数；`SINGLE_KINDS` 只留第一张；本地已存在且命中 `keepFlagOf(settings.download, kind)` 时跳过但仍计入 planted |
| `imagesOf(planted, context)` | 落盘结果 → `MediaImageDraft[]`（`width` / `height` 记 0） |
| `pruneEmptyDirs(context, dirs)` | 只删空目录；跳过 `/`、资料库根目录及其祖先；受 `settings.file.removeEmptyFolder` 控制 |

### 4.5 插件契约扩展（剧集相关）

| 字段 / 函数 | 位置 | 说明 |
| --- | --- | --- |
| `PluginMovieCandidate.isSeries?` | `src/common/types/plugin/movie.ts` | 该结果是不是多集作品 |
| `PluginMovieCandidate.episodeCount?` | 同上 | 多集作品的总集数 |
| `PluginMovieDetail.episodes?` | 同上 | 多集作品才有（剧集即「多季多集」） |
| `PluginMovieDetail.genres?` | 同上 | 剧集 NFO 的 `<genre>` 用它（影片只写 tags）；`metadataOf` 改用 `detail.genres ?? []` |
| `PluginEpisode{ id?, season?, index, title?, plot?, duration?, releaseDate? }` | 同上 | `season` 从 1 开始、0 表示特别篇、缺省按第 1 季；`index` 是季内序号；`plot` 是分集简介（剧集 NFO 的 `<plot>` 与详情页简介用它） |
| `normalizeEpisode` 的 `plot` | `src/common/types/plugin/normalize.ts` | 归一化时保留 `plot` |
| `readDetail` 读 `<plot>` | `src/main/src/modules/scrape/scrapePluginData.ts` | 把 `<plot>` 读进 `episode.plot` |

## 5. 命名与产物形态

模板默认值在 `src/common/types/setting/namingSetting.ts`：

```ts
seriesFolderTemplate: '{title} ({year})'          // 剧集目录名
seasonFolderTemplate: 'Season {season}'           // 季目录名
episodeFileTemplate: '{showTitle} S{season}E{episode}'  // 集文件名（NFO 与剧照随之同名）
```

渲染函数在 `src/common/types/scrape/naming.ts`：`renderSeasonFolderName(template, detail, naming, season)`（只多一个 `{season}`，两位补零）、`renderEpisodeTemplate(template, detail, naming, scope)`（`EpisodeTemplateScope{ showTitle, season, episode, episodeTitle, fileName }`；`{title}` 仍是剧集名，集名走 `{episodeTitle}`，`{season}` / `{episode}` 两位补零，额外支持 `{showTitle}` 与 `{resolution}`）。

刮削后的磁盘形态（Jellyfin 风格）：

```text
<剧集目录>/                        ← naming.seriesFolderTemplate，默认 `{title} ({year})`；资料库根自己就是剧集目录时不改名
├── tvshow.nfo                     ← buildTvShowNfoXml(detail, naming, artworkOf(plantedSeries), seriesRestore)
├── poster.jpg / backdrop.jpg / thumb.jpg / banner.jpg / logo.jpg
├── Season 01/                     ← renderSeasonFolderName，默认 `Season {season}`（`padNumber` 两位补零）
│   ├── season.nfo                 ← buildSeasonNfoXml(…, seasonRestore)
│   ├── poster.jpg
│   ├── Show S01E01.mkv            ← renderEpisodeTemplate，扩展名沿用源文件
│   ├── Show S01E01.nfo            ← buildEpisodeNfoXml（与集文件同名）
│   └── Show S01E01-thumb.jpg      ← EPISODE_THUMB_SUFFIX = '-thumb'
└── Show S01E02.mkv / .nfo / -thumb.jpg   ← 剧集目录里直接放的集（隐式季）
```

NFO 与还原记录：

> 同一集的多个版本（`Show S01E01.mkv` + `Show S01E01 - 1080p.mkv`）：刮削只把**主版本**改成上面的规范文件名，其它版本**保持原文件名不变**，但各自有以自己文件名命名的 `.nfo`（扫描侧逐个版本试读）；重扫时它们仍归同一条 `episode`（多版本合并，见 §3.1）。

- 文件名常量：写入侧 `scrapeSeriesJob.ts` 与还原侧 `mediaClearShared.ts` 都定义 `SERIES_NFO_NAME = 'tvshow.nfo'`、`SEASON_NFO_NAME = 'season.nfo'`；`mediaWall.ts:68` 读侧另有一份同名常量。
- 三件套 XML 构造在 `src/common/types/scrape/tvNfo.ts`：`buildTvShowNfoXml` / `buildSeasonNfoXml` / `buildEpisodeNfoXml`（都接受第 4 个参数 `restore: NfoRestoreInfo | null`；集 NFO 是 `<episodedetails>`，含 `<episode>` 标签）。
- 还原记录写在 NFO 里，由 `src/common/types/scrape/nfo.ts` 的 `appendRestore` 生成：注释行 + `<originalfilename>` + `<originaldirectory>` + 若干 `<plantedfile relative="…" original="…" />`；读回用 `parseNfoRestore`。剧集三层都带记录，**集 NFO 的记录是「原集文件名 + 原目录」**（这是逐集搬回的唯一依据）。

## 6. 读模型与播放

类型都在 `src/common/types/media/index.ts`：

- `MediaWallItem` 增加 `type: 'movie' | 'series'`、`seasonCount`、`episodeCount`。剧集卡的字段口径（`mediaWall.ts:170` 的 `toSeriesWallItem`）：

  | 字段 | 剧集取值 |
  | --- | --- |
  | `path` / `dirPath` | 剧集目录（两者相同） |
  | `name` | 剧集目录名（刮削后是刮削标题） |
  | `num` | `''`（剧集没有番号） |
  | `playUrl` | `''`（播放走选集） |
  | `size` / `modifiedAt` | 集文件体积合计 / 集文件最新时间（`seriesStatsOf` 聚合） |
  | `seasonCount` / `episodeCount` | 聚合出的季数 / 集数 |

  影片卡由 `toWallItem` 补 `type: 'movie'`，`seasonCount` / `episodeCount` 恒为 0。

- `MediaEpisodeRef{ itemId, seasonNumber, episodeNumber, title, overview, runtimeMinutes, premiereDate, playUrl, coverUrl, path, size }`。
- `MediaSeasonRef{ itemId, seasonNumber, name, posterUrl, episodes }`（`name` 是季目录名；特别篇是「特别篇」）。
- `MediaDetailResult.seasons: MediaSeasonRef[]`：**只放有媒体源、能播的集**（`loadSeriesDetail` 里 `if (!source) continue`）；影片恒为 `[]`。
- `MediaClearNfoResult.removedDirs: string[]`（剧集会有多个季 / 集目录，见 §8）。

主进程读取（`src/main/src/modules/media/mediaWall.ts`）：

- `loadMediaWall` 按 `library.type === 'tv'` 走 `listSeriesItems(library.id)` + `seriesStatsOf(library.id)` + `toSeriesWallItem`；影片库走「条目 + 主源」。空 `libraryId` 遍历所有库。
- `loadWallItems(itemIds)` 影片与剧集都认（`item.type === 'series'` 时用 `seriesStatsOfOne`）。
- `readNfoMeta` 拆出通用 `readNfoInDir(connectionId, dirPath, names)`：影片读视频**同目录**的 `movie.nfo` → `<目录名>.nfo` → `<基础名>.nfo`（`nfoCandidates`，目录型条目靠目录名对上），剧集读 `<剧集目录>/tvshow.nfo`。
- `loadSeriesDetail(item, library)`：
  - 季列表 `listSeasonItems(libraryId, item.id)`、集列表 `listEpisodeItems(libraryId, season.id)`；
  - 季海报 `posterUrl = coverUrlOf(season, images)`、集封面 `coverUrl = coverUrlOf(episode, images)` —— 封面兜底链是「条目自己的图 → 直接父条目（集 → 季 → 剧集）」，所以集没剧照会退回季海报、季没海报会退回剧集封面；
  - 集标题：`episode.scrapedAt > 0 && episode.name.length > 0 ? name : '第 N 集'`；
  - 播放地址：`buildMediaUrl(source.connectionId, source.id, source.name)`（即 `storage://` 形式，与影片一致）。
- `loadMediaDetail` 先判 `item.type === 'series'` → `loadSeriesDetail`；`type` 既不是 `movie` 也不是 `series`（季 / 集直接来查）一律 `notFound`；影片返回值补 `seasons: []`。
- 目录浏览块（`owningPath` / `movieSubtree` / `toBrowseEntry` / `compareBrowse` / `browseLibrary`）已拆到**新文件** `src/main/src/modules/media/mediaBrowse.ts`，**只认影片库** —— 渲染层目前没有剧集库的目录浏览入口。
- `libraryStore.ts`：`coverUrlsOf(library)` 与 `listSummaries().videoCount` 按库类型分派 `listSeriesItems` / `countSeriesItems` 或影片版。

## 7. UI

### 7.1 影视墙卡片与文案

| 位置 | 剧集口径 |
| --- | --- |
| `src/renderer/src/components/media/MediaWallCard.vue` | 剧集卡多一枚「N 季 M 集」标签（`episodeSummary`），**不显示番号**；`alt` 按类型分说（`剧集封面` / `影片封面`） |
| `home/components/LibraryCard.vue` | 摘要「剧集 N 部」/「影片 N 部」 |
| `library/components/LibraryListItem.vue` | 「还没有剧集」/「剧集 N 部」 |
| `wall/MediaWallPage.vue` | 标题空库时「影视墙」、描述与空态用「影片」/「剧集」（`noun = libraryType === 'tv' ? '剧集' : '影片'`）；路由 query 变化时重查库名与类型 |

### 7.2 详情页（`src/renderer/src/windows/main/pages/media/detail/`）

- `composables/useEpisodeSelection.ts`（新文件，43 行）：`{ seasons, activeId, activeEpisode, playUrl, poster, select }`。
  - `seasons` 直接取 `detail.seasons`（影片是空数组）；`episodes` 是各季拉平；
  - `activeEpisode` = 选中 ID 命中的集 → **否则第一集** → 否则 `null`；**没手选过、或重新读取后选中的集已不存在，一律回落第一集**，所以「重新读取」不用清状态；
  - `playUrl` = 选中集的 `playUrl`，没有集时回落 `detail.item.playUrl`（影片路径）；`poster` 同理（选中集封面 → 剧集封面）。
- `components/MediaEpisodeList.vue`（新文件，158 行）：`props { seasons, activeId }` + `emit('select')`；季选择器（`seasons.length > 1` 才出现，只影响这一屏显示哪一季）+ 集按钮（`第 N 集`，当前集 `theme="primary"`）+ 当前集标题 / 时长 / 首播日期 / 体积 / 简介；**`seasons` 为空数组时整块不渲染**；选中集换季时选择器自己拨过去，季列表变化后收回仍存在的季。
- `MediaDetailPage.vue`：播放器改用选集口径（`const { seasons, activeId, playUrl, poster, select } = useEpisodeSelection(detail)`），播放器下方接入 `<media-episode-list>`；「还原刮削前」的确认文案按类型分说（`这部剧集` / `这部影片`，剧集提示会连带还原所有季与集）。
- `MediaDetailHero.vue`：**头部不放播放按钮**（播哪一集由选集区决定，播放器就在头部正下方），标题兜底「未命名剧集」；另外头部**只认宽图**（缩略图 / 横幅 / 背景图 / 剧照），一张都没有时整条图片带都不渲染、退成纯文字头部。
- `composables/useDetailView.ts`：`isSeries`、`posterTitle`（空标题时「未命名剧集」/「未命名影片」）、`posterNote`（剧集 `N 季 · M 集 · 体积`，影片 `番号 · 体积`）、`noSourceHint`（剧集「这部剧集里还没有能播放的集，请回影视墙刷新后再试」）。
- `mediaDetailCells.ts`：`fileCells`（文件信息）与 `heroFacts` 加剧集分支 —— 文件信息用「剧集目录」标签 + 所在目录 / 体积 / 修改时间 / 数据源，头部要点是季数 / 集数（`episodeCount > 0 ? 'N 集' : ''`）/ 首播日期（`meta.releaseDate`）；`infoCells`（影片信息 / 剧集信息）与影片共用同一套四行（片商 / 厂牌 / 系列 / 导演），空值行不渲染。

## 8. 还原刮削前（清除 NFO）

入口 `src/main/src/modules/media/mediaClearNfo.ts`（分派器）：

- 空 id → `MediaError('invalidArgument', '缺少条目 ID')`；条目不存在 → `notFound('索引里没有这个条目')`；
- `type === 'series'` → `clearSeriesNfo`（`mediaClearSeriesNfo.ts`）；`type !== 'movie'`（季 / 集）→ `notFound('索引里没有这部影片')`；其余 → `clearMovieNfo`；
- `MediaClearNfoResult.removedDir: string` 已改成 **`removedDirs: string[]`**（剧集会有多个季 / 集目录）。

公共工具抽到**新文件** `src/main/src/modules/media/mediaClearShared.ts`：`SERIES_NFO_NAME` / `SEASON_NFO_NAME` / `PlantedRestore` / `openClient` / `readRestore` / `removeNfoFiles` / `existsOrTrue` / `moveFile` / `restorePlantedFiles` / `libraryRoots` / `removeEmptyDir(client, dirPath, keep)`。

`clearSeriesNfo(item)` 的顺序固定为「**剧集根 → 逐季 → 逐集**」，每层都是「读记录 → 删 NFO → 还原资源 → 搬回文件」：

1. **剧集根**：读 `tvshow.nfo` 还原记录 → 删 NFO → 记录目标与当前路径不同且目标**不存在**时，`moveFile` 把**整个剧集目录搬回原名原位置**，并 `replacePathPrefix(libraryId, seriesDir, target)` 一次改写三类路径（条目 id / 父子关系不动）→ `restorePlantedFiles` 还原剧集级资源 → `clearItemMetadata(itemId, { name: basenameRemotePath(seriesDir), num: '' })` + `deleteImagesByItem` + `deleteCastByItems`；
   - 改名必须排在最前面，否则集 NFO 里记的「旧剧集目录下的季目录」不成立；目标已被占用时保持现状、只记 `restored = false`（**绝不覆盖**）。
2. **逐季**：删 `season.nfo` → 读季记录 → 还原季资源 → `clearItemMetadata(season.id, …)` + `deleteImagesByItem(season.id)`。
3. **逐集**：取主媒体源；**没有源就只清库内数据**（`clearItemMetadata` + `deleteImagesByItem` + `deleteCastByItems`）；有源时从**源文件名**反推 NFO 名 `nfoFileName(stripExtension(source.name))`（条目 `name` 已被刮削标题覆盖，名字只能从源文件反推）→ 删 NFO → 还原集资源（剧照 `<集基础名>-thumb.<ext>`）→ 按记录把集文件搬回并 `refreshSourcePath(client, connectionId, episode.id, source.path, target)` → 展示名回落磁盘文件名（`name = basenameRemotePath(finalPath)`，`num = normalizeNum(extractKeyword(fileName).num)`）→ `deleteImagesByItem` + `deleteCastByItems`；集目录搬空后 `removeEmptyDir` 顺手删掉，路径进 `removedDirs`。
4. 每季末尾同样 `removeEmptyDir(seasonDir, roots)`，规范化改名出来的季目录通常已搬空 → 也进 `removedDirs`。

**已知限制：季目录名不回改。** 刮削时的规范化改名没有留下原始季目录名，所以旧季目录由集文件搬回时**重建**（集 NFO 里记的旧目录重新成立），规范化后的季目录在搬空后按空目录删掉；扫描下一次会把重建出来的旧季目录认成新季条目。

其余口径与影片一致（见 `mediaClearNfo.ts` 文件头）：还原依据是 NFO 里的记录；没记录的旧 NFO 退化成「只清库内 + 删 NFO」；**先磁盘、后数据库**（NFO 删失败整体失败，库内原样保留）；只动刮削产物，没记在 NFO 里的文件一律不碰；演员本人档案不动，只删该条目的参演名单；清完不自动重刮。

## 9. 关键文件表

| 文件 | 职责 |
| --- | --- |
| `src/common/types/library/index.ts` | `LibraryType` / `LIBRARY_TYPES` / `LIBRARY_TYPE_LABELS` / `libraryTypeLabel` |
| `src/common/types/media/index.ts` | `MediaWallItem`（加 `type` / `seasonCount` / `episodeCount`）、`MediaEpisodeRef`、`MediaSeasonRef`、`MediaDetailResult.seasons`、`MediaClearNfoResult.removedDirs` |
| `src/common/types/media/mediaRules.ts` | 剧集与影片共用的命名规则纯函数：`parseEpisodeNumbers` / `seasonNumberOfDir` / `isExtraVideoDir` / `extraKindOfName` / `seriesKeywordOf` / `seriesYearOf` / `parseMediaName` / `isVersionOfFolder`（原来是 `src/common/types/scrape/episode.ts`，该文件已删除） |
| `src/common/types/scrape/naming.ts` | `renderSeasonFolderName` / `renderEpisodeTemplate` / `padNumber` |
| `src/common/types/scrape/tvNfo.ts` | `buildTvShowNfoXml` / `buildSeasonNfoXml` / `buildEpisodeNfoXml` |
| `src/common/types/scrape/nfo.ts` | 还原记录写入 `appendRestore` / 读回 `parseNfoRestore` |
| `src/main/src/db/schema/mediaItem.ts` | `media_item` 的 drizzle schema：`type` 收 `series` / `season` / `episode`，新增 `season_number` / `episode_number` 两列 |
| `resources/drizzle/0001_familiar_lifeguard.sql` | 剧集增量迁移：给 `media_item` 加 `season_number` / `episode_number`（基线是 `0000_moaning_black_panther.sql`） |
| `src/main/src/modules/library/libraryScrapeDispatch.ts` | 按库类型分派三个入口（唯一判断点 `isTvLibrary`） |
| `src/main/src/modules/library/libraryScan.ts` | 扫描编排：`isTv` 二选一走剧集索引 / 清理，`skippedVideos` 提示 |
| `src/main/src/modules/library/libraryScrape.ts` | 剧集候选 `collectSeriesCandidates` / `pendingSeriesEntries` / `planSeriesLibraryScrape` / `startSeriesLibraryScrape(ByIds)` |
| `src/main/src/modules/library/libraryStore.ts` | `coverUrlsOf` / `listSummaries().videoCount` 按库类型分派 |
| `src/main/src/modules/media/mediaSeriesItems.ts` | 剧集条目层：`seriesItemId` / `seasonItemId` / `episodeItemId` / `findOwnedItem` 认领、`ensureSeriesItem` / `ensureSeasonItem` / `indexEpisode`（多版本合成一集） |
| `src/main/src/modules/media/mediaSeriesIndexer.ts` | 剧集目录遍历 `indexSeriesLibraryPath`、图片归属 `indexSeriesImages`、`cleanupSeriesUnseen` |
| `src/main/src/modules/media/mediaNfoScan.ts` | 扫描期 NFO：`collectNfoBases` / `hasNfoEvidence` / `importMovieNfo` / `importSeriesNfo` / `importSeasonNfo` / `importEpisodeNfo` |
| `src/main/src/db/repo/mediaSeriesRepo.ts` | `SeriesItemStats` / `EMPTY_SERIES_STATS` / `listSeriesItems` / `listPendingSeriesItems` / `countSeriesItems` / `listSeasonItems` / `listEpisodeItems` / `seriesStatsOf` / `seriesStatsOfOne` / `replacePathPrefix` / `SeriesEpisodeFile` / `listSeriesEpisodes` |
| `src/main/src/modules/media/mediaWall.ts` | `toSeriesWallItem` / `readNfoInDir` / `loadSeriesDetail` / `loadWallItems` 认 series |
| `src/main/src/modules/media/mediaBrowse.ts` | 目录浏览块（**只认影片库**） |
| `src/main/src/modules/media/mediaClearNfo.ts` | 还原分派器 + `clearMovieNfo` |
| `src/main/src/modules/media/mediaClearSeriesNfo.ts` | `clearSeriesNfo`（剧集三步还原） |
| `src/main/src/modules/media/mediaClearShared.ts` | 还原公共工具（NFO 名常量、`readRestore`、`restorePlantedFiles`、`removeEmptyDir`…） |
| `src/main/src/modules/scrape/scrapeSeriesJob.ts` | `runSeriesJob` 剧集任务入口 + 产物命名常量 |
| `src/main/src/modules/scrape/scrapeSeriesAssets.ts` | `indexRemoteEpisodes` / `landAssets` / `imagesOf` / `pruneEmptyDirs` |
| `src/main/src/modules/scrape/scrapeJobApply.ts` | `metadataOf`（`detail.genres ?? []`）、`mergeRestoreFiles`、`carryRestore`、`refreshSourcePath`（单文件条目）、`refreshItemDir`（目录型条目：条目 `path` 换成新目录 + 逐源重算路径） |
| `src/main/src/modules/scrape/scrapeJobPlan.ts` | `collectFromPlugins`（第三参 `pick`，剧集传 `pickSeriesCandidate`） |
| `src/main/src/modules/scrape/scrapeMatcher.ts` | `pickSeriesCandidate` |
| `src/renderer/src/components/media/MediaWallCard.vue` | 剧集卡「N 季 M 集」标签 |
| `src/renderer/src/windows/main/pages/media/detail/` | `composables/useEpisodeSelection.ts`、`components/MediaEpisodeList.vue`、`MediaDetailPage.vue`、`useDetailView.ts`、`mediaDetailCells.ts`、`MediaDetailHero.vue` |
| `src/renderer/src/windows/main/pages/media/{home,library,wall}/…` | 库摘要与墙面文案按 `library.type` 分说 |

## 10. 注意事项与已知限制

1. **季目录名不回改**（§8）：还原后旧季目录是集文件搬回时重建的，规范化后的季目录被当空目录删掉。
2. **剧集库暂不支持「优先本地 NFO」**（`localFirst`）：剧集任务的 `localKinds` 传空集合，已有本地 NFO / 图片不会被沿用。
3. **剧集不做体积过滤、剧集之间不去重**（影片库两者都有）。
4. **集号认不出来就不入库**：只报 `skippedVideos`（「N 个视频认不出季 / 集号，未入库」），不会猜。
5. **细节名与目录角色只看名字**：`Extras` 之类词表命中即整棵跳过；OVA / OAD 按季 0（不是跳过）。
6. **剧集没有番号**：`num` 恒为空串，`playUrl` 恒为空串；播放地址由详情页的选集状态折算。
7. **`seasons` 只含有源的集**：没有媒体源的残留集不上详情页，也不参与选集。
8. **渲染层没有剧集库的目录浏览入口**：`mediaBrowse.ts` 只认影片库。
9. **资料库根自己就是剧集目录时不改名**：只在它下面按规范建季目录（warn 提示）。
10. `media_item` **没有 `title` 列**：刮削标题写在 `name` 与 `sortName` 上（`mediaRepo.updateItemMetadata`），NFO 还原后 `name` 回落到磁盘文件名。
11. **同集多版本只搬主版本**：同一季同集号的多个文件合成一条 `episode` 后，刮削只把**主版本**（条目 `path` 指向的那份）整理成规范文件名，其它版本保持原文件名（只各写自己的 NFO）；详情页本期只播主版本，版本切换 UI 留后续。多版本的识别依赖文件名里同一次 `SxxExx`（`parseEpisodeNumbers`），**与 `- 1080p` 这类版本后缀无关**。
12. **花絮文件在剧集库同样不入库**：`extraKindOfName` 命中的文件（`xxx-sample.mkv`、整个名字就是 `sample` 的）在扫描期被过滤，`isExtraVideoDir` 命中的目录整棵不下钻。
