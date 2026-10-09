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
| `src/main/src/db/schema/resource.ts` | `resource` 表定义（资源索引） |
| `src/main/src/db/schema/index.ts` | schema 汇总导出（drizzle 配置的入口） |
| `src/main/src/db/client.ts` | 单例连接、`initDb()`、`db()` |
| `src/main/src/db/repo/logRepo.ts` | 日志仓储 |
| `src/main/src/db/repo/taskRepo.ts` | 任务仓储与统计 |
| `src/main/src/db/repo/scrapeRepo.ts` | 刮削任务下的逐文件结果仓储（含 `findScrapeFileByCoverId` 与跨任务按路径 / 状态取记录的 `listScrapeWithConnection`） |
| `src/main/src/db/repo/resourceRepo.ts` | 资源索引仓储（含影视墙用的 `listResourceByKind` / `maxResourceIndexedAt`） |
| `src/main/src/db/dbIpc.ts` | 数据库域 IPC 注册 |
| `src/preload/src/modules/db/dbChannels.ts` | 通道常量与载荷类型（契约） |
| `src/preload/src/modules/db/db.ts` | 渲染层可用的 `dbApi` |
| `src/renderer/src/api/db.ts` | 渲染层统一出口 |
| `drizzle.config.ts` | drizzle-kit 配置（schema 入口与迁移输出目录） |
| `resources/drizzle/` | 迁移 SQL 与 meta（由 drizzle-kit generate 生成） |

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
| `id` | text PK | `${taskId}:${path}` |
| `task_id` | text | 所属任务 |
| `path` / `name` | text | 文件远端路径与文件名 |
| `final_path` | text | 流水线算出的最终路径（成功重命名 / 移动之后）；未改名时与 `path` 相同，旧数据为空串时按 `path` 处理 |
| `keyword` | text | 搜索关键词（由文件名解析） |
| `status` | text | `pending` / `running` / `success` / `failed` / `skipped` |
| `plugin_id` / `title` | text | 命中的插件与条目标题 |
| `message` | text | 结果说明或失败原因 |
| `cover_id` / `cover_path` | text | 刮削产出的封面资源 id 与远端路径，空串表示没有封面 |
| `updated_at` | integer | 毫秒时间戳 |

索引：`idx_scrape_file_task`（taskId）、`idx_scrape_file_status`（taskId, status）。

`resource` 表（`resourceTable('resource')`）：媒体库资源索引，一次扫描（或任务收尾重建）按目录整体替换。

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | `sha1(connectionId + '\n' + path)` 的 16 位十六进制前缀 |
| `connection_id` | text | 所属数据源 |
| `dir_path` | text | 建立索引时扫描的目录 |
| `path` / `name` | text | 文件远端路径与文件名 |
| `extname` / `mime` | text | 扩展名（小写不含点）与 MIME |
| `size` / `modified_at` | integer | 字节数与修改时间（毫秒） |
| `kind` | text | `video` / `image` / `nfo` / `other` |
| `indexed_at` | integer | 建立索引的时间（毫秒） |

索引：`idx_resource_dir`（connectionId, dirPath）、唯一索引 `idx_resource_conn_path`（connectionId, path）。

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
- `replaceResourceDir(connectionId, dirPath, items): number`：在一个事务里先按 `(connectionId, dirPath)` 删除、再按 `path` 删除，最后批量插入，返回写入条数。重复扫描同一目录是幂等的（不会翻倍）。
- `getResourceById(id): ResourceItem | null`、`listResourceByDir(connectionId, dirPath): ResourceItem[]`（按 name 升序）、`countResource(): number`、`deleteResourceByConnection(connectionId): number`。
- `listResourceByKind(kind): ResourceItem[]`：按连接与路径升序取某一类资源（影视墙用它拉全部视频）；`maxResourceIndexedAt(): number`：索引里最新的 `indexed_at`，没有任何资源时为 0。
- `listScrapeWithConnection(status?): { item: ScrapeFileItem; connectionId: string }[]`：`scrape_file ⨝ task` 取回所属存储（`scrape_file` 本身没有 `connection_id`），可选按状态过滤，按 `updatedAt` 倒序。影视墙用它把磁盘视频配对到刮削记录。

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

资源索引与逐文件刮削结果在 `db` 域之外**只有影视墙会读**：`db` 域不为它们开 IPC 通道，影视墙走独立的 `media` 域通道 `media:wall` / `media:detail`（见 [../page/04-media-wall-page.md](../page/04-media-wall-page.md)）；封面地址仍是 `storage://` URL（见 [../resource/01-resource-index.md](../resource/01-resource-index.md)）。其余场景（`storage://` 协议处理、任务终态重建、删除数据源时清理）都由主进程自己使用这两个仓储。

## 迁移

- 迁移文件由 `yarn db:generate`（即 `drizzle-kit generate`）生成到 `resources/drizzle/`，不手写 SQL。drizzle 的 `run()` 只支持单语句 DDL，手写多语句迁移会直接抛错；删表也走 generate 产出 `DROP`。
- 启动时 `initDb()` 调用 `migrate(db, { migrationsFolder })`，目录在开发态为 `join(__dirname, '../../resources/drizzle')`；打包时通过 `electron-builder.yml` 的 `asarUnpack` 释放到磁盘后仍可按该相对路径解析。
- 迁移是追加式的：改表结构后重新 generate，产生新的 `000X_*.sql`，不要修改历史迁移。

## 注意事项

- `db()` 在 `initDb()` 之前被调用会抛 `'[db] initDb() 未调用'`，这是有意的快速失败。
- `better-sqlite3` 是原生模块，必须与 Electron ABI 匹配；`postinstall` 已配置 `electron-builder install-app-deps` 自动重编译，`electron-builder.yml` 的 `asarUnpack` 也必须包含 `node_modules/better-sqlite3`。
- 新增一个数据域时的固定动作：schema → repo → 通道常量 → preload 封装 → 主进程 `registerDbIpc()` 注册 → 渲染层 `types` 声明与 `@/api` 出口。缺一步就会出现「类型能过但运行时 undefined」。
- 例外：离线数据包库（`r18.db`）与插件 / 文件等模块自己的落盘一样，**不走**上面这条 drizzle 流程——它由主进程自己建表、自己管版本，只读查询。
- 日志写入目前只暴露给主进程内部（`appendLog` 未开 IPC）。若将来需要渲染进程写日志，应新增 `db:logAppend` 通道，而不是让渲染进程直连数据库。
