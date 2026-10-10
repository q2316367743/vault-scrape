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
| `src/main/src/db/schema/mediaItem.ts` | `media_item` 表定义（Jellyfin 的 BaseItem：`movie` / `folder`） |
| `src/main/src/db/schema/mediaSource.ts` | `media_source` 表定义（一个条目下的媒体文件） |
| `src/main/src/db/schema/mediaImage.ts` | `media_image` 表定义（primary / backdrop / thumb / …） |
| `src/main/src/db/schema/index.ts` | schema 汇总导出（drizzle 配置的入口） |
| `src/main/src/db/client.ts` | 单例连接、`initDb()`、`db()` |
| `src/main/src/db/repo/logRepo.ts` | 日志仓储 |
| `src/main/src/db/repo/taskRepo.ts` | 任务仓储与统计 |
| `src/main/src/db/repo/scrapeRepo.ts` | 刮削任务下的逐文件结果仓储（含跨任务按路径 / 状态取记录的 `listScrapeWithConnection`，影视墙已不再用它） |
| `src/main/src/db/repo/libraryRepo.ts` | 资料库与媒体目录仓储（`isSameOrInsidePath` / `findLibraryByPath`；旧的精确归属函数 `findPathOwner` 已随目录重叠规则删除） |
| `src/main/src/db/repo/mediaRepo.ts` | 媒体条目 + 媒体源仓储（`upsertSource` / `updateItemMetadata` / `updateSourcePath` / `cleanupUnseen` 用到的删除函数） |
| `src/main/src/db/repo/mediaImageRepo.ts` | 媒体图片仓储（`upsertImage` / `replaceItemImages` / 按连接、按库批量删除） |
| `src/main/src/db/dbIpc.ts` | 数据库域 IPC 注册 |
| `src/preload/src/modules/db/dbChannels.ts` | 通道常量与载荷类型（契约） |
| `src/preload/src/modules/db/db.ts` | 渲染层可用的 `dbApi` |
| `src/renderer/src/api/db.ts` | 渲染层统一出口 |
| `drizzle.config.ts` | drizzle-kit 配置（schema 入口与迁移输出目录） |
| `resources/drizzle/` | 迁移 SQL 与 meta（由 drizzle-kit generate 生成）：现为 `0000_heavy_hardball.sql` + `0001_smooth_micromacro.sql`，配 `meta/{0000,0001}_snapshot.json` 与 `meta/_journal.json` |

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

媒体层的五张表（`library` 14 列 / `library_path` 5 列 / `media_item` 26 列 / `media_source` 12 列 / `media_image` 9 列）不在本文重复，逐列说明见 [资料库](../media/01-media-library.md) 的「数据结构」一节。要点：

- `library` 表的 `type` 列（`$type<LibraryType>()`，默认 `'movie'`）由迁移 `0001_smooth_micromacro.sql` 加上：类型决定扫描按 `setting.library.extensions` 里的哪份后缀清单识别媒体文件，建库后不可修改。
- 表之间**没有外键**：`library_id` / `item_id` / `parent_id` 都是普通 text 列，级联清理由仓储函数显式完成（`deleteItemsWithoutSource` → `deleteImagesByIds` → `deleteSourcesNotInScan`；删库走 `purgeLibraryMedia`；删连接走 `deleteLibrariesByConnection`）。
- 唯一索引是去重与 upsert 的落点：`library_path (connection_id, path)`（一条目录只能属于一个库，嵌套与重叠由 `libraryStore.normalizePaths()` 在保存时先用 `isRemotePathInside` 拦下）、`media_source (connection_id, path)`（重扫 `upsertSource` 的冲突目标，**id 不变**）、`media_image (connection_id, path)`。
- 刮削元数据写在 `media_item` 上（`title` / `num` / `overview` / 评分 / JSON 列 `genres` / `studios` / `tags` / `provider_ids` / `scraped_at` / `scraper_id`），所以重扫只更新 `media_source`，元数据与图片不会丢。
- `media_item.has_nfo`（迁移 `0002_damp_mandarin.sql` 加列）反过来是**扫描拥有**的列：扫描时同目录有 `movie.nfo` 或与视频同名的 `.nfo` 就置 1。它和 `scraped_at`（跑过刮削）、图片（条目自己或父目录条目有 `media_image` 行）一起构成「是否刮削」的判定，见 [资料库](../media/01-media-library.md)。

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

资料库与媒体层仓储（`src/main/src/db/repo/libraryRepo.ts` / `mediaRepo.ts` / `mediaImageRepo.ts`，全部只在主进程内部使用，没有 IPC 通道）：

- 资料库：`listLibraries()`、`listLibrariesByConnection(connectionId)`、`getLibrary(id)`、`listLibraryPaths(libraryId)`、`insertLibrary(input)`、`updateLibrary(id, input)`、`replaceLibraryPaths(libraryId, drafts)`（整组替换多根目录）、`patchLibrary(id, patch)`、`deleteLibrary(id)`、`deleteLibrariesByConnection(connectionId)`；路径判定 `isSameOrInsidePath(root, target)`、`findLibraryByPath(connectionId, dirPath)`（**没有 `findPathOwner` 了**——目录归属已由 `libraryStore.normalizePaths()` 的「不许重复 / 不许嵌套」规则在保存时保证，判定用 `src/common/types/file/path.ts` 的 `isRemotePathInside(dir, path)`）。
- 媒体条目：`getItem(id)`、`listItems(libraryId)`、`listMovieItems(libraryId?)`、`listChildItems(libraryId, parentId)`、`findItemByPath(connectionId, path)`、`insertItem(input)`、`updateItem(id, patch)`（**只更新扫描拥有的列**，元数据列原样保留）、`updateItemMetadata(itemId, meta)`（整组覆盖刮削元数据，`name` 与 `sort_name` 同取标题）、`deleteItem(id)`、`deleteItemsWithoutSource(libraryId, scanId): string[]`（只删 `type='movie'` 的孤儿条目，返回 id 列表）、`countMovieItems(libraryId)`、`countScrapedMovieItems(libraryId)`、`listPendingMovieItems(libraryId)`、`deleteItemsByLibrary(libraryId)`、`deleteItemsByConnection(connectionId)`。
- 媒体源：`getSource(id)`、`listSourcesByItem(itemId)`、`listSourcesByLibrary(libraryId)`、`findSourceByPath(connectionId, path)`、`insertSource(input, scanId)`、`upsertSource(input, scanId)`（冲突目标 `(connection_id, path)`，冲突时刷新扫描拥有的列、**id 不变**）、`updateSource(id, patch)`、`updateSourcePath(id, file)`（就地更新路径 / 名字 / 扩展名 / MIME / 大小 / 时间）、`deleteSourcesNotInScan(libraryId, scanId): number`、`maxSourceIndexedAt(): number`、`deleteSourcesByLibrary` / `deleteSourcesByConnection`。
- 媒体图片：`getImage(id)`、`listImagesByItem(itemId)`、`listImagesByLibrary(libraryId)`、`findImageByPath(connectionId, path)`、`insertImage(input)`、`upsertImage(input)`、`replaceItemImages(itemId, images)`（刮削成功后整组替换）、`deleteImage(id)`、`deleteImagesByItem(s)` / `deleteImagesByIds(ids)` / `deleteImagesByLibrary` / `deleteImagesByConnection`。

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

媒体条目 / 媒体源 / 图片与逐文件刮削结果在 `db` 域之外**只有影视墙与资料库会读**：`db` 域不为它们开 IPC 通道，影视墙走 `media` 域通道 `media:wall` / `media:detail`，工作台逐级浏览走 `scrape:browse`（见 [影视墙页面](../page/04-media-wall-page.md)、[工作台页面](../page/03-workspace-page.md)）；条目封面与播放地址都是 `storage://` URL。其余场景（`storage://` 协议处理、扫描后的清理、删除存储时的级联）都由主进程自己使用这些仓储。

## 迁移

- 迁移文件由 `yarn db:generate`（即 `drizzle-kit generate`）生成到 `resources/drizzle/`，不手写 SQL。drizzle 的 `run()` 只支持单语句 DDL，手写多语句迁移会直接抛错；删表也走 generate 产出 `DROP`。
- 启动时 `initDb()` 调用 `migrate(db, { migrationsFolder })`，目录在开发态为 `join(__dirname, '../../resources/drizzle')`；打包时通过 `electron-builder.yml` 的 `asarUnpack` 释放到磁盘后仍可按该相对路径解析。
- 迁移是追加式的：改表结构后重新 generate，产生新的 `000X_*.sql`，不要修改历史迁移。
- **媒体层重建这一轮重新生了迁移**：旧的 4 个迁移（`0000_typical_paibok.sql` ~ `0003_tiresome_gressill.sql`）与 `meta/` 全部删除，现在的迁移一共三份：
  - `resources/drizzle/0000_heavy_hardball.sql`——媒体层重建后的基线（**8 张表、0 外键**）；
  - `resources/drizzle/0001_smooth_micromacro.sql`——全文一行 `ALTER TABLE \`library\` ADD \`type\` text DEFAULT 'movie' NOT NULL;`（资料库类型）；
  - `resources/drizzle/0002_damp_mandarin.sql`——全文一行 `ALTER TABLE \`media_item\` ADD \`has_nfo\` integer DEFAULT 0 NOT NULL;`（扫描侧的 NFO 证据列）。
  `meta/_journal.json` 里有 idx 0（tag `0000_heavy_hardball`）、idx 1（tag `0001_smooth_micromacro`）与 idx 2（tag `0002_damp_mandarin`）三条，快照为 `meta/0000_snapshot.json` + `meta/0001_snapshot.json` + `meta/0002_snapshot.json`；`0000` 本身未被改动。**历史迁移（含 0000）永远不要改**，之后改表结构继续 generate 出新的 `000X_*.sql`。
- **旧库不做兼容、不迁移数据**：drizzle 的记账表里记着旧 tag / hash，与新迁移对不上时启动会报 `table ... already exists`；因此本机旧库 `~/.vault-scrape/db/vault-scrape.db` 已改名归档为 `vault-scrape.db.old-20261010`，新库首次启动时按新迁移从零建表。旧库里的刮削记录 / 任务历史一律不带过来。
- **资料库配置这一轮进了 sqlite**（`library` / `library_path`）：`~/.vault-scrape/media/libraries.json` 已废弃、不再读写，删除存储时的库级联也变成数据库操作（`deleteLibrariesByConnection`）。
- 例外不变：离线插件自管的 `r18.db` 不参与 `migrate()`，不受这次重建影响。

## 注意事项

- `db()` 在 `initDb()` 之前被调用会抛 `'[db] initDb() 未调用'`，这是有意的快速失败。
- `better-sqlite3` 是原生模块，必须与 Electron ABI 匹配；`postinstall` 已配置 `electron-builder install-app-deps` 自动重编译，`electron-builder.yml` 的 `asarUnpack` 也必须包含 `node_modules/better-sqlite3`。
- 新增一个数据域时的固定动作：schema → repo → 通道常量 → preload 封装 → 主进程 `registerDbIpc()` 注册 → 渲染层 `types` 声明与 `@/api` 出口。缺一步就会出现「类型能过但运行时 undefined」。
- 例外：离线数据包库（`r18.db`）与插件 / 文件等模块自己的落盘一样，**不走**上面这条 drizzle 流程——它由主进程自己建表、自己管版本，只读查询。
- 日志写入目前只暴露给主进程内部（`appendLog` 未开 IPC）。若将来需要渲染进程写日志，应新增 `db:logAppend` 通道，而不是让渲染进程直连数据库。
