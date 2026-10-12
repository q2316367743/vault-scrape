# 演员页面

演员有三处界面：**演员列表页**、**演员详情页**、**演员编辑弹窗**；影视墙的影片详情页上还有一条**参演演员条**，点击即跳演员详情。主进程实现见 [演员模块](../actor/01-actor-module.md)。

**演员图片不参与 NSFW 保护**：演员的头像与图集一律直接显示，不接 `useNsfwProtection`、不传 `SensitiveImage` 的 `protect`（演员图片没有存储上下文，也不属于要遮罩的影片内容）；演员页里的**影片封面**仍按影视墙规则遮罩，见下文与 [影视墙页面](./04-media-wall-page.md) 第 7 节。

## 1. 路由与入口

| 路由 | 名称 | 页面 | 说明 |
| --- | --- | --- | --- |
| `/actor` | 演员 | `pages/actor/list/ActorListPage.vue` | 列表：搜索 / 排序 / 标签筛选 / 分页 / 补全缺失资料 / 新增 |
| `/actor/detail` | 演员详情 | `pages/actor/detail/ActorDetailPage.vue` | 详情：query 只带 `actorId` |

- 侧栏一级菜单「演员」（`UserIcon`，排在「影视墙」之后，`match: 'prefix'`），所以停在详情页时侧栏仍高亮「演员」（`router.ts`、`pages/app/AppSide.vue`）。
- 目录分层（RL-09）：`pages/actor/` 下按页面分子目录 —— `list/`（页面 + `composables/`）、`detail/`（页面 + `components/` + `composables/` + `modals/` 抓取弹窗）、`modals/`（编辑弹窗外壳与内容）、`components/`（页面目录内共用组件 `ActorCard.vue`）。
- **三围与罩杯只有女演员有**：`gender === 'female'` 才展示这两项，其它性别（`male` / `other` / 未设置）在详情页资料格里整行不出现、编辑表单里也不出现（旧数据不删、只是不露出）。详见 §3、§4。

## 2. 列表页（`list/ActorListPage.vue`）

`PageLayout title="演员"`，`padded: false` 让网格自己控制内边距；`#extra` 两个按钮：

| 按钮 | 行为 |
| --- | --- |
| 补全缺失资料 | `actorApi.scrapeMissing()`（**无参数**，主进程用 `ACTOR_SCRAPE_MISSING_LIMIT = 200`）→ 成功 `MessageUtil.info(result.data.message)` 并重新取数；成功且真的排了队时提示尾缀「，进度见概览页」（队列进度只在概览页的「演员资料补全」卡片上，见 [actor/01](../actor/01-actor-module.md) §6）；按钮自身 `loading` 防重复点击 |
| 新增演员 | `openActorEditorDialog({ onSaved: () => void search() })` |

工具条：关键词 `t-input`（回车 / 清空即搜，前缀放大镜）→ 排序 `t-select`（最近更新 / 姓名 / 作品数，`ACTOR_SORTS`）→ 标签 `t-select`（来自 `ActorListResult.tags`）→ 每页条数 `t-select`（`ACTOR_PAGE_SIZES = [30, 60, 120]`，默认 `ACTOR_LIST_PAGE_SIZE = 60`）→ 刷新。搜索、换标签、换每页条数都会把页码重置回第一页。

主体：`t-alert theme="error"` 显示 `failure`；首次加载（`loading && list.length === 0`）显示 `t-loading`；否则用 `grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))` 铺 `ActorCard`（头像 + 姓名 + 作品数 + 标签徽标，点卡片跳 `{ name: '演员详情', query: { actorId } }`）；空结果显示 `t-empty`；`total > limit` 时显示 `t-pagination`。

取数组合式 `list/composables/useActorList.ts`：`keyword` / `tag` / `sort` / `limit` / `page` / `loading` / `failure` / `list` / `tags` / `total`，`load()` 调 `actorApi.list({ keyword, tag, sort, offset: (page - 1) * limit, limit })`，失败只写 `failure`（保留上一次列表）；`search()` 先把 `page` 归 1 再 `load()`。

## 3. 详情页（`detail/ActorDetailPage.vue`）

`SubPageLayout title="演员详情"`，`description` 取演员姓名（未加载时显示 `actorId`），`fallback="/actor"`（返回按钮由容器提供）。`#extra` 三个动作：

| 动作 | 行为 |
| --- | --- |
| 抓取资料 | 打开 `detail/modals/ActorScrapeDialog`，**手动选一个**演员信息插件再抓（默认选中上次用过的），抓完用返回的 `message` 提示并重新取数；细节见本节末「手动抓取弹窗」 |
| 编辑资料 | `openActorEditorDialog({ actor, onSaved: () => void load() })` |
| 删除演员 | `MessageBoxUtil.confirm` 二次确认 → `actorApi.remove({ actorId })` → `router.replace('/actor')` |

主体三块：

- `components/ActorProfileBlock.vue`：头像（`SensitiveImage`，**不传 `protect`**，不做 NSFW 遮罩；没有头像时显示姓名首字占位）+ 资料格（性别 / 生日 / 出生地（`actorBirthplaceText`）/ 身高（`actorHeightText`）/ **仅女演员**：三围（`actorMeasurementsText`）/ 罩杯 / 收录时间 / 刮削插件 / 资料锁定），别名与用户标签用 `t-tag`，简介按原文换行展示；空值统一显示「未填写」。资料格由 `isFemale = computed(() => actor.gender === 'female')` 控制，非女演员时三围与罩杯两项**不出现在列表中**（不是显示空值）。**「来源链接」不在资料格里**：单独一行放在资料块最后（简介之后），有值用 `t-link theme="primary"` 展示完整地址、点击调 `window.open(url, '_blank')`——主窗口的 `setWindowOpenHandler` 会把它交给 `shell.openExternal`（`src/main/index.ts:65-68`），由系统默认浏览器打开，应用窗口不会被导航走，所以 `t-link` **不写 `href`**；没有来源链接时这一行显示「未填写」。**「简介」是描述性正文**：不跟字段值同色平铺，而是装进 `.profile-overview-box`（`1px solid var(--td-component-border)` + `var(--td-radius-medium)` + 10/12px 内边距）里、正文用 `var(--td-text-color-secondary)`（空态仍用 placeholder 色显示「还没有简介。」），一眼能和上面的字段值区分开。
- `components/ActorGalleryBlock.vue`：图集缩略图（`SensitiveImage`，同样不传 `protect`）+ 「导入图片」「导入头像」按钮（`dialogApi.open({ multiple: true, filters: [{ name: '图片', extensions: ACTOR_IMAGE_EXTENSIONS }] })`，初始目录取 `app.actorImageDir`；「导入头像」是单选），每张图可「设为头像」或删除（删除走二次确认，本机文件与数据库记录一起清掉）；导入失败项用 `MessageUtil.warning` 列出「路径：原因」。
- 出演作品：`MediaWallCard` 网格（`connectionOf` 从 `useFileConnections()` 取连接，用于 NSFW 判定——这里是**影片封面**，不属于上文的豁免范围），空态 `t-empty`。

取数组合式 `detail/composables/useActorDetail.ts`：从 `route.query.actorId` 取参，缺失时只写中文 `failure`「地址里缺少演员参数，请从演员列表点进来」并且**不发请求**；`load()` 调 `actorApi.detail({ actorId })`。

**打开详情页自动补全**：`onMounted` 里 `load()` 之后调一次 `autoScrape()`——开启 `scrape.actorScrapeOnOpen`（默认开）且资料不全（`scrapedAt === 0`、`avatarUrl === ''` 或 `birthday === ''`）、演员未锁定、且本次会话里这个 `actorId` 还没试过（`Set` 去重）时，取 `pluginApi.actor.list()` 里已启用的演员信息插件 ID 调 `actorApi.scrape`，有产出（`filled.length > 0 || images > 0`）就静默 `load()` 刷新；失败只记日志、不打扰用户——这是四个抓取场景里的第 2 个（全表见 [../actor/01-actor-module.md](../actor/01-actor-module.md)）。**自动流程不走选择插件弹窗**，仍然把全部启用插件交给主进程按顺序试（没有人工决策环节）；「选一个插件」只作用于上面的手动「抓取资料」。

**手动抓取弹窗（`detail/modals/`）**：与编辑弹窗一样拆两个文件 —— `ActorScrapeDialog.tsx`（外壳，导出 `openActorScrapeDialog({ actorId, actorName, onDone? })`，`DialogPlugin` + `destroyOnClose`，footer 是「取消 / 开始抓取」，`onSuccess` 里 `dialog.hide()` → `MessageUtil.info(result.message)` → `onDone()`）+ `ActorScrapeDialogContent.vue`（内容，props `{ actorId, actorName }`，`defineExpose` 暴露 `submit` / `saving` / `canSubmit`）。内容组件：

- 打开时 `pluginApi.actor.list()`，只列 `enabled && loadError.length === 0` 的演员信息插件（与手动匹配同一口径），`t-select` 单选，选项文案 `名称 v版本`；
- 没有任何可用插件时显示 `t-alert theme="warning"` 且主按钮不可提交；
- **默认选中上次用过的插件**：`useLocalStorage('vault-scrape:actor-scrape-plugin', '')` 存插件 ID（纯 UI 偏好，不进设置文件）；记住的那个插件被停用或删除后回落到列表第一个；只有抓取成功才写回；
- 提交时只传选中的那一个：`actorApi.scrape({ actorId, pluginIds: [selectedId] })`——主进程把**空数组**理解成「全部启用的插件」，所以必须有选中项才能提交。

## 4. 编辑弹窗（`actor/modals/`）

按项目约定拆成两个文件：

- `ActorEditorDialog.tsx`（外壳）：导出 `openActorEditorDialog({ actor?, onSaved? })`，内部 `DialogPlugin({ destroyOnClose: true, width: …, header, footer, body })`；footer 用 JSX 渲染「取消 / 保存」按钮，按钮 `loading` / `disabled` 读内容组件通过 `defineExpose` 暴露的 `saving` / `canSubmit`；保存成功回调里 `dialog.hide()` 再调 `onSaved`。
- `ActorEditorDialogContent.vue`（内容，不含操作按钮）：props `{ actor?: ActorDetail }`（有值 = 编辑，无值 = 新增），emits `success`（载荷为 `actorId`）与 `close`；`submit()` 组装完整 `ActorSaveRequest` 后调 `actorApi.save`，成功 `MessageUtil.success('已新增演员' | '已保存演员资料')` 并 `emit('success', actorId)`。

表单字段：姓名（必填，`canSubmit = name.trim().length > 0`）、性别、别名（`t-tag-input`，回车添加）、生日（`t-date-picker`）、出生地四格（国家 / 省州 / 城市 / 区县）、身高、**仅女演员**：三围（胸围 / 腰围 / 臀围，`t-input-number`，0 = 未填写）与罩杯、标语、来源链接、简介（`t-textarea`）、用户标签（`t-tag-input`）、锁定资料（`t-switch`，提示「锁定后刮削只补空白字段」）。三围与罩杯由 `isFemale = computed(() => form.gender === 'female')` 控制显隐，切换性别只影响表单显隐、**不清空已填的值**（男演员表单里不会误改到旧数据）。

## 5. 影片详情页的参演演员条

`pages/media/detail/components/MediaActorStrip.vue`：`props { actors: MediaActorRef[] }`，标题「参演演员（N）」，每项是 56×56 头像（`SensitiveImage`，**不传 `protect`**，不做 NSFW 遮罩，缺失时首字占位）+ 姓名，点击跳 `{ name: '演员详情', query: { actorId } }`。数据来自 `MediaDetailResult.actors`（主进程 `actorRefsOfItem` 按 `media_cast.ordinal` 组装，弱关联只认名字，演员行缺失时 `actorId` 为空串、点击不跳转，见 [影视墙页面](./04-media-wall-page.md) 与 [资料库](../media/01-media-library.md)），在 `MediaDetailPage.vue` 里 `v-if="detail.actors.length > 0"` 挂在 NFO 区块之前。
