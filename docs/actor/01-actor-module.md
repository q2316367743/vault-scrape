# 演员模块（主进程）

演员是**独立于影视墙的一个域**：资料落在数据库（`actor` 等四张表），图片文件落在应用数据目录（默认 `~/.vault-scrape/media/actor/<演员ID>/`），影片与演员是**按名字的弱关联**（`media_cast` 只记影片 ID 与演员姓名的归一化键，不记演员 ID）。资料可以手工编辑，也可以由**演员信息插件**（`actor` / `actorAssets`）自动补全；参演名单在扫描时由 NFO 提供、刮削时由影片信息插件提供，落库后所有查询都走数据库。

## 1. 数据模型

`src/main/src/db/schema/actor.ts`（四张表都在全量基线迁移 `resources/drizzle/0000_moaning_black_panther.sql` 里；早期强关联的 `media_actor` 与拆分出来的 `0005` / `0006` 迁移都已删除重建）：

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `actor` | `id` / `name` / `name_key`（唯一索引） / `gender` / `birthday` / `birth_country` / `birth_province` / `birth_city` / `birth_county` / `height` / `bust` / `waist` / `hip` / `cup` / `tagline` / `source_url` / `overview` / `tags`（JSON 文本） / `avatar_image_id` / `locked` / `scraper_id` / `scraped_at` / `created_at` / `updated_at` | 一位演员一行；`idx_actor_name_key` 唯一、`idx_actor_updated` 供「最近更新」排序 |
| `actor_alias` | `actor_id` / `alias` / `alias_key` | 别名多行；`(actor_id, alias_key)` 唯一，`alias_key` 单列索引供「按别名找演员」 |
| `actor_image` | `id`（= 私有协议媒体 ID） / `actor_id` / `kind`（`avatar` / `photo`） / `path`（本机绝对路径） / `name` / `extname` / `mime` / `size` / `width` / `height` / `source`（`user` / `scrape`） / `created_at` | 数据库只存元信息，**图片本体在磁盘** |
| `media_cast` | `item_id` / `actor_name`（原始写法，供展示） / `name_key`（归一化键） / `ordinal`（出演顺序） | 复合主键 `(item_id, name_key)`；`idx_media_cast_name` 供「这位演员出演了哪些影片」。只按名字关联：演员改名或删除都不会留下悬挂行，代价是同名演员无法区分 |

约定：

- `name_key` 是姓名归一化键（`actorNameKey`），`actor_alias.alias_key` 同理；两者都用于去重与匹配，展示永远用原始写法；
- `gender` 取值 `''` / `female` / `male` / `other`（`ACTOR_GENDERS`）；`birthday` 是 `YYYY-MM-DD` 文本；身高与三围是整数厘米，**0 表示未填写**；
- `bust` / `waist` / `hip` / `cup` 只有女演员会用：数据库字段照旧可存（插件抓回来不拦），但**界面只在 `gender === 'female'` 时展示**这三围与罩杯，其它性别整项不出现（见 [演员页面 §3 / §4](../page/05-actor-pages.md)）；
- `tags` 是用户标签（JSON 字符串数组），刮削永不覆盖；`locked` 为真时刮削**只填空白字段**；
- `scraped_at` / `scraper_id` 记录最后一次命中的插件，用于「资料不全」排队与详情页展示。

## 2. 图片落盘与 `storage://actor` 协议

目录解析（`src/main/src/modules/actor/actorPaths.ts`）：

1. 设置 `app.actorImageDir` 非空且是绝对路径、且可写 → 用它；
2. 否则回落默认目录 `join(app.getPath('home'), '.vault-scrape', 'media', 'actor')`，并写一条 `warn` 日志；
3. 每位演员一个子目录，文件名固定 `<图片ID>.<扩展名>`（`buildActorImagePath`）。删除时只允许删根目录内的文件（`isInsideActorRoot` 相对路径判定），删不掉只记日志不报错。

地址形式：`storage://actor/<图片ID>/<文件名>`（`buildActorImageUrl`，文件名整体 `encodeURIComponent`，只参与展示与扩展名推断）。主进程在 `mediaProtocol.ts` 的解析链里**最前面**加了演员分支：`connectionId === 'actor'` 交给 `serveActorImage(imageId)`，校验 ID 形状 → 查 `actor_image` → 文件必须在演员图片根目录内且存在 → `net.fetch(pathToFileURL(...))`，响应头带 `Content-Type`（库里存的 mime，缺失按扩展名猜）与 `Cache-Control: public, max-age=31536000, immutable`；失败走统一的 404 与 60 秒去重告警。

头像的唯一性由 `actorAsset.saveActorImage` 保证：**第一位**以 `avatar` 导入/抓取的图片会写 `actor_image.kind = 'avatar'` 并回填 `actor.avatar_image_id`，之后的新图一律按 `photo` 存（不会顶掉已有头像）；用户也可以在详情页显式「设为头像」（`setActorAvatar`，允许顶掉）。

## 3. 主进程文件分工

| 文件 | 职责 |
| --- | --- |
| `modules/actor/actorPaths.ts` | 图片根目录解析、演员目录、落盘路径与「是否在根目录内」判定 |
| `db/repo/actorRepo.ts` | 演员三张表与 `media_cast` 的全部读写（列表分页 / 计数（作品数走 `name_key` 子查询）/ 标签汇总 / 别名替换 / 名单替换 / 删除） |
| `modules/actor/actorAsset.ts` | 图片落盘与删除：`saveActorImage` / `importActorImages` / `removeActorImage` / `listActorPhotos` / `actorAvatarOf` |
| `modules/actor/actorService.ts` | 读模型：`loadActorList` / `loadActorDetail`（详情带该演员的全部出演作品） |
| `modules/actor/actorWrite.ts` | 写操作：`saveActor`（新增 / 编辑，含同名冲突校验）、`removeActor`（连带清磁盘图片）、`setActorAvatarOf` |
| `modules/actor/actorLink.ts` | 影片 ↔ 演员弱关联：`syncItemCast`（按姓名 / 别名解析、缺失则建演员，再整组写 `media_cast`）、`ensureActorsOf`、`actorRefsOfItem` |
| `modules/actor/actorView.ts` | 数据库行 → 公共展示形状（`actorSummaryOf` / `actorDetailOf`，统一拼头像地址） |
| `modules/actor/actorScrape.ts` | 演员信息插件抓取与合并、图片下载、串行队列、队列状态计数、刮削入库后的自动补全 |
| `modules/actor/actorProtocol.ts` | `storage://actor` 的响应实现（`serveActorImage`） |
| `modules/actor/actorEvents.ts` | 补全队列状态向所有窗口的单向推送（`actor:progress`） |
| `modules/actor/actorIpc.ts` | 十个 `actor:*` 调用通道 + `ActorResult` 信封 |

## 4. 读模型与写操作

- `loadActorList(request)` → `{ items: ActorSummary[], total, tags }`；`keyword` 同时匹配姓名与别名（`exists` 子查询），`tag` 按 JSON 文本匹配，`sort` 为 `updated` / `name` / `films`，`limit` 上限 200（IPC 层默认 60）。
- `loadActorDetail(request)` → `{ actor: ActorDetail, films: MediaWallItem[] }`；出演作品拿 `actor.name_key` 反查 `media_cast` 得条目 ID（`listItemIdsByActorNameKey`），再用 `loadWallItems` 组装媒体墙形状并按日期倒序。名单里没有对应演员行的名字不会出现在任何演员的详情页里。
- `saveActor(request)`：新增走 `ensureActorByName`（`name_key` 冲突即返回既有行，返回的 ID 与本次不同则报 `conflict`）；编辑走 `updateActor`；两条路径都会 `replaceAliases`（先删后插、按 key 去重）。姓名不能为空且不能与别人重名。
- `removeActor(request)`：`deleteActor` 返回该演员的全部图片行，再 `removeActorImageFiles` 清磁盘文件；别名与图片记录一并删除。`media_cast` 的行**不动**：它只记名字，删演员不影响影片的参演名单，同名档案重建后关系自动接上。
- 图片导入（`importActorImages`）：逐个路径校验（空路径 / 不存在 / 不是文件 / 扩展名不允许 / 超过 `ACTOR_IMAGE_MAX_BYTES = 20MB`），失败项进 `failed` 并带原因，**不整体失败**。
- 标签汇总（`listAllTags`）从 `actor.tags` 解析去重后按中文排序，供列表页筛选下拉使用。

## 5. 抓取链路（演员信息插件）

演员资料全部由**演员信息插件**产出，插件侧契约见 [插件模块](../plugin/01-plugin-module.md) 第 2.5 节与[插件类别](../plugin/03-plugin-categories.md)：`actor(name, env, ctx)` **必填**，`actorAssets(name, env, ctx)` 可选（后者用 `PLUGIN_ACTOR_ASSET_KINDS = ['poster','thumb','still']`，`poster` 视为头像候选）。**演员抓取不理影片信息插件**：`actorScrape.ts` 只从演员类别的注册表（`actorPlugins`）里取「已启用且编译通过」的插件。

主进程合并规则（`actorScrape.ts`）：

1. 按 `pluginIds`（为空则取全部启用的**演员信息插件**）**依次尝试**，`actor` 命中一个就停；
2. 文本字段 `trim()` 后为空视为未提供；数字字段 `undefined` 或 `<= 0` 视为未提供；`locked` 为真时只填空白字段，未锁定时覆盖；
3. 姓名与用户标签永不被覆盖；别名在未锁定时直接用插件结果，锁定时与原值合并去重；
4. 图片按 `actorImageLimit` 限量（0 = 只抓资料不下图）：`poster` 只在没有头像时存一张，其余进图集；下载走刮削域的 `downloadAssetToTemp`，落盘后调 `saveActorImage({ source: 'scrape' })` 并 `cleanup` 临时文件；图片扩展名优先从资源 url 末段推断（`PluginAsset.name` 是展示名，如「头像」，只在 url 取不到扩展名时兜底），仍识别不了就跳过并记 warn；
5. 命中后写回资料、`replaceAliases`（有变化时）、`scraper_id` / `scraped_at`；全部失败只记日志，不打断调用方；
6. 自动补全走**模块级串行队列**（`enqueueActorScrape`），同一演员排队期间不重复入队，取消（`ActorError('cancelled')`）静默处理；队列自己维护 `ActorScrapeStatus` 计数并逐位广播进度（见 §6），被取消的那一位算「已处理」但不算失败。

### 5.1 四个触发场景

| # | 场景 | 触发点 | 说明 |
| --- | --- | --- | --- |
| 1 | 影片入库后 | `scrapeFileJob` 第 7 步 `enqueueItemActorScrape(itemId, detail.actors ?? [], settings.scrape.actorScrape, signal)` | 先把参演名单写进 `media_cast`，再按设置为「资料不全」（`scraped_at === 0` / 没有头像 / 没有生日）的演员排队；受设置 `scrape.actorScrape` 控制，走串行队列 |
| 2 | 打开演员详情页 | `ActorDetailPage.vue` 在 `load()` 之后异步触发一次 | 受设置 `scrape.actorScrapeOnOpen`（默认开）控制；资料不全（没抓过 / 没头像 / 没生日）**且未锁定**才抓；同一演员一次会话内只试一次（会话级 `Set` 去重），静默执行、失败不打扰；没有启用的演员插件时直接跳过 |
| 3 | 详情页「抓取资料」 | `ActorDetailPage.vue` 的 `onScrape` → `detail/modals/ActorScrapeDialog` | 手动：弹窗里**单选一个**演员信息插件（只列已启用且编译通过的，默认选中上次用过的 `vault-scrape:actor-scrape-plugin`），只把选中的那一个 ID 作为 `pluginIds` 传下去；只有它是空数组时主进程才会补成「全部启用的插件」，所以弹窗保证有选中项 |
| 4 | 列表页「补全缺失资料」 | `actorIpc.ts` → `scrapeMissingActors(ACTOR_SCRAPE_MISSING_LIMIT)` | 批量补全，走串行队列 |

四个入口共用同一条 `scrapeActor` 链路与同一套合并规则（上面 1–6 条）。

与影视库的衔接另有两个入口：

- **刮削**：即上表场景 1——先写 `media_cast`（名单为空时**不动**已有名单，避免只要元数据的重刮清掉演员），再排队补全；
- **扫描**：未刮削（`scraped_at = 0`）且库里还没有名单的条目，`mediaIndexer` 会读同目录 NFO（优先 `movie.nfo`，其次**目录型条目的目录名**、再其次与视频同名；只认根元素 `<movie>`）里的 `<actor>` 写进 `media_cast`，顺手按名字建好演员档案 —— NFO 是数据提供方、数据库是保存方；已经有名单或已经刮削的条目不再读文件，重扫也不会覆盖刮削结果。

影片详情页的演员条读 `MediaDetailResult.actors`（`actorRefsOfItem` 组装，头像缺失回落空串；演员行被手工删掉时 `actorId` 是空串，渲染层据此不跳转）。

## 6. IPC 通道与错误码

`src/preload/src/modules/actor/actorChannels.ts`：十个调用通道 `actor:list` / `actor:detail` / `actor:save` / `actor:remove` / `actor:importImages` / `actor:removeImage` / `actor:setAvatar` / `actor:scrape` / `actor:scrapeMissing` / `actor:scrapeStatus`，外加一个单向推送 `actor:progress`。渲染层入口是 `@/api` 的 `actorApi`（`window.preload.actor`）：`scrapeStatus()` 拉补全队列快照，`onScrapeProgress(listener)` 订阅全量状态事件（返回退订函数）。

补全队列的进度可观：`actorScrape.ts` 维护内存计数（`total` / `finished` / `failed` / `pending` / `running` / `currentName` / `updatedAt`，形状是 `ActorScrapeStatus`），入队、开始抓下一位、每位抓完各广播一次；概览页的「演员资料补全」卡片订阅它（`overview/composables/useActorScrape.ts` + `overview/components/ActorScrapeProgressCard.vue`）。跑空后保留最后一轮数字，下一轮入队时归零重算；应用重启即清零（不落库）。

参数一律在 `actorIpc.ts` 里收窄（`readId` / `readListRequest` / `readSaveRequest` / `readImageRequest` / `readImportRequest` / `readScrapeRequest`），成功返回 `actorOk(data)`，失败返回 `actorFail(code, message)`；渲染层只按 `code` 分支、展示 `message`。

错误码（`src/common/types/actor/error.ts`）：`notFound` / `invalidArgument` / `conflict` / `ioFailed` / `scrapeFailed` / `cancelled` / `unknown`。「没有头像」「没有插件命中」不是错误，用空值表达。

## 7. 设置项

| 键 | 含义 | 默认 |
| --- | --- | --- |
| `app.actorImageDir` | 演员图片根目录（头像与图集都放这里），留空回落默认目录 | `''` |
| `scrape.actorScrape` | 影片刮削入库后，是否自动为参演演员排队补全资料 | `true` |
| `scrape.actorScrapeOnOpen` | 打开演员详情页时，资料不全（没抓过 / 没头像 / 没生日）且未锁定的演员是否自动抓一次（会话内同一演员只试一次） | `true` |
| `scrape.actorImageLimit` | 单次抓取最多保存几张演员图片，0 表示只抓资料 | `12` |

## 8. 已知限制与取舍

- 演员域只从 NFO 与影片信息插件的演员名单拿名单，**不扫演员资料**：图片也只从「用户导入」与「演员信息插件的 `actorAssets`」两个入口进来；
- 弱关联只认名字：同名演员会被算成同一位、也无法区分；改名相当于换人（旧名字的作品不再出现在新档案下，除非改回去）。
- 别名 / 姓名匹配基于归一化键，改姓名不会自动合并两个演员；
- 一位演员的头像只有一张，旧头像被顶掉后仍留在图集里（文件不删）；
- 离线内置插件（`r18-offline`）属**影片信息**类别、**不实现 `actor`**：离线库只有番号 / 标题 / 演员名单，没有生日身高，所以演员抓取永远不会命中它（离线库的名单仍会写进 `media_cast`），演员资料需要另外启用一个演员信息插件；
- 抓取是串行队列，批量补全大量演员时耗时较长；进度在概览页「演员资料补全」卡片上看（`total` / `finished` / `failed` / `pending` / 当前演员），但队列状态只在主进程内存里、**不落库**，应用重启即清零，也没有「逐位结果」的历史表 —— 单次结果仍在日志里看；队列本身不支持取消（随发起它的刮削任务一起被 `signal` 中止）。
