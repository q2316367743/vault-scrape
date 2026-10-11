# 演员页面

演员有三处界面：**演员列表页**、**演员详情页**、**演员编辑弹窗**；影视墙的影片详情页上还有一条**参演演员条**，点击即跳演员详情。主进程实现见 [演员模块](../actor/01-actor-module.md)。

## 1. 路由与入口

| 路由 | 名称 | 页面 | 说明 |
| --- | --- | --- | --- |
| `/actor` | 演员 | `pages/actor/list/ActorListPage.vue` | 列表：搜索 / 排序 / 标签筛选 / 分页 / 补全缺失资料 / 新增 |
| `/actor/detail` | 演员详情 | `pages/actor/detail/ActorDetailPage.vue` | 详情：query 只带 `actorId` |

- 侧栏一级菜单「演员」（`UserIcon`，排在「影视墙」之后，`match: 'prefix'`），所以停在详情页时侧栏仍高亮「演员」（`router.ts`、`pages/app/AppSide.vue`）。
- 目录分层（RL-09）：`pages/actor/` 下按页面分子目录 —— `list/`（页面 + `composables/`）、`detail/`（页面 + `components/` + `composables/`）、`modals/`（编辑弹窗外壳与内容）、`components/`（页面目录内共用组件 `ActorCard.vue`）。

## 2. 列表页（`list/ActorListPage.vue`）

`PageLayout title="演员"`，`padded: false` 让网格自己控制内边距；`#extra` 两个按钮：

| 按钮 | 行为 |
| --- | --- |
| 补全缺失资料 | `actorApi.scrapeMissing()`（**无参数**，主进程用 `ACTOR_SCRAPE_MISSING_LIMIT = 200`）→ 成功 `MessageUtil.info(result.data.message)` 并重新取数；按钮自身 `loading` 防重复点击 |
| 新增演员 | `openActorEditorDialog({ onSaved: () => void search() })` |

工具条：关键词 `t-input`（回车 / 清空即搜，前缀放大镜）→ 排序 `t-select`（最近更新 / 姓名 / 作品数，`ACTOR_SORTS`）→ 标签 `t-select`（来自 `ActorListResult.tags`）→ 每页条数 `t-select`（`ACTOR_PAGE_SIZES = [30, 60, 120]`，默认 `ACTOR_LIST_PAGE_SIZE = 60`）→ 刷新。搜索、换标签、换每页条数都会把页码重置回第一页。

主体：`t-alert theme="error"` 显示 `failure`；首次加载（`loading && list.length === 0`）显示 `t-loading`；否则用 `grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))` 铺 `ActorCard`（头像 + 姓名 + 作品数 + 标签徽标，点卡片跳 `{ name: '演员详情', query: { actorId } }`）；空结果显示 `t-empty`；`total > limit` 时显示 `t-pagination`。

取数组合式 `list/composables/useActorList.ts`：`keyword` / `tag` / `sort` / `limit` / `page` / `loading` / `failure` / `list` / `tags` / `total`，`load()` 调 `actorApi.list({ keyword, tag, sort, offset: (page - 1) * limit, limit })`，失败只写 `failure`（保留上一次列表）；`search()` 先把 `page` 归 1 再 `load()`。

## 3. 详情页（`detail/ActorDetailPage.vue`）

`SubPageLayout title="演员详情"`，`description` 取演员姓名（未加载时显示 `actorId`），`fallback="/actor"`（返回按钮由容器提供）。`#extra` 三个动作：

| 动作 | 行为 |
| --- | --- |
| 抓取资料 | 先 `pluginApi.list()` 取**已启用**插件的 ID，再 `actorApi.scrape({ actorId, pluginIds })`，用返回的 `message` 提示并重新取数 |
| 编辑资料 | `openActorEditorDialog({ actor, onSaved: () => void load() })` |
| 删除演员 | `MessageBoxUtil.confirm` 二次确认 → `actorApi.remove({ actorId })` → `router.replace('/actor')` |

主体三块：

- `components/ActorProfileBlock.vue`：头像（`SensitiveImage`，走全局 NSFW 保护；没有头像时显示姓名首字占位）+ 资料格（性别 / 生日 / 出生地（`actorBirthplaceText`）/ 身高（`actorHeightText`）/ 三围（`actorMeasurementsText`）/ 罩杯 / 来源链接 / 收录时间 / 刮削插件 / 资料锁定），别名与用户标签用 `t-tag`，简介按原文换行展示；空值统一显示「未填写」。
- `components/ActorGalleryBlock.vue`：图集缩略图 + 「导入图片」「导入头像」按钮（`dialogApi.open({ multiple: true, filters: [{ name: '图片', extensions: ACTOR_IMAGE_EXTENSIONS }] })`，初始目录取 `app.actorImageDir`；「导入头像」是单选），每张图可「设为头像」或删除（删除走二次确认，本机文件与数据库记录一起清掉）；导入失败项用 `MessageUtil.warning` 列出「路径：原因」。
- 出演作品：`MediaWallCard` 网格（`connectionOf` 从 `useFileConnections()` 取连接，用于 NSFW 判定），空态 `t-empty`。

取数组合式 `detail/composables/useActorDetail.ts`：从 `route.query.actorId` 取参，缺失时只写中文 `failure`「地址里缺少演员参数，请从演员列表点进来」并且**不发请求**；`load()` 调 `actorApi.detail({ actorId })`。

## 4. 编辑弹窗（`modals/`）

按项目约定拆成两个文件：

- `ActorEditorDialog.tsx`（外壳）：导出 `openActorEditorDialog({ actor?, onSaved? })`，内部 `DialogPlugin({ destroyOnClose: true, width: …, header, footer, body })`；footer 用 JSX 渲染「取消 / 保存」按钮，按钮 `loading` / `disabled` 读内容组件通过 `defineExpose` 暴露的 `saving` / `canSubmit`；保存成功回调里 `dialog.hide()` 再调 `onSaved`。
- `ActorEditorDialogContent.vue`（内容，不含操作按钮）：props `{ actor?: ActorDetail }`（有值 = 编辑，无值 = 新增），emits `success`（载荷为 `actorId`）与 `close`；`submit()` 组装完整 `ActorSaveRequest` 后调 `actorApi.save`，成功 `MessageUtil.success('已新增演员' | '已保存演员资料')` 并 `emit('success', actorId)`。

表单字段：姓名（必填，`canSubmit = name.trim().length > 0`）、性别、别名（`t-tag-input`，回车添加）、生日（`t-date-picker`）、出生地四格（国家 / 省州 / 城市 / 区县）、身高与三围（`t-input-number`，0 = 未填写）、罩杯、标语、来源链接、简介（`t-textarea`）、用户标签（`t-tag-input`）、锁定资料（`t-switch`，提示「锁定后刮削只补空白字段」）。

## 5. 影片详情页的参演演员条

`pages/media/detail/components/MediaActorStrip.vue`：`props { actors: MediaActorRef[] }`，标题「参演演员（N）」，每项是 56×56 头像（`SensitiveImage` + NSFW 保护，缺失时首字占位）+ 姓名，点击跳 `{ name: '演员详情', query: { actorId } }`。数据来自 `MediaDetailResult.actors`（主进程 `actorRefsOfItem` 按 `media_cast.ordinal` 组装，弱关联只认名字，演员行缺失时 `actorId` 为空串、点击不跳转，见 [影视墙页面](./04-media-wall-page.md) 与 [资料库](../media/01-media-library.md)），在 `MediaDetailPage.vue` 里 `v-if="detail.actors.length > 0"` 挂在 NFO 区块之前。
