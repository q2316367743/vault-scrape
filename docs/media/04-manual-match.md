# 手动匹配元数据（详情页）

详情页的「手动匹配」：用户自己搜一条影视，选中后**按这条候选重刮一次**，产物与自动刮削完全一致。
本文记录交互口径、数据流、IPC 契约与主进程实现，入口位置见 [影视墙页面](../page/04-media-wall-page.md)，
被复用的流水线见 [刮削模块](../scrape/01-scrape-module.md)。

## 1. 定位与入口

- 入口在影片 / 剧集详情页顶部吸顶工具栏的「更多」下拉里，叫「手动匹配」（`SearchIcon`），
  和「重新读取」「还原刮削前」同一层级（`detail/components/MediaDetailToolbar.vue`，`emit('match')`）。
- 只有详情已经读出来（`loaded`）时才出现，`busy`（读取中 / 还原中）时禁用；`protected` 与普通条目一视同仁。
- 点击后开命令式弹窗 `DialogPlugin`（宽 760px，`destroyOnClose: true`），
  上半是搜索框 + 搜索按钮（回车等价），下半是「元数据 + 封面」候选列表，footer 只有「取消 / 使用所选」。
- 页面侧只有一行接线：`detail/composables/useManualMatch.ts` 的 `open()` 读当前条目开窗，应用成功后 `load()` 重读详情。

## 2. 输入与搜索口径

| 条目 | 输入框语义 | 搜索方式 |
| --- | --- | --- |
| 受保护（`nsfwProtected`，即 NSFW 命中） | 番号（占位符 `输入番号，例如 ABC-123`） | `pluginApi.movie.search(pluginId, 关键词)` |
| 不受保护 | TMDB ID 或关键字（占位符 `输入 TMDB ID 或关键字`） | **纯数字** → `pluginApi.movie.detail(pluginId, 数字)` 直查；否则同上传 `search` |

- 纯数字必须走 `detail`：TMDB 插件的 `search` 只走 `/search/multi`，**不会把纯数字当 ID**，
  所以「输入 tmdbid」由渲染层判定后改调 `detail`（见 [TMDB 插件](../plugin/05-tmdb-plugin.md)）。
- `detail` 返回的 `PluginMovieDetail` **不含封面**，直查命中后再调 `pluginApi.movie.covers()` 补一张，
  按 `COVER_ASSET_KINDS`（poster → thumb → fanart → banner → logo）取第一张非空资源。
- **搜索范围 = 该条目所属资料库配置的刮削器 ∩ 当前可用插件**（`library.scrapers` + `plugin.enabled` + 无 `loadError`），
  与批量任务同一口径；一个都没有时 `blocked` 为真，弹窗**不给出搜索框**，只提示
  「这条影视所属的资料库没有可用的刮削器，请先到「资料库」里为它配置刮削器」。
- 多插件时按插件页顺序依次搜、结果合并去重，键是 `${pluginId}:${candidate.id}`；
  某个插件报错就把 `${插件名}：${错误}` 写进提示并从其他插件继续。
- 搜索阶段**只读**：不落盘、不改插件状态、不产生刮削任务。

## 3. 数据流

```text
MediaDetailToolbar（更多 → 手动匹配）
  → MediaDetailPage.vue：useManualMatch(detail, protect, load).open()
  → modals/MediaMatchDialog.tsx：DialogPlugin（footer：取消 / 使用所选）
  → modals/MediaMatchContent.vue：搜索框 + 候选列表 + 应用（defineExpose submit/saving/canSubmit）
      ├─ composables/useMediaMatchSearch.ts：libraryApi.list() + pluginApi.movie.list() 定可用插件
      │     └─ pluginApi.movie.search / detail / covers → MatchCandidate[]
      └─ scrapeApi.match({ itemId, pluginId, movieId })
  → 主进程 scrapeRunner.matchItemManually → runFileJob / runSeriesJob（与自动刮削同一条流水线）
  → emit('success', ScrapeMatchResult) → 外壳关窗 + 提示 + 页面 load() 重读详情
```

## 4. IPC 契约

| 通道 | 入参 | 返回 |
| --- | --- | --- |
| `scrape:match` | `ScrapeMatchRequest`：`{ itemId, pluginId, movieId }` | `ScrapeResult<ScrapeMatchResult>` |

```ts
// src/common/types/scrape/match.ts
interface ScrapeMatchRequest {
  itemId: string   // media_item.id
  pluginId: string // 产出该候选的影片信息插件 id
  movieId: string  // 候选的 id（插件自己的 id，纯数字或带 movie-/tv- 前缀）
}
interface ScrapeMatchResult {
  itemId: string
  status: ScrapeFileStatus // 'success' | 'failed' | ...
  pluginId: string
  title: string
  message: string
  finalPath: string
}
```

- 三个字段都是字符串，缺任何一个在 IPC 边界就报 `invalidArgument`（`缺少媒体条目 ID / 缺少刮削器 ID / 缺少候选 ID`）。
- **同步等待**：`match` 等流水线跑完才返回（单条刮削，通常秒级），不做进度推送；忙时返回 `busy` 信封
  「已有刮削任务在运行，请先等待或取消」。
- 渲染层只看 `status === 'success'`：成功提示 `已使用「<标题>」的元数据…` 并重读详情；
  否则把 `message` 原样警告出来。

## 5. 主进程：`scrapeManualMatch.ts`

`matchItemManually(request)` 的顺序：

1. **校验**：trim 三个字段 → `getItem(itemId)`（不存在 → `notFound`「索引里没有这个条目」）→ `getLibrary(item.libraryId)`（不存在 → `notFound`）
   → `library.scrapers.includes(pluginId)`（否则 `pluginMissing`「该刮削器不在资料库的刮削器列表里…」）
   → `usablePlugins([pluginId]).list[0]`（否则 `pluginMissing`「该刮削器当前不可用…」）。
2. **取落点**：`resolveTarget(item)` —— 剧集用条目自己（`connectionId` / `path` 就是剧集目录）；
   影片用 `primarySourceOf(item, listSourcesByItem(item.id))` 的主源（`dirPath = dirnameRemotePath(source.path)`）；
   其他类型（`season` / `episode` / `folder`）直接 `invalidArgument`「该条目不支持手动匹配，请在影片或剧集详情页使用」。
3. **抢运行槽位**：`takeRunSlot(\`manual:${item.id}\`)`。手动匹配与批量刮削共用 `scrapeRunSlot`（[刮削模块 §4](../scrape/01-scrape-module.md)），
   谁在跑，另一方就是 `busy`；`finally` 里 `releaseRunSlot()`。
4. **组装上下文**（与批量任务同一套类型）：
   - `policy = { ...libraryPolicy(library, connectionId), localFirst: false }`：**忽略「优先读取本地」**；
   - `settings.download` 的 5 个 `keepXxx` 全置 false：**忽略「保留已有图片」**，新封面能覆盖旧图
     （下载哪些资源仍由 `downloadXxx` 决定，置 false 的 keep 开关不影响下载）；
   - `plugins = [plugin]`、`forced = { pluginId, movieId }`、`client = getFileClient(connectionId)`；
   - 日志走 `createScrapeRunLog('手动匹配 <名字>')`，`taskId` 只是日志与槽位标识。
5. **跑流水线**：`item.type === 'series' ? runSeriesJob(context) : runFileJob(context)`，结果映射成 `ScrapeMatchResult`。

### 5.1 强制候选：`ScrapeJobContext.forced`

`scrapeJobPlan.collectFromPlugins` 的插件循环开头多了一行判定：命中 `context.forced.pluginId` 的那个插件
**直接用 `detail({ movieId: forced.movieId })` 取详情**，跳过 `search` 与候选挑选（`pickCandidate` / `pickSeriesCandidate`），
后续 `covers` / `extras` 补全照旧。影片与剧集共用这个函数，所以剧集的手动匹配天然只换「选中的那一条」。

## 6. 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/common/types/scrape/match.ts` | `ScrapeMatchRequest` / `ScrapeMatchResult`，由 `types/scrape/index.ts` 导出 |
| `src/main/src/modules/scrape/scrapeRunSlot.ts` | 单例运行槽位（`takeRunSlot` / `releaseRunSlot` / `currentRun` / `isRunActive`），批量与手动共用 |
| `src/main/src/modules/scrape/scrapeManualMatch.ts` | `matchItemManually()`：校验 → 取落点 → 抢槽 → 跑流水线 |
| `src/main/src/modules/scrape/scrapeJobPlan.ts` | `collectFromPlugins` 的 `forced` 分支（跳过 search 与挑选） |
| `src/main/src/modules/scrape/scrapeJobTypes.ts` | `ScrapeForcedMatch` 与 `ScrapeJobContext.forced` |
| `src/main/src/modules/scrape/scrapeIpc.ts` | `scrape:match` 通道 + `readMatchRequest()` 入参收窄 |
| `src/preload/src/modules/scrape/scrape.ts` | `scrapeApi.match(request)`（`scrapeChannels.ts` 的 `match: 'scrape:match'`） |
| `.../pages/media/detail/composables/useMediaMatchSearch.ts` | 可用插件、输入语义、搜索与候选去重 |
| `.../pages/media/detail/composables/useManualMatch.ts` | 页面侧入口胶水（读条目 → 开窗 → 应用后重读） |
| `.../pages/media/detail/modals/MediaMatchDialog.tsx` | 弹窗外壳（`DialogPlugin` + footer 取消 / 使用所选） |
| `.../pages/media/detail/modals/MediaMatchContent.vue` | 弹窗内容（搜索 + 列表 + `submit` / `saving` / `canSubmit`） |
| `.../pages/media/detail/modals/MediaMatchCandidateRow.vue` | 单条候选行（封面 + 标签 + 选择按钮） |

## 7. 注意事项

- **不落任务表**：手动匹配是单条即时执行，不写 `task` / `scrape_file`，也不广播 `scrape:progress`，
  所以概览页的刮削记录里看不到它；需要看过程就开「文件行为 → 保存日志到文件」，日志名是 `手动匹配 <名字>-<时间戳>.log`。
- **互斥而非排队**：与批量任务共用运行槽位，抢不到直接 `busy`（不会排队等待）。
- **不做事务回滚**：走到流水线之后就与自动刮削一样逐步落盘（下载图片 → 写 NFO → 改名 / 移动 → 回写库），
  中途失败已落盘的部分保持现状；失败原因由 `ScrapeResult.message` 与文件日志给出。
- **`movieId` 是插件自己的 id**：TMDB 的候选 id 带 `movie-` / `tv-` 前缀，而 `detail` 返回的 `id` 是纯数字；
  弹窗把候选原始的 `candidate.id` 原样回传，不要在前端做去前缀处理。
- **元数据回写**：流水线第 7 步会写 `providerIds: { [pluginId]: detail.id }`、`scraperId`、`scrapedAt`，
  因此手动匹配后该条目即视为已刮削（不再出现在待刮削候选里）。
- **剧集**：整部剧一次处理，产物是 `tvshow.nfo` + `season.nfo` + 每集 NFO 与图片（见 [剧集支持](./02-series-support.md)）；
  手动匹配只换「选中的这一条剧」，改名口径与自动刮削一致。
