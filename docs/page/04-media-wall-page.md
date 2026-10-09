# 影视墙页面

## 1. 定位与入口

影视墙是刮削成果的**浏览入口**：把磁盘上的视频聚成一堵墙，刮削成果（刮削记录 + 同目录的 NFO / 封面）只用来补标题与封面。

- 侧栏一级菜单「影视墙」（在「概览」下方），路由 `/media`，懒加载 `MediaWallPage.vue`（`src/renderer/src/windows/main/router.ts`）。
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

**详情**（`media:detail`）：`loadMediaDetail({ connectionId, path })` 先用 `resourceIdOf(connectionId, path)` 校验该路径确实是本连接下的视频（不存在 / 跨存储 / 不是视频都返回 `notFound`），再返回与墙上同一套卡片数据 + 同目录 NFO 的解析结果：

- 候选顺序 `movie.nfo` → `{文件名}.nfo`，路径为空或读失败 / 解析不出内容都算「没有 NFO」，不报错；
- NFO 解析用三端共享的纯函数 `parseNfoXml`（`@common/types/media/nfo.ts`），字段口径与写入侧 `buildNfoXml` 对齐；`runtime` 转成分钟。

## 3. 目录结构

```
src/renderer/src/windows/main/pages/media/
├── MediaWallPage.vue                     # 页面骨架：工具条 + 卡片网格 + 空态 / 失败态
├── mediaUtils.ts                         # 纯展示工具：体积 / 时间 / 时长格式化
├── composables/
│   └── useMediaWall.ts                   # 取数与视图状态：搜索、数据源筛选、排序
├── components/
│   └── MediaWallCard.vue                 # 单张卡片：封面、角标、番号、来源
└── modals/
    ├── MediaDetailDrawer.tsx             # 命令式抽屉外壳：openMediaDetailDrawer(options)
    └── MediaDetailDrawerContent.vue      # 抽屉内容：文件事实 + NFO 元信息
```

主进程侧：`src/main/src/modules/media/mediaWall.ts`（配对与取数）、`mediaIpc.ts`（IPC 注册）；preload 桥为 `src/preload/src/modules/media/{mediaChannels.ts,media.ts}`，渲染层出口 `src/renderer/src/api/media.ts`。

## 4. 页面与组件契约

- `MediaWallPage.vue`：`PageLayout`（title「影视墙」，description 说明「磁盘上的视频聚成一堵墙」），`#extra` 只放「刷新」；工具条 = 搜索 `t-input`（`v-model="keyword"`，命中标题 / 番号 / 文件名）+ 数据源 `t-select`（默认「全部数据源」）+ 排序 `t-select` + 统计文案（`共 N 部 · 已刮削 M 部 · 索引更新于 …`）。网格 `repeat(auto-fill, minmax(180px, 1fr))`；加载用 `t-loading`、失败用 `t-alert`、空态用 `t-empty`。
- `components/MediaWallCard.vue`：props `{ item, connection, sourceName }`；封面 3:4（`SensitiveImage`，无封面时显示占位图标 + 「未刮削 / 没有封面」），右上角「已刮削 / 未刮削」角标，标题两行省略（`t-tooltip` 悬停看全），下面番号标签 + 来源标签 + 体积 / 磁盘修改时间；点击整张卡片打开详情抽屉。封面一律用 `item.coverUrl`（已是 `storage://` 地址），卡片不自己拼路径。
- 抽屉是命令式（`DrawerPlugin`，680px、`footer: false`、`destroyOnClose: true`）：外壳 `modals/MediaDetailDrawer.tsx` 导出 `openMediaDetailDrawer({ connectionId, path, title, sourceName, protect })`，内容 `modals/MediaDetailDrawerContent.vue` 打开即拉一次详情。内容分两块：
  - 「文件事实」：左侧大封面（200×280）+ 右侧网格（标题 / 番号 / 数据源 / 文件名 / 所在目录 / 体积 / 磁盘修改时间 / 刮削状态）；刮削状态在「命中记录」时显示「已刮削 · 时间」，靠同目录产出判定时只显示「已刮削」（没有时间可显示）；
  - 「NFO 元信息」：标题 / 番号 / 原名 / 发行日期 / 时长 / 片商 / 厂牌 / 系列 / 导演 / 演员 / 标签 + plot；没有可用 NFO 时提示「同目录没有可用的 NFO：标题按磁盘文件名推断，封面取同目录图片」，但上半部分照常显示。
  - 失败只显示 `t-alert` 与「重新读取」按钮，不抛出。
- `composables/useMediaWall.ts` 返回 `{ items, loading, failure, indexedAt, keyword, sourceId, sort, visible, scrapedCount, load }`；排序口径 `scraped`（默认，已刮削优先、同组按刮削时间倒序）/ `title` / `size` / `modified`。只有失败才写 `failure`，成功但空列表是正常状态。
- `mediaUtils.ts` 是**页面私有**的 `formatSize` / `formatTime` / `formatDuration`（未知值统一显示「—」）：`utils/lang/FormatUtil.ts` 那份通用格式化当前全仓库无人引用，影视墙不引它，避免为一个页面唤醒休眠工具。

## 5. NSFW 保护

- 卡片用 `useNsfwProtection(computed(() => props.connection))` 取 `active`（全局开关 + 该存储的 `nsfw` 标记同时成立才隐藏），封面统一走 `@/components/SensitiveImage.vue`。
- 打开抽屉时把当时的 `active` 作为 `protect` 快照传进去（`MediaDetailDrawerOptions.protect`），抽屉里的大封面沿用同一状态。
- `SensitiveImage` 的遮罩容器带 `@click.stop`：在卡片上点「内容已隐藏，点击查看」只放行图片，不会顺带打开详情抽屉。
- `active` 依赖 `connections`（页面挂载时 `refreshConnections()`）与模块级的总开关缓存，两者都到位才有遮罩。总开关由应用设置保存成功后的回调刷新（见[设置存储](../setting/01-setting-storage.md)）：在影视墙开着的时候去打开「应用设置 → NSFW 保护」，回来约 300ms 内卡片遮罩应当直接出现，不需要刷新页面或重进影视墙；反过来关掉开关，遮罩应立即消失。

## 6. 手工验证清单

按项目约定只跑 `yarn typecheck`，运行时行为手工验证：

1. 做过扫描 / 刮削后进入影视墙：资源索引里该目录下的视频都应上墙，未刮削的卡片显示文件名占位与「未刮削」角标。
2. 刮削成功后刷新：卡片标题变成插件标题、封面出现、角标变「已刮削」。
3. 开启「文件行为 → 成功后移动文件」并设置成功目录，再刮削一次：移动后的视频仍能对上刮削记录（靠 `final_path`），标题与封面不丢；在 `final_path` 出现之前的旧记录（本机存量数据）则应靠**同目录 NFO + 封面图**兜底，同样显示「已刮削」并有封面（只是没有刮削时间）。
4. 从磁盘删掉一个视频后再刷新：对应卡片消失（未重建索引时可能仍在，重建后消失）。
5. 搜索框输入番号 / 标题 / 文件名片段实时过滤；切数据源下拉只剩该数据源的卡片；切排序顺序变化（默认已刮削优先）。
6. 点开卡片：抽屉出现大封面、文件信息与 NFO 元信息；同目录没有 NFO 时上半部分仍显示并给出提示。
7. 开启 NSFW 保护并把数据源标记 NSFW：卡片封面显示遮罩，点击后本卡放行且**不会**打开抽屉；抽屉里的大封面同样受保护。
8. 抽屉开着时删掉文件再点「重新读取」：提示「索引里没有这个视频，磁盘上可能已被删除」，界面不崩。
9. 缩放窗口宽度：网格列数自适应，卡片不溢出。

## 7. 限制与后续

- 整墙一次全量拉取，没有分页 / 虚拟滚动：视频数量很大（数千）时首屏渲染会变慢，后续按需再加分页或虚拟列表。
- 详情只读同目录 NFO，不读取刮削插件详情、不播放视频；「点击播放」与「重新刮削」留给后续。
- 配对分两级：路径配对（`final_path` / `path`）优先，同目录产出（NFO / 图片）兜底。两级都靠**索引**判断，因此刮削后如果索引没有重建（目录里新增了 NFO 与封面但 `resource` 表里没有），兜底那一级也看不到；此时在工作台重新扫描该目录即可。
- 同目录兜底是**目录粒度**的：一个目录里有多个视频（例如一季剧集）时，只要目录里有 NFO，这些视频都会被标成「已刮削」并共用该目录的封面图。要更细的粒度得等播放/剧集模型。
