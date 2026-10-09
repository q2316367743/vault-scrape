# 工作台页面

## 1. 定位与入口

工作台是刮削模块的前端外壳：选一个数据源与根目录 → 扫描根目录里的视频 → 勾选要刮削的文件 → 启动任务并观察进度。业务规则全部在主进程（见[刮削模块](../scrape/01-scrape-module.md)），本页只做「转成调用 + 展示快照」。

- 侧栏一级菜单「工作台」，路由 `/workspace`，懒加载 `WorkspacePage.vue`（`src/renderer/src/windows/main/router.ts`）。
- 数据来源：`@/api` 的 `scrapeApi`（扫描 / 启动 / 取消 / 继续 / 取快照 / 最近任务 / 是否在跑 / 进度订阅）与 `settingApi`（读取应用设置里的 NSFW 开关）。
- 页面约定：`PageLayout`（title「工作台」，description「选择存储与根目录，按插件顺序刮削视频」，`padded: false`），`#extra` 放 NSFW 状态标签，主体是左右两栏。

## 2. 目录结构

```
src/renderer/src/windows/main/pages/workspace/
├── WorkspacePage.vue                     # 页面骨架：PageLayout + 左面板 + 右（任务卡片 + 文件表格）
├── workspaceUtils.ts                     # 纯展示工具：状态文案 / 主题色 / 本地路径与连接内路径互转 / 时间格式化
├── composables/
│   └── useWorkspaceScrape.ts             # 状态机：扫描、启动、取消、继续、进度订阅、快照复原
└── components/
    ├── WorkspaceSourcePanel.vue          # 左栏：数据源选择 + 根目录 + 扫描按钮
    ├── WorkspaceTaskPanel.vue            # 任务卡片：状态、进度、统计、开始 / 取消 / 继续
    └── WorkspaceFileTable.vue            # 文件表格：封面、勾选、关键词、番号、状态
```

## 3. 布局与组件契约

- `WorkspaceSourcePanel`：props `{ connections, activeId, connection, dirPath, scanning, locking }`，emit `update:activeId` / `update:dirPath` / `scan`。数据源用 `t-select`；根目录在本地数据源下用通用控件 `DirectoryPickerField`（本机绝对路径），WebDAV / SMB 下退化成 `t-input`（连接内路径），并始终回显「连接内路径」。`locking` 为真（任务运行中）时禁用数据源与扫描按钮。
- `WorkspaceTaskPanel`：props `{ task, running, submitting, selectedCount, total, finished, failed, percentage, canStart, canCancel, canResume }`，emit `start` / `cancel` / `resume`。顶部状态标签取 `TASK_STATUS_LABELS` / `TASK_STATUS_THEMES`，进度条只在任务失败时染红（`progressStatus`）。
- `WorkspaceFileTable`：props `{ rows, selected, loading, protect }`，emit `update:selected` / `update:all`。表格 `row-key="path"`，列固定为「勾选 / 封面 / 文件名 / 搜索关键词 / 番号 / 状态」；封面列用 `SensitiveImage`（48×64）显示刮削产出的封面，`:protect` 由页面传入（即 `useNsfwProtection(activeConnection).active`），没有封面时空态显示「—」；状态列显示状态标签 + 插件 ID + 结果说明（超长用 `t-tooltip`）。重复番号行在「番号」列显示「重复」标签与对比文件，且在 `select-change` 里被过滤掉，无法勾选；卡片右上角是「全选（已选/可选）」，带 `indeterminate` 半选态。
- 状态类型是 `ScrapeFileStatus | 'idle'`：任务结果里没有的扫描行显示「未开始」（`WORKSPACE_STATUS_LABELS`）。

## 4. 状态机（`useWorkspaceScrape.ts`）

- 入参是选中连接的 `Ref`，内部维护 `dirPath` / `entries` / `files` / `task` / `selected` / `scanning` / `submitting` / `running`。
- `rows` 是**扫描结果与任务结果按路径合并**后的表格数据：任务结果优先取 `scrape_file` 里的 `name` / `status` / `pluginId` / `title` / `message`，扫描结果补 `num` / `size` / `duplicateOf`。
- `scan()` 调 `scrapeApi.listVideos`，成功后默认勾选所有非重复文件；`start()` 调 `scrapeApi.start` 再 `getTask` 拉一次逐文件结果；`cancel()` / `resume()` 成功后重新拉快照。
- **进度复原**：`restore()` 先 `listTasks(5)` 找本连接最近的任务并 `refreshTask`，没有任务时用 `running()` 纠正「主进程在跑」的显示；`onProgress` 订阅只接收本连接的事件（任务快照 + 本次变化的文件行做 upsert）。因此切换 tab、关闭窗口再回来，进度与结果都在（真相在 sqlite）。
- `watch(connection.id)` 在切换数据源时 `reset()` 并重新 `restore()`；`onUnmounted` 退订进度。

## 5. NSFW 保护

- 判定规则：应用设置 `app.nsfwProtection` 是总开关，存储连接的 `nsfw` 标记决定**哪些存储**受保护，两者同时成立才隐藏内容；没有存储上下文的页面（如工具搜索）只看总开关。判定收敛在 `@/hooks/UseNsfwProtection.ts`：`useNsfwProtection(connection?)` 返回 `{ protection, active }`，并导出 `refreshNsfwProtection()`——它由应用设置 store（`SettingAppStore.ts`）挂在分组保存成功的回调上，所以拨动总开关后约 300ms（防抖落盘）全应用生效，不需要刷新页面。保护状态是模块级 ref、一次读取全应用共享：**没有任何地方在保存后刷新它，开关就会一直停在本次启动时的首个读取值**，表现正是「开关打开了，影视墙还是直接显示封面」。
- 图片位统一用 `@/components/SensitiveImage.vue`（props `{ src, protect, alt?, width?, height?, fit? }`）：保护生效时显示遮罩，用户点击后本次显示放行，刷新页面重新隐藏。组件本身不读设置、不读连接，只认 `protect`；遮罩容器带 `@click.stop`，因此「点击查看」只放行图片，不会连带触发外层元素（如影视墙卡片）的点击。
- 当前落地：工作台在 `active` 为真时于页头显示「NSFW 保护已生效」标签；文件表格的封面列（`protect` 即 `active`）与工具搜索页的候选预览图（`PluginMovieCandidate.cover`，按总开关接入）是现有的图片位；影视墙的卡片封面与详情抽屉大封面同样走 `SensitiveImage`（按该影片所属存储判定，见[影视墙页面](./04-media-wall-page.md)）。后续新增影片列表 / 详情页渲染图片时必须走 `SensitiveImage`，不要直接使用 `t-image`。

## 6. 手工验证清单

按项目约定只跑 `yarn typecheck`，运行时行为手工验证：

1. 没有数据源时进入工作台：左栏选择器应可点但没有选项，扫描按钮禁用并提示先选数据源。
2. 选一个本地数据源与根目录：根目录用目录选择控件填本机绝对路径，下方「连接内路径」实时变化；切到 WebDAV / SMB 时输入框变为连接内路径。
3. 「扫描根目录」应列出根目录一层的视频并默认全选；同番号文件带「重复」标记且点勾选框无效；「全选」的计数与半选态正确。
4. 启动任务：按钮变 loading，左栏锁定；进度条与「已处理 / 失败 / 计划」随推送变化；文件行状态与插件 ID、结果说明同步更新。
5. 切到别的 tab 或最小化窗口若干秒再回来：进度不回退、不清零；关掉窗口重开应用回到工作台，任务与逐文件结果仍在。
6. 任务运行中点「取消」后按钮变成「继续」，点「继续」能接着跑完剩余文件。
7. 打开应用设置里的「NSFW 保护」，并把某个数据源标记为 NSFW：工作台页头出现「NSFW 保护已生效」；未标记的数据源不出现该标签。到工具搜索页搜索，候选预览图应显示遮罩，点击后放行。
8. 刮削一个能产出封面的文件：文件表格的「封面」列应出现缩略图；该数据源标记 NSFW 且总开关打开时先显示遮罩、点击后放行；没有封面的行显示「—」。重启应用回到工作台，封面应仍能显示（走 `scrape_file` 的 `cover_id` / `cover_path` 兜底解析，不依赖索引是否重建）。
