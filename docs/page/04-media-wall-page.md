# 影视墙页面

## 1. 定位与入口

影视墙是刮削成果的**浏览与播放入口**，这一轮按 Jellyfin 的「库 → 条目 → 详情」形态拆成了**首页（资料库横排 + 三排影片）**与**内容页（单库 / 全部影片）**两级，再加原有的**影片详情页**：

| 路由 | 名称 | 页面 | 说明 |
| --- | --- | --- | --- |
| `/media` | 影视墙 | `src/renderer/src/windows/main/pages/media/home/MediaHomePage.vue` | 首页：资料库横排 + 最近添加 / 待刮削 / 推荐三排 |
| `/media/library` | 影视墙资料库 | `src/renderer/src/windows/main/pages/media/wall/MediaWallPage.vue` | 内容页：query `libraryId`（**空串 = 全部影片**）+ 可选 `keyword` |
| `/media/detail` | 影视墙详情 | `src/renderer/src/windows/main/pages/media/detail/MediaDetailPage.vue` | 详情页：query 只带 `itemId` |

- 侧栏一级菜单「影视墙」（在「概览」下方），菜单项用 `match: 'prefix'` 判定选中，所以停在内容页 / 详情页时侧栏仍高亮「影视墙」（`src/renderer/src/windows/main/router.ts`、`pages/app/AppSide.vue`）。
- **本轮没有播放历史**：所以首页第二屏里没有「继续观看」，只有最近添加 / 待刮削 / 推荐三排。
- 内容口径：**以磁盘为准**。墙面主体是资料库扫描出来的影片条目，未刮削的视频也会上墙（文件名占位），磁盘上被删掉的视频会在下次扫描后从墙上消失。
- 资料库范围：所有数据源（本机 / WebDAV / SMB）聚合成一堵墙，每张卡片带**资料库角标**（`item.libraryName`）。**每个影片都归属于某个资料库**（归属是条目上的真实外键，不再按路径最长前缀猜），因此没有「未归入资料库」这一档。
- 取数：`@/api` 的 `mediaApi`（`home()` / `wall()` / `detail()`），主进程实现见 `src/main/src/modules/media/mediaWall.ts`。

## 2. 首页（`home/MediaHomePage.vue`）

`PageLayout title="影视墙"`，description 写明「把磁盘上的视频收进资料库，刮削后按最近添加 / 待刮削 / 推荐浏览」，`#extra` 只放「刷新」。

**工具条**：搜索 `t-input`（placeholder「搜索标题、番号或文件名，回车到影片列表」，`@enter` 触发）→「资料库」按钮（打开资料库抽屉）→「全部影片」按钮（跳 `/media/library?libraryId=''`）→ 摘要

| 元素 | 行为 |
| --- | --- |
| 搜索框 | 回车时 `trim()`；关键词非空才带 `keyword`，跳 `{ name: '影视墙资料库', query: { libraryId: '', keyword } }`；空串只跳 `libraryId: ''` |
| 「资料库」按钮 | `openLibraryDrawer({ onChanged: load })`：抽屉里的新建 / 编辑 / 删除 / 扫描 / 刮削完成后重拉首页 |
| 「全部影片」按钮 | 跳内容页并清空 `libraryId` |
| 摘要 | `共 N 部 · 已刮削 M 部 · K 个资料库`，`indexedAt > 0` 时补 ` · 索引更新于 …` |

**区块一：资料库横排**。行头显示「N 个」；有库时横向滚动排 `LibraryCard.vue`，没有库时 `t-empty`「还没有资料库 / 点上方「资料库」新建资料库并扫描，影片会自动出现在这里」。

**区块二~四：三排影片**，由主进程 `loadMediaHome()` 决定（渲染层只按 `row.items.length > 0` 决定画不画，**整排为空则整排不渲染**）：

| 排 id | 标题 | 取数规则 |
| --- | --- | --- |
| `recent` | 最近添加 | 整个墙面按 `dateAdded > 0 ? dateAdded : modifiedAt` 倒序，取前 `MEDIA_HOME_ROW_LIMIT` 条 |
| `pending` | 待刮削 | 未刮削（`scraped === false`）的条目，取前 `MEDIA_HOME_ROW_LIMIT` 条 |
| `discover` | 推荐 | 对**整份**列表按步长 `items.length / limit` 均匀取样（`spreadSample`），避免与「最近添加」整排重复 |

`MEDIA_HOME_ROW_LIMIT = 24`（`src/common/types/media/index.ts`）。每排行头 = 标题 + 「N 部」，卡片复用 `pages/media/components/MediaWallCard.vue`，`connection` 由 `useFileConnections().connections` 按 `item.connectionId` 匹配。

**资料库卡片**（`home/components/LibraryCard.vue`）：props `{ library: MediaLibrarySummary }`；封面是 `library.coverUrls` 的**四宫格**（`.lib-cover` 网格 `repeat(2, 1fr)`、`aspect-ratio: 16/9`），没有封面时显示 `CollectionIcon`；标题行 = 库名 + 类型标签（`libraryTypeLabel(library.type)`）；meta「影片 N 部 · 已刮削 M 部」；点击跳 `{ name: '影视墙资料库', query: { libraryId: library.id } }`。

`coverUrls` 由主进程 `libraryStore.coverUrlsOf()` 生成：取该库**最近添加且有封面**的前 `COVER_URL_LIMIT = 4` 张，拼成 `storage://` 地址；为空数组时卡片退化成文字封面。首页不自己找封面。

## 3. 内容页（`wall/MediaWallPage.vue`）

内容页容器是 `SubPageLayout`（`:title="pageTitle"`、`fallback="/media"`），返回图标按钮在标题左侧，`#extra` 只放「刷新」。

- **标题**：`libraryId` 为空 → 「全部影片」；否则优先显示库名（`libraryApi.list()` 里查到的名字），查不到时兜底「资料库」。
- **内容工具条**（`.wall-toolbar`）：只剩搜索 / 排序 / 「资料库」按钮 / 摘要，不再有「返回」按钮与重复的标题；返回按钮由页头提供（`SubPageLayout` 的 `#leading` 里那枚 `variant="text" shape="square"` + `ChevronLeftIcon`）。
- **搜索**：`t-input`（width 260，placeholder「搜索标题、番号或文件名」，`v-model="keyword"`）——**输入即过滤，不回车跳转**；初值取 `route.query.keyword`（首页搜索框带过来的词）。
- **排序**：`t-select`（width 180），四个选项来自 `useMediaWall` 的 `SORT_OPTIONS`：

| 值 | 文案 | 口径 |
| --- | --- | --- |
| `scraped` | 已刮削优先 | 默认；已刮削在前，组内按 `scrapedAt` 倒序 |
| `title` | 按标题 | `localeCompare('zh-Hans-CN')` |
| `size` | 按体积 | `size` 倒序 |
| `modified` | 按磁盘时间 | `modifiedAt` 倒序 |

- **资料库按钮**：打开抽屉，`onChanged` 里重查库名并重拉数据。
- **摘要**：`共 N 部 · 已刮削 M 部`（`N = visible.length`、`M = visible` 里已刮削的数量，**都是当前搜索 + 排序后的可见口径，不是整墙口径**），`indexedAt > 0` 时补 ` · 索引更新于 …`。
- **没有资料库下拉筛选**：库范围完全由 `query.libraryId` 决定，页内不提供「全部 / 单个库」切换（旧版的 `MEDIA_LIBRARY_ALL` 哨兵与库下拉已随本轮改版去除）。要换库请回首页点库卡片，或直接改地址栏的 `libraryId`。
- 网格 `repeat(auto-fill, minmax(180px, 1fr))`，卡片仍是 `MediaWallCard.vue`；加载 `t-loading`、失败 `t-alert`、空态 `t-empty`（全部影片时「墙上还没有影片」，单库时「这个资料库还没有影片」）。
- `libraryId` 用 `watch(() => route.query.libraryId)` 跟随地址变化；`useMediaWall` 内部的 `watch(..., { immediate: true })` 负责首次取数，页面 `onMounted` 只补一次连接列表与库名。

## 4. 数据流（主进程 `src/main/src/modules/media/mediaWall.ts`）

**整墙**（`media:wall`）：`loadMediaWall({ libraryId })` —— `libraryId` 为空串时遍历 `listLibraries()`，否则只取 `getLibrary(libraryId)`（库不存在抛 `notFound`「资料库不存在」）。每个库取 `listMovieItems(libraryId)`——**只列 `type='movie'` 的条目**，不属于任何资料库的影片不会出现在墙上；条目没有主源（已被清理）时跳过。`indexedAt = maxSourceIndexedAt()`（最新媒体源的 `indexed_at`），`libraries = listSummaries()`（带 `videoCount` / `scrapedCount` / `coverUrls`，**0 个视频的库也会出现**），返回 `MediaWallResult{ items, total, scrapedCount, indexedAt, libraries }`。整墙一次拉全，搜索 / 排序全在渲染层做，主进程不复制排序规则（首页三排的取样在**主进程**做，见 §2）。

**详情**（`media:detail`）：`loadMediaDetail({ itemId })`——空 id 报 `invalidArgument`「缺少影片 ID」；条目不存在、不是 `movie` 条目、或没有主源时报 `notFound`（「索引里没有这个视频，磁盘上可能已被删除」）。返回 `MediaDetailResult{ item, meta, nfoPath }`，`item` 与墙上同一套卡片数据（含 `playUrl`），详情页不需要再拼任何地址。

- NFO 候选顺序 `movie.nfo` → `{文件名}.nfo`（文件名取主源 `name`），路径为空或读失败 / 解析不出内容都算「没有 NFO」，不报错；
- NFO 解析用三端共享的纯函数 `parseNfoXml`（`@common/types/media/nfo.ts`），字段口径与写入侧 `buildNfoXml` 对齐；`runtime` 转成分钟。

**卡片字段**（`toWallItem()`）：`itemId` / `libraryId` / `libraryName` / `nsfwProtected`（= 所属库的 `nsfwProtection`）/ `connectionId` / `path` / `dirPath` / `name` / `num` / `title`（刮削过用条目 `name`，否则用去掉扩展名的 `name`）/ `coverUrl` / `playUrl` / `scraped` / `scrapedAt` / `dateAdded` / `pluginId`（条目上的 `scraperId`）/ `size` / `modifiedAt`。

- `scraped`：跑过刮削（`scrapedAt > 0`）**或**同目录有 NFO（`hasNfo > 0`）**或**有图片（条目自己 / 父目录条目有图片）任一命中，与库摘要的 `scrapedCount`（`countScrapedMovieItems`）同口径——**磁盘上已有产出就算已刮削**，不会因为没跑过刮削流程而显示「未刮削」。
- 刮削队列是另一个口径：`listPendingMovieItems` 仍只取 `scrapedAt === 0`，所以「有 NFO / 有封面但没真刮过」的条目照样能被「刮削本库」选中重刮。

- 封面 `coverUrl`：按 `MEDIA_COVER_IMAGE_TYPE_ORDER`（主图 → 缩略图 → 背景图 → 剧照 → 其他）逐类找，同一类里先条目自己的图片、再**父目录条目**的图片，取到第一张就返回。目录级 `poster` / `cover` / `folder` 在扫描时挂在目录条目上，刮削器写的 `[基名-]thumb.jpg`、`extrafanart/stillN.jpg` 也已在扫描时入库，所以「有快照没封面」会自动回退到快照。地址 `buildMediaUrl(image.connectionId, image.id, 文件名)`；一张都没有则空串（卡片显示占位）。
- 播放 `playUrl`：`buildMediaUrl(source.connectionId, source.id, source.name)`——用的是**媒体源 id**，渲染层因此拿不到磁盘路径。

**播放**（`storage://` 协议 + 自建 Range 服务端，`src/main/src/modules/media/mediaProtocol.ts`）：

- scheme 名仍是 `storage`（CSP 不变），地址只认 ID：`storage://{连接ID}/{媒体ID}/{文件名}`。
- `resolveTarget(connectionId, mediaId)` 先查 `media_source`（kind 由扩展名 / MIME 判定，视频走流式），再查 `media_image`；连接对不上或都查不到返回 404。
- 视频请求不走 `net.fetch`，而是 `handleVideoRequest`：先 `client.stat(path)` 取**权威**大小与 MIME（索引可能过期，而 206 的 `Content-Range` 必须和真实大小一致），再解析单区间 Range：
  - 无 `Range` → `200` + `Accept-Ranges: bytes` + `Content-Length`；
  - 有 `Range` → `206` + `Content-Range: bytes s-e/total`；
  - `start` 越界 → `416` + `Content-Range: bytes */total`；
  - 支持 `bytes=start-end` / `bytes=start-` / `bytes=-suffix` 尾部探测（非 faststart 的 MP4 要靠最后一种去文件尾读 moov）；多区间与非法值退化成 200 全量，不做 `multipart/byteranges`。
- 取值路径：本机连接（`protocol === 'local'`）直读；远端视频 / 图片先落到 `~/.vault-scrape/cache/media/<媒体ID>`（总量上限 512MB，超了按 mtime 由旧到新剪到 80%）再读；`imageSaveMode='appdata'` 的图片走伪连接 `appdata`，协议层复核目标路径确实在 `~/.vault-scrape/media/images` 之下后用 `net.fetch(pathToFileURL)` 直读。
- 区间读与流适配：`FileClient.readRange(path, start, end)`（**闭区间，含 end**）返回 node 流，再用 `modules/file/streamToWeb.ts` 的 `toWebStream` 适配成 `Response` 的 body（队列积压时 `pause()` 源流、`pull` 时 `resume()`，下游 `cancel` 时 `destroy()` 源流）。
- 任何异常都记一条去重 warn（同一媒体 60s 内只记一条）并返回 404，不在渲染层抛异常。
- 渲染层 `MediaPlayer.vue` 监听 artplayer 的 `video:error`：视频读不出来（文件被移走 / 删除，或封装、编码放不了）时不再留一块黑屏，而是在播放器位置盖一层 `poster`（就是上面的 `coverUrl`，通常已回退到快照）加一句说明文案；换片（`url` 变化）或重新起播时清掉这个状态，本版本不做转码。
- 协议在 app ready 之前由 `registerMediaScheme()` 登记为特权 scheme（`standard` / `secure` / `supportFetchAPI` / `stream`），ready 之后、开窗之前 `registerMediaProtocol()` 接管（见 `src/main/index.ts`）。

## 5. 资料库抽屉与表单

资料库 = 「一个名称 + 一个类型 + 一组媒体目录（可跨存储）+ 自己的刮削器（可为空） + 库级选项」，模型与主进程契约见[资料库](../media/01-media-library.md)。影视墙页不承担资料库的配置细节，只做两件事：在首页 / 内容页用它取数，用抽屉维护它。

**抽屉**（`openLibraryDrawer({ onChanged })`；外壳 `library/components/LibraryDrawer.tsx` → `DrawerPlugin`，宽 720px，无 footer）——内容 `LibraryDrawerContent.vue`：

- 头部：「新建资料库」按钮 + 「刷新」按钮 + 口径提示「资料库 = 多个媒体目录 + 自己的刮削器，影片按库归集到影视墙」。
- 扫描条（`scanning` 为真时显示在列表上方，**不是行内**）：`t-loading` + 「正在扫描资料库…」+ 「已遍历 N 个目录，索引 M 个文件」+ 当前目录 + 「取消扫描」。
- 每行是 `LibraryListItem.vue`：库名 + 类型标签（`libraryTypeLabel`）+ 「N 个目录」+ 刮削器标签（`scrapers.length > 0` 显示「N 个刮削器」，否则显示「**不刮削**」）+ NSFW 标签；下面逐条目录显示「存储名 · 目录」（本地存储显示本机路径，连接被删显示「存储已删除」）；再下面「影片 N 部 · 已刮削 M 部」（计数来自影视墙读模型，与墙面同口径）+ 上次扫描 / 上次刮削时间；行右四个动作「扫描」「刮削」「编辑」「删除」。
- 空刮削器不再是错误状态：「刮削」按钮禁用并 `t-tooltip` 说明「该资料库未配置刮削器，不执行刮削」；扫描期间所有行的动作都禁用。
- 「扫描」成功提示「「名称」扫描完成：索引 X 个文件（视频 Y 个），移除 Z 个，待刮削 W 个」；自动刮削启动时提示「已自动开始刮削「名称」：N 个文件，进度见工作台」，被跳过时提示「未自动刮削：原因」。「刮削」成功提示「已为「名称」排队 N 个文件，进度见工作台任务列表」。
- **删除只删配置与库内媒体行**：确认文案原文「将删除资料库「X」的配置与库内影片记录，磁盘文件不会被删除。一条媒体目录只属于一个资料库，删除后这些影片会从影视墙上消失。」任何改动通过 `onChanged` 让页面重新 `load()`。

**表单抽屉**（`openLibraryFormDrawer({ library?, connections, onSaved })`；外壳 `library/components/LibraryFormDrawer.tsx` → `DrawerPlugin`，宽 800px，从右侧滑出；内容 `LibraryFormContent.vue` 只留字段，状态机抽在 `library/composables/useLibraryForm.ts`，底部 footer 常驻「取消 / 保存」，保存按钮的 `loading` 取自内容组件 `defineExpose` 的 `saving`）：

| 字段 | 契约 |
| --- | --- |
| 名称 | 必填，空则「请填写资料库名称」 |
| 类型 | `t-select`，选项来自 `LIBRARY_TYPES` / `LIBRARY_TYPE_LABELS`；**新建可选，编辑态 disabled**（说明文案「类型创建后不可修改」），理由：条目已按原类型后缀索引，中途换类型会留下孤儿条目 |
| 媒体目录 | 多行编辑器 `LibraryDirectoryEditor.vue`：每行「存储下拉 + 选择目录 + 路径回显」，未选存储时选择按钮禁用并 `t-tooltip` 提示「请先选择存储」；换存储会清空该行路径；只剩一行时删除按钮禁用；底部「添加媒体目录」+ 说明「一个资料库可以包含多个存储上的多个目录，扫描时会全部递归遍历」 |
| 选择目录 | 走资料库自己的 `RemoteDirDialog.tsx` + `RemoteDirPickerContent.vue`（`fileApi.list({ connectionId, path })`，**只列目录**，带面包屑与「上级目录」，路径全程是**连接内路径**（`/` = 连接根），点「选择当前目录」把当前路径回调回该行）；弹窗 footer 左侧跟着内容组件 `defineExpose` 出来的当前路径、右侧是「取消 / 选择当前目录」（契约见 `src/renderer/src/utils/modal/ModalContent.ts`）；**不复用本机目录选择器** |
| 刮削器 | `t-transfer` 穿梭框（左「可用刮削器」/ 右「已选刮削器」，带搜索框；`TTransfer` 已手工补进 `components.d.ts`），候选项来自 `useScraperOptions`（`pluginApi.list()` 过滤 `enabled && loadError === ''`）；说明「不选择刮削器表示这个资料库不刮削，扫描后不会自动刮削」；已保存但当前不可用的 id 不进候选，会被补进穿梭框数据、在右侧标注「（已失效）」显示，移动条目时不会被静默清空；**新建时默认勾选内置 `R18_OFFLINE_PLUGIN_ID`（`r18-offline`），插件不可用时保持不勾** |
| 库级选项 | NSFW 保护 / 写入 NFO / 重命名文件 / 移动文件（**开启时才显示「目标目录」输入**，关闭时存空串）/ 图片保存位置（`LIBRARY_IMAGE_SAVE_MODE_LABELS`） |

- 提交前校验顺序：名称 → 至少一行媒体目录 → 每行都选了存储 → 同库内不出现重复目录 → 每行都选了目录；两条兜底文案「请先到「存储」页新建数据源」「请为每个媒体目录选择存储」，重复目录报「存在重复的根目录，请合并后再保存」。
- 提交走 `libraryApi.save`（新建不带 `id`），失败经 `LibraryResult` 回显中文原因（跨库目录重叠的报错由主进程给，见[资料库 · 目录重叠规则](../media/01-media-library.md)）。
- 新建时渲染层默认值：`type = 'movie'`、`writeNfo = true`、NSFW / 重命名 / 移动均关闭、`imageSaveMode = 'media'`。

## 6. 目录结构

```
src/renderer/src/windows/main/pages/media/
├── components/
│   └── MediaWallCard.vue                 # 首页与内容页共用的卡片：封面、资料库 / 番号角标、体积 / 时间
├── home/                                 # /media（首页）
│   ├── MediaHomePage.vue                 # 资料库横排 + 三排影片 + 工具条
│   ├── components/LibraryCard.vue        # 资料库卡片：coverUrls 四宫格 + 计数
│   └── composables/useMediaHome.ts       # 调 mediaApi.home()，持有 libraries / rows / 摘要
├── wall/                                 # /media/library（内容页）
│   ├── MediaWallPage.vue                 # 页头（`SubPageLayout` 返回 + 标题）+ 搜索 + 排序 + 摘要 + 网格
│   └── composables/useMediaWall.ts       # 取数、去重、搜索过滤与排序
├── detail/                               # /media/detail（详情页）
│   ├── MediaDetailPage.vue               # 播放器 + 磁盘事实 + NFO 元信息
│   ├── mediaDetailCells.ts               # 两块信息格的字段口径（纯函数）
│   ├── mediaPlayerI18n.ts                # artplayer 简体中文词条（官方语言包没有 zh-cn）
│   ├── composables/useMediaDetail.ts     # 从 query 取参、调 mediaApi.detail
│   └── components/{MediaPlayer,MediaFactGrid,MediaNfoBlock}.vue
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
- 原来页面私有的 `mediaUtils.ts` 已上移为 `src/renderer/src/utils/format.ts`（`formatSize` / `formatTime` / `formatDuration`，未知值统一显示「—」），引用点统一用 `@/utils/format`；工作台也在用同一份，所以不要再在页面里复制。
- 主进程侧：`src/main/src/modules/media/mediaWall.ts`（首页 / 整墙 / 详情 / 逐级浏览取数）、`mediaProtocol.ts`（`storage://` 协议与 Range 流式）、`mediaAppData.ts`（伪连接 `appdata` 与图片根目录）、`mediaIpc.ts`（IPC 注册）；preload 桥为 `src/preload/src/modules/media/{mediaChannels.ts,media.ts}`，渲染层出口 `src/renderer/src/api/media.ts`；资料库的主进程实现见[资料库](../media/01-media-library.md)。
- 本机路径与连接内路径互转仍走 `src/renderer/src/utils/remotePath.ts`（`toRemoteDir` / `toDisplayDir`）。

## 7. NSFW 保护

- 首页 / 内容页卡片：`MediaWallCard.vue` 用 `useNsfwProtection(computed(() => props.connection))` 取 `active`（全局开关 + 该存储的 `nsfw` 标记同时成立），再与 `item.nsfwProtected`（所属资料库的 `nsfwProtection`）取或：**任一命中即遮罩**，封面统一走 `@/components/SensitiveImage.vue`。资料库表单里的「NSFW 保护」因此既能强制遮罩本库内容，也不影响存储级标记对其它内容的作用。
- 首页的资料库卡片封面（`coverUrls`）同样走 `SensitiveImage`；库级 `nsfwProtection` 为真时也按敏感内容处理。
- 详情页**自己**拉一次连接列表（`useFileConnections().refresh()`），按 `detail.item.connectionId` 找到连接后再 `useNsfwProtection(connection)` 判定；不从列表页传保护快照，所以进详情页后立刻切换总开关，行为与列表页一致。
- 播放器在 `protect` 为真时盖一层不透明遮罩（`--td-bg-color-container`）+「内容已隐藏，点击播放」，点击后撤遮罩并 `art.play()`；详情页的大封面沿用 `SensitiveImage` 自己的遮罩。
- `SensitiveImage` 的遮罩容器带 `@click.stop`：在卡片上点「内容已隐藏，点击查看」只放行图片，不会顺带跳进详情页。
- `active` 依赖 `connections` 与模块级的总开关缓存，两者都到位才有遮罩。总开关由应用设置保存成功后的回调刷新（见[设置存储](../setting/01-setting-storage.md)）：在影视墙（或详情页）开着的时候去打开「应用设置 → NSFW 保护」，回来约 300ms 内遮罩应当直接出现，不需要刷新页面；反过来关掉开关，遮罩应立即消失。

## 8. 手工验证清单

按项目约定只跑 `yarn typecheck`，运行时行为手工验证：

1. 首页三排：扫过一个有影片的库后回首页，应能看到「资料库」横排与「最近添加 / 待刮削 / 推荐」三排，行头计数与实际卡片数一致；某一排为空时该排整块不渲染。
2. 首页搜索回车：输入完整关键词回车 → 跳 `/media/library?libraryId=&keyword=…`，内容页搜索框带出该词且列表已过滤；清空关键词再回车 → 只带 `libraryId`。
3. 「全部影片」按钮 → 内容页标题为「全部影片」、摘要只有「共 N 部 · 已刮削 M 部」（没有「K 个资料库」）；点内容页页头左侧返回按钮回首页，直接以 URL 打开该页时点返回落到 `/media`。
4. 点首页的资料库卡片 → 跳 `/media/library?libraryId=<id>`，标题是库名，列表只剩该库影片；摘要里的「已刮削 M 部」随搜索 / 排序后的可见数量变化（不是整墙口径）。
5. 资料库卡片封面：给库内最近的 4 个影片刮出封面后回首页，卡片应显示四宫格；不足 4 张按实际张数排；一张都没有时显示文字占位。
6. 新建资料库的媒体目录：点「选择目录」必须弹出**存储内的目录**对话框（只列目录、有面包屑与「上级目录」、可回连接根），选中后回填的是**连接内路径**；未选存储时按钮禁用并提示「请先选择存储」；选完保存后抽屉里该行显示「存储名 · 目录」。
7. 类型锁定：新建资料库时类型可选（当前只有「影视」）；保存后重新打开编辑抽屉，类型下拉应为禁用状态（「类型创建后不可修改」）。
8. 目录重叠：同一个库内加两条相同目录 → 保存报「存在重复的根目录，请合并后再保存」（不发请求）；把库 A 的目录设成库 B 目录的子目录（或反过来）→ 保存报「媒体目录与资料库「B」的 X 重叠，请改用不重叠的目录」。
9. 后缀设置：在「设置 → 资料库」里把 `mp4` 从「影视媒体后缀」删掉，重新扫描该库 → `.mp4` 文件不再入库（墙上消失）；清空后缀清单失焦 → 提示「至少要保留一个后缀，已回落默认值」。
10. 空刮削器：把某库的刮削器全部取消（把右侧「已选刮削器」全部移回左侧）后保存 → 抽屉里该行标签显示「不刮削」且「刮削」按钮禁用（悬停提示「该资料库未配置刮削器，不执行刮削」）；点「扫描」仍能正常扫描，扫描完成后提示「未自动刮削：该资料库未配置刮削器，已跳过刮削」，墙面照常更新。
11. 点「扫描」：抽屉顶部出现扫描条（已遍历目录数、索引文件数、当前目录），期间所有行动作禁用；完成后「影片 N 部」「上次扫描」更新，`skippedDirs` / 截顶会在提示里以中文说明。
12. 扫描期间再点一次「扫描」（或另一个库的「扫描」）→ 报「已有扫描任务在运行，请稍候」；点「取消扫描」→ 返回「扫描已取消」，且**本次不做清理、`上次扫描` 不变**。
13. 自动刮削四种跳过原因：关掉「刮削设置 → 扫描后自动刮削」→「设置中已关闭「扫描后自动刮削」」；空刮削器 →「该资料库未配置刮削器，已跳过刮削」；没有未刮削影片 →「没有待刮削的影片」；已有任务在跑 →「已有刮削任务在运行，可稍后手动刮削」。
14. 做过扫描 / 刮削后进内容页：该库目录下的视频都应上墙，未刮削的卡片显示文件名占位与「未刮削」角标；卡片角标显示资料库名，存储被删时退化成「存储已删除」而不报错。
15. 刮削成功后刷新：卡片标题变成插件标题、封面出现、角标变「已刮削」。
16. 在资料库表单里开启「移动文件」并填写「目标目录」，再刮削一次：移动后的视频仍能播放、标题与封面不丢（`updateSourcePath` 就地更新了 `media_source.path`，媒体源 id 没变），详情页的「所在目录」显示新位置。
17. 从磁盘删掉一个视频后到资料库抽屉点「扫描」：扫描完成后对应卡片从墙上消失（本轮没有文件系统监控，只有扫描会清理）。
18. 内容页搜索框输入番号 / 标题 / 文件名片段实时过滤（不需要回车）；切排序顺序变化（默认已刮削优先）。
19. 在抽屉里删除一个资料库：确认文案说明只删配置与库内影片记录，删完该库从首页横排与内容页消失；磁盘文件都还在。
20. 点卡片进入详情页：地址栏变成 `#/media/detail?itemId=…`，侧栏仍高亮「影视墙」，左上角返回按钮能回到内容页；把 `itemId` 手动删掉再刷新，应显示「地址里缺少影片参数，请从影视墙点进来」而不是白屏。
21. 播放：封面出现后点播放能起播；拖进度条能跳、暂停 / 继续 / 倍速 / 音量 / 全屏 / 画中画正常；**拖到影片中间位置能立刻出画**说明 Range 生效（本机、WebDAV、SMB 三种数据源都要过一遍，SMB 依赖 `patches/@awo00+smb2+1.1.1.patch`）。
22. 播放中途切走 / 关掉页面，再回来看日志：不应出现重复的资源读取失败记录（说明被取消的流已经 `destroy()`）。
23. 详情页点「重新读取」前先把文件从磁盘删掉：提示「索引里没有这个视频，磁盘上可能已被删除」（或资源读取失败），界面不崩。
24. 同目录没有 NFO：NFO 块给出「同目录没有可用的 NFO…」提示，播放器与磁盘事实照常显示。
25. 开启 NSFW 保护并把数据源标记 NSFW：列表封面显示遮罩；点进详情页后播放器显示「内容已隐藏，点击播放」，点击后撤遮罩并起播。
26. 缩放窗口宽度：首页资料库横排与三排横向滚动正常（卡片不压缩），内容页网格列数自适应，详情页播放器按 16:9 等比缩放。
27. **播放失败兜底**：把一个已入库影片的文件从磁盘移走 / 删掉后直接进详情页（不重扫）→ 播放器位置不再是黑屏，而是显示该影片封面（通常是快照）+「视频读不出来…」文案；把文件放回去重新进页面 → 正常起播、兜底层消失。

## 9. 限制与后续

- 整墙一次全量拉取，没有分页 / 虚拟滚动：视频数量很大（数千）时首屏渲染会变慢，后续按需再加分页或虚拟列表；首页三排只取前 24 条（推荐排是均匀取样，不是随机）。
- 内容页没有库下拉筛选：换库要回首页点卡片或改地址栏，交互上比旧版「一个下拉切库」多一步。
- 播放是「直接放磁盘上的原文件」：不做转码、不做字幕与外挂音轨、**不记忆播放进度**（本轮明确不做播放历史，所以既没有「继续观看」，详情页也总是从头开始），多版本 / 多线路切换没有入口。
- 远端（WebDAV / SMB）视频按区间实时读，不再整文件落本机缓存：好处是点开即播、不占磁盘，代价是每次拖动都要向远端重新要数据，网络差时会有缓冲等待；后续若要顺滑可以加一小段本地分片缓存。
- 没有「重新配对」这一步：整墙直接读条目与媒体源，刮削成功即写库，不需要重建索引；磁盘上消失的文件要靠资料库抽屉的「扫描」清理（本轮没有文件系统监控）。
- 封面只认两级：条目自己的 `primary` 图片，以及**父目录条目**的 `primary` 图片（扫描时把目录级 `poster` / `cover` / `folder` 挂在目录条目上）。旧版按文件名在索引里找封面的「同目录产出」兜底已随资源索引删除；一个目录里有多个视频（例如一季剧集）时会共用父目录的封面。
- **多目录资料库的刮削一次只跑一组**：任务表只支持一个「连接 + 目录」，所以一次「刮削」只处理条目最多的那一组目录，其余条目保持 `scrapedAt = 0`，要再点一次「刮削」才会轮到下一组（详见[资料库 · 已知限制](../media/01-media-library.md)）。
- 删除资料库**只删配置与库内影片记录**，磁盘文件一个都不动；反过来，删除存储会级联删掉它名下的资料库（见[存储页](./02-storage-page.md)），刮削记录同样保留，重新建库扫描后会重新配上。
- **归属是条目上的外键**，不再是取数时按「最长前缀」现算：改资料库的媒体目录后，需要重新扫描才会把影片划到新的库里（不再是一刷新就自动改归属）。
