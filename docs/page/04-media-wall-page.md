# 影视墙页面

## 1. 定位与入口

影视墙是刮削成果的**浏览与播放入口**，这一轮按 Jellyfin 的「库 → 条目 → 详情」形态拆成了**首页（资料库横排 + 两排影片）**与**内容页（单库 / 全部影片）**两级，再加原有的**影片详情页**：

| 路由 | 名称 | 页面 | 说明 |
| --- | --- | --- | --- |
| `/media` | 影视墙 | `src/renderer/src/windows/main/pages/media/home/MediaHomePage.vue` | 首页：资料库横排 + 最近添加 / 推荐两排 |
| `/media/library` | 影视墙资料库 | `src/renderer/src/windows/main/pages/media/wall/MediaWallPage.vue` | 内容页：query `libraryId`（**空串 = 全部影片**）+ 可选 `keyword` |
| `/media/detail` | 影视墙详情 | `src/renderer/src/windows/main/pages/media/detail/MediaDetailPage.vue` | 详情页：query 只带 `itemId` |

- 侧栏一级菜单「影视墙」（在「概览」下方），菜单项用 `match: 'prefix'` 判定选中，所以停在内容页 / 详情页时侧栏仍高亮「影视墙」（`src/renderer/src/windows/main/router.ts`、`pages/app/AppSide.vue`）。
- **本轮没有播放历史**：所以首页第二屏里没有「继续观看」，只有最近添加 / 推荐两排。
- **不按刮削与否分类**：Jellyfin 也没有「待刮削 / 已刮削」这种库内分类，所以影视墙上没有这类角标、排序与统计，资料库详情也没有「已刮削优先」；刮削进度只在概览页的进度卡片与刮削记录里体现（队列口径仍是 `scrapedAt === 0`，见[资料库](../media/01-media-library.md)）。
- 内容口径：**以磁盘为准**。墙面主体是资料库扫描出来的影片条目，未刮削的视频也会上墙（文件名占位），磁盘上被删掉的视频会在下次扫描后从墙上消失。
- 资料库范围：所有数据源（本机 / WebDAV / SMB）聚合成一堵墙，每张卡片带**资料库角标**（`item.libraryName`）。**每个影片都归属于某个资料库**（归属是条目上的真实外键，不再按路径最长前缀猜），因此没有「未归入资料库」这一档。
- 取数：`@/api` 的 `mediaApi`（`home()` / `wall()` / `detail()`），主进程实现见 `src/main/src/modules/media/mediaWall.ts`。
- 详情页另有「**还原刮削前**」入口（详情页右上角「更多」菜单里，通道仍是 `media:clear-nfo`）：二次确认后清掉这条影片的刮削数据与磁盘 NFO，并按 NFO 里记的「刮削前位置」把文件改回原名、搬回原目录，用来处理刮错的数据，见 §4。这是影视墙域唯一的写操作。

## 2. 首页（`home/MediaHomePage.vue`）

`PageLayout title="影视墙"`，description 写明「把磁盘上的视频收进资料库，按最近添加 / 推荐浏览」，`#extra` 只放「刷新」。

**工具条**：搜索 `t-input`（placeholder「搜索标题、番号或文件名，回车到影片列表」，`@enter` 触发）→「资料库」按钮（打开资料库抽屉）→「全部影片」按钮（跳 `/media/library?libraryId=''`）→ 摘要

| 元素 | 行为 |
| --- | --- |
| 搜索框 | 回车时 `trim()`；关键词非空才带 `keyword`，跳 `{ name: '影视墙资料库', query: { libraryId: '', keyword } }`；空串只跳 `libraryId: ''` |
| 「资料库」按钮 | `openLibraryDrawer({ onChanged: load })`：抽屉里的新建 / 编辑 / 删除 / 扫描 / 刮削完成后重拉首页 |
| 「全部影片」按钮 | 跳内容页并清空 `libraryId` |
| 摘要 | `共 N 部 · K 个资料库`，`indexedAt > 0` 时补 ` · 索引更新于 …` |

**区块一：资料库横排**。行头显示「N 个」；有库时横向滚动排 `LibraryCard.vue`，没有库时 `t-empty`「还没有资料库 / 点上方「资料库」新建资料库并扫描，影片会自动出现在这里」。

**区块二~三：两排影片**，由主进程 `loadMediaHome()` 决定（渲染层只按 `row.items.length > 0` 决定画不画，**整排为空则整排不渲染**）：

| 排 id | 标题 | 取数规则 |
| --- | --- | --- |
| `recent` | 最近添加 | 整个墙面按 `dateAdded > 0 ? dateAdded : modifiedAt` 倒序，取前 `MEDIA_HOME_ROW_LIMIT` 条 |
| `discover` | 推荐 | 对**整份**列表按步长 `items.length / limit` 均匀取样（`spreadSample`），避免与「最近添加」整排重复 |

`MEDIA_HOME_ROW_LIMIT = 24`（`src/common/types/media/index.ts`）。每排行头 = 标题 + 「N 部」，卡片复用 `pages/media/components/MediaWallCard.vue`，`connection` 由 `useFileConnections().connections` 按 `item.connectionId` 匹配。

**资料库卡片**（`home/components/LibraryCard.vue`）：props `{ library: MediaLibrarySummary }`；封面是 `library.coverUrls` 的**四宫格**（`.lib-cover` 网格 `repeat(2, 1fr)`、`aspect-ratio: 16/9`），没有封面时显示 `CollectionIcon`；标题行 = 库名 + 类型标签（`libraryTypeLabel(library.type)`）；meta「影片 N 部」；点击跳 `{ name: '影视墙资料库', query: { libraryId: library.id } }`。

`coverUrls` 由主进程 `libraryStore.coverUrlsOf()` 生成：取该库**最近添加且有封面**的前 `COVER_URL_LIMIT = 4` 张，拼成 `storage://` 地址；为空数组时卡片退化成文字封面。首页不自己找封面。

## 3. 内容页（`wall/MediaWallPage.vue`）

内容页容器是 `SubPageLayout`（`:title="pageTitle"`、`fallback="/media"`），返回图标按钮在标题左侧，`#extra` 只放「刷新」。

- **标题**：`libraryId` 为空 → 「全部影片」；否则优先显示库名（`libraryApi.list()` 里查到的名字），查不到时兜底「资料库」。
- **内容工具条**（`.wall-toolbar`）：只剩搜索 / 排序 / 「资料库」按钮 / 摘要，不再有「返回」按钮与重复的标题；返回按钮由页头提供（`SubPageLayout` 的 `#leading` 里那枚 `variant="text" shape="square"` + `ChevronLeftIcon`）。
- **搜索**：`t-input`（width 260，placeholder「搜索标题、番号或文件名」，`v-model="keyword"`）——**输入即过滤，不回车跳转**；初值取 `route.query.keyword`（首页搜索框带过来的词）。
- **排序**：`t-select`（width 180），三个选项来自 `useMediaWall` 的 `SORT_OPTIONS`（**默认 `modified`，即按磁盘时间**）：

| 值 | 文案 | 口径 |
| --- | --- | --- |
| `modified` | 按磁盘时间 | 默认；`modifiedAt` 倒序（最新在前） |
| `title` | 按标题 | `localeCompare('zh-Hans-CN')` |
| `size` | 按体积 | `size` 倒序 |

- **资料库按钮**：打开抽屉，`onChanged` 里重查库名并重拉数据。
- **摘要**：`共 N 部`（`N = visible.length`，**是当前搜索 + 排序后的可见口径，不是整墙口径**），`indexedAt > 0` 时补 ` · 索引更新于 …`。**不再统计「已刮削 M 部」**。
- **没有资料库下拉筛选**：库范围完全由 `query.libraryId` 决定，页内不提供「全部 / 单个库」切换（旧版的 `MEDIA_LIBRARY_ALL` 哨兵与库下拉已随本轮改版去除）。要换库请回首页点库卡片，或直接改地址栏的 `libraryId`。
- 网格 `repeat(auto-fill, minmax(180px, 1fr))`，卡片仍是 `MediaWallCard.vue`；加载 `t-loading`、失败 `t-alert`、空态 `t-empty`（全部影片时「墙上还没有影片」，单库时「这个资料库还没有影片」）。
- `libraryId` 用 `watch(() => route.query.libraryId)` 跟随地址变化；`useMediaWall` 内部的 `watch(..., { immediate: true })` 负责首次取数，页面 `onMounted` 只补一次连接列表与库名。

## 4. 数据流（主进程 `src/main/src/modules/media/mediaWall.ts`）

**整墙**（`media:wall`）：`loadMediaWall({ libraryId })` —— `libraryId` 为空串时遍历 `listLibraries()`，否则只取 `getLibrary(libraryId)`（库不存在抛 `notFound`「资料库不存在」）。每个库取 `listMovieItems(libraryId)`——**只列 `type='movie'` 的条目**，不属于任何资料库的影片不会出现在墙上；条目没有主源（已被清理）时跳过。`indexedAt = maxSourceIndexedAt()`（最新媒体源的 `indexed_at`），`libraries = listSummaries()`（带 `videoCount` / `coverUrls`，**0 个视频的库也会出现**），返回 `MediaWallResult{ items, total, indexedAt, libraries }`。整墙一次拉全，搜索 / 排序全在渲染层做，主进程不复制排序规则（首页两排的取样在**主进程**做，见 §2）。

**详情**（`media:detail`）：`loadMediaDetail({ itemId })`——空 id 报 `invalidArgument`「缺少影片 ID」；条目不存在、不是 `movie` 条目、或没有主源时报 `notFound`（「索引里没有这个视频，磁盘上可能已被删除」）。返回 `MediaDetailResult{ item, meta, nfoPath, actors, images }`，`item` 与墙上同一套卡片数据（含 `playUrl`），详情页不需要再拼任何地址。`actors` 是**参演演员**（`MediaActorRef{ actorId, name, avatarUrl }[]`，按 `media_cast.ordinal` 出演顺序；没有名单时是空数组，`avatarUrl` 为空串表示没头像），由 `actorRefsOfItem(itemId)` 组装、头像是 `storage://actor/...` 地址；演员与影片是**按名字的弱关联**（`media_cast` 只记姓名归一化键，演员行被删掉时 `actorId` 回落空串、渲染层不跳转），名单在刮削入库与扫描 NFO 时写入（见[演员模块](../actor/01-actor-module.md)）。详情页用 `MediaActorStrip.vue` 渲染成「头像 + 姓名」并跳[演员详情页](./05-actor-pages.md)。`images` 是这部影片的全部图片（`MediaDetailImage{ type, url }[]`，`detailImagesOf()`）：与封面同一套归属规则——**条目自己的图在前、父目录条目的兜底图在后**（目录级图片会被同目录多部影片共用），各自按 `MEDIA_IMAGE_TYPES`（主图 → 背景图 → 缩略图 → 剧照 → 徽标 → 横幅 → 其他）排序、按地址去重；一张都没有时是空数组，封面仍以 `item.coverUrl` 为准。渲染层拿它喂沉浸头部的背景大图与剧照墙，只按 `type` 分工、不再取数（见 §4「详情页版式」）。

- NFO 候选顺序 `movie.nfo` → `{文件名}.nfo`（文件名取主源 `name`），路径为空或读失败 / 解析不出内容都算「没有 NFO」，不报错；
- NFO 解析用三端共享的纯函数 `parseNfoXml`（`@common/types/media/nfo.ts`），字段口径与写入侧 `buildNfoXml` 对齐；`runtime` 转成分钟。

**清除 NFO / 还原刮削前**（`media:clear-nfo`，本域唯一的写通道）：`clearMediaNfo({ itemId })`（`src/main/src/modules/media/mediaClearNfo.ts`）——空 id 报 `invalidArgument`「缺少影片 ID」；条目不存在、不是 `movie` 条目、没有主源时报 `notFound`。只对**单条影片**生效，语义是「一键还原成刮削前的样子」：

1. **读还原记录**：按上面同一套候选顺序读同目录 NFO，取第一条能解析出记录的那份（`parseNfoRestore`，见[刮削模块 §5.2](../scrape/01-scrape-module.md)）。旧版本刮削的 NFO、第三方工具写的 NFO 里都没有记录，这种情况退化成「只清数据 + 删 NFO」；
2. **删磁盘 NFO**：按同一套候选顺序逐个 `exists` 再 `remove`，存在的都删。任何一个删不掉（连接不可用、权限不足）就抛 `writeFailed`「磁盘上的 NFO 没有删除（原因），刮削数据保持不变」，**库内数据保持原样**——只清库不删盘，下次开「优先读取本地 NFO」重刮会把同一份错误数据读回来；
3. **还原 / 清理资源**：记录里带 `original` 的文件（`localFirst` 沿用、被改名就位的本地图片）搬回原来的文件名与目录（原位置已被占用就原样留着、**不覆盖**）；不带 `original` 的（本次刮削联网下载的图片、预告片）直接删掉；两者都是尽力而为，删不掉 / 搬不动只跳过，不让整次还原失败；
4. **搬回视频**：记录里有原目录与原文件名时，先 `mkdir`（递归）目标目录再 `move`（`overwrite: false`），搬成功后 `refreshSourcePath` 就地更新 `media_source` 与条目 `path`（**source id 不变**，墙面与协议地址不受影响）；目标已存在就**保持现状**（不覆盖、不删），只把 `restored` 报成 `false`；视频本来就在记录位置时算还原成功（空操作）；
5. **清库内数据**：`clearItemMetadata(itemId, { name, num })` 把刮削列整组归零（`scrapedAt = 0`、`sortName` / `originalTitle` / `overview` / `tagline` / `premiereDate` / `officialRating` / `scraperId` 归空、`genres` / `studios` / `tags` 回 `'[]'`、`providerIds` 回 `'{}'`），`name` 取**还原后**的磁盘视频文件名（含扩展名）、`num` 取 `normalizeNum(extractKeyword(文件名).num)`；再 `deleteImagesByItem(itemId)` 删掉这条影片的图片记录、`deleteCastByItems([itemId])` 删掉参演名单（与 `mediaIndexer` 的扫描写入口径一致，所以清完的状态等于「扫描过、还没刮」）；
6. **删空目录**：视频搬走后，原来的影片目录（≠ 还原后的目录、≠ 连接根目录、不属于任何资料库根目录）若已经空了就递归 `remove` 掉，路径返回在 `removedDir`。

返回 `MediaClearNfoResult{ itemId, removedNfo, removedAssets, restoredAssets, restored, path, removedDir }`：三个路径数组都是**真的改动过**的磁盘路径，本来就没有对应文件时是空数组（不算失败）；`path` 是还原后的视频路径；`restored === false` 只表示「视频没能回到记录位置」（没有记录，或目标已存在），库内数据照样清干净了，渲染层据此换提示文案。扫描拥有的列（`type` / `parentId` / `hasNfo`）不动，`path` 由第 4 步更新，`hasNfo` 交给下次扫描纠正。

- **只动刮削产物**：NFO、记录里列出的图片 / 预告片、以及自己创建且搬空的影片目录；没记在 NFO 里的文件一律不碰（用户自己放的同目录文件、别的影片的文件都安全）；
- **绝不覆盖**：还原目标已有同名文件时保持现状，文件留在影片目录里（宁可少还原一步，也不覆盖用户的文件）；
- **可以反复刮、反复还原**：再刮一次时旧 NFO 里的记录会被新 NFO 原样沿用（见[刮削模块 §5.2](../scrape/01-scrape-module.md)），所以第二次清除照样能还原到最初的位置；
- **不误删是一种取舍**：记录只收「本次真的写下或搬过」的文件，第二次刮削时按保留设置沿用磁盘上已有图片、以及本来就没挪过位置的本地图片都不进记录，还原时它们会留在影片目录里（宁可少删一步，也不删用户自己的文件）；连同整个影片目录已经删不空，也就不会被顺手删掉；
- 演员本人档案（`actor`）不动，只删 `media_cast` 关联（见[演员模块](../actor/01-actor-module.md)）；
- 清完**不自动重刮**：详情页只重新 `mediaApi.detail()` 一次，要重刮请回资料库抽屉点「刮削」（`scrapedAt === 0` 会被队列选中）；
- 注意 `movie.nfo` 是**目录级**候选：一个目录里多部影片共用 `movie.nfo` 时，清除其中一条会把这个文件删掉，兄弟影片的库内元数据不受影响，但它们的 `hasNfo` 要等下次扫描才纠正。

**卡片字段**（`toWallItem()`）：`itemId` / `libraryId` / `libraryName` / `nsfwProtected`（= 所属库的 `nsfwProtection`）/ `connectionId` / `path` / `dirPath` / `name` / `num` / `title` / `coverUrl` / `playUrl` / `dateAdded` / `pluginId`（条目上的 `scraperId`）/ `size` / `modifiedAt`。**没有 `scraped` / `scrapedAt`**：卡片不再打「已刮削 / 未刮削」角标（`scrapedAt` 仍留在库里，只用于队列与标题口径）。

- `title` 口径 = `item.scrapedAt > 0 ? item.name : stripExtension(item.name)`——刮削时插件写回的标题就存在条目 `name` 上，所以「刮过」的条目显示插件标题，没刮过的显示去扩展名的文件名。
- 刮削分类已下线：旧的「`scrapedAt > 0` 或 `hasNfo > 0` 或有图片」三口径连同 `mediaWall.scrapedOf()` 与 `countScrapedMovieItems()` 一起删除；**刮削队列**仍是另一个口径——`listPendingMovieItems` 只取 `scrapedAt === 0`，所以「有 NFO / 有封面但没真刮过」的条目照样能被「刮削本库」选中重刮（见[资料库](../media/01-media-library.md) §5）。

- 封面 `coverUrl`：按 `MEDIA_COVER_IMAGE_TYPE_ORDER`（主图 → 缩略图 → 背景图 → 剧照 → 其他）逐类找，同一类里先条目自己的图片、再**父目录条目**的图片，取到第一张就返回。目录级 `poster` / `cover` / `folder` 在扫描时挂在目录条目上，刮削器写的 `[基名-]thumb.jpg`、`extrafanart/stillN.jpg` 也已在扫描时入库，所以「有快照没封面」会自动回退到快照。地址 `buildMediaUrl(image.connectionId, image.id, 文件名)`；一张都没有则空串（卡片显示占位）。注意 `image.id` 有两种形态（扫描图 32 位十六进制 / 刮削图 UUID），主进程 `handleMediaRequest()` 的 `MEDIA_ID_PATTERN` 形态校验必须两种都放行，否则刮削封面会静默 404（`notFound()` 分支不打日志），表现为「封面全都不显示」——见[资料库 · 确定性 ID](../media/01-media-library.md)。
- 播放 `playUrl`：`buildMediaUrl(source.connectionId, source.id, source.name)`——用的是**媒体源 id**，渲染层因此拿不到磁盘路径。

**播放**（`storage://` 协议 + 自建 Range 服务端，`src/main/src/modules/media/mediaProtocol.ts`）：

- scheme 名仍是 `storage`（CSP 不变），地址只认 ID：`storage://{连接ID}/{媒体ID}/{文件名}`。
- `resolveTarget(connectionId, mediaId)` 先查 `media_source`（kind 由扩展名 / MIME 判定，视频走流式），再查 `media_image`；连接对不上或都查不到返回 404。
- 视频请求不走 `net.fetch`，而是 `handleVideoRequest`：先 `client.stat(path)` 取**权威**大小与 MIME（索引可能过期，而 206 的 `Content-Range` 必须和真实大小一致），再解析单区间 Range：
  - 无 `Range` → `200` + `Accept-Ranges: bytes` + `Content-Length`；
  - 有 `Range` → `206` + `Content-Range: bytes s-e/total`；
  - `start` 越界 → `416` + `Content-Range: bytes */total`；
  - 支持 `bytes=start-end` / `bytes=start-` / `bytes=-suffix` 尾部探测（非 faststart 的 MP4 要靠最后一种去文件尾读 moov）；多区间与非法值退化成 200 全量，不做 `multipart/byteranges`。
- 取值路径：本机连接（`protocol === 'local'`）直读；远端视频 / 图片先落到 `~/.vault-scrape/cache/media/<媒体ID>`（总量上限 512MB，超了按 mtime 由旧到新剪到 80%）再读。刮削产物（视频与全部图片）都落在影片自己的文件夹里，没有独立的图片存储位置。
- 区间读与流适配：`FileClient.readRange(path, start, end)`（**闭区间，含 end**）返回 node 流，再用 `modules/file/streamToWeb.ts` 的 `toWebStream` 适配成 `Response` 的 body（队列积压时 `pause()` 源流、`pull` 时 `resume()`，下游 `cancel` 时 `destroy()` 源流）。
- 任何异常都记一条去重 warn（同一媒体 60s 内只记一条）并返回 404，不在渲染层抛异常；**唯一的例外是下面的路径自愈**。
- **播放期路径自愈**（`src/main/src/modules/media/mediaLocator.ts`）：`media_source.path` 只在扫描与刮削改名 / 移动时更新，用户在文件管理器里手工把 `.mp4` 挪走又不重扫时，`client.stat()` 会抛 ENOENT——以前直接变 404（封面还在原地，所以表现为「图片正常、视频 404」）。现在 `handleRangeRequest`（媒体源与存储页路径预览共用的区间请求入口）把 `stat` 包进 try/catch，命中 `isNotFoundError(error)` 且请求来自**媒体源**时按「文件名等价（trim + 忽略大小写）+ 字节数相同」找回：
  - 先在同目录 `client.list(dirname(path))` 快查（同目录改名、移进子目录最常见），再从该资料库配置的媒体目录（`getLibrary(libraryId).paths` 里 `connectionId` 匹配的，`/` = 连接根）广度优先遍历；单目录列不出来只跳过该目录，单次最多 `MAX_ENTRIES = 20_000` 条、`MAX_DEPTH = 8` 层；不做标题 / 番号模糊匹配——宁可继续 404，也不放错片子。
  - 命中后用 `updateSourcePath(source.id, …)` 只改 `media_source` 的 `path` / `name` / `extname` / `mime` / `size` / `modified_at`：**source id 不变**，`storage://` 地址与远端缓存都不失效；`media_item.path` / `parentId` 不动。成功记 info 日志「索引路径失效，已按文件名找回：<旧> → <新>」；写库失败只记 warn，本次播放照常返回。
  - 找不到的结论按「资料库 + 连接 + 文件名 + 字节数」缓存 `MISS_TTL_MS = 60_000`，同一媒体源的并发 Range 请求共享一次查找（模块级 `healing: Map<sourceId, Promise<FileEntry | null>>`）。不主动扫盘、不监听文件系统、不新增 IPC；真删掉的文件仍然 404。
- 渲染层 `MediaPlayer.vue`（已移到共用目录 `src/renderer/src/components/media/MediaPlayer.vue`，影视墙详情页与[存储页预览](./02-storage-page.md)共用）监听 artplayer 的 `video:error`：视频读不出来（文件被移走 / 删除，或封装、编码放不了）时不再留一块黑屏，而是在播放器位置盖一层 `poster`（就是上面的 `coverUrl`，通常已回退到快照）加一句说明文案（详情页用组件默认的 `fallbackText`——「文件可能已被移动或删除，也可能是封装 / 编码放不了；可以先用本机播放器打开这个目录，**也可以在影视墙里对资料库重新扫描一次**」，存储页预览另传一句「……可以先用本机播放器打开它」）；换片（`url` 变化）或重新起播时清掉这个状态，本版本不做转码。
- 协议在 app ready 之前由 `registerMediaScheme()` 登记为特权 scheme（`standard` / `secure` / `supportFetchAPI` / `stream`），ready 之后、开窗之前 `registerMediaProtocol()` 接管（见 `src/main/index.ts`）。

### 详情页版式（`detail/MediaDetailPage.vue` + `detail/components/`）

页面**不用 `SubPageLayout`**：没有页头横条，页顶只有一枚**吸顶悬浮条** `detail/components/MediaDetailToolbar.vue`——`position: sticky; top: 0`，高度 56px，再用 `margin-bottom: -56px` 负掉自己的高度所以**不占流内空间**，头部图片依旧贴到容器顶边，因此它必须是滚动容器的第一个子节点。返回图标压在封面图左上角，「更多」（`t-dropdown`，`trigger="click"`、`placement="bottom-right"`；菜单项「重新读取」始终可用、详情没读出来时它就是重试入口，「还原刮削前」只在详情读出来后出现、是危险操作所以用 `theme: 'error'` 标红）在右上角；**头部的标题被滚出视野后**，这条退成一抹半透明横幅（毛玻璃 + 单行省略号的标题 + 收成圆形、与返回同形的「更多」），判断见 `composables/useDetailScroll.ts`。代价是页面自己就是滚动容器（根节点 `.media-detail { height: 100%; overflow: auto }`），正文左右内边距从页头挪到 `.detail-body`（20px），头部因此天然通栏、不再需要负外边距出血。正文自上而下七块，版式取主流影视站的沉浸头部 + 数据应用的信息密度：

| 顺序 | 区块 | 组件 / 口径 |
| --- | --- | --- |
| 1 | 沉浸头部 | `MediaDetailHero.vue`：通栏背景大图 + 底部渐隐 + 标题 / 原名 / 要点行 / 标签 + 「播放」 |
| 2 | 播放器 | 共用 `@/components/media/MediaPlayer.vue`（16:9，自带边框）；没有 `playUrl` 时换成 `t-alert` 警告 |
| 3 | 剧情简介 | 只在 `meta.plot` 去空白后非空时出现（原 NFO 块里的只读 `t-textarea` 已去掉，简介不再被塞进输入框） |
| 4 | 封面 | 168×238 的 `SensitiveImage` + 标题 + 「番号 · 体积」；头部用封面兜底时那张是模糊的，这块给一张清晰的 |
| 5 | 两栏信息 | 左 `MediaNfoBlock.vue`（NFO 元信息 + 来源路径 + 无 NFO 时的 `t-empty`），右「磁盘上的事实」+ `MediaFactGrid.vue`；`grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))`，窄窗口自动叠成一栏 |
| 6 | 剧照墙 | `MediaStillWall.vue`：缩略图网格 + `t-image-viewer` 大图浏览 |
| 7 | 参演演员 | `MediaActorStrip.vue`（本轮未改） |

- **无卡片留白分区**：区块一律不画底板 / 描边 / 圆角，只靠 14px 小节标题与 24px 留白分隔（上一版每块都套 `--td-bg-color-container` + 1px 边框，视觉上是一摞横条，已按反馈去掉）。唯一保留圆角的是封面与剧照缩略图；播放器自带边框，不再套第二层。
- 头部左右**出血**是天然的：滚动容器自己不设内边距，20px 只加在 `.detail-body` 上（`.detail-bleed` 这个负外边距类已随 `SubPageLayout` 一起删掉）。悬浮条自己就是横幅：整条 `pointer-events: none`，只有两枚按钮 `pointer-events: auto`——中间空档必须放行事件，否则会挡住头部那层「点击查看原图」（`.hero-mask` 是 z-index 2，悬浮条取 z-index 3）。横幅底色用 `::before` + `opacity`（不用 `color-mix`，兼容面更宽），`.is-solid` 时淡入到 0.82 并加 `backdrop-filter: blur(12px)` 与下边框，标题同时淡入。**56px 这个高度是硬约束**：详情页 `useDetailScroll` 拿同一个数字当 `rootMargin`，改一处要一起改。加载 / 失败 / 空态走 `v-else` 分支（`.detail-fallback`，顶部留 96px 给悬浮条），失败提示在正文顶部。
- 横幅什么时候显形**不按 `scrollTop` 猜阈值**（头部高度随窗口宽度与标题 / 要点行换行而变）：头部正下方埋一枚 1px 哨兵 `.hero-end`，`IntersectionObserver` 以滚动容器为 root、`rootMargin` 收掉横幅那一条，哨兵跑到它上面（`entry.boundingClientRect.top < entry.rootBounds.top`）就是标题已经滚出去了，`collapsed` 交给悬浮条。刷新后恢复滚动位置、窗口拉伸、要点行换行都不用额外处理，相交变化会自己重算。
- 头部要点行（`heroFacts()`）只列**真正有值**的项——番号 / 发行日期 / 时长 / 片商 / 厂牌 / 系列 / 导演 / 体积，没有值就整项不出现，未刮削的影片不会是一排「—」，项之间用 `/` 分隔；标签取 NFO `tags` 去空去重（`heroTags()`），用 `t-tag size="small" theme="primary" variant="light"`（light 变体没有边框）。
- 背景大图（`heroBackdropOf()`）按**缩略图 → 横幅 → 背景图 → 剧照**取第一张现成的图：`thumb*` 是该条目的官方横图，必须排最前——`backdrop` 里混着 `extrafanart/fanartN` 这种竖版剧照（实测 `fanart1.jpg` 是 600×800），排在前面会把头部裁成一条。一张都没有时退回 `item.coverUrl` 并把它 `transform: scale(1.12)` + `filter: blur(28px)` 模糊放大铺满（2:3 竖图直接 `cover` 会被裁成一条），这时标题块下方单独给一张清晰封面。连 `coverUrl` 也没有才只留渐变底色。
- **头部只有一张图，横竖两种来源都可能不准**：类型只决定优先级，真正的横竖由 `MediaDetailHero.vue` 在 `t-image` 的 `@load` 里量 `naturalWidth / naturalHeight`（`target instanceof HTMLImageElement` 收窄，不用 `as`）——竖图同样走模糊底图，`landscape` 与 `revealed` 跟着 `itemId` 在 `watch` 里重置（详情页是同一路由换 query，组件不会重建）。
- **NSFW 保护命中时头部给模糊底图 + 「点击查看原图」**（`.hero-mask` 盖一层可点区域，点一下 `revealed = true` 换成清晰原图）：既不第一眼就露出未经确认的敏感画面，也不会像完全不放图那样只剩一块底色（上一版就是这么做的，反馈是「横幅是个白灰白色的方块」）。封面与剧照仍由 `SensitiveImage` 自己按需遮罩。
- 标题压在图片下缘的渐隐区里（`.hero-scrim` = `transparent 0% → transparent 32% → var(--td-bg-color-container) 82%`，82% 就收满，保证 `margin-top: -64px` 叠上来的标题第一行落在已完全收满的纯色区，画面上不会有图从字后面透出来；`.hero-body` 用 `margin-top: -64px` 叠上去），文字用 `--td-text-color-primary` 落在渐隐到面板底色的区域——深浅两套主题都读得清；**不用白字压原图**，避免亮色主题下白字贴浅图不可读。渐隐的 token 是硬约束：页面容器是 `windows/main/App.vue` 的 `.main-container { background: var(--td-bg-color-container) }`，渐隐若取 `--td-bg-color-page`（亮 `#f3f3f3` / 暗 `#141414`）就会与面板（亮 `#ffffff` / 暗 `#292929`）不同色，头部底边会压出一条横切标题文字的硬边色带（用户反馈原话：「你上面的横幅盖到了视频标题的文字上面了」）。头部渐隐之外，详情页其余区块一律不铺底色。
- **头部的层级必须显式写死**（用户反馈原话：「你的图片层级在文件文字的层级上面……导致文字看不到」——实测标题第一行真的被图片像素盖掉）：tdesign 的图片根节点是 `.t-image__wrapper { position: relative; z-index: 1 }`，`t-image` 外面那层若只有 `position: relative`（`z-index: auto`）就**不成层叠上下文**，这枚 `z-index: 1` 会被提升到外层、画进「正 z-index 层」，压过 `z-index: auto` 的兄弟节点。修法是 `.hero-media` 自己写 `z-index: 0` 成层，`.hero-scrim` 写 `z-index: 1`、`.hero-mask` 写 `z-index: 2`、`.hero-body`（标题层）写 `z-index: 1`——图片带整层永远在文字层之下。以后在别的页面把 `t-image` 叠在任何块内定位元素上，都要按这个分层写。
- **播放器那一块的层级同样要写死**（用户反馈原话：「视频的 z-index 很大，导致把最上面的标题栏给覆盖掉了」）：artplayer 的根节点 `.art-video-player` **不建层叠上下文**（它自己没写 `z-index`），内部图层会直接逃到页面这一层跟吸顶悬浮条（`3`）比大小——实测视频本体 `.art-video` 是 `10`、控制条 `.art-bottom` `60`、`.art-loading` `70`、`.art-notice` `80`、`.art-settings` `90`、`.art-info` `100`、`.art-contextmenus` `120`、`.art-mini-popup` `9999`、`[class*='hint--']` 提示气泡 `1000000 / 1000001`。**别去抬高标题栏**（要压过 1000001 就是魔法数字，还会反过来盖住网页全屏）。修法是给播放器块建层：`.player-block { position: relative; z-index: 0 }` 收住全部内部图层；网页全屏时 artplayer 给根节点加 `.art-fullscreen-web`（`position: fixed; inset: 0; z-index: var(--art-fullscreen-web-index)` = `9999`），这时反过来让播放器块抬到 `.player-block.is-fullscreen { z-index: 100 }` 盖住标题栏与页面里的图片层（`1 / 2`）。全屏状态由 `MediaPlayer.vue` 监听 artplayer 的 `fullscreenWeb` 事件 `emit('webFullscreen', boolean)` 回传（销毁播放器时补一次 `false`，否则重建后页面会一直以为还在全屏）。
- 剧照墙（`stillImagesOf()`）去掉主图（封面）与缩略图（头部优先用这张），以及头部实际用到的那张图本身，其余按主进程给的原顺序排列；每张缩略图都走 `SensitiveImage`（保护命中时逐张点开），点开的大图是原图（用户已明确要看）。大图浏览必须写 `v-model:index` + `v-model:visible`：`index` 是受控 prop，只传值不写 `v-model` 时翻页会失效（内部只 `emit('update:index')`）；`download: false` 去掉下载按钮（这些是 `storage://` 私有协议地址，浏览器下载不了）。
- 头部的「播放」只把播放器 `scrollIntoView` 滚进视野，**不自动播放**：`MediaDetailHero` 用 `emit('play')` 把决定权交给页面。
- 样式写在各组件自己的 `scoped` 里（页面私有的块不往 `src/components` 放）；`MediaFactGrid` 是「88px 标签 + 值」的行列表，不再是两列网格。
- 返回语义与改版前一致，仍是 `router.back()`：改由 `MediaDetailToolbar.vue` 里的 `useSafeBack('/media')` 提供（历史为空时兜底影视墙首页），页面不再有页头，也不要在正文里再放返回按钮；这枚返回**吸顶、不会被滚走**（见上文 `position: sticky`），滚动后它会和标题横幅、圆形「更多」并排；播放失败仍落到 `MediaPlayer` 的 `fallbackText` 兜底层（见本节前文）。

## 5. 资料库抽屉与表单

资料库 = 「一个名称 + 一个类型 + 一组媒体目录（可跨存储）+ 自己的刮削器（可为空） + 库级选项」——**刮削器只能选影片信息插件（`kind: 'movie'`）**，模型与主进程契约见[资料库](../media/01-media-library.md)、插件类别见[插件类别](../plugin/03-plugin-categories.md)。影视墙页不承担资料库的配置细节，只做两件事：在首页 / 内容页用它取数，用抽屉维护它。

**抽屉**（`openLibraryDrawer({ onChanged })`；外壳 `library/components/LibraryDrawer.tsx` → `DrawerPlugin`，宽 720px，无 footer）——内容 `LibraryDrawerContent.vue`：

- 头部：「新建资料库」按钮 + 「刷新」按钮 + 口径提示「资料库 = 多个媒体目录 + 自己的刮削器，影片按库归集到影视墙」。
- 扫描条（`scanning` 为真时显示在列表上方，**不是行内**）：`t-loading` + 「正在扫描资料库…」+ 「已遍历 N 个目录，索引 M 个文件」+ 当前目录 + 「取消扫描」。
- 每行是 `LibraryListItem.vue`：库名 + 类型标签（`libraryTypeLabel`）+ 「N 个目录」+ 刮削器标签（`scrapers.length > 0` 显示「N 个刮削器」，否则显示「**不刮削**」）+ NSFW 标签；下面逐条目录显示「存储名 · 目录」（本地存储显示本机路径，连接被删显示「存储已删除」）；再下面「影片 N 部」（计数来自影视墙读模型）+ 上次扫描 / 上次刮削时间；行右四个动作「扫描」「刮削」「编辑」「删除」。
- 空刮削器不再是错误状态：「刮削」按钮禁用并 `t-tooltip` 说明「该资料库未配置刮削器，不执行刮削」；扫描期间所有行的动作都禁用。
- 「扫描」成功提示「「名称」扫描完成：索引 X 个文件（视频 Y 个），移除 Z 个，待刮削 W 个」；自动刮削启动时提示「已自动开始刮削「名称」：N 个文件，进度见概览页」，被跳过时提示「未自动刮削：原因」。「刮削」成功提示「已为「名称」排队 N 个文件，进度见概览页的刮削记录」。
- **删除只删配置与库内媒体行**：确认文案原文「将删除资料库「X」的配置与库内影片记录，磁盘文件不会被删除。一条媒体目录只属于一个资料库，删除后这些影片会从影视墙上消失。」任何改动通过 `onChanged` 让页面重新 `load()`。

**表单抽屉**（`openLibraryFormDrawer({ library?, connections, onSaved })`；外壳 `library/components/LibraryFormDrawer.tsx` → `DrawerPlugin`，宽 800px，从右侧滑出；内容 `LibraryFormContent.vue` 只留字段，状态机抽在 `library/composables/useLibraryForm.ts`，底部 footer 常驻「取消 / 保存」，保存按钮的 `loading` 取自内容组件 `defineExpose` 的 `saving`）：

| 字段 | 契约 |
| --- | --- |
| 名称 | 必填，空则「请填写资料库名称」 |
| 类型 | `t-select`，选项来自 `LIBRARY_TYPES` / `LIBRARY_TYPE_LABELS`；**新建可选，编辑态 disabled**（说明文案「类型创建后不可修改」），理由：条目已按原类型后缀索引，中途换类型会留下孤儿条目 |
| 媒体目录 | 多行编辑器 `LibraryDirectoryEditor.vue`：每行「存储下拉 + 选择目录 + 路径回显」，未选存储时选择按钮禁用并 `t-tooltip` 提示「请先选择存储」；换存储会清空该行路径；只剩一行时删除按钮禁用；底部「添加媒体目录」+ 说明「一个资料库可以包含多个存储上的多个目录，扫描时会全部递归遍历」 |
| 选择目录 | 走资料库自己的 `RemoteDirDialog.tsx` + `RemoteDirPickerContent.vue`（`fileApi.list({ connectionId, path })`，**只列目录**，带面包屑与「上级目录」，路径全程是**连接内路径**（`/` = 连接根），点「选择当前目录」把当前路径回调回该行）；弹窗 footer 左侧跟着内容组件 `defineExpose` 出来的当前路径、右侧是「取消 / 选择当前目录」（契约见 `src/renderer/src/utils/modal/ModalContent.ts`）；**不复用本机目录选择器** |
| 刮削器 | 通用多选控件 `CheckboxSelect`（`@/components/CheckboxSelect.vue`：外框 + 搜索框 + 可滚动 checkbox 列表，`v-model` 是 `string[]`，契约见 [ui/03](../ui/03-checkbox-select.md)），候选项来自 `useScraperOptions`（`pluginApi.movie.list()` 过滤 `enabled && loadError === ''`，只列**影片信息插件**）；说明「不选择刮削器表示这个资料库不刮削，扫描后不会自动刮削」；已保存但当前不可用的 id 不进候选，会被补进选项数据、label 标注「（已失效）」显示，取消勾选才会从配置里清除（不会被静默清空）；**新建时默认勾选内置 `R18_OFFLINE_PLUGIN_ID`（`r18-offline`），插件不可用时保持不勾** |
| 库级选项 | NSFW 保护 / 「文件过滤」`minFileSizeMb`（`t-input-number`，`:min="0"`、`:step="100"`，说明「小于该体积（MB）的视频不参与扫描与刮削；填 0 表示不过滤」）/ 「优先读取本地 NFO 和图片」`localFirst`（开关，文案「优先读取本地 NFO 文件中的信息和本地图片，仅从互联网上获取缺失的信息」）/ 移动文件（**开启时才显示「目标目录」输入**，关闭时存空串）；**写 NFO、按命名规则重命名、图片与影片同目录都是固定行为，表单里没有对应开关** |

- 提交前校验顺序：名称 → 至少一行媒体目录 → 每行都选了存储 → 同库内不出现重复目录 → 每行都选了目录；两条兜底文案「请先到「存储」页新建数据源」「请为每个媒体目录选择存储」，重复目录报「存在重复的根目录，请合并后再保存」。
- 提交走 `libraryApi.save`（新建不带 `id`），失败经 `LibraryResult` 回显中文原因（跨库目录重叠的报错由主进程给，见[资料库 · 目录重叠规则](../media/01-media-library.md)）。
- 新建时渲染层默认值：`type = 'movie'`、`minFileSizeMb = 0`、`localFirst = false`、NSFW / 移动均关闭。

## 6. 目录结构

```
src/renderer/src/windows/main/pages/media/
├── components/
│   └── MediaWallCard.vue                 # 首页与内容页共用的卡片：封面、资料库 / 番号角标、体积 / 时间
├── home/                                 # /media（首页）
│   ├── MediaHomePage.vue                 # 资料库横排 + 两排影片（最近添加 / 推荐）+ 工具条
│   ├── components/LibraryCard.vue        # 资料库卡片：coverUrls 四宫格 + 计数
│   └── composables/useMediaHome.ts       # 调 mediaApi.home()，持有 libraries / rows / 摘要
├── wall/                                 # /media/library（内容页）
│   ├── MediaWallPage.vue                 # 页头（`SubPageLayout` 返回 + 标题）+ 搜索 + 排序 + 摘要 + 网格
│   └── composables/useMediaWall.ts       # 取数、去重、搜索过滤与排序
├── detail/                               # /media/detail（详情页）
│   ├── MediaDetailPage.vue               # 吸顶悬浮条（无页头）+ 沉浸头部 + 播放器 + 剧情简介 + 两栏信息 + 剧照墙 + 演员条
│   ├── mediaDetailCells.ts               # 信息格 + 头部要点 / 标签 / 背景图 / 剧照墙的字段口径（纯函数）
│   ├── composables/useDetailScroll.ts    # 头部哨兵 + IntersectionObserver → collapsed（标题滚出后横幅显形）
│   ├── composables/useDetailView.ts      # 展示口径：连接反查、NSFW 判定、封面块 / 剧照墙 / 信息格
│   ├── composables/useMediaDetail.ts     # 从 query 取参、调 mediaApi.detail
│   └── components/{MediaDetailToolbar,MediaDetailHero,MediaStillWall,MediaFactGrid,MediaNfoBlock,MediaActorStrip}.vue
└── library/                              # 首页 / 内容页共用的资料库管理
    ├── components/
    │   ├── LibraryDrawer.tsx / LibraryDrawerContent.vue
    │   ├── LibraryListItem.vue           # 抽屉里的一行
    │   ├── LibraryFormDrawer.tsx / LibraryFormContent.vue
    │   ├── LibraryDirectoryEditor.vue    # 媒体目录多行编辑器
    │   └── RemoteDirDialog.tsx / RemoteDirPickerContent.vue   # 连接内目录选择器
    └── composables/{useLibraryForm.ts,useMediaLibraries.ts}
```

- `pages/media/` 下**不再有平铺文件**（RL-09：页面目录分层），跨首页与内容页共用的组件放 `pages/media/components/`。
- 原来页面私有的 `mediaUtils.ts` 已上移为 `src/renderer/src/utils/format.ts`（`formatSize` / `formatTime` / `formatDuration`，未知值统一显示「—」），引用点统一用 `@/utils/format`；刮削展示也在用同一份，所以不要再在页面里复制。
- 主进程侧：`src/main/src/modules/media/mediaWall.ts`（首页 / 整墙 / 详情 / 逐级浏览取数，并导出 `nfoCandidates` / `primarySourceOf` 给清除流程共用）、`mediaClearNfo.ts`（「清除 NFO / 还原刮削前」：按 NFO 里的还原记录删 NFO、还原文件、清库内刮削数据，本域唯一写操作；文件搬移与路径回写复用 `$/modules/scrape/scrapeJobApply` 的 `refreshSourcePath`）、`mediaProtocol.ts`（`storage://` 协议与 Range 流式、视频路径自愈入口）、`mediaLocator.ts`（播放期按文件名 + 字节数找回被移动的视频）、`mediaIpc.ts`（IPC 注册）；preload 桥为 `src/preload/src/modules/media/{mediaChannels.ts,media.ts}`，渲染层出口 `src/renderer/src/api/media.ts`；资料库的主进程实现见[资料库](../media/01-media-library.md)。
- 本机路径与连接内路径互转仍走 `src/renderer/src/utils/remotePath.ts`（`toRemoteDir` / `toDisplayDir`）。

## 7. NSFW 保护

- 首页 / 内容页卡片：`MediaWallCard.vue` 用 `useNsfwProtection(computed(() => props.connection))` 取 `active`（全局开关 + 该存储的 `nsfw` 标记同时成立），再与 `item.nsfwProtected`（所属资料库的 `nsfwProtection`）取或：**任一命中即遮罩**，封面统一走 `@/components/SensitiveImage.vue`。资料库表单里的「NSFW 保护」因此既能强制遮罩本库内容，也不影响存储级标记对其它内容的作用。
- 首页的资料库卡片封面（`coverUrls`）同样走 `SensitiveImage`；库级 `nsfwProtection` 为真时也按敏感内容处理。
- 详情页**自己**拉一次连接列表（`useFileConnections().refresh()`），按 `detail.item.connectionId` 找到连接后再 `useNsfwProtection(connection)` 判定；不从列表页传保护快照，所以进详情页后立刻切换总开关，行为与列表页一致。
- 播放器在 `protect` 为真时盖一层不透明遮罩（`--td-bg-color-container`）+「内容已隐藏，点击播放」，点击后撤遮罩并 `art.play()`；详情页的头部**在保护命中时先给模糊底图 + 「点击查看原图」**（点一下才换成清晰原图，见 §4），海报与剧照仍沿用 `SensitiveImage` 自己的遮罩（剧照逐张点开）。
- `SensitiveImage` 的遮罩容器带 `@click.stop`：在卡片上点「内容已隐藏，点击查看」只放行图片，不会顺带跳进详情页。
- `active` 依赖 `connections` 与模块级的总开关缓存，两者都到位才有遮罩。总开关由应用设置保存成功后的回调刷新（见[设置存储](../setting/01-setting-storage.md)）：在影视墙（或详情页）开着的时候去打开「应用设置 → NSFW 保护」，回来约 300ms 内遮罩应当直接出现，不需要刷新页面；反过来关掉开关，遮罩应立即消失。

## 8. 手工验证清单

按项目约定只跑 `yarn run typecheck`，运行时行为手工验证：

1. 首页两排：扫过一个有影片的库后回首页，应能看到「资料库」横排与「最近添加 / 推荐」两排（**不应出现「待刮削」排**），行头计数与实际卡片数一致；某一排为空时该排整块不渲染。
2. 首页搜索回车：输入完整关键词回车 → 跳 `/media/library?libraryId=&keyword=…`，内容页搜索框带出该词且列表已过滤；清空关键词再回车 → 只带 `libraryId`。
3. 「全部影片」按钮 → 内容页标题为「全部影片」、摘要只有「共 N 部」（没有「K 个资料库」、没有「已刮削 M 部」）；点内容页页头左侧返回按钮回首页，直接以 URL 打开该页时点返回落到 `/media`。
4. 点首页的资料库卡片 → 跳 `/media/library?libraryId=<id>`，标题是库名，列表只剩该库影片；摘要「共 N 部」随搜索 / 排序后的可见数量变化（不是整墙口径）。
5. 资料库卡片封面：给库内最近的 4 个影片刮出封面后回首页，卡片应显示四宫格；不足 4 张按实际张数排；一张都没有时显示文字占位。
6. 新建资料库的媒体目录：点「选择目录」必须弹出**存储内的目录**对话框（只列目录、有面包屑与「上级目录」、可回连接根），选中后回填的是**连接内路径**；未选存储时按钮禁用并提示「请先选择存储」；选完保存后抽屉里该行显示「存储名 · 目录」。
7. 类型锁定：新建资料库时类型可选（当前只有「影视」）；保存后重新打开编辑抽屉，类型下拉应为禁用状态（「类型创建后不可修改」）。
8. 目录重叠：同一个库内加两条相同目录 → 保存报「存在重复的根目录，请合并后再保存」（不发请求）；把库 A 的目录设成库 B 目录的子目录（或反过来）→ 保存报「媒体目录与资料库「B」的 X 重叠，请改用不重叠的目录」。
9. 后缀设置：在「设置 → 资料库」里把 `mp4` 从「影视媒体后缀」删掉，重新扫描该库 → `.mp4` 文件不再入库（墙上消失）；清空后缀清单失焦 → 提示「至少要保留一个后缀，已回落默认值」。
10. 空刮削器：把某库的刮削器全部取消勾选（在列表里逐项点掉，或搜索后逐项取消）后保存 → 抽屉里该行标签显示「不刮削」且「刮削」按钮禁用（悬停提示「该资料库未配置刮削器，不执行刮削」）；点「扫描」仍能正常扫描，扫描完成后提示「未自动刮削：该资料库未配置刮削器，已跳过刮削」，墙面照常更新。
11. 点「扫描」：抽屉顶部出现扫描条（已遍历目录数、索引文件数、当前目录），期间所有行动作禁用；完成后「影片 N 部」「上次扫描」更新，`skippedDirs` / 截顶会在提示里以中文说明。
12. 扫描期间再点一次「扫描」（或另一个库的「扫描」）→ 报「已有扫描任务在运行，请稍候」；点「取消扫描」→ 返回「扫描已取消」，且**本次不做清理、`上次扫描` 不变**。
13. 自动刮削四种跳过原因：关掉「刮削设置 → 扫描后自动刮削」→「设置中已关闭「扫描后自动刮削」」；空刮削器 →「该资料库未配置刮削器，已跳过刮削」；没有未刮削影片 →「没有待刮削的影片」；已有任务在跑 →「已有刮削任务在运行，可稍后手动刮削」。
14. 做过扫描 / 刮削后进内容页：该库目录下的视频都应上墙，没刮过刮削的卡片显示文件名占位（**没有「未刮削」角标**，摘要里也没有「已刮削 M 部」）；卡片角标显示资料库名，存储被删时退化成「存储已删除」而不报错。
15. 刮削成功后刷新：卡片标题变成插件标题、封面出现（**角标不再是「已刮削」**，本轮已去掉这套分类）。
16. 在资料库表单里开启「移动文件」并填写「目标目录」，再刮削一次：移动后的视频仍能播放、标题与封面不丢（`updateSourcePath` 就地更新了 `media_source.path`，媒体源 id 没变），详情页的「所在目录」显示新位置。
17. 从磁盘删掉一个视频后到资料库抽屉点「扫描」：扫描完成后对应卡片从墙上消失（本轮没有文件系统监控，只有扫描会清理）。
18. 内容页搜索框输入番号 / 标题 / 文件名片段实时过滤（不需要回车）；切排序三项顺序变化（**默认「按磁盘时间」最新在前**，另有「按标题」「按体积」）。
19. 在抽屉里删除一个资料库：确认文案说明只删配置与库内影片记录，删完该库从首页横排与内容页消失；磁盘文件都还在。
20. 点卡片进入详情页：地址栏变成 `#/media/detail?itemId=…`，侧栏仍高亮「影视墙」，左上角返回按钮能回到内容页；把 `itemId` 手动删掉再刷新，应显示「地址里缺少影片参数，请从影视墙点进来」而不是白屏。
21. 播放：封面出现后点播放能起播；拖进度条能跳、暂停 / 继续 / 倍速 / 音量 / 全屏 / 画中画正常；**拖到影片中间位置能立刻出画**说明 Range 生效（本机、WebDAV、SMB 三种数据源都要过一遍，SMB 依赖 `patches/@awo00+smb2+1.1.1.patch`）。**再把某个 `mp4` 在文件管理器里挪到库里别的目录（不重扫）**，回详情页仍应能起播，日志里有 info「索引路径失效，已按文件名找回：<旧> → <新>」。
22. 播放中途切走 / 关掉页面，再回来看日志：不应出现重复的资源读取失败记录（说明被取消的流已经 `destroy()`）。
23. 详情页在「更多」里点「重新读取」前先把文件从磁盘删掉：提示「索引里没有这个视频，磁盘上可能已被删除」（或资源读取失败），界面不崩；页面此时没有详情，但「更多」仍在，菜单里只剩「重新读取」可用作重试。
24. 同目录没有 NFO：NFO 块给出「同目录没有可用的 NFO…」提示，播放器与磁盘事实照常显示。
25. 开启 NSFW 保护并把数据源标记 NSFW：列表封面显示遮罩；点进详情页后播放器显示「内容已隐藏，点击播放」，点击后撤遮罩并起播。
26. 缩放窗口宽度：首页资料库横排与两排横向滚动正常（卡片不压缩），内容页网格列数自适应，详情页播放器按 16:9 等比缩放。
27. **播放失败兜底 + 路径自愈**：把一个已入库影片的**文件名改掉**（或真删掉）后直接进详情页（不重扫）→ 播放器位置不再是黑屏，而是显示该影片封面（通常是快照）+「视频读不出来……也可以在影视墙里对资料库重新扫描一次」；把文件放回去重新进页面 → 正常起播、兜底层消失。只是**挪到别的目录**（同名同大小）时不该看到兜底，见第 21 条的自愈。
28. **还原刮削前**：进一个已刮削影片的详情页 → 封面图右上角的「更多」里应有「还原刮削前」（详情没读到时「更多」整枚不显示，菜单项在读取 / 还原中禁用）；展开点它 → 二次确认写明「清空刮削数据 + 删磁盘 NFO 与刮削下载的图片 / 预告片 + 视频改回原名并搬回原位，原位置有同名文件时不覆盖，不自动重刮」，点「取消」什么都不发生。确认后：标题回到**刮削前的原始文件名**、简介 / 分类 / 封面 / 参演名单消失，`movie.nfo` / `<文件名>.nfo` 与刮削下载的图片 / 预告片被删掉，本地沿用的图片搬回原文件名，视频回到刮削前的位置与文件名（被搬进 `<根>/<base>/` 的应搬回原目录，空掉的影片文件夹一并删掉），演员本人档案仍在，提示形如「已清除刮削数据，视频已改回原文件名并移回原位置，删掉 1 个 NFO 文件」。
29. **没有记录的旧数据**：把 NFO 里的 `<originalfilename>` / `<originaldirectory>` 标签删掉（模拟旧版本刮削）再点「还原刮削前」→ 数据照样清干净、NFO 删掉，视频保持当前位置，提示里带「视频保持当前位置（NFO 里没有可用的还原记录，或原位置已被占用）」。
30. 还原后**不自动重刮**：还原完详情页不应自己发起刮削；此时到资料库抽屉点「刮削」，这条影片应像没刮过一样重新进入队列（`scrapedAt === 0`），刮完标题 / 封面 / 演员回来。
31. 清不掉时保持原样：把该影片所在目录设成只读（或让连接离线、删掉连接）再点「还原刮削前」→ 提示「磁盘上的 NFO 没有删除（原因），刮削数据保持不变」，库内标题 / 封面 / 演员仍在（不允许出现「库清了、NFO 还在」的半成品状态）。
32. 详情页版式：进一个已刮削且刮到背景图 / 剧照的影片 → **没有页头横条**，顶部只有一条**吸顶**的悬浮条（左「返回」圆钮、右「更多」，点「更多」弹出「重新读取 / 还原刮削前」），**不显示页头标题**；往下滚时这条**留在顶部、不跟着滚走**，一旦头部那个大标题滚出视野，它就淡入成一抹半透明横幅——毛玻璃底 + 单行省略号的标题（长标题末尾截断成「…」、宽度被挤时也不换行）+ 收成圆形的「更多」（与返回同形），滚回顶部再淡出、露出压在封面图上的返回与「更多」；横幅显形后点「返回」/「更多」都应正常响应（条子本身不吃事件，但两枚按钮要能点）；头部是通栏背景大图铺到窗口左右边缘，标题（有原名时带大写副标题）**完整可见、不被图片盖住任何一行**，标题压在图片下缘的渐隐区里，然后一行「播放」按钮 + 右侧 `/` 分隔的要点行 + 标签；要点行只出现**有值**的项（未刮削的影片不应出现一排「—」）；正文各块之间**不应出现带边框的卡片或横条**；头部图片带的底边与页面**不应有色差或硬边**（渐隐必须落到内容面板底色上，不能横切标题文字）；点头部「播放」只把播放器滚进视野，**不自动起播**；页面滚到底时最下面的演员条不被裁掉（本页自己是滚动容器）；滚到播放器那一段时悬浮条仍压在播放器上面（视频本体、控制条、设置菜单、提示气泡一个都不该盖住它），点播放器的「网页全屏」后反过来——视频铺满窗口、悬浮条被它盖住、页面里的封面与剧照也不该在视频上透出来，退出全屏恢复。
33. 剧情简介：NFO 里有简介时单独成一块（可选中复制）；没写简介时这块整块不出现；NFO 元信息块里**不应再有简介输入框**。
34. 剧照墙：有多张剧照时显示「剧照（N）」网格（主图 / 缩略图与头部实际用到的那张不在墙上，总数与网格数一致），点任意一张打开大图浏览，翻页 / 左右切换正常（`v-model:index` 生效），大图浏览里**没有下载按钮**；一张剧照都没有时整块不渲染。
35. 封面兜底：找一部只刮到竖版 `primary` 封面、没有任何背景图 / 横幅 / 剧照的影片 → 头部应是这张封面模糊放大铺满（不出现被裁成一条的清晰竖图），标题块下方另有一张 168×238 的清晰封面 + 标题 + 「番号 · 体积」。
36. 头部选图：找一部同时有 `thumb.jpg`（官方横图）与 `extrafanart/fanartN.jpg`（竖版剧照）的影片 → 头部应是那张 `thumb`；只有竖版 `backdrop` 的影片 → 头部走模糊底图（竖图不应被裁成一条）。
37. 窄窗口：把窗口拉窄 → 两栏信息（NFO 元信息 / 磁盘上的事实）叠成一栏，头部标题 / 要点行 / 标签自动换行不溢出，封面与剧照网格自适应。
38. NSFW 保护命中时进详情页：头部先显示**模糊**的背景大图 + 一枚「点击查看原图」，点一下变清晰（点过之后不再回到模糊）；头部下方那张封面是遮罩状态、要点行与标题仍在（标题来自索引，不算敏感画面）；剧照墙每张都要点一下才显示；从详情页切到另一部影片（同路由换 query）时头部的「已点开」状态不能带过去。

## 9. 限制与后续

- 整墙一次全量拉取，没有分页 / 虚拟滚动：视频数量很大（数千）时首屏渲染会变慢，后续按需再加分页或虚拟列表；首页两排只取前 24 条（推荐排是均匀取样，不是随机）。
- 内容页没有库下拉筛选：换库要回首页点卡片或改地址栏，交互上比旧版「一个下拉切库」多一步。
- 播放是「直接放磁盘上的原文件」：不做转码、不做字幕与外挂音轨、**不记忆播放进度**（本轮明确不做播放历史，所以既没有「继续观看」，详情页也总是从头开始），多版本 / 多线路切换没有入口。
- **不支持 MPEG-TS 封装**：内置播放器就是 Chromium 的 `<video>`，桌面版不解 MPEG-TS（`.ts` / `.m2ts`，或扩展名被写成 `.mp4` 的 TS 流——`ffprobe` 报 `mpegts`、文件头 `47 40 11 10`），改 `Content-Type` 也没用（解封装器只嗅探字节流）。这类文件播放时必然落到 §4 的 `fallbackText` 兜底层，**本版本不做转封装**，只能先用 `ffmpeg -i 原文件 -c copy -movflags +faststart 新文件.mp4` 转成真 MP4 再看。扫描是按扩展名判 MIME 的（`mediaIndexer` 用 `guessMimeType`），所以库里这类文件的 `mime` 会记成 `video/mp4`，与实际封装不符。
- 远端（WebDAV / SMB）视频按区间实时读，不再整文件落本机缓存：好处是点开即播、不占磁盘，代价是每次拖动都要向远端重新要数据，网络差时会有缓冲等待；后续若要顺滑可以加一小段本地分片缓存。
- 没有「重新配对」这一步：整墙直接读条目与媒体源，刮削成功即写库，不需要重建索引；磁盘上消失的文件要靠资料库抽屉的「扫描」清理（本轮没有文件系统监控）。**唯一例外**是播放期的路径自愈（§4）：同名同大小、只是被挪了目录的视频能在起播时自己找回，改名 / 删除仍要重扫。
- 封面只认两级：条目自己的 `primary` 图片，以及**父目录条目**的 `primary` 图片（扫描时把目录级 `poster` / `cover` / `folder` 挂在目录条目上）。旧版按文件名在索引里找封面的「同目录产出」兜底已随资源索引删除；一个目录里有多个视频（例如一季剧集）时会共用父目录的封面。详情页的背景大图与剧照墙同源，也只看这两级（`detailImagesOf()`），不做全库图集；剧照墙只做「点开大图 + 左右切换」，没有缩放 / 旋转 / 幻灯片 / 下载（`storage://` 是私有协议地址，浏览器下载不了）。
- **多目录资料库的刮削一次只跑一组**：任务表只支持一个「连接 + 目录」，所以一次「刮削」只处理条目最多的那一组目录，其余条目保持 `scrapedAt = 0`，要再点一次「刮削」才会轮到下一组（详见[资料库 · 已知限制](../media/01-media-library.md)）。
- 删除资料库**只删配置与库内影片记录**，磁盘文件一个都不动；反过来，删除存储会级联删掉它名下的资料库（见[存储页](./02-storage-page.md)），刮削记录同样保留，重新建库扫描后会重新配上。
- **归属是条目上的外键**，不再是取数时按「最长前缀」现算：改资料库的媒体目录后，需要重新扫描才会把影片划到新的库里（不再是一刷新就自动改归属）。
- 「清除 NFO」（按钮文案「还原刮削前」）只做单条影片，没有批量 / 整库还原，还原完也不自动重刮。
- 还原依赖 NFO 里的 `<originalfilename>` / `<originaldirectory>` / `<plantedfile>` 记录：旧版本刮削、或第三方工具写的 NFO 没有这些标签，只能清数据 + 删 NFO，视频留在原地（视频记录在影片目录里，目录也不会被删）。
- 还原是**尽力而为、不回滚**：视频目标已存在就保持现状（不覆盖、不删），某个图片 / 预告片删不掉只跳过，都只体现在返回值与提示文案里。
- `movie.nfo` 是目录级候选，多部影片共用时会被一并删掉（见 §4）。
