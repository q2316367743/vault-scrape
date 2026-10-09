# 基础页面

## 实现思路

七个基础页面覆盖「看状态、干活、调试、配置、查日志、看版本、管插件」七件事，另有[存储管理页面](./02-storage-page.md)承载文件模块的界面。当前概览、日志、关于、设置四个页面接了真实数据（数据库与设置 IPC），存储页接了文件模块 IPC，插件页接了插件模块 IPC（导入 / 启停 / 拖拽排序 / 环境变量配置）与离线数据包 IPC（检查更新 / 下载导入 / 本地导入 / 删除），工具页的搜索工具接了插件模块 IPC（关键字搜索 / 影片 ID 直查），工作台接了刮削模块 IPC（扫描根目录 / 启动 / 取消 / 继续 / 进度推送）。

页面目录位于 `src/renderer/src/windows/main/pages/<页面名>/`，页面私有组件放在同目录的 `components/` 下。嵌套路由再按同一个路径段分一级：一级页面目录放索引页，子路由各占一个同名目录，页面与它的 `components/`、`composables/`、`modals/` 一起进去（例：`/tools` → `pages/tools/ToolsPage.vue`，`/tools/search` → `pages/tools/search/`）。

## 路由

`src/renderer/src/windows/main/router.ts`，使用 `createWebHashHistory`（Electron 文件协议下无需服务端配合）：

| 路径 | 页面 | 名称 |
| --- | --- | --- |
| `/` | 重定向到 `/overview` | — |
| `/overview` | `pages/overview/OverviewPage.vue` | 概览 |
| `/workspace` | `pages/workspace/WorkspacePage.vue` | 工作台 |
| `/storage` | `pages/storage/StoragePage.vue` | 存储 |
| `/plugin` | `pages/plugin/PluginPage.vue` | 插件 |
| `/tools` | `pages/tools/ToolsPage.vue` | 工具 |
| `/tools/search` | `pages/tools/search/ToolSearchPage.vue` | 搜索 |
| `/setting` | `pages/setting/SettingPage.vue` | 设置 |
| `/log` | `pages/log/LogPage.vue` | 日志 |
| `/about` | `pages/about/AboutPage.vue` | 关于 |

全部为 `() => import(...)` 懒加载。

## 概览

- 数据来源：`dbApi.task.stats()` 取任务统计，`dbApi.task.list({ limit: 5 })` 取最近任务。
- 结构：7 张统计卡片（总数 / 等待中 / 进行中 / 已成功 / 已失败 / 已取消 / 已中断）（`components/StatCard.vue`，props `{ label, value }`）+ 最近任务表格。
- 表格列：名称 / 状态 / 进度 / 更新时间。状态用带主题色的标签（`statusThemes` 按 `TaskStatus` 取色），进度显示 `finished / total`，更新时间用 dayjs 格式化为 `YYYY-MM-DD HH:mm:ss`。

## 工作台

左栏选数据源与根目录并扫描（只列根目录一层的视频），右侧是任务卡片 + 文件表格：勾选文件后启动刮削任务，可取消与继续。业务在主进程，页面只消费 `scrapeApi` 的快照与进度推送，因此切换 tab、关闭窗口再回来进度不变。NSFW 保护生效时页头带状态标签。详见[工作台页面](./03-workspace-page.md)与[刮削模块](../scrape/01-scrape-module.md)。

## 存储

左侧管理数据源（本地磁盘 / WebDAV / SMB 连接的新建、编辑、删除、测试连通），右侧浏览并操作远端文件（目录浏览、新建、重命名、复制、移动、删除、文本读改、上传下载）。详见[存储管理页面](./02-storage-page.md)。

## 插件

- 页面 `PluginPage.vue`：左侧 `components/PluginList.vue`（插件列表），右侧 `components/PluginDetail.vue`（概览 + 启停 + 编辑代码 + 删除 + 配置区块）。
- 左栏不是卡片：`PluginList.vue` 是透明的 `<aside>`，只用一条右侧分隔线（`--fluent-sidebar-border`）与右栏分区，自身带 40px 高的「已安装插件 + 数量」头，露出主容器的亚克力材质。
- 列表项固定单行：最左是拖拽手柄（`MoveIcon`，悬停提示「按住任意位置拖动即可调整顺序」），接着名称 +（内置插件）「内置」标签 + 单行省略的描述，描述完整内容与详情页「说明」一样通过 `t-tooltip` 悬停查看；右侧用 `size="small"` 的状态标签显示「已启用 / 已停用」与「待填写变量 / 加载失败」。
- 拖拽排序用 sortablejs：容器取**第一个列表项的父节点**（不假设 tdesign 内部层级——`t-list` 外层若再包一层 `ul`，容器取错会让 Sortable 静默失效），**整行都可拖**（没有位移的点击不会触发原生拖拽，仍按点击处理，即选中插件；手柄只是视觉提示）。拖完先就地重排本地列表，再走 `plugin:reorder` 写回 `plugins.json`；主进程返回的完整列表作为最终顺序，失败则报错并重新拉取列表还原。
- 状态在 `composables/usePlugins.ts`（列表、选中持久化到 localStorage、启停、排序、导入、删除、源码读写、`applySummary` 就地更新单条摘要）里。搜索与影片详情原来挂在插件页，现已整体迁到工具箱，见下文「工具」。
- 环境变量在插件页右栏的**配置区块**（`components/PluginConfigPanel.vue`）填写：只在插件声明了环境变量（`hasEnv`）时渲染，内置插件与没写 `env` 的脚本插件都不会出现空区域；选中插件后按声明表渲染多行文本域，保存以插件为单位；环境变量一律按敏感处理，明文永不回传，文本域留空表示保持已保存的值。保存成功后用主进程返回的 `PluginSummary` 上抛（`PluginDetail` 的 `changed` → 页面的 `applySummary`），列表上的「待填写变量」标签即时更新，不整表刷新。
- 安装（导入 / 保存源码）时会在沙箱里执行一次脚本，读取 `env` 声明并写入索引，不联网、不调用四个方法；声明表即配置区块的数据源。
- 影片详情是命令式抽屉（现位于 `pages/tools/search/`）：外壳 `modals/MovieDetailDrawer.tsx`（`openMovieDetailDrawer`，`DrawerPlugin` 680px、`destroyOnClose`）+ 内容 `modals/MovieDetailDrawerContent.vue`（打开即拉一次详情；顶部「影片 ID + 重新拉详情 / 取封面 / 取花絮」；详情 11 格网格；剧集表；下载配置表按当前下载设置标注「会下载 / 当前不下载」，方便核对防盗链请求头）。
- 源码编辑器是命令式弹窗：外壳 `modals/PluginEditorDialog.tsx`（`openPluginEditorDialog`）+ 内容 `modals/PluginEditorDialogContent.vue`（`t-textarea` + 契约提示，保存时主进程先编译校验再落盘）。
- 导入支持在系统文件选择框里一次多选多个 `.js`；同名（`meta.id`）只保留最新——先比 `meta.version`，版本相同再比源文件 mtime，批内与本机已安装的旧版本都不落盘，只用 `MessagePlugin.info` 提示「已跳过 N 个旧版本插件」；仅当版本相同且未覆盖时弹 `DialogPlugin.confirm`，确认后带 `overwrite: true` 重试；导入的系统文件选择框由主进程弹出。
- 契约、沙箱白名单、超时、存储与错误码见 [../plugin/01-plugin-module.md](../plugin/01-plugin-module.md)。
- 内置插件（当前只有 `r18-offline`「R18 离线数据包」）用 `PluginSummary.source === 'builtin'` 区分：列表与详情都带「内置」标签，没有源码文件，因此详情页隐藏「编辑代码」「删除」，源文件一行显示「内置实现（无源码文件）」。
- 内置插件详情在概览下方挂 `components/OfflinePackPanel.vue`（内置插件 `env` 为空、`hasEnv` 为 false，没有配置区块）：四个按钮（检查更新 / 下载并导入 / 本地导入 / 删除）、阶段进度与取消、数据包日期 / 导入时间 / 上次检查 / 影片数量 / 库大小 / 库路径（下载与删除走 `DialogPlugin.confirm`）；状态集中在 `composables/useOfflineData.ts`（模块级单例，`ensureSubscribed()` 只订阅一次进度与完成事件）。
- 启动时的「离线数据包有新版本」提示在外壳 `App.vue` 里由 `composables/useOfflineUpdateNotice.ts` 完成：先订阅主进程广播、再读一次状态，**每次启动最多提示一次，且绝不自动下载**（自动检查间隔 7 天，由主进程在启动时判断）。
- 离线数据包的数据源、存储布局、导入流水线与查询规则见 [../plugin/02-builtin-offline-plugin.md](../plugin/02-builtin-offline-plugin.md)。

## 工具

- 工具箱是**索引页**：`ToolsPage.vue` 按 `toolRegistry.ts` 的 `ToolEntry[]` 渲染入口卡片（图标 + 名称 + 说明），点击进入各自的工具页路由；新增工具时先在注册表登记、再在 `router.ts` 注册路由。
- 当前唯一工具是**搜索**（`/tools/search`，`pages/tools/search/ToolSearchPage.vue`）：顶部用 `t-select` 选择「使用哪个插件」（选项带「加载失败 / 待填写变量 / 已停用」状态后缀，加载失败的选项禁用），下面 `components/ToolSearchPanel.vue` 提供两个入口——关键字搜索（结果每行 = 单行省略的标题 + `t-tooltip` 悬停看全，下面是带图标的标签行：番号 / 发行日期 / 集数 / 演员，演员超过 3 个折成 `+N` 悬停看全，点行或「详情」按钮打开抽屉）与直接填影片 ID 点「查看详情」。页面用 `SubPageLayout` 包裹：返回图标按钮在标题左侧、点它 `router.back()`，右上角 `#extra` 只放「刷新」。
- 搜索状态在 `composables/useToolSearch.ts`（关键字、候选列表、loading），影片详情在 `composables/useMoviePreview.ts`（按影片 ID 拉详情 / 封面 / 花絮，并按当前下载设置标注资产），资源类型与下载判定在 `toolUtils.ts`（都在 `pages/tools/search/` 下）。
- 选择器与插件页共享同一份「当前插件」（`usePlugins` 持久化到 localStorage 的 `vault-scrape:plugin-active`）：在插件页选中哪个插件，进搜索工具页就是哪个。
- 未启用、必填变量未填的插件仍可被选中，调用由主进程以中文错误拒绝（渲染层不复制这套业务规则）；插件列表为空时页面提示先去「插件」页导入。

## 设置

- 页面 `SettingPage.vue`：顶部横向 `t-tabs`（TDesign Vue Next 的 `t-tabs` 没有竖排模式，因此分组以顶部标签呈现），7 个 `t-tab-panel` 分别承载各面板，默认 `path`，支持 `?group=network` 之类的查询参数直达分组。站点账号类参数不在设置页，见「插件」的配置区块。
- 面板：`components/Setting{Path,Scrape,Network,Translate,Naming,Download,File}Panel.vue`。
- 面板统一形态：`const { setting } = storeToRefs(useSettingXxxStore())` + `t-list` / `t-list-item` / `t-list-item-meta`（`title` + `description`），控件放 `#action` 插槽里的 `.setting-field` 容器中。
- `settingOptions.ts` 集中存放下拉选项（`SettingOption<T>` 接口 + 代理协议、目标语言、附属文件命名、分盘样式、NFO 命名、角标位置）。
- `TemplateHintBar.vue` 是命名规则面板顶部的占位符提示条，点击 chip 复制到剪贴板并弹出成功提示。
- 保存是自动的：store 内 `watchDebounced` 300ms 深监听，变更即写盘（细节见 [../setting/01-setting-storage.md](../setting/01-setting-storage.md)）。
- 目录选择按钮为提示占位，待后续接入。

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
| 设置-目录与路径 | 目录选择对话框（当前为提示占位；dialog 域 IPC 已就绪，见[系统对话框模块](../dialog/01-dialog-module.md)，接入时换成通用组件 `DirectoryPickerField`） |
| 存储-上传 / 下载 | 本机文件与目录选择器（当前为本机绝对路径输入框；dialog 域 IPC 已就绪，接入方式同上） |
| 设置-翻译服务 | 翻译服务实现（当前只有开关与目标语言） |
| 工作台 | 刮削任务创建、队列与执行控制；消费插件产出的「下载配置」并真正下载（含封面角标、NFO 生成、命名落盘） |
| 工具 | 在线番号解析、批量重命名、NFO 校验等工具；搜索工具（`/tools/search`）已接入 |
| 插件 | 在线插件仓库 / 远程更新；插件请求走代理；子进程级隔离（`utilityProcess`）；编辑器语法高亮；内置离线数据包的增量更新与后台下载（当前只提示、由用户手动触发）；环境变量的「清空 / 单独重置」交互 |
| 全局 | 暗色模式（`theme.less` 目前只有亮色一套） |

> 已完成：数据源「本地磁盘」的根目录已接入系统目录选择框（通用组件 `DirectoryPickerField` + dialog 域 IPC），见[存储管理页面](./02-storage-page.md) §5。
