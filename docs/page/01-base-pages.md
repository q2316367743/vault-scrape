# 基础页面

## 实现思路

九个一级页面（概览 / 影视墙 / 演员 / 存储 / 插件 / 工具 / 设置 / 日志 / 关于）覆盖「看状态、浏览库、管演员、调试、配置、查日志、看版本、管插件」这些事，子页面有存储管理（见[存储管理页面](./02-storage-page.md)）、影视墙详情（见[影视墙页面](./04-media-wall-page.md)）、演员详情（见[演员页面](./05-actor-pages.md)）、工具搜索（见下文「工具」）与刮削进度详情（见[刮削进度与详情页](./03-scrape-detail-page.md)）。当前概览、日志、关于、设置四个页面接了真实数据（数据库与设置 IPC），存储页接了文件模块 IPC（只读：连接管理、`list` / `stat`、读 nfo 原文，加 `storage://` 路径预览的区间流），插件页接了插件模块 IPC（按类别分影片信息 / 演员信息 / 翻译三个 tab；导入 / 启停 / 拖拽排序 / 环境变量配置）与离线数据包 IPC（检查更新 / 下载导入 / 本地导入 / 删除），工具页的搜索工具接了插件模块 IPC（关键字搜索 / 影片 ID 直查），概览接了任务与刮削模块 IPC（任务统计 / 分页记录 / 当前任务快照 / 进度推送 / 取消 / 继续）与演员补全队列的快照 + 进度推送，影视墙接了媒体与资料库模块 IPC（整墙取数 / 影片详情与 NFO 解析 / 详情页「还原刮削前」/ 资料库增删改与扫描），演员页接了演员模块 IPC（列表 / 详情 / 编辑 / 删图 / 抓取资料 / 批量补全）。

页面目录位于 `src/renderer/src/windows/main/pages/<页面名>/`，页面私有组件放在同目录的 `components/` 下。嵌套路由再按同一个路径段分一级：一级页面目录放索引页，子路由各占一个同名目录，页面与它的 `components/`、`composables/`、`modals/` 一起进去（例：`/tools` → `pages/tools/ToolsPage.vue`，`/tools/search` → `pages/tools/search/`）。

## 路由

`src/renderer/src/windows/main/router.ts`，使用 `createWebHashHistory`（Electron 文件协议下无需服务端配合）：

| 路径 | 页面 | 名称 |
| --- | --- | --- |
| `/` | 重定向到 `/overview` | — |
| `/overview` | `pages/overview/OverviewPage.vue` | 概览 |
| `/overview/scrape` | `pages/overview/scrape/ScrapeDetailPage.vue` | 刮削进度详情 |
| `/media` | `pages/media/home/MediaHomePage.vue` | 影视墙 |
| `/media/library` | `pages/media/wall/MediaWallPage.vue` | 影视墙资料库 |
| `/media/detail` | `pages/media/detail/MediaDetailPage.vue` | 影视墙详情 |
| `/storage` | `pages/storage/StoragePage.vue` | 存储 |
| `/plugin` | `pages/plugin/PluginHomePage.vue` | 插件（tab 外壳，redirect `/plugin/movie`） |
| `/plugin/movie` | `pages/plugin/movie/MoviePluginPage.vue` | 影片信息插件 |
| `/plugin/actor` | `pages/plugin/actor/ActorPluginPage.vue` | 演员信息插件 |
| `/plugin/translate` | `pages/plugin/translate/TranslatePluginPage.vue` | 翻译插件 |
| `/tools` | `pages/tools/ToolsPage.vue` | 工具 |
| `/tools/search` | `pages/tools/search/ToolSearchPage.vue` | 搜索 |
| `/setting` | `pages/setting/SettingPage.vue` | 设置 |
| `/log` | `pages/log/LogPage.vue` | 日志 |
| `/about` | `pages/about/AboutPage.vue` | 关于 |

全部为 `() => import(...)` 懒加载。

## 概览

- 数据来源：`dbApi.task.stats()` 取任务统计，`dbApi.task.list` / `count` 取刮削记录（分页）；主进程侧 `scrapeApi.listTasks(1)` 取最近一条任务作为「当前任务」，`onProgress` 订阅进度，`cancel` / `resume` 作用于它；演员补全队列走另一条链路 `actorApi.scrapeStatus()`（挂载快照）+ `actorApi.onScrapeProgress`（`actor:progress` 全量状态推送）。
- 结构：7 张统计卡片（总数 / 等待中 / 进行中 / 已成功 / 已失败 / 已取消 / 已中断）（`components/StatCard.vue`，props `{ label, value }`）+「当前刮削进度」卡片（`components/ScrapeProgressCard.vue`：任务 / 目录 / 更新时间、进度条与已处理 · 失败 · 计划，底部是取消 / 继续按钮，没有任务时提示「在影视墙的资料库抽屉里可发起整库刮削」）+「演员资料补全」卡片（`components/ActorScrapeProgressCard.vue`：当前演员 / 更新时间、进度条与已处理 · 失败 · 排队中 · 计划，只读；没有任务时空态「当前没有演员补全任务」，状态标签在补全中 / 有失败 / 已完成 / 空闲之间切换）+「刮削记录」表（`components/ScrapeTaskTable.vue`：任务名 / 状态 / 已处理 · 计划 / 失败 / 更新时间 + 分页，默认每页 20 条，可选 20 / 50 / 100）。
- 表格列：名称 / 状态 / 进度 / 更新时间。状态用带主题色的标签（`TASK_STATUS_THEMES` 按 `TaskStatus` 取色），进度显示 `finished / total`，更新时间用 dayjs 格式化为 `YYYY-MM-DD HH:mm`。
- **点记录表任意一行**进刮削进度详情（`/overview/scrape?taskId=…`，整行可点，光标为手型）；取消 / 继续留在进度卡片，详情页保持只读。演员补全卡片没有动作按钮（队列不支持取消），进度是主进程内存态、重启清零。详见[刮削进度与详情页](./03-scrape-detail-page.md)。

## 影视墙

侧栏「概览」下方的第二个一级入口（`/media` 首页 + `/media/library` 内容页 + `/media/detail` 详情页）。首页上半是资料库横排，下半是**最近添加 / 推荐**两排（整排为空则不渲染），工具条提供搜索（回车跳内容页）、资料库抽屉与「全部影片」按钮；内容页是单库或全部影片的网格，支持搜索与三种排序（默认按修改时间）。墙面 = 各资料库扫描出来的**影片条目**（剧集库放的则是**剧集**——一整部剧算一条，卡上标「N 季 M 集」，点进详情页在选集区挑季 / 集播放），不属于任何资料库的影片不会上墙；封面取条目自己的主图、没有就退回父目录条目的主图，没刮过刮削的条目以文件名占位显示（**不按刮削与否分类**）。资料库的增删改与扫描 / 刮削都在资料库抽屉里。详情页没有页头横条（不用 `SubPageLayout`），页顶一条**吸顶**悬浮条：封面图左上角是返回、右上角是「更多」菜单（滚动时它不会被滚走；头部的标题滚出视野后它会退成一条半透明横幅，横幅里是单行省略的标题 + 收成圆形的「更多」）。菜单里除「重新读取」外还有「**还原刮削前**」：二次确认后清掉这条影片的刮削数据，并按 NFO 里记的刮削前位置把视频改回原名 / 搬回原目录、删掉刮削写下的图片与预告片（原位置有同名文件时不覆盖，演员档案保留，清完不自动重刮），用来处理刮错的数据，是影视墙域唯一的写操作（剧集库还原的是**整部剧**：剧集根 → 逐季 → 逐集，见[剧集支持](../media/02-series-support.md)）。图片位统一走 `SensitiveImage`，NSFW **以应用设置的总开关为前提**：开启时命中所属资料库的 `nsfwProtection` 才遮罩（连接上没有 NSFW 标记），关闭时一律不遮。详见[影视墙页面](./04-media-wall-page.md)。

## 刮削进度详情

`/overview/scrape?taskId=…` 是只读二级页：上面是任务信息（`scrape/components/ScrapeTaskSummary.vue`：状态标签 + 任务名 / 目录 / 创建 / 更新时间 + 进度条 + 已处理 · 失败 · 计划 + message），下面是逐文件结果表（`scrape/components/ScrapeFileResultTable.vue`：文件 / 命中标题 / 状态 / 说明 / 更新时间，`max-height="60vh"` 内部滚动）。取数走 `scrapeApi.getTask(taskId)`（一次拿到任务快照 + 全量逐文件结果），运行中的任务再靠 `onProgress` 按 `file.id` 增量更新；参数缺失或任务不存在时显示中文空态。返回按钮由 `SubPageLayout` 提供（`fallback="/overview"`）。详见[刮削进度与详情页](./03-scrape-detail-page.md)。

## 存储

左侧管理数据源（本地磁盘 / WebDAV / SMB 连接的新建、编辑、删除、测试连通），右侧**只读**浏览连接内目录（进入目录、面包屑、刷新）并预览媒体文件与 nfo（点开是抽屉：视频 / 音频可播可拖、图片可看、nfo 可切换解析字段与原始 XML）。新建 / 上传 / 下载 / 重命名 / 复制 / 移动 / 删除 / 编辑文本与传输进度面板均已下线（主进程 file 接口保留）。详见[存储管理页面](./02-storage-page.md)。

## 插件

- 插件页是**一个入口 + 三个 tab**（影片信息 / 演员信息 / 翻译，类别与契约见 [../plugin/03-plugin-categories.md](../plugin/03-plugin-categories.md)）：外壳 `pages/plugin/PluginHomePage.vue` 只放 `t-tabs` 条、旧版插件提示与 `<router-view>`（自身不套 `page-layout`，避免双层页头），三个 tab 分别路由到 `plugin/movie/MoviePluginPage.vue` / `plugin/actor/ActorPluginPage.vue` / `plugin/translate/TranslatePluginPage.vue`；每个类别页都复用 `components/PluginManagerView.vue`（`props: { kind }`，左列表 + 右详情，自身不套 `page-layout`、不再有标题 / 说明页头）、`components/PluginList.vue`（插件列表，左）与 `components/PluginDetail.vue`（概览 + 启停 + 编辑代码 + 删除 + 配置区块，右）。
- 左栏不是卡片：`PluginList.vue` 是透明的 `<aside>`，只用一条右侧分隔线（`--fluent-sidebar-border`）与右栏分区，自身带 40px 高的面板头 `components/PluginListHeader.vue`——「全选复选框 + 已安装插件 + 数量 + 刷新 / 导入」（事件 `refresh` / `import-plugins` / `toggle-all` 上抛，由 `PluginManagerView` 执行），露出主容器的亚克力材质。
- 列表项固定单行：最左是勾选框（多选用，点它 `.stop` 只切换勾选、不会连带选中插件），接着是拖拽手柄（`MoveIcon`，悬停提示「按住任意位置拖动即可调整顺序」），再是名称 +（内置插件）「内置」标签 + 单行省略的描述，描述完整内容与详情页「说明」一样通过 `t-tooltip` 悬停查看；右侧用 `size="small"` 的状态标签显示「已启用 / 已停用」与「待填写变量 / 加载失败」。
- 批量操作用选中项驱动：勾选状态在 `composables/usePluginSelection.ts`（纯 UI 状态、不落 localStorage，列表刷新后自动淘汰已不存在的 ID），有选中项时面板头下方出现一条批量操作条（启用 / 停用 / 删除 / 取消，同为 `PluginListHeader.vue` 的第二个根节点），事件经 `PluginList` 上抛 ID 数组；`PluginManagerView` 负责确认弹窗与内置插件剔除（内置插件不可删除），`usePluginManager` 的 `setEnabledMany` / `removeMany` **串行**逐个落盘（`plugins.json` 是「读 → 改 → 写」，并发会互相覆盖；插件数量只有个位数）后统一刷新，失败项聚合提示。
- 拖拽排序用 sortablejs：容器取**第一个列表项的父节点**（不假设 tdesign 内部层级——`t-list` 外层若再包一层 `ul`，容器取错会让 Sortable 静默失效），**整行都可拖**（没有位移的点击不会触发原生拖拽，仍按点击处理，即选中插件；手柄只是视觉提示），勾选框区域用 `filter: '.plugin-check'` + `preventOnFilter: false` 排除在拖拽外且不拦它的 mousedown。拖完先就地重排本地列表，再走 `plugin:<类别>:reorder`（如 `plugin:movie:reorder`）写回该类别目录下的 `plugins.json`；主进程返回的完整列表作为最终顺序，失败则报错并重新拉取列表还原。
- 状态在 `composables/usePluginManager.ts`（`usePluginManager(kind)`，按类别各持一份模块级状态；列表、选中持久化到 localStorage、启停 / 批量启停、排序、导入、删除 / 批量删除、源码读写、`applySummary` 就地更新单条摘要）里；IPC 走 `api/plugin.ts` 的 `pluginBridge(kind)`（`pluginApi.movie` / `.actor` / `.translate`）。搜索与影片详情原来挂在插件页，现已整体迁到工具箱，见下文「工具」。
- 环境变量在插件页右栏的**配置区块**（`components/PluginConfigPanel.vue`）填写：只在插件声明了环境变量（`hasEnv`）时渲染，内置插件与没写 `env` 的脚本插件都不会出现空区域；选中插件后按声明表渲染多行文本域，保存以插件为单位；环境变量一律按敏感处理，明文永不回传，文本域留空表示保持已保存的值。保存成功后用主进程返回的 `PluginSummary` 上抛（`PluginDetail` 的 `changed` → 页面的 `applySummary`），列表上的「待填写变量」标签即时更新，不整表刷新。
- 安装（导入 / 保存源码）时会在沙箱里执行一次脚本，读取 `env` 声明并写入索引，不联网、不调用四个方法；声明表即配置区块的数据源。
- 影片详情是命令式抽屉（现位于 `pages/tools/search/`）：外壳 `modals/MovieDetailDrawer.tsx`（`openMovieDetailDrawer`，`DrawerPlugin` 680px、`destroyOnClose`）+ 内容 `modals/MovieDetailDrawerContent.vue`（打开即拉一次详情；顶部「影片 ID + 重新拉详情 / 取封面 / 取花絮」；详情 11 格网格；剧集表；下载配置表按当前下载设置标注「会下载 / 当前不下载」，方便核对防盗链请求头）。
- 源码编辑器是命令式弹窗：外壳 `modals/PluginEditorDialog.tsx`（`openPluginEditorDialog`）+ 内容 `modals/PluginEditorDialogContent.vue`（`t-textarea` + 契约提示，只有编辑器本体；底部 footer 的「取消 / 保存」由外壳渲染，保存动作与 `saving` / `canSubmit` 由内容组件 `defineExpose` 暴露，见 `src/renderer/src/utils/modal/ModalContent.ts`；保存时主进程先编译校验再落盘）。
- 导入支持在系统文件选择框里一次多选多个 `.js`；同名（`meta.id`）只保留最新——先比 `meta.version`，版本相同再比源文件 mtime，批内与本机已安装的旧版本都不落盘，只用 `MessagePlugin.info` 提示「已跳过 N 个旧版本插件」；仅当版本相同且未覆盖时弹 `DialogPlugin.confirm`，确认后带 `overwrite: true` 重试；导入的系统文件选择框由主进程弹出。
- 契约、沙箱白名单、超时、存储与错误码见 [../plugin/01-plugin-module.md](../plugin/01-plugin-module.md)。
- 内置插件（当前只有 `r18-offline`「R18 离线数据包」，属**影片信息**类别）用 `PluginSummary.source === 'builtin'` 区分：列表与详情都带「内置」标签，没有源码文件，因此详情页隐藏「编辑代码」「删除」，源文件一行显示「内置插件（无源码文件）」。
- 内置插件详情在概览下方挂 `movie/components/OfflinePackPanel.vue`——`MoviePluginPage.vue` 通过 `PluginManagerView` 的 `#detail-extra` 插槽注入，仅当前选中项是内置插件时出现（内置插件 `env` 为空、`hasEnv` 为 false，没有配置区块）：四个按钮（检查更新 / 下载并导入 / 本地导入 / 删除）、阶段进度与取消、数据包日期 / 导入时间 / 上次检查 / 影片数量 / 库大小 / 库路径（下载与删除走 `DialogPlugin.confirm`）；状态集中在 `movie/composables/useOfflineData.ts`（模块级单例，`ensureSubscribed()` 只订阅一次进度与完成事件）。
- 侧栏「插件」项用 `match: 'prefix'`，进入任一类别 tab 都保持高亮。
- 旧版平铺插件（`~/.vault-scrape/plugin/*.js`，没有 `meta.kind`）不再加载，由 `PluginHomePage.vue` 顶部的 `components/PluginLegacyAlert.vue` 调 `pluginApi.legacy()` 给出提示。
- 启动时的「离线数据包有新版本」提示在外壳 `App.vue` 里由 `composables/useOfflineUpdateNotice.ts` 完成：先订阅主进程广播、再读一次状态，**每次启动最多提示一次，且绝不自动下载**（自动检查间隔 7 天，由主进程在启动时判断）。
- 离线数据包的数据源、存储布局、导入流水线与查询规则见 [../plugin/02-builtin-offline-plugin.md](../plugin/02-builtin-offline-plugin.md)。

## 工具

- 工具箱是**索引页**：`ToolsPage.vue` 按 `toolRegistry.ts` 的 `ToolEntry[]` 渲染入口卡片（图标 + 名称 + 说明），点击进入各自的工具页路由；新增工具时先在注册表登记、再在 `router.ts` 注册路由。
- 当前唯一工具是**搜索**（`/tools/search`，`pages/tools/search/ToolSearchPage.vue`）：顶部用 `t-select` 选择「使用哪个插件」（选项带「加载失败 / 待填写变量 / 已停用」状态后缀，加载失败的选项禁用），下面 `components/ToolSearchPanel.vue` 提供两个入口——关键字搜索（结果每行 = 单行省略的标题 + `t-tooltip` 悬停看全，下面是带图标的标签行：番号 / 发行日期 / 集数 / 演员，演员超过 3 个折成 `+N` 悬停看全，点行或「详情」按钮打开抽屉）与直接填影片 ID 点「查看详情」。页面用 `SubPageLayout` 包裹：返回图标按钮在标题左侧、点它 `router.back()`，右上角 `#extra` 只放「刷新」。
- 搜索状态在 `composables/useToolSearch.ts`（关键字、候选列表、loading），影片详情在 `composables/useMoviePreview.ts`（按影片 ID 拉详情 / 封面 / 花絮，并按当前下载设置标注资产），资源类型与下载判定在 `toolUtils.ts`（都在 `pages/tools/search/` 下）。
- 选择器与「影片信息插件」页共享同一份「当前插件」（都用 `usePluginManager('movie')`，选中持久化到 localStorage 的 `vault-scrape:plugin-active:movie`）：在插件页影片信息 tab 选中哪个插件，进搜索工具页就是哪个。
- 未启用、必填变量未填的插件仍可被选中，调用由主进程以中文错误拒绝（渲染层不复制这套业务规则）；插件列表为空时页面提示先去「插件」页导入。

## 设置

- 页面 `SettingPage.vue`：顶部横向 `t-tabs`（TDesign Vue Next 的 `t-tabs` 没有竖排模式，因此分组以顶部标签呈现），8 个 `t-tab-panel` 分别承载各面板，默认 `app`，支持 `?group=network` 之类的查询参数直达分组。站点账号类参数不在设置页，见「插件」的配置区块。
- 面板：`components/Setting{App,Library,Scrape,Network,Translate,Naming,Download,File}Panel.vue`（`SettingLibraryPanel.vue` 是「资料库」页签：按 `LIBRARY_TYPES` 逐类型用 `t-tag-input` 维护媒体后缀清单，失焦清洗、清空回落默认值，保存沿用 store 的防抖）。
- 面板统一形态：`const { setting } = storeToRefs(useSettingXxxStore())` + `t-list` / `t-list-item` / `t-list-item-meta`（`title` + `description`），控件放 `#action` 插槽里的 `.setting-field` 容器中。
- `settingOptions.ts` 集中存放下拉选项（`SettingOption<T>` 接口 + 代理协议、目标语言、附属文件命名、分盘样式、NFO 命名、角标位置）。
- `TemplateHintBar.vue` 是命名规则面板顶部的占位符提示条，点击 chip 复制到剪贴板并弹出成功提示。
- 保存是自动的：store 内 `watchDebounced` 300ms 深监听，变更即写盘（细节见 [../setting/01-setting-storage.md](../setting/01-setting-storage.md)）。
- 应用设置里的「演员图片目录」（`app.actorImageDir`）用通用控件 `DirectoryPickerField.vue`：输入框 + 「选择」按钮，按钮内部调 `dialogApi.open({ title, directory: true })` 并把选中的绝对路径写回输入框，留空表示用默认位置（`~/<数据目录>/media/actor`）。

## 日志

- 页面 `LogPage.vue`：等级筛选（`'all' | LogLevel`）、分页（`page` / `pageSize`，可选 20/50/100）、清空按钮。
- `buildQuery()` 把当前筛选条件转成 `LogQuery`（`level` / `offset` / `limit`）；筛选或分页变化时重置到第一页后再拉取，避免重复请求。
- 清空走命令式 `DialogPlugin.confirm({ theme: 'warning' })`，确认后 `dbApi.log.clear()`，关闭弹窗、提示成功并重新加载。
- 表格 `components/LogTable.vue`：props `{ items, loading }`，等级列用标签着色（`levelThemes` / `levelLabels`）。

## 关于

展示 8 行版本信息：`window.electron.process.versions`（Electron / Chrome / Node / V8 等）与 `window.electron.process.platform`，应用自身的 Vue 版本通过 `import { version as vueVersion } from 'vue'` 取得。

## 待接入项

| 位置 | 待办 |
| --- | --- |
| 存储-上传 / 下载 | **入口已随存储页只读改造下线**（`PathDialog` 整套删除）。将来恢复上传 / 下载时再按本行做法接本机文件 / 目录选择器（dialog 域 IPC 已就绪） |
| 设置-翻译服务 | 翻译服务实现（当前只有开关与目标语言） |
| 刮削 | 按条目挑片入口（`scrape:browse` / `scrape:start` 通道保留、渲染层暂无调用方）；消费插件产出的「下载配置」并真正下载（含封面角标、NFO 生成、命名落盘）；演员补全队列的**取消 / 逐位结果历史**（当前只有概览页的内存态进度，不落库） |
| 工具 | 在线番号解析、批量重命名、NFO 校验等工具；搜索工具（`/tools/search`）已接入 |
| 插件 | 在线插件仓库 / 远程更新；插件请求走代理；子进程级隔离（`utilityProcess`）；编辑器语法高亮；内置离线数据包的增量更新与后台下载（当前只提示、由用户手动触发）；环境变量的「清空 / 单独重置」交互 |
| 全局 | 暗色模式（`theme.less` 目前只有亮色一套） |

> 本地磁盘的根目录由通用控件 `DirectoryPickerField.vue` 承担：它选的是**本机绝对路径**（输入框 + 「选择」按钮，内部调 `dialogApi.open({ directory: true })`），`src/renderer/src/windows/main/pages/storage/modals/ConnectionDialogContent.vue:53` 的 `<directory-picker-field>` 正是它。资料库的媒体目录**不**用它——那里要的是连接内目录，走资料库自己的 `RemoteDirDialog`（`fileApi.list` 列连接内目录，见[影视墙页面](./04-media-wall-page.md)）。两者并存是正确设计，详见[系统对话框模块 §6.1](../dialog/01-dialog-module.md) 与[存储管理页面](./02-storage-page.md) §5。
