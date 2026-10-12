# 刮削进度与详情页

## 1. 定位与入口

刮削的「进度 + 历史」集中在**概览页**（`/overview`）：顶部 7 张任务统计卡，下面是「当前刮削进度」卡片（可取消 / 继续）、「演员资料补全」卡片（只读进度）与「刮削记录」分页表。点记录表任意一行进**刮削进度详情**（`/overview/scrape?taskId=…`），只读展示该任务的任务信息与逐文件结果。

- 原「工作台」（`/workspace`：选资料库 → 逐级浏览目录 → 勾选影片排队）**已整体下线**，手动挑片入口一并删除。刮削入口只剩影视墙资料库抽屉里的整库「刮削」（候选 = 全库 `scrapedAt = 0` 的影片），见[影视墙页面](./04-media-wall-page.md)与[资料库](../media/01-media-library.md)。
- 主进程 / preload 的 `scrape:browse`（资料库目录浏览）与 `scrape:start`（按 `media_item.id` 排队）通道**保留**，但渲染层当前没有调用方；渲染层原来包装 `browseMedia` 的 `src/renderer/src/api/scrape.ts` 现在只导出 `scrapeApi = window.preload.scrape`。
- 数据来源：sqlite 侧 `dbApi.task.stats()` / `dbApi.task.list` / `dbApi.task.count`（`db` 域无信封）；主进程侧 `scrapeApi.listTasks(1)` / `getTask` / `running` / `cancel` / `resume` / `onProgress`（`ScrapeResult` 信封）。两条链路都不新增 IPC。
- 页面约定：概览用 `PageLayout`（title「概览」，description「刮削与演员补全进度、历史记录，点记录行查看逐文件结果」）；详情用 `SubPageLayout`（title「刮削进度详情」，description 是任务名，`fallback="/overview"`，返回图标按钮在标题左侧，**不要在 `#extra` 里再放返回按钮**）。

## 2. 目录结构

```
src/renderer/src/windows/main/pages/overview/
├── OverviewPage.vue                    # 组装：7 张统计卡 + 进度卡片 + 演员补全卡片 + 记录表；行点击跳详情
├── components/
│   ├── StatCard.vue                    # 统计卡（原有）
│   ├── ScrapeProgressCard.vue          # 当前刮削进度：任务 / 目录 / 进度条 / 取消 / 继续
│   ├── ActorScrapeProgressCard.vue     # 演员资料补全：当前演员 / 进度条 / 已处理 · 失败 · 排队中 · 计划（只读）
│   └── ScrapeTaskTable.vue             # 刮削记录表：任务列表 + 分页，行点击 open(taskId)
├── composables/
│   ├── useScrapeOverview.ts            # 状态机：统计 / 记录分页 / 当前任务 / 进度订阅 / 取消 / 继续
│   ├── useActorScrape.ts               # 演员补全队列：挂载拉快照 + 订阅 actor:progress 全量状态
│   └── useScrapeTaskDisplay.ts         # 纯展示常量与工具：状态文案与主题色、时间格式化、百分比
└── scrape/                             # 刮削进度详情（子页面独占子目录）
    ├── ScrapeDetailPage.vue            # 页面骨架：SubPageLayout + 任务信息 + 逐文件结果
    ├── components/
    │   ├── ScrapeTaskSummary.vue       # 任务信息（只读）
    │   └── ScrapeFileResultTable.vue   # 逐文件结果（只读，表格内部滚动）
    └── composables/
        └── useScrapeTaskDetail.ts      # 从 query 读 taskId，取「任务 + 逐文件结果」并订阅增量
```

## 3. 路由与侧栏

- 路由 `/overview/scrape`，name `刮削进度详情`，懒加载 `scrape/ScrapeDetailPage.vue`（`src/renderer/src/windows/main/router.ts`）。参数走 **query**（`taskId`），与 `/media/detail?itemId=…`、`/actor/detail?actorId=…` 同一惯例，可直接刷新与复用地址。
- 侧栏「概览」带 `match: 'prefix'`，进详情页后仍保持高亮：`src/renderer/src/components/menu/SideMenuNode.vue` 的 `isSelfActive` 在 `match === 'prefix'` 时用 `path.startsWith(to)`，否则要求路径精确相等。
- 参数缺失（手改地址栏、旧书签）时不发请求，只显示中文空态「地址里缺少刮削任务参数，请从概览的刮削记录里点进来」。
- 一级页面由 10 个减为 9 个（概览 / 影视墙 / 演员 / 存储 / 插件 / 工具 / 设置 / 日志 / 关于）。

## 4. 组件契约

- `ScrapeProgressCard`：props `{ task: ScrapeTaskSnapshot | null, total, finished, failed, percentage, canCancel, canResume, acting }`，emit `cancel` / `resume`。`#actions` 是状态标签（无任务显示「未开始」）；`t-progress` 的 `label` 是 `finished/total`（`total === 0` 时关掉 label），任务 `failed` 时进度条 `status="error"`；`#footer` 依 `canCancel` →「取消任务」（danger outline）、`canResume` →「继续任务」（warning outline），两者都不显示时给灰字提示「在影视墙的资料库抽屉里可发起整库刮削」；`task` 为 `null` 时是 `t-empty description="当前没有刮削任务"`。
- `ScrapeTaskTable`：props `{ tasks: TaskItem[], loading, page, pageSize, total }`，emit `update:page` / `update:pageSize` / `open`。列「任务名（ellipsis）/ 状态 100 / 已处理 · 计划 140 / 失败 80 / 更新时间 150」，`:empty="'暂无刮削记录'"`；整行可点 = `:row-class-name="() => 'is-clickable'"` + `:deep(.is-clickable){ cursor: pointer }`，行点击用 tdesign 的 `@row-click`（回调参数 `RowEventContext<TaskItem>` = `{ row, index, e }`），写成内联箭头 `(context) => emit('open', context.row.id)` 让 vue-tsc 走上下文推断，**不手写 `any`、也不加 `as`**；分页用 `:page` / `:page-size` / `:total` / `:page-size-options="[20, 50, 100]"` + `@current-change` / `@page-size-change` 回传，分页状态留在 composable（不用 `v-model`）。
- `ScrapeTaskSummary`：props `{ task: ScrapeTaskSnapshot }`，只读（状态标签 + 任务名 / 目录 / 创建 / 更新时间 + 进度条 + 已处理 / 失败 / 计划 + message），**没有动作按钮**——取消 / 继续留在概览页的进度卡片。
- `ScrapeFileResultTable`：props `{ files: ScrapeFileItem[] }`，`t-card` 标题带条数「逐文件结果（N）」，列「文件（ellipsis）/ 命中标题 240 / 状态 100 / 说明 240 / 更新时间 150」，`max-height="60vh"` 让表格内部纵向滚动（文件可能很多，不做前端分页）；状态用 `SCRAPE_FILE_STATUS_LABELS`（`@common/types/scrape`）与 `SCRAPE_FILE_STATUS_THEMES`。
- 状态文案与配色集中在 `composables/useScrapeTaskDisplay.ts`：`TASK_STATUS_LABELS` / `TASK_STATUS_THEMES`（排队中 / 刮削中 / 已完成 / 有失败 / 已取消 / 已中断）、`SCRAPE_FILE_STATUS_THEMES`、`formatTimestamp(value)`（`> 0` 时 `YYYY-MM-DD HH:mm`，否则「—」）、`toPercentage(finished, total)`（`total` 为 0 时给 0）。时间列统一 150px 宽（原概览「最近任务」表是 170）。

## 5. 状态机

### `useScrapeOverview()`（概览）

- 返回 `{ stats, tasks, recordsTotal, page, pageSize, loadingTasks, task, running, acting, total, finished, failed, percentage, canCancel, canResume, loadStats, loadTasks, cancel, resume }`。
- 统计与记录读 sqlite：`loadStats()` = `dbApi.task.stats()`；`loadTasks()` = `Promise.all([dbApi.task.list(query), dbApi.task.count(query)])`，`query = { offset: (page - 1) * pageSize, limit: pageSize }`，默认 `pageSize = 20`。分页顺序是主进程 `listTask` 的 `created_at desc`。
- **当前任务 = 主进程最近一条任务**：`loadCurrent()` 先 `scrapeApi.listTasks(1)`，有任务就 `refreshTask(id)`（`scrapeApi.getTask` + `isScrapeOk` 判定，失败用 `MessagePlugin.error` 提示）；一条任务都没有时取 `scrapeApi.running()`，同时把 `task` 置空。任务真相在主进程（sqlite），所以切 tab、关窗再回来进度与结果都在。
- `canCancel = running && task !== null`；`canResume = !running && task.status === 'paused' && task.total > task.finished`。
- 进度事件 `applyProgress(event)`：`adopt = current === null || event.task.id === current.id || current.status !== 'running'` 时才接管 `task` / `running`——既避免多任务串台，也能接住「本页空闲时新起的任务」；命中就用事件里的任务替换 `tasks` 中同 id 的那一行；**「运行中 → 非运行中」时再拉一次统计与记录**，让统计卡与列表收敛到落库结果，不做本地乐观更新。
- 分页：`watch(pageSize, resetToFirstPage)`、`watch(page, loadTasks)`。
- `onMounted` 先订阅 `scrapeApi.onProgress`，再 `Promise.all([loadStats(), loadTasks(), loadCurrent()])`；`onUnmounted` 退订。
- `cancel()` 成功后 `running = false` 并重新拉一次快照，提示「已取消，剩余影片可稍后继续」；`resume()` 成功后 `running = true` 并重新拉快照；两个动作共用 `acting` 给按钮做 loading。

### `useActorScrape()`（概览的演员补全）

- 返回 `{ status, hasTask, percentage, loadStatus }`；`hasTask = status.total > 0`，`percentage = toPercentage(status.finished, status.total)`。
- 数据来自主进程的演员补全队列（与概览的刮削任务是完全独立的两条链路）：`onMounted` 先 `actorApi.onScrapeProgress(next => status.value = next)` 订阅 `actor:progress`，再 `void loadStatus()`（`actorApi.scrapeStatus()` + `isActorOk` 判定）拉一次快照；事件是**全量状态**而不是增量字段，直接覆盖本地值。
- 队列在主进程跑，`onUnmounted` 只退订，关页面 / 切页不影响补全；重新挂载即可复原当前进度。
- 内存态：跑空后保留最后一轮数字（卡片仍显示「已完成 / 有失败」），应用重启清零；卡片没有动作按钮，队列不支持取消。

### `useScrapeTaskDetail()`（详情）

- 返回 `{ taskId, task, files, loading, failure, load }`。`taskId` 从 `route.query.taskId` 读，非 string 视为缺失。
- `load()` 调 `scrapeApi.getTask(taskId)`：成功写 `task`（快照）与 `files`（**全量**逐文件结果），失败把信封 `message` 写进 `failure`；`loading` 只用于首次加载的 `t-loading`。
- `applyProgress(event)` 只认 `event.task.id === taskId`，按 `file.id` 替换已有行、没有就追加，避免多任务串台。
- `onMounted` 订阅 + `load()`，`onUnmounted` 退订。

## 6. 与资料库 / 影视墙的关系

- 启动入口：影视墙资料库抽屉的整库「刮削」（`library:scrape` → `startLibraryScrape`）。启动后的进度 / 取消 / 继续 / 逐文件结果都回概览页看，提示文案同步指向概览：「已自动开始刮削「名称」：N 个文件，进度见概览页」与「已为「名称」排队 N 个文件，进度见概览页的刮削记录」。
- 任务与逐文件结果的字段口径、错误码与调度细节见[刮削模块](../scrape/01-scrape-module.md)；`task` / `scrape_file` 两张表与排序见[SQLite 存储](../data/01-sqlite-storage.md)。

## 7. 手工验证清单

按项目约定只跑 `yarn run typecheck`，运行时行为手工验证：

1. 侧栏不再有「工作台」；访问旧书签 `#/workspace` 不应再出现工作台页面（当前没有兜底路由，会显示空内容区）。
2. 概览页自上而下是 7 张统计卡、「当前刮削进度」卡片、「演员资料补全」卡片、「刮削记录」表。
3. 记录表分页：切到第 2 页、把每页条数改成 50 / 100，表格内容与总数应同步正确，改每页条数后回到第 1 页。
4. 点记录行任意位置进详情页：侧栏「概览」仍高亮，标题左侧有返回按钮，点它回到概览。
5. 详情页只读（没有取消 / 继续按钮）；正在跑的任务，进度条与逐文件状态应随推送变化，不需要刷新页面。
6. 概览页点「取消任务」后按钮变「继续任务」，点「继续」能接着跑完剩余文件；任务结束后统计卡与记录表自动刷新。
7. 详情页手改地址去掉 `taskId`（`#/overview/scrape`）显示中文提示且不发请求；填一个不存在的 `taskId` 显示主进程的错误文案。
8. 从影视墙资料库抽屉点「刮削」后回到概览页：进度卡片与记录表出现同一条任务；扫描触发的自动刮削提示应写「进度见概览页」。
9. 本页没有图片位，因此不涉及 NSFW 遮罩。
10. 演员页点「补全缺失资料」后回概览页：提示写「…，进度见概览页」，卡片标题「演员资料补全」，标签从「补全中」变「已完成」，当前演员与 `已处理 / 计划` 随推送递增；有失败时标签「有失败」且进度条变红；关掉概览页再回来数字不丢（队列在主进程），重启应用后回到「空闲」。
