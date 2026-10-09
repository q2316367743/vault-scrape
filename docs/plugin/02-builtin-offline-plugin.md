# 内置插件：R18 离线数据包

## 1. 为什么做内置插件

在线插件依赖目标站点可用、账号有效、页面结构不变，任何一环失效刮削就归零。r18.dev 每月（实际按周滚动）发布一份**全量 PostgreSQL 转储**（`r18dotdev_dump_YYYY-MM-DD.sql.gz`），包含番号、标题、演员、类别、厂牌、导演、发行日期与 DMM 图片相对路径。把它落到本机后即可**离线**完成刮削，作为在线刮削的保底方案。

内置插件 id 为 `r18-offline`（`src/main/src/modules/plugin/builtinPlugins.ts`），与用户导入的 JS 插件走同一套列表 / 启停 / 调用入口（在工具箱的搜索工具里被选中执行），但**没有源码文件**：不可编辑、不可删除、不可被同名导入覆盖（`unsupported`）。

代价与边界：

- 数据包**不含封面图与预告片文件**，只含 DMM 的图片相对路径；封面 / 花絮仍会在刮削时联网从 `pics.dmm.co.jp` 与 `cc3001.dmm.co.jp` 取；
- 每个数据包解压后约 1.8 GB，导入后库文件同量级，需要一次性磁盘与时间成本；
- 上游给的 `machine_translation`（约 123 MB）本期不导入（无用途），`/histrion` 系列（`derived_actor` / `derived_video_actor` / `source_dmm_histrion` / `source_dmm_video_histrion`）也不导入。

## 2. 数据源与格式

- 入口 `https://r18.dev/dumps`，`/dumps/latest` 会 302 到具体文件 `r18dotdev_dump_<日期>.sql.gz`；日期从文件名解析（`/r18dotdev_dump_(\d{4}-\d{2}-\d{2})\.sql(?:\.gz)?/`），比下载完再算更可靠。
- 文件是**纯文本 pg_dump**，结构为若干段：

  ```
  COPY public.derived_video (content_id, dvd_id, title_en, ...) FROM stdin;
  100tv00031	100TV-031	\N	...	digital
  \.
  ```

  字段以 `\t` 分隔，行以 `\n` 结束，行内转义为 `\N`（NULL）、`\b\f\n\r\t\v`、`\xHH`、八进制；段以单独一行 `\.` 结束。
- **必须自写解析器**（`pgCopyImporter.ts`）：SQLite 的 `.import` / `sqlite3` CLI 不认 `\N` 与上述转义，直接把字面量写进库会得到 `\N` 字符串；而且 `.import` 无法流式报告进度、无法按表白名单跳过。
- 建表**不写死列**：按 `COPY … (列列表)` 头部动态生成列，全部 `TEXT` 亲和（避免 `100TV-031` 这类番号被转成数字），上游增列 / 换序不会导致导入失败。

### 2.1 导入表白名单（14 张）

| 表 | 主键 | 用途 |
| --- | --- | --- |
| `derived_video` | `(content_id, site_id, service_code)` | 主表：番号、标题、简介、时长、发行日期、DMM 图片路径 |
| `derived_actress` | `id` | 演员（罗马字 / 汉字 / 假名） |
| `derived_category` | `id` | 类别 |
| `derived_maker` | `id` | 厂牌商 |
| `derived_label` | `id` | 系列厂牌 |
| `derived_series` | `id` | 系列 |
| `derived_site` | `id` | 站点（`site_id`） |
| `derived_director` | `id` | 导演 |
| `derived_author` | `id` | 原作 |
| `derived_video_actress` | `(content_id, actress_id)` | 影片 ↔ 演员，含 `ordinality` 排序 |
| `derived_video_category` | `(content_id, category_id)` | 影片 ↔ 类别 |
| `derived_video_director` | `(content_id, director_id)` | 影片 ↔ 导演 |
| `derived_video_author` | `(content_id, author_id)` | 影片 ↔ 原作 |
| `source_dmm_trailer` | `(content_id, url)` | 预告片直链 |

另外自建一张 `offline_meta`（`schema_version` / `pack_date` / `source_url` / `imported_at` / `video_count` / `row_count` / `table_counts`）记录导入元信息。

`derived_video` 额外加一个**生成列** `dvd_id_norm = upper(replace(dvd_id, char(45), ''))` 并建索引：番号查询走这个索引而不是全表扫描；依赖列缺失时自动跳过该生成列与索引。

## 3. 存储布局（与系统库隔离）

全部落在系统库同级的 `~/.vault-scrape/db/` 下：

| 路径 | 说明 |
| --- | --- |
| `r18.db` | 离线库（只读打开，独立句柄，**绝不 ATTACH 系统库**） |
| `r18.db.import` | 导入中的临时库，导入 + 校验通过后才改名上位 |
| `r18.db.old` | 替换过程中的旧库，替换成功后删除 |
| `r18-dump.sql.gz` | 在线下载的原始转储（导入成功后删除；本地导入的源文件永不删） |
| `r18-state.json` | 状态：`lastCheckAt` / `latestPackDate` / `packDate` / `importedAt` / `dbBytes` / `corrupt`（原子写：`.tmp` + rename） |

隔离原则：离线库损坏 / 被删只影响离线刮削结果，`vault-scrape.db` 与设置不受影响；反过来说离线库也不参与 drizzle 迁移，schema 版本由 `offline_meta.schema_version` 自管（当前 `1`）。

## 4. 导入流水线

`src/main/src/modules/offline/offlineImporter.ts` 用「单任务 + 全局互斥」模型：已有任务进行时再启动直接返回 `offlineBusy`。

| 阶段 | 动作 |
| --- | --- |
| `checking` | 解析最新数据包地址与日期 |
| `precheck` | 磁盘余量 ≥ 2.6 GB（在线下载时）；本地导入额外校验文件 ≥ 50 MB |
| `downloading` | `httpClient` 流式下载到 `r18-dump.sql.gz`，按 `Content-Length` 报百分比，60 s 无数据视为超时，可取消 |
| `importing` | 建 `r18.db.import`，`PRAGMA journal_mode=OFF / synchronous=OFF / locking_mode=EXCLUSIVE / temp_store=MEMORY / cache_size=-131072 / foreign_keys=OFF`，流式解析并按 2 万行一批事务提交；进度按阶段节流 200 ms 推送 |
| `verifying` | `PRAGMA integrity_check` 必须全 `ok`，且 `derived_video` 行数 ≥ 1,000,000 |
| `swapping` | 关闭只读句柄 → `r18.db` 改名 `.old`、`r18.db.import` 改名 `r18.db` → 删除 `.old` |
| `done` | 写入 `r18-state.json`，删除下载的转储（本地导入不动源文件），广播完成事件 |
| `failed` | 丢弃临时库与转储，保留旧数据包，写 `error` 日志 |

- 解析器按原始文件字节报进度（解压比）并在每 2 万行让出事件循环，避免长同步阻塞主进程；
- 取消：`AbortController` 中断下载 / 解析循环，已写入的临时库整个丢弃；
- 只有 `verifying` 通过才会替换现有库——**先验证再上位**，因此不会出现「导入到一半把可用数据包弄坏」的情况。

## 5. 查询层

`src/main/src/modules/offline/offlineRepo.ts` 只读打开 `r18.db`（`readonly: true, fileMustExist: true`）：

- `offlineSearch(keyword, limit = 50)`：先把关键字按「番号」归一化（大写、去掉空白与 `-`/`_`），分三档查 `derived_video`：`dvd_id_norm = ?`（精确）、`content_id = ?` / `dvd_id_norm LIKE ?||'%'`（前缀区间扫描，命中索引）、其余 `title_ja/title_en LIKE ? ESCAPE '\'`（兜底）；候选合并去重后按 rank（0 精确 / 1 content_id / 2 前缀 / 3 标题）+ 数据完整度排序，写进结果时顺带 join `derived_video_actress` 取最多 10 个演员名填到 `PluginMovieCandidate.actors`（供列表展示，详情仍取全量）；
- `offlineDetail(movieId)`：按 content_id 找最佳行，再 join 演员（按 `CAST(ordinality AS INTEGER)` 排序）、类别、导演、maker / label / series / site 字典；
- `offlineCovers(movieId)` / `offlineExtras(movieId)`：见下节图片规则；
- 未安装数据包时 `search` 返回空数组（保底语义：没装就当没有结果），`detail` / `covers` / `extras` 抛 `offlineMissing`，界面给「请先导入离线数据包」的可读提示；
- 异常映射：`not a database` / `malformed` / `SQLITE_CORRUPT` / `no such table` / `no such column` / `schema_version` 不符 → `offlineCorrupt`（「离线数据包已损坏，请重新导入」），`SQLITE_BUSY` → `invokeFailed`（「离线数据包正忙，请稍后重试」）。

### 5.1 图片与预告片规则

上游只给 DMM 的相对路径（如 `digital/video/100tv00031/100tv00031pl`、`.../100tv00031jp-1` … `-5`）：

- 图片地址 = `https://pics.dmm.co.jp/<相对路径>.jpg`，且必须带 `Referer: https://www.dmm.co.jp/` 才能取到（防盗链）；
- `jacket_full_url` → `poster`，`jacket_thumb_url` → `thumb`；
- `gallery_full_first` / `gallery_full_last` 解析公共前缀 + 尾号区间推中间所有图（当前样本为 `-1` … `-5`），第一张作 `fanart`，其余（上限 30 张）作 `still`；
- `source_dmm_trailer.url` → `trailer`（形如 `https://cc3001.dmm.co.jp/litevideo/freepv/h/hmn/hmn00283/hmn00283_mhb_w.mp4`）。

## 6. 内置插件与插件系统

- `builtinPlugins.ts` 导出 `BUILTIN_PLUGINS`（当前仅 `r18-offline`，`meta.name = 'R18 离线数据包'`，`env: []`）与 `findBuiltinPlugin(id)`；`invoke` 把四个方法直接映射到查询层：`search → offlineSearch`、`detail → offlineDetail`、`covers → offlineCovers`、`extras → offlineExtras`。
- `plugins.json` 的记录多了 `builtin: boolean`；主进程启动 / 列表 / 调用前会调幂等的 `ensureBuiltinPlugins()` 把内置插件补进索引（保留用户设置的 `enabled` 与环境变量值，元信息没变就不写盘）。同 ID 冲突时内置插件接管并写 `warn` 日志。
- `PluginSummary.source` 为 `'builtin' | 'file'`：内置插件的 `filePath` 是空串，界面隐藏「编辑代码」「删除」，并显示「内置」标签与「内置实现（无源码文件）」。
- 内置插件 `env` 为空数组，`hasEnv` 恒为 `false`：详情页不渲染配置区块（`PluginDetail.vue` 上按 `v-if="plugin.hasEnv"` 门控），「R18 离线数据包」这类无需参数的内置插件不会出现空的环境变量区域。
- 调用路径：`invokePlugin` 校验存在 → 已启用 → 参数非空，命中内置即 `invokeWithTimeout(() => builtin.invoke(...), {…})`（与 JS 插件共用超时与日志），**不做 env 校验、不编译**；JS 插件路径保持不变。
- `readPluginCode` / `savePluginCode` / 导入覆盖 / 删除对内置插件分别抛 `notFound` / `unsupported`，`removePlugin` 与 `writePluginSource` 在 store 层再兜一层。

## 7. 检查更新

`src/main/src/modules/offline/offlineCheck.ts`：

- 只发一个 `HEAD`（`maxRedirects: 0`，超时 15 s，UA `vault-scrape-offline/1.0`），从 `Location` 头解析最新数据包日期；跟随重定向的客户端抛错时从 `error.response.headers.location` 兜底；
- **自动检查**：启动时 `runOfflineStartupCheck()`（`src/main/index.ts` 在 `createWindow()` 之后 `void` 调用）。距上次成功检查不足 7 天直接返回；发现更新广播 `offline:updateAvailable`；**只提示，绝不自动下载**；
- **主动检查**：插件页「检查更新」按钮走 `offline:check`，立即联网并把结果写回状态；
- 只有成功才写 `lastCheckAt`，失败保留旧值（下一次启动会重试），日志 scope 为 `offline`。

## 8. IPC 通道

通道常量在 `src/preload/src/modules/offline/offlineChannels.ts`，主进程 handler 在 `offlineIpc.ts`，全部返回 `PluginResult` 信封，**绝不跨 IPC 抛异常**。

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `offline:status` | — | `OfflinePackStatus`（是否安装 / 数据包日期 / 导入时间 / 影片数 / 库大小 / 库路径 / 上次检查 / 最新日期 / 是否有更新 / 是否损坏） |
| `offline:check` | — | `OfflineCheckResult` |
| `offline:update` | — | `{ jobId }`（启动在线下载 + 导入任务） |
| `offline:importLocal` | — | `{ jobId, canceled }`（主进程弹系统文件选择框，`sql` / `gz`） |
| `offline:cancel` | — | `{ canceled }` |
| `offline:remove` | — | `{ removed }` |
| `offline:progress`（推送） | `OfflineProgress` | `{ jobId, phase, percent, message, rows, table }` |
| `offline:done`（推送） | `OfflineDone` | `{ jobId, ok, message }` |
| `offline:updateAvailable`（推送） | `OfflineUpdateNotice` | `{ latestPackDate, packDate }` |

渲染层统一用 `@/api/offline` 的 `offlineApi`：`status / check / update / importLocal / cancel / remove` 加三个 `onXxx(listener)` 订阅（返回取消订阅函数）。

## 9. 界面

- 插件页 `PluginDetail.vue`：选中内置插件时在详情里挂 `components/OfflinePackPanel.vue`（内置插件没有配置区块，面板直接接在概览下方）——四个按钮（检查更新 / 下载并导入 / 本地导入 / 删除）、阶段进度与取消、数据包日期 / 导入时间 / 上次检查 / 影片数量 / 库大小 / 库路径、上游发布节奏与磁盘占用提示；下载与删除走 `DialogPlugin.confirm`。
- 应用外壳 `App.vue`：`composables/useOfflineUpdateNotice.ts` 先订阅 `offline:updateAvailable`，再在挂载时读一次状态，**每次启动最多提示一次**「离线数据包有新版本 X（当前 Y），可在插件页更新」。
- 状态集中在 `pages/plugin/composables/useOfflineData.ts`（模块级单例），跨组件共享同一个任务状态与进度。

## 10. 新增错误码

| 错误码 | 文案 | 触发 |
| --- | --- | --- |
| `offlineMissing` | 尚未安装离线数据包 | 未导入时查详情 / 封面 / 花絮 |
| `offlineBusy` | 已有离线数据包任务在进行中 | 并发启动任务 |
| `offlineCorrupt` | 离线数据包已损坏，请重新导入 | 库损坏、schema 版本不符 |
| `offlineCheckFailed` | 检查离线数据包更新失败 | 检查更新失败（不改变已安装状态） |

## 11. 关键文件

| 位置 | 职责 |
| --- | --- |
| `src/common/types/offline/` | 三端共享类型：状态、阶段与进度、状态归一化与常量（`OFFLINE_AUTO_CHECK_INTERVAL_MS`、`OFFLINE_MIN_VIDEO_ROWS`、`OFFLINE_DUMPS_LATEST_URL`、文件名正则） |
| `src/main/src/modules/offline/offlineSchema.ts` | 表白名单、主键 / 索引 / 生成列、建表与插入 SQL 生成 |
| `src/main/src/modules/offline/pgCopyImporter.ts` | pg_dump `COPY` 文本流解析（gunzip、转义解码、批量回调、进度） |
| `src/main/src/modules/offline/offlineFileStore.ts` | 路径、状态文件、磁盘余量、临时文件清理、换库 |
| `src/main/src/modules/offline/offlineImporter.ts` | 任务编排：下载 / 导入 / 校验 / 换库 / 取消 |
| `src/main/src/modules/offline/offlineCheck.ts` | 检查更新与启动自动检查 |
| `src/main/src/modules/offline/offlineRepo.ts` | 只读查询：search / detail / covers / extras |
| `src/main/src/modules/offline/offlineMapper.ts` | 行 → 候选 / 详情映射、番号归一化、DMM 图片与预告片地址 |
| `src/main/src/modules/offline/offlineEvents.ts` | 进度 / 完成 / 有更新三条推送 |
| `src/main/src/modules/offline/offlineIpc.ts` | IPC 注册（含系统文件选择框） |
| `src/main/src/modules/plugin/builtinPlugins.ts` | 内置插件定义（`r18-offline`），四个方法映射到查询层 |
| `src/renderer/src/windows/main/pages/plugin/components/OfflinePackPanel.vue` | 数据包面板 |
| `src/renderer/src/windows/main/pages/plugin/composables/useOfflineData.ts` | 数据包状态与操作的单例 |
| `src/renderer/src/windows/main/composables/useOfflineUpdateNotice.ts` | 启动时的更新提示 |

## 12. 本期不做（后续项）

- 增量更新（只有全量包）与后台定时下载：自动检查只提示，下载始终由用户触发；
- 数据包内的封面 / 预告片本地缓存（仍需联网取 DMM 资源）；
- `machine_translation` 的标题翻译接入、演员头像下载；
- 多数据包并存 / 版本回滚（当前只保留一份可用库）；
- 导入断点续传（下载中断即从头开始）。
