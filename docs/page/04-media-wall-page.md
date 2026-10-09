# 影视墙页面

## 1. 定位与入口

影视墙是刮削成果的**浏览与播放入口**：把磁盘上的视频聚成一堵墙，点开某一张卡片进入**影片详情页**（播放 + 更细的信息）；刮削成果（刮削记录 + 同目录的 NFO / 封面）只用来补标题与封面。

- 侧栏一级菜单「影视墙」（在「概览」下方），路由 `/media`，懒加载 `MediaWallPage.vue`；菜单项用 `match: 'prefix'` 判定选中，所以停在详情页时侧栏仍高亮「影视墙」（`src/renderer/src/windows/main/router.ts`、`pages/app/AppSide.vue`）。
- 影片详情路由 `/media/detail`（name「影视墙详情」），懒加载 `pages/media/detail/MediaDetailPage.vue`；参数走 **query**（`connectionId` + `path`），刷新 / 重复进入都能还原，返回按钮由 `SubPageLayout` 提供（不要在 `#extra` 里再放一个）。
- 内容口径：**以磁盘为准**。墙面主体是资源索引（`resource` 表）里 `kind = 'video'` 的行，因此未刮削的视频也会上墙（文件名占位），磁盘上被删掉的视频会自动从墙上消失。
- 数据源范围：所有数据源（本机 / WebDAV / SMB）聚合成一堵墙，每张卡片有来源角标，顶部提供数据源筛选。
- 取数：`@/api` 的 `mediaApi`（`wall()` / `detail()`），主进程实现见 `src/main/src/modules/media/`。

## 2. 数据流

**整墙**（`media:wall`）：`loadMediaWall()` = `listResourceByKind('video')` + `maxResourceIndexedAt()` + 一张刮削索引 + 一张同目录产出索引，返回 `MediaWallResult{ items, total, scrapedCount, indexedAt }`。整墙一次拉全，搜索 / 数据源筛选 / 排序全在渲染层做，主进程不复制排序规则。

刮削配对（`src/main/src/modules/media/mediaWall.ts`）的口径，**分两级、后一级只做兜底**：

- 第一级——刮削记录：索引来自 `listScrapeWithConnection()`（`scrape_file ⨝ task` 取回 `connection_id`），只收 `status = 'success'` 且 `title` 与 `coverId` 不同时为空的行——取消 / 失败留下的空行若被当成命中，卡片会显示成「已刮削但没信息」；
  - 对齐键是 `final_path`（为空时回落 `path`）：刮削可能改名 / 移动文件，`path` 是扫描时的原始路径、`final_path` 是流水线算出的最终路径，两个键都查一遍；同一路径只保留最新一条（查询已按 `updatedAt` 降序）；
  - 番号优先取文件名解析结果（`extractKeyword`），回落记录的 `keyword`；标题取记录 `title`，没有就用去掉扩展名的文件名；
  - 封面按 `buildResourceUrl(connectionId, coverId, basenameRemotePath(coverPath))` 拼。
- 第二级——同目录刮削产出（`buildDirEvidence()`，只查索引、不读文件）：按 `connectionId + dirPath` 收集 `kind = 'nfo'` 与 `kind = 'image'` 的行，**有 NFO 即视为这个目录刮过**，封面取该目录的图片（命名优先级 `poster > folder > cover > fanart > backdrop > banner > thumb`，其余按文件名兜底）。这一级专门兜住路径对不上的情况：加 `final_path` 之前的旧记录（`final_path` 为空且 `path` 已被流水线改名移动）、以及刮削之外的手工改名 / 移动。命中这一级时标题就是磁盘文件名（移动后的文件名本身就是标题），没有刮削时间可显示。
- 两级都没命中 → 卡片显示文件名占位 + 「未刮削」角标，没有封面。
- 每张卡片的「播放地址」也是这里定下来的：`toWallItem()` 用 `buildResourceUrl(connectionId, item.id, item.name)` 生成 `playUrl`（资源 ID 由 `resourceIdOf(connectionId, path)` 算），渲染层因此拿不到磁盘路径。

**详情**（`media:detail`）：`loadMediaDetail({ connectionId, path })` 先用 `resourceIdOf(connectionId, path)` 校验该路径确实是本连接下的视频（不存在 / 跨存储 / 不是视频都返回 `notFound`），再返回 `MediaDetailResult{ item, meta, nfoPath }`——`item` 与墙上同一套卡片数据（含 `playUrl`），因此详情页不需要再拼任何地址：

- 候选顺序 `movie.nfo` → `{文件名}.nfo`，路径为空或读失败 / 解析不出内容都算「没有 NFO」，不报错；
- NFO 解析用三端共享的纯函数 `parseNfoXml`（`@common/types/media/nfo.ts`），字段口径与写入侧 `buildNfoXml` 对齐；`runtime` 转成分钟。

**播放**（`storage://` 协议 + 自建 Range 服务端）：

- 视频请求不走 `net.fetch`，而是 `resourceProtocol.ts` 的 `handleVideoRequest`：先 `client.stat(path)` 取**权威**大小与 MIME（索引可能过期，而 206 的 `Content-Range` 必须和真实大小一致），再解析单区间 Range：
  - 无 `Range` → `200` + `Accept-Ranges: bytes` + `Content-Length`；
  - 有 `Range` → `206` + `Content-Range: bytes s-e/total`；
  - `start` 越界 → `416` + `Content-Range: bytes */total`；
  - 支持 `bytes=start-end` / `bytes=start-` / `bytes=-suffix` 尾部探测（非 faststart 的 MP4 要靠最后一种去文件尾读 moov）；多区间与非法值退化成 200 全量，不做 `multipart/byteranges`。
- 区间读由 `FileClient.readRange(path, start, end)`（**闭区间，含 end**）提供：本机 `createReadStream(local, { start, end })`、WebDAV `createReadStream(remote, { range: { start, end } })`（服务器不返回 206 时由库自己抛错）、SMB `createFileReadStream(remote, { start, end })`（依赖下方那条补丁）。
- node 流转成 `Response` 需要一次适配：主进程类型里同时存在 DOM 与 `stream/web` 两套 `ReadableStream` 声明，`Readable.toWeb` 的返回值喂给 `new Response(...)` 会在 `pipeThrough` 泛型上判定不兼容（TS2345），因此手写 `modules/file/streamToWeb.ts`：队列积压时 `pause()` 源流、`pull` 时 `resume()`（背压），下游 `cancel` 时 `destroy()` 源流。

## 3. 目录结构

```
src/renderer/src/windows/main/pages/media/
├── MediaWallPage.vue                     # 列表页骨架：工具条 + 卡片网格 + 空态 / 失败态
├── mediaUtils.ts                         # 纯展示工具：体积 / 时间 / 时长格式化
├── composables/
│   └── useMediaWall.ts                   # 取数与视图状态：搜索、数据源筛选、排序
├── components/
│   └── MediaWallCard.vue                 # 单张卡片：封面、角标、番号、来源；点击跳详情
└── detail/                               # 影片详情页（/media/detail）
    ├── MediaDetailPage.vue               # 页面骨架：播放器 + 磁盘事实 + NFO 元信息
    ├── mediaDetailCells.ts               # 两块信息格的字段口径（纯函数）
    ├── mediaPlayerI18n.ts                # artplayer 简体中文词条（官方语言包没有 zh-cn）
    ├── composables/
    │   └── useMediaDetail.ts             # 从 query 取参、调 mediaApi.detail
    └── components/
        ├── MediaPlayer.vue               # artplayer 外壳：建 / 销毁、错误提示、NSFW 遮罩
        ├── MediaFactGrid.vue             # 信息格（键值网格，wide 占满整行）
        └── MediaNfoBlock.vue             # NFO 元信息块 + 剧情简介
```

主进程侧：`src/main/src/modules/media/mediaWall.ts`（配对与取数）、`mediaIpc.ts`（IPC 注册）；preload 桥为 `src/preload/src/modules/media/{mediaChannels.ts,media.ts}`，渲染层出口 `src/renderer/src/api/media.ts`；播放地址由 `src/main/src/modules/resource/resourceProtocol.ts` 提供。

## 4. 页面与组件契约

- `MediaWallPage.vue`：`PageLayout`（title「影视墙」，description 说明「磁盘上的视频聚成一堵墙」），`#extra` 只放「刷新」；工具条 = 搜索 `t-input`（`v-model="keyword"`，命中标题 / 番号 / 文件名）+ 数据源 `t-select`（默认「全部数据源」）+ 排序 `t-select` + 统计文案（`共 N 部 · 已刮削 M 部 · 索引更新于 …`）。网格 `repeat(auto-fill, minmax(180px, 1fr))`；加载用 `t-loading`、失败用 `t-alert`、空态用 `t-empty`。列表页只管浏览，播放与详情都在下一个路由。
- `components/MediaWallCard.vue`：props `{ item, connection, sourceName }`；封面 3:4（`SensitiveImage`，无封面时显示占位图标 + 「未刮削 / 没有封面」），右上角「已刮削 / 未刮削」角标，标题两行省略（`t-tooltip` 悬停看全），下面番号标签 + 来源标签 + 体积 / 磁盘修改时间；点击整张卡片 `router.push({ name: '影视墙详情', query: { connectionId, path } })`。封面一律用 `item.coverUrl`（已是 `storage://` 地址），卡片不自己拼路径、也不再持有详情与保护快照。
- `MediaDetailPage.vue`：`SubPageLayout`（title「影片详情」，description 优先显示读到标题、未加载时退化成磁盘路径），`#extra` 只放「重新读取」（`load()` 可重复调用，重试不清屏）。内容自上而下：播放器 →「磁盘上的事实」（左侧 200×280 封面 / 占位 + 右侧信息格）→「NFO 元信息」块；失败 `t-alert`、首屏加载 `t-loading`、空态 `t-empty`。`playUrl` 为空（索引里没有这个视频）时只给一条 warning，不渲染播放器。
- `components/MediaPlayer.vue`：props `{ url, poster?, protect? }`；`onMounted` 建实例、`onBeforeUnmount` `art.destroy()`、`watch(url)` 销毁重建（换片 / 重新读取不残留上一部的缓冲与错误）。option 关键项：`lang: 'zh-cn'` + 内联 i18n、`theme` 运行时读 `--td-brand-color`（读不到回落 `#0052d9`）、`volume: 0.8`、`autoplay: false`、`autoSize: false`（外层固定 `aspect-ratio: 16/9`），倍速 / 画面比例 / 截图 / 设置 / 热键 / 画中画 / 全屏 / 网页全屏 / 迷你进度条打开；`video:error` 只弹「这个视频的封装或编码放不了，建议用本机播放器打开」。**不引 artplayer 的 css**（样式由 JS 自带注入），**不写裸色值**（主题色走 token）。
- `mediaDetailCells.ts`：纯函数 `scrapedText(item)`、`fileCells(detail, sourceName)`（8 项：标题 / 番号 / 数据源 / 文件名 / 所在目录 / 体积 / 磁盘修改时间 / 刮削状态）、`nfoCells(detail)`（11 项：标题 / 番号 / 原名 / 发行日期 / 时长 / 片商 / 厂牌 / 系列 / 导演 / 演员 / 标签）。刮削状态在「命中记录」时显示「已刮削 · 时间」，靠同目录产出判定时只显示「已刮削」（没有时间可显示）。
- `composables/useMediaWall.ts` 返回 `{ items, loading, failure, indexedAt, keyword, sourceId, sort, visible, scrapedCount, load }`；排序口径 `scraped`（默认，已刮削优先、同组按刮削时间倒序）/ `title` / `size` / `modified`。只有失败才写 `failure`，成功但空列表是正常状态。
- `composables/useMediaDetail.ts` 返回 `{ connectionId, path, detail, loading, failure, load }`：参数在进入页面时从 query 读一次，缺 `connectionId` 或 `path` 只写中文 `failure`、不发请求也不抛异常。
- `mediaUtils.ts` 是**页面私有**的 `formatSize` / `formatTime` / `formatDuration`（未知值统一显示「—」）：`utils/lang/FormatUtil.ts` 那份通用格式化当前全仓库无人引用，影视墙不引它，避免为一个页面唤醒休眠工具。

## 5. NSFW 保护

- 列表卡片用 `useNsfwProtection(computed(() => props.connection))` 取 `active`（全局开关 + 该存储的 `nsfw` 标记同时成立才隐藏），封面统一走 `@/components/SensitiveImage.vue`。
- 详情页**自己**拉一次连接列表（`useFileConnections().refresh()`），按 query 里的 `connectionId` 找到连接后再 `useNsfwProtection(connection)` 判定；不再从列表页传保护快照，所以进详情页后立刻切换总开关，行为与列表页一致。
- 播放器在 `protect` 为真时盖一层不透明遮罩（`--td-bg-color-container`）+「内容已隐藏，点击播放」，点击后撤遮罩并 `art.play()`；详情页的大封面沿用 `SensitiveImage` 自己的遮罩。
- `SensitiveImage` 的遮罩容器带 `@click.stop`：在卡片上点「内容已隐藏，点击查看」只放行图片，不会顺带跳进详情页。
- `active` 依赖 `connections` 与模块级的总开关缓存，两者都到位才有遮罩。总开关由应用设置保存成功后的回调刷新（见[设置存储](../setting/01-setting-storage.md)）：在影视墙（或详情页）开着的时候去打开「应用设置 → NSFW 保护」，回来约 300ms 内遮罩应当直接出现，不需要刷新页面；反过来关掉开关，遮罩应立即消失。

## 6. 手工验证清单

按项目约定只跑 `yarn typecheck`，运行时行为手工验证：

1. 做过扫描 / 刮削后进入影视墙：资源索引里该目录下的视频都应上墙，未刮削的卡片显示文件名占位与「未刮削」角标。
2. 刮削成功后刷新：卡片标题变成插件标题、封面出现、角标变「已刮削」。
3. 开启「文件行为 → 成功后移动文件」并设置成功目录，再刮削一次：移动后的视频仍能对上刮削记录（靠 `final_path`），标题与封面不丢；在 `final_path` 出现之前的旧记录（本机存量数据）则应靠**同目录 NFO + 封面图**兜底，同样显示「已刮削」并有封面（只是没有刮削时间）。
4. 从磁盘删掉一个视频后再刷新：对应卡片消失（未重建索引时可能仍在，重建后消失）。
5. 搜索框输入番号 / 标题 / 文件名片段实时过滤；切数据源下拉只剩该数据源的卡片；切排序顺序变化（默认已刮削优先）。
6. 点卡片进入详情页：地址栏变成 `#/media/detail?connectionId=…&path=…`，侧栏仍高亮「影视墙」，左上角返回按钮能回到列表页。
7. 播放：封面出现后点播放能起播；拖进度条能跳、暂停 / 继续 / 倍速 / 音量 / 全屏 / 画中画正常；**拖到影片中间位置能立刻出画**说明 Range 生效（本机、WebDAV、SMB 三种数据源都要过一遍，SMB 依赖 `patches/@awo00+smb2+1.1.1.patch`）。
8. 播放中途切走 / 关掉页面，再回来看日志：不应出现重复的资源读取失败记录（说明被取消的流已经 `destroy()`）。
9. 详情页点「重新读取」前先把文件从磁盘删掉：提示「索引里没有这个视频，磁盘上可能已被删除」（或资源读取失败），界面不崩。
10. 同目录没有 NFO：NFO 块给出「同目录没有可用的 NFO…」提示，播放器与磁盘事实照常显示。
11. 开启 NSFW 保护并把数据源标记 NSFW：列表封面显示遮罩；点进详情页后播放器显示「内容已隐藏，点击播放」，点击后撤遮罩并起播。
12. 缩放窗口宽度：网格列数自适应，卡片不溢出；详情页播放器按 16:9 等比缩放。

## 7. 限制与后续

- 整墙一次全量拉取，没有分页 / 虚拟滚动：视频数量很大（数千）时首屏渲染会变慢，后续按需再加分页或虚拟列表。
- 播放是「直接放磁盘上的原文件」：不做转码、不做字幕与外挂音轨、**不记忆播放进度**（下次进详情页从头开始），多版本 / 多线路切换没有入口。
- 远端（WebDAV / SMB）视频按区间实时读，不再整文件落本机缓存：好处是点开即播、不占磁盘，代价是每次拖动都要向远端重新要数据，网络差时会有缓冲等待；后续若要顺滑可以加一小段本地分片缓存。
- 配对分两级：路径配对（`final_path` / `path`）优先，同目录产出（NFO / 图片）兜底。两级都靠**索引**判断，因此刮削后如果索引没有重建（目录里新增了 NFO 与封面但 `resource` 表里没有），兜底那一级也看不到；此时在工作台重新扫描该目录即可。
- 同目录兜底是**目录粒度**的：一个目录里有多个视频（例如一季剧集）时，只要目录里有 NFO，这些视频都会被标成「已刮削」并共用该目录的封面图。要更细的粒度得等剧集模型。
