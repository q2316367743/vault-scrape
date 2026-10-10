# 工作台页面

## 1. 定位与入口

工作台是**手动刮削入口**：选一个资料库 → 逐级浏览该库里的目录 → 勾选想刮的影片 → 排队刮削 → 在任务卡片里看进度。业务规则全部在主进程（见[刮削模块](../scrape/01-scrape-module.md)与[资料库](../media/01-media-library.md)），本页只做「转成调用 + 展示快照」。

- 与资料库的关系：日常用法是影视墙的[资料库](../media/01-media-library.md)抽屉里「扫描 + 刮削待刮削影片」（整库递归）；工作台面向「只想挑几部」的场景。两者**共用同一套任务模型**，所以资料库启动的任务同样出现在本页的任务卡片与文件表格里，进度 / 取消 / 继续 / 日志都在这里看。任务面板展示的是**主进程里最近的一条任务**，与当前选中的资料库无关（`TaskItem` 上没有 libraryId）。
- 本页**不再扫盘、也不再自己算索引**：目录内容来自 `scrape:browse`（主进程按资料库配置解析），因此看到的内容与影视墙、扫描结果完全同源。入库入口只有影视墙资料库抽屉里的「扫描」。
- 侧栏一级菜单「工作台」，路由 `/workspace`，懒加载 `WorkspacePage.vue`（`src/renderer/src/windows/main/router.ts`）。
- 数据来源：`@/api` 的 `libraryApi`（`list`）与 `scrapeApi`（`browse` / `start` / `cancel` / `resume` / `getTask` / `listTasks` / `running` / `onProgress`）。
- 页面约定：`PageLayout`（title「工作台」，description「手动挑片刮削：选资料库，逐级浏览后勾选影片排队」，`padded: false`），`#extra` 在任务运行中显示「刮削进行中」标签，主体是左右两栏。

## 2. 目录结构

```
src/renderer/src/windows/main/pages/workspace/
├── WorkspacePage.vue                     # 页面骨架：PageLayout + 左面板 + 右（任务卡片 + 条目表格）
├── workspaceUtils.ts                     # 纯展示工具：任务状态文案 / 主题色 / 时间格式化（路径互转已移到 @/utils/remotePath，这里只转出）
├── composables/
│   └── useWorkspaceScrape.ts             # 状态机：选库、目录浏览、勾选、排队、进度订阅、快照复原
└── components/
    ├── WorkspaceSourcePanel.vue          # 左栏：资料库选择 + 面包屑 + 上一级
    ├── WorkspaceTaskPanel.vue            # 任务卡片：状态、进度、统计、开始 / 取消 / 继续（本轮未改造）
    └── WorkspaceFileTable.vue            # 条目表格：选择 / 名称 / 类型 / 大小 / 修改时间 / 刮削状态
```

## 3. 布局与组件契约

- `WorkspaceSourcePanel`：props `{ libraries, libraryId, library, dirPath, crumbs, loading, locking, selectedCount }`，emit `update:libraryId` / `navigate`。资料库用 `t-select`；面包屑首项是库名、其余按 `dirPath` 逐段累加；「上一级」与面包屑里的祖先项都只 emit `navigate(路径)`，父级路径由面板自己算（`dirPath === FILE_ROOT` 时禁用「上一级」）。`locking` 为真（任务运行中）时禁用库选择。下方常驻显示「N 个目录」（未配置刮削器时显示 warning 标签）与「当前目录」「已勾选 N 个影片」。
- `WorkspaceFileTable`：props `{ rows: MediaBrowseEntry[], selected, loading, emptyText }`，emit `enter` / `toggle` / `toggle-all` / `refresh`。列固定为「选择 / 名称 / 类型 / 大小 / 修改时间 / 刮削状态」；只有 `type === 'movie'` 的行可勾选（目录行禁用），目录行点名称进入下一级；类型列用「目录 / 影片」标签，大小列目录显示「—」；状态列对影片显示「已刮削 / 未刮削」，`hasSource === false` 再补一个「没有播放源」告警标签。卡片右上角是「全选（已选/可选）」复选框（带 `indeterminate` 半选态）与「刷新」按钮。
- `WorkspaceTaskPanel`：props `{ task, running, submitting, selectedCount, total, finished, failed, percentage, canStart, canCancel, canResume }`，emit `start` / `cancel` / `resume`；本轮的「开始」由它发出，语义从「扫描根目录后启动」变成「把当前勾选的影片排队」。

## 4. 状态机（`useWorkspaceScrape.ts`）

- 无入参。内部维护 `libraries` / `libraryId` / `dirPath`（初值 `FILE_ROOT = '/'`，即库的媒体根目录）/ `entries` / `browsing` / `failure` / `selected`（**条目 ID**，不是路径）/ `task` / `submitting` / `running`。
- `browse(path)` 调 `scrapeApi.browse({ libraryId, dirPath: path })`，**成功才更新** `dirPath` 与 `entries`，并剔除本层已不存在的选中项；`enter(entry)` 只对目录下钻，`goto(path)` 供面包屑与「上一级」使用（同路径直接返回）。
- **选中以 `itemId` 为准**：路径不再跨 IPC 传递，刮削过程中改名 / 移动也不会找错文件。`selectedCount` 只统计影片行。
- `start()` 调 `scrapeApi.start({ libraryId, itemIds })`，成功后清空勾选并提示「已排队 N 个影片，进度见下方任务卡片」。
- 切换资料库：`watch(libraryId)` → `reset()`（清空条目与勾选）→ 回到库根目录重新 `browse`。
- **进度复原**：`restore()` 用 `listTasks(1)` 取主进程最近的一条任务做快照，没有任务时用 `running()` 纠正「主进程在跑」的显示；`onProgress` 只处理**当前任务 ID** 的事件（避免多任务串台），并只在「运行中 → 非运行中」时静默重新 `browse(dirPath)`，让「已刮削」标记跟着结果刷新。任务快照的真相在主进程（sqlite），因此切 tab、关闭窗口再回来，进度与结果都在。
- `onUnmounted` 退订进度；`start` / `cancel` / `resume` 的可用性分别由 `canStart` / `canCancel` / `canResume` 控制。
- 空态文案分级（`WorkspacePage.vue`）：没有资料库 →「还没有资料库，请先到影视墙的「资料库」里新建并扫描」；正在读取 →「正在读取目录…」；库根目录没有影片 →「这个资料库里还没有影片，先到「资料库」点「扫描」」；否则「这个目录下没有影片或子目录」。未选库就浏览时提示「请先选择资料库」。

## 5. NSFW 保护

- 判定规则：应用设置 `app.nsfwProtection` 是总开关，存储连接的 `nsfw` 标记决定**哪些存储**受保护，两者同时成立才隐藏内容；没有存储上下文的页面（如工具搜索）只看总开关。判定收敛在 `@/hooks/UseNsfwProtection.ts`：`useNsfwProtection(connection?)` 返回 `{ protection, active }`，并导出 `refreshNsfwProtection()`——它由应用设置 store（`SettingAppStore.ts`）挂在分组保存成功的回调上，所以拨动总开关后约 300ms（防抖落盘）全应用生效，不需要刷新页面。
- 图片位统一用 `@/components/SensitiveImage.vue`（props `{ src, protect, alt?, width?, height?, fit? }`）：保护生效时显示遮罩，用户点击后本次显示放行，刷新页面重新隐藏。组件本身不读设置、不读连接，只认 `protect`；遮罩容器带 `@click.stop`，因此「点击查看」只放行图片，不会连带触发外层元素（如影视墙卡片）的点击。
- 本页**已没有图片位**（条目表格只显示文字与标签，封面列随本轮改造移除），因此页头不再显示 NSFW 标签；当前仍在用图片位的页面是影视墙卡片与详情大封面（见[影视墙页面](./04-media-wall-page.md)，按影片所属存储判定）与工具搜索页的候选预览图（按总开关接入）。后续新增影片列表 / 详情页渲染图片时必须走 `SensitiveImage`，不要直接使用 `t-image`。

## 6. 手工验证清单

按项目约定只跑 `yarn typecheck`，运行时行为手工验证：

1. 一个资料库都没有时进入工作台：左栏选择器可点但没有选项，表格空态提示去影视墙新建资料库并扫描。
2. 选一个资料库：应自动列出该库媒体根目录一层的子目录与影片；目录行不可勾选，影片行可勾选。
3. 点目录行的名称进入下一级：「当前目录」与面包屑同步变化，「上一级」与面包屑祖先项都能回到上级；到库根目录时「上一级」禁用。
4. 勾选若干影片后点「开始」：按钮变 loading，勾选被清空，任务卡片出现并提示「已排队 N 个影片…」；进度条与「已处理 / 失败 / 计划」随推送变化。未勾选任何影片或未选库时「开始」不可点。
5. 切到别的 tab 或最小化窗口若干秒再回来：进度不回退、不清零；关掉窗口重开应用回到工作台，任务仍在。
6. 任务运行中点「取消」后按钮变成「继续」，点「继续」能接着跑完剩余文件；任务结束后当前目录的「已刮削」标记应自动刷新。
7. 从影视墙的资料库抽屉启动一次刮削后回到本页：同一张任务卡片与结果行应能看到（两者共用任务模型）。
8. 打开应用设置里的「NSFW 保护」，并把某个数据源标记为 NSFW：影视墙卡片与工具搜索页的候选预览图应显示遮罩，点击后放行；本页不出现 NSFW 标签。
