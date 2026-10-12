# SQLite 存储

## 实现思路

数据落盘统一走主进程：`better-sqlite3` 提供同步 SQLite 驱动，`drizzle-orm` 提供类型化查询与迁移，表结构用 drizzle 的 `sqliteTable` 声明。渲染进程永远不直接接触数据库文件，只通过 IPC 调用主进程的仓储函数。

数据库文件位置：`~/.vault-scrape/db/vault-scrape.db`（WAL 模式）。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/src/db/schema/log.ts` | `log` 表定义 |
| `src/main/src/db/schema/task.ts` | `task` 表定义 |
| `src/main/src/db/schema/scrapeFile.ts` | `scrape_file` 表定义 |
| `src/main/src/db/schema/library.ts` | `library` / `library_path` 表定义（资料库配置与多根目录） |
| `src/main/src/db/schema/mediaItem.ts` | `media_item` 表定义（Jellyfin 的 BaseItem：影视库用 `movie` / `folder`，剧集库用 `series` / `season` / `episode` + 组织层 `folder`） |
| `src/main/src/db/schema/mediaSource.ts` | `media_source` 表定义（一个条目下的媒体文件；同一影片目录的多个版本、同一集号的多个文件各写一条，条目与源是一对多） |
| `src/main/src/db/schema/mediaImage.ts` | `media_image` 表定义（primary / backdrop / thumb / …） |
| `src/main/src/db/schema/actor.ts` | 演员域三张表 + 影视参演名单表定义（`actor` / `actor_alias` / `actor_image` / `media_cast`，见 [演员模块](../actor/01-actor-module.md)） |
| `src/main/src/db/schema/index.ts` | schema 汇总导出（drizzle 配置的入口） |
| `src/main/src/db/client.ts` | 单例连接、`initDb()`、`db()` |
| `src/main/src/db/repo/logRepo.ts` | 日志仓储 |
| `src/main/src/db/repo/taskRepo.ts` | 任务仓储与统计 |
| `src/main/src/db/repo/scrapeRepo.ts` | 刮削任务下的逐文件结果仓储（含跨任务按路径 / 状态取记录的 `listScrapeWithConnection`，影视墙已不再用它） |
| `src/main/src/db/repo/libraryRepo.ts` | 资料库与媒体目录仓储（`isSameOrInsidePath` / `findLibraryByPath`；旧的精确归属函数 `findPathOwner` 已随目录重叠规则删除） |
| `src/main/src/db/repo/mediaRepo.ts` | 媒体条目 + 媒体源仓储（`upsertSource` / `updateItemMetadata` / `updateSourcePath` / `cleanupUnseen` 用到的删除函数） |
| `src/main/src/db/repo/mediaImageRepo.ts` | 媒体图片仓储（`upsertImage` / `replaceItemImages` / 按连接、按库批量删除） |
| `src/main/src/db/repo/actorRepo.ts` | 演员仓储（演员 / 别名 / 图片 / 参演名单四张表的读写，清单见 §数据结构 后的仓储小节） |
| `src/main/src/db/dbIpc.ts` | 数据库域 IPC 注册 |
| `src/preload/src/modules/db/dbChannels.ts` | 通道常量与载荷类型（契约） |
| `src/preload/src/modules/db/db.ts` | 渲染层可用的 `dbApi` |
| `src/renderer/src/api/db.ts` | 渲染层统一出口 |
| `drizzle.config.ts` | drizzle-kit 配置（schema 入口与迁移输出目录） |
| `resources/drizzle/` | 迁移 SQL 与 meta：**全量基线** `0000_moaning_black_panther.sql`（12 张表）+ 剧集增量 `0001_familiar_lifeguard.sql`（给 `media_item` 加 `season_number` / `episode_number`），配 `meta/0000_snapshot.json` / `meta/0001_snapshot.json` 与 `meta/_journal.json`（idx 0 / 1 两条），详见 §迁移 |

## 数据结构

`log` 表（`logTable('log')`）：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | `randomUUID()` |
| `level` | text | `debug` / `info` / `warn` / `error` |
| `scope` | text | 产生日志的模块，如 `app`、`setting` |
| `message` | text | 日志正文 |
| `detail` | text | 附加信息，通常为 JSON 字符串，空串表示无 |
| `created_at` | integer | 毫秒时间戳 |

索引：`idx_log_created`（created_at）、`idx_log_level`（level）。

`task` 表（`taskTable('task')`）：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | 任务 id |
| `name` | text | 任务名，通常是待刮削目录名或番号 |
| `status` | text | `pending` / `running` / `success` / `failed` / `paused` |
| `connection_id` | text | 数据源（存储）id |
| `dir_path` | text | 该次任务扫描的根目录（远端路径） |
| `total` | integer | 计划处理数量 |
| `finished` | integer | 已处理数量 |
| `failed` | integer | 失败数量 |
| `message` | text | 结果说明或失败原因 |
| `created_at` / `updated_at` | integer | 毫秒时间戳 |

索引：`idx_task_status`（status）、`idx_task_created`（created_at）。

`scrape_file` 表（`scrapeFileTable('scrape_file')`）：逐文件结果，主键为 `` `${taskId}:${path}` ``。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | `${taskId}:${扫描时的 path}` |
| `task_id` | text | 所属任务 |
| `item_id` | text | 本次刮削的条目 ID（`media_item.id`）；解析不到条目时为空串 |
| `path` / `name` | text | 文件扫描时的原始连接内路径与文件名 |
| `final_path` | text | 刮削结束后的最终路径；未改名 / 移动时与 `path` 相同，改名 / 移动后由 `updateSourcePath` 同步写回 `media_source.path`，两者始终一致 |
| `keyword` | text | 搜索关键词（由文件名解析） |
| `status` | text | `pending` / `running` / `success` / `failed` / `skipped` |
| `plugin_id` / `title` | text | 命中的插件与条目标题 |
| `message` | text | 结果说明或失败原因 |
| `updated_at` | integer | 毫秒时间戳 |

索引：`idx_scrape_file_task`（taskId）、`idx_scrape_file_status`（taskId, status）、`idx_scrape_file_item`（itemId）。

媒体层的五张表（`library` 13 列 / `library_path` 5 列 / `media_item` 32 列 / `media_source` 12 列 / `media_image` 9 列）不在本文重复，逐列以 `src/main/src/db/schema/*.ts` 与 `resources/drizzle/` 里的迁移 SQL 为准。要点：

- `library` 表的 `type` 列（`$type<LibraryType>()`，默认 `'movie'`）现由基线迁移 `0000_moaning_black_panther.sql` 一并建立：类型决定扫描按 `setting.library.extensions` 里的哪份后缀清单识别媒体文件，建库后不可修改。库级选项只留 `min_file_size_mb`（体积过滤，默认 0）与 `local_first`（优先本地 NFO 与图片，默认 false）；写 NFO、重命名、图片落同目录是固定规范，没有对应列。
- 表之间**没有外键**：`library_id` / `item_id` / `parent_id` 都是普通 text 列，级联清理由仓储函数显式完成（`deleteItemsWithoutSource` → `deleteImagesByIds` → `deleteSourcesNotInScan`；删库走 `purgeLibraryMedia`；删连接走 `deleteLibrariesByConnection`）。
- `media_item.type` 的取值是 `'movie' | 'folder' | 'series' | 'season' | 'episode'`（列注释与 `$type<…>()` 同步）：影视库写 `movie`（视频）/ `folder`（目录），**剧集库写 `series`（整部剧）/ `season`（季）/ `episode`（集）**，同样用 `parent_id` 串成 剧集 → 季 → 集 三层——**没有新表**，只在增量迁移 `0001_familiar_lifeguard.sql` 里给 `media_item` 加了 `season_number`（季号，`0` 表示特别篇）与 `episode_number`（集号，从 1 开始）两列（`movie` / `folder` / `series` 两列恒 0），`path` 对 `movie` / `episode` 是主媒体源路径（**目录型影片条目的 `path` 是影片目录路径**，条目下每个版本各有一条 `media_source`）、对 `folder` / `series` / `season` 是目录路径。扫描按库类型分派（`libraryScrapeDispatch.ts` 的 `isTvLibrary()`），逐层建条目与季 / 集号解析见[剧集支持](../media/02-series-support.md)。
- 唯一索引是去重与 upsert 的落点：`library_path (connection_id, path)`（一条目录只能属于一个库，嵌套与重叠由 `libraryStore.normalizePaths()` 在保存时先用 `isRemotePathInside` 拦下）、`media_source (connection_id, path)`（重扫 `upsertSource` 的冲突目标，**id 不变**）、`media_image (connection_id, path)`。
- 刮削元数据写在 `media_item` 上（`title` / `num` / `overview` / 评分 / JSON 列 `genres` / `studios` / `tags` / `provider_ids` / `scraped_at` / `scraper_id`，以及明文四列 `maker` / `label` / `series` / `director`），所以重扫只更新 `media_source`，元数据与图片不会丢。`maker` / `label` / `series` / `director` 由增量迁移 `0002_soft_masked_marvel.sql`（`ADD … TEXT NOT NULL DEFAULT ''`）加上：以前只有 `studios` 一个 JSON 列、把 studio / maker / label 压成一个数组，`series` 与 `director` 干脆没有落脚点，所以**详情页要显示片商 / 厂牌 / 系列 / 导演就只能实时去读磁盘 NFO**；现在两者都落库，详情页只读这四列。写入侧两处：刮削走 `scrapeJobApply.metadataOf()`，扫描导入 NFO 走 `mediaNfoScan.scannedMetadataOf()`；「还原刮削前」的 `clearItemMetadata()` 与其它刮削列一起归空。
- `media_item.has_nfo`（基线迁移 `0000_moaning_black_panther.sql` 里的列）反过来是**扫描拥有**的列：扫描时同目录有 `movie.nfo`、**目录型条目按目录名命名的 `.nfo`** 或与视频同名的 `.nfo` 就置 1；剧集库三层分别认 `tvshow.nfo` / `season.nfo`（或 `seasonNN.nfo`）/ 集同名 NFO。它只表示「磁盘上有没有 NFO」这一事实——影视墙不按它分类（旧的「是否刮削 = `scraped_at > 0` 或 `has_nfo > 0` 或有图片」三口径已下线），但它**决定批量刮削的候选**：`listPendingMovieItems` / `listPendingSeriesItems` 只取 `scraped_at = 0` 且 `has_nfo = 0`，有 NFO 的条目只能在详情页手动刮；唯一的另一个写入方是「还原刮削前」的 `clearItemMetadata()`（把 `has_nfo` 一并归零，因为该条目的 NFO 已被删掉），见 [资料库](../media/01-media-library.md)。
- 演员域的三张表与影视参演名单表（`actor` 24 列 / `actor_alias` 4 列 / `actor_image` 12 列 / `media_cast` 4 列，都在基线迁移 `0000_moaning_black_panther.sql` 里）也不在本文重复：列语义、图片落盘与 `storage://actor` 协议、抓取链路见 [演员模块](../actor/01-actor-module.md)。要点：`actor.name_key` 与 `actor_alias.(actor_id, alias_key)` 是唯一索引（姓名与别名去重、匹配的落点）；`media_cast` 是**按名字的弱关联**（复合主键 `(item_id, name_key)`，`idx_media_cast_name` 反查作品），`actor_name` 只用于展示、不存演员 ID，所以演员改名或删除都不会留下悬挂行；`actor.tags` 同样是 JSON 文本列；图片**本体不在库里**，`actor_image.path` 指向应用数据目录下的绝对路径。

时间一律使用整数毫秒，避免时区与字符串格式歧义。

## 离线数据包库（r18.db）

内置插件「R18 离线数据包」会另建一个**完全独立**的库，放在系统库边上：`~/.vault-scrape/db/r18.db`（导入期另有 `r18.db.import` / `r18.db.old`）。

- 不写进 drizzle schema、不参与 `migrate()`：schema 版本由库内 `offline_meta.schema_version` 自管，列由上游转储的 `COPY` 头部动态生成（全部 TEXT 亲和）；
- 查询用独立只读句柄（`readonly: true, fileMustExist: true`）打开，**绝不 ATTACH 系统库**；两个库之间没有外键与事务关系；
- 这个库被删 / 损坏只影响离线刮削结果，系统数据与设置不受影响（这正是分库的目的）；
- 细节（数据源、导入流水线、查询规则、错误码）见 [../plugin/02-builtin-offline-plugin.md](../plugin/02-builtin-offline-plugin.md)。

## API 契约

主进程仓储（`src/main/src/db/repo/`）：

- `appendLog(input: LogInput): LogItem`：补全 `id` 与 `createdAt` 后写入并返回整行。
- `listLog(query?: LogQuery): LogItem[]`：默认 `limit = 50`，按 `createdAt` 倒序。
- `countLog(query?: LogQuery): number`。
- `clearLog(): number`：返回删除行数。
- `listTask(query?: TaskQuery): TaskItem[]`：默认 `limit = 20`。
- `countTask(query?: TaskQuery): number`。
- `taskStats(): TaskStats`：按 status 分组聚合，输出 `{ total, pending, running, success, failed }`。
- `listScrapeWithConnection(status?): { item: ScrapeFileItem; connectionId: string }[]`：`scrape_file ⨝ task` 取回所属存储（`scrape_file` 本身没有 `connection_id`），可选按状态过滤，按 `updatedAt` 倒序。它仍在，但**影视墙已不再用它做配对**（配对改由 `media_source` 的条目外键完成）。

资料库与媒体层仓储（`src/main/src/db/repo/libraryRepo.ts` / `mediaRepo.ts` / `mediaImageRepo.ts` / `mediaCleanupRepo.ts`，全部只在主进程内部使用，没有 IPC 通道）：

- 资料库：`listLibraries()`、`listLibrariesByConnection(connectionId)`、`getLibrary(id)`、`listLibraryPaths(libraryId)`、`insertLibrary(input)`、`updateLibrary(id, input)`、`replaceLibraryPaths(libraryId, drafts)`（整组替换多根目录）、`patchLibrary(id, patch)`、`deleteLibrary(id)`、`deleteLibrariesByConnection(connectionId)`；路径判定 `isSameOrInsidePath(root, target)`、`findLibraryByPath(connectionId, dirPath)`（**没有 `findPathOwner` 了**——目录归属已由 `libraryStore.normalizePaths()` 的「不许重复 / 不许嵌套」规则在保存时保证，判定用 `src/common/types/file/path.ts` 的 `isRemotePathInside(dir, path)`）。
- 媒体条目：`getItem(id)`、`listItems(libraryId)`、`listMovieItems(libraryId?)`、`listChildItems(libraryId, parentId)`、`findItemByPath(connectionId, path)`、`insertItem(input)`、`updateItem(id, patch)`（**只更新扫描拥有的列**，元数据列原样保留）、`updateItemMetadata(itemId, meta)`（整组覆盖刮削元数据，`name` 与 `sort_name` 同取标题）、`deleteItem(id)`、`countMovieItems(libraryId)`、`countScrapedMovieItems(libraryId)`、`listPendingMovieItems(libraryId)`；扫描收尾与「删库 / 删连接」的批量清理在 `mediaCleanupRepo.ts`（`deleteSourcesNotInScan` / `deleteItemsWithoutSource` 按 `DELETE_CHUNK = 500` 分块删，跳过 `skippedDirs` 内的条目；另有 `deleteSourcesByLibrary` / `deleteSourcesByConnection` / `deleteItemsByLibrary` / `deleteItemsByConnection`）。
- 媒体源：`getSource(id)`、`listSourcesByItem(itemId)`、`listSourcesByLibrary(libraryId)`、`findSourceByPath(connectionId, path)`、`insertSource(input, scanId)`、`upsertSource(input, scanId)`（冲突目标 `(connection_id, path)`，冲突时刷新扫描拥有的列、**id 不变**）、`updateSource(id, patch)`、`updateSourcePath(id, file)`（就地更新路径 / 名字 / 扩展名 / MIME / 大小 / 时间）、`maxSourceIndexedAt(): number`。
- 媒体图片：`getImage(id)`、`listImagesByItem(itemId)`、`listImagesByLibrary(libraryId)`、`findImageByPath(connectionId, path)`、`insertImage(input)`、`upsertImage(input)`、`replaceItemImages(itemId, images)`（刮削成功后整组替换）、`deleteImage(id)`、`deleteImagesByItem(s)` / `deleteImagesByIds(ids)` / `deleteImagesByLibrary` / `deleteImagesByConnection`。
- 演员：`src/main/src/db/repo/actorRepo.ts`（`getActor` / `findActorByName` / `findActorByAlias` / `ensureActorByName` / `updateActor` / `listActors` / `listActorsByNames` / `countActors` / `listAllTags` / `countFilmsByNameKey` / `listAliases` / `replaceAliases` / `getActorImage` / `listActorImages` / `insertActorImage` / `deleteActorImage` / `setActorAvatar` / `replaceItemCast` / `listItemCastNames` / `listItemIdsByActorNameKey` / `deleteCastByItems` / `listIncompleteActors` / `deleteActor` 等）；仓储只做数据库读写，图片文件的搬移与删除在 `modules/actor/actorAsset.ts`，名单的写入与演员档案的自动创建在 `modules/actor/actorLink.ts`（`syncItemCast`）。逐项语义见 [演员模块](../actor/01-actor-module.md)。

IPC 通道（`DbChannels`，全部为 `ipcMain.handle` / `ipcRenderer.invoke`）：

| 通道 | 载荷 |
| --- | --- |
| `db:logList` | `LogQuery` → `LogItem[]` |
| `db:logCount` | `LogQuery` → `number` |
| `db:logClear` | 无 → `number` |
| `db:taskList` | `TaskQuery` → `TaskItem[]` |
| `db:taskCount` | `TaskQuery` → `number` |
| `db:taskStats` | 无 → `TaskStats` |

渲染层通过 `dbApi`（`@/api` 再导出）以 `dbApi.log.list(...)` / `dbApi.task.stats()` 形式调用。

媒体条目 / 媒体源 / 图片与逐文件刮削结果在 `db` 域之外**只有影视墙与资料库会读**：`db` 域不为它们开 IPC 通道，影视墙走 `media` 域通道 `media:wall` / `media:detail`，资料库目录浏览走 `scrape:browse`（渲染层暂无入口，通道保留）（见 [影视墙页面](../page/04-media-wall-page.md)、[刮削进度与详情页](../page/03-scrape-detail-page.md)）；条目封面与播放地址都是 `storage://` URL。**`media_item` / `media_image` / `media_cast` 的唯一外部写通道是 `media:clear-nfo`**（详情页「还原刮削前」：按 NFO 里的还原记录把视频改回原名 / 搬回原目录（**目录型条目则整个影片目录搬回**）并刷新条目路径与 `media_source.path`、删掉刮削写下的图片与 NFO（候选 `movie.nfo` / `<目录名>.nfo` / `<文件名>.nfo`）、刮削列归零 + `name` / `num` 还原成还原后的磁盘文件名，再删掉该条目的图片与参演名单），其余写入都由扫描 / 刮削主进程内部完成。其余场景（`storage://` 协议处理、扫描后的清理、删除存储时的级联）都由主进程自己使用这些仓储。

## 迁移

- 迁移文件由 `yarn db:generate`（即 `drizzle-kit generate`）生成到 `resources/drizzle/`，不手写 SQL。drizzle 的 `run()` 只支持单语句 DDL，手写多语句迁移会直接抛错；删表也走 generate 产出 `DROP`。
- 启动时 `initDb()` 调用 `migrate(db, { migrationsFolder })`，目录在开发态为 `join(__dirname, '../../resources/drizzle')`；打包时通过 `electron-builder.yml` 的 `asarUnpack` 释放到磁盘后仍可按该相对路径解析。
- 迁移是追加式的：改表结构后重新 generate，产生新的 `000X_*.sql`，不要修改历史迁移。
- **整库重建过一次：迁移删光重生成，得到一份全量基线**。旧的 `0000_heavy_hardball.sql` ~ `0006_media_cast.sql` 与整个 `meta/` 已删除，本机数据库 `~/.vault-scrape/db/vault-scrape.db`（含 `-wal` / `-shm`）也一起删了，重新 `yarn db:generate` 得到：
  - `resources/drizzle/0000_moaning_black_panther.sql`——基线 schema 的完整建库脚本（**12 张表、0 外键**，全文 `CREATE TABLE` + `CREATE INDEX`），列数：`log` 6 / `task` 11 / `scrape_file` 12 / `library_path` 5 / `library` 13 / `media_item` 26 / `media_source` 12 / `media_image` 9 / `actor_alias` 4 / `actor_image` 12 / `actor` 24 / `media_cast` 4；索引 2 / 2 / 3 / 2 / 0 / 3 / 3 / 3 / 2 / 1 / 2 / 1；
  - `resources/drizzle/0001_familiar_lifeguard.sql`——剧集支持的**增量**（`ALTER TABLE media_item ADD season_number` + `ADD episode_number`）；基线 + 这份增量后 `media_item` 是 **28 列**（其余表不变）；
  - `resources/drizzle/0002_soft_masked_marvel.sql`——详情页元信息落库的**增量**（`ALTER TABLE media_item ADD maker` / `label` / `series` / `director`，四列都是 `TEXT NOT NULL DEFAULT ''`）；再叠加这份后 `media_item` 是 **32 列**（其余表不变）；
  - `meta/_journal.json` 有 idx 0（tag `0000_moaning_black_panther`）、idx 1（tag `0001_familiar_lifeguard`）与 idx 2（tag `0002_soft_masked_marvel`）三条，快照为 `meta/0000_snapshot.json` / `meta/0001_snapshot.json` / `meta/0002_snapshot.json`。
  之后改表结构照旧 `yarn db:generate` 追加 `0003_*.sql` 这类增量即可。
- **旧库不做兼容、不迁移数据**：drizzle 的记账表里记着旧 tag / hash，与新迁移对不上时启动会报 `table ... already exists`；因此本机旧库一直是「删掉 + 重建」（历史归档 `vault-scrape.db.old-20261010`，最近一次直接删了当前库文件），新库首次启动时按基线迁移从零建表。旧库里的刮削记录 / 任务历史一律不带过来。
- **资料库配置这一轮进了 sqlite**（`library` / `library_path`）：`~/.vault-scrape/media/libraries.json` 已废弃、不再读写，删除存储时的库级联也变成数据库操作（`deleteLibrariesByConnection`）。
- 例外不变：离线插件自管的 `r18.db` 不参与 `migrate()`，不受这次重建影响。

## 注意事项

- `db()` 在 `initDb()` 之前被调用会抛 `'[db] initDb() 未调用'`，这是有意的快速失败。
- `better-sqlite3` 是原生模块，必须与 Electron ABI 匹配；`postinstall` 已配置 `electron-builder install-app-deps` 自动重编译，`electron-builder.yml` 的 `asarUnpack` 也必须包含 `node_modules/better-sqlite3`。
- 新增一个数据域时的固定动作：schema → repo → 通道常量 → preload 封装 → 主进程 `registerDbIpc()` 注册 → 渲染层 `types` 声明与 `@/api` 出口。缺一步就会出现「类型能过但运行时 undefined」。
- 例外：离线数据包库（`r18.db`）与插件 / 文件等模块自己的落盘一样，**不走**上面这条 drizzle 流程——它由主进程自己建表、自己管版本，只读查询。
- 日志写入目前只暴露给主进程内部（`appendLog` 未开 IPC）。若将来需要渲染进程写日志，应新增 `db:logAppend` 通道，而不是让渲染进程直连数据库。
