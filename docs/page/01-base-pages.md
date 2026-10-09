# 基础页面

## 实现思路

七个基础页面覆盖「看状态、干活、调试、配置、查日志、看版本、管插件」七件事，另有[存储管理页面](./02-storage-page.md)承载文件模块的界面。当前只有概览、日志、关于、设置四个页面接了真实数据（数据库与设置 IPC），存储页接了文件模块 IPC，插件页接了插件模块 IPC（导入 / 启停 / 测试）与离线数据包 IPC（检查更新 / 下载导入 / 本地导入 / 删除），工作台与工具是结构化占位，等刮削流程落地后填充。

页面目录位于 `src/renderer/src/windows/main/pages/<页面名>/`，页面私有组件放在同目录的 `components/` 下。

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
| `/setting` | `pages/setting/SettingPage.vue` | 设置 |
| `/log` | `pages/log/LogPage.vue` | 日志 |
| `/about` | `pages/about/AboutPage.vue` | 关于 |

全部为 `() => import(...)` 懒加载。

## 概览

- 数据来源：`dbApi.task.stats()` 取任务统计，`dbApi.task.list({ limit: 5 })` 取最近任务。
- 结构：5 张统计卡片（`components/StatCard.vue`，props `{ label, value }`）+ 最近任务表格。
- 表格列：名称 / 状态 / 进度 / 更新时间。状态用带主题色的标签（`statusThemes` 按 `TaskStatus` 取色），进度显示 `finished / total`，更新时间用 dayjs 格式化为 `YYYY-MM-DD HH:mm:ss`。

## 工作台

`t-card` + `t-empty` 的结构化占位。将来的职责是承载刮削任务的创建、排队与执行控制，数据表 `task` 已就绪。

## 存储

左侧管理数据源（本地磁盘 / WebDAV / SMB 连接的新建、编辑、删除、测试连通），右侧浏览并操作远端文件（目录浏览、新建、重命名、复制、移动、删除、文本读改、上传下载）。详见[存储管理页面](./02-storage-page.md)。

## 插件

- 页面 `PluginPage.vue`：左侧 `components/PluginList.vue`（插件列表），右侧 `components/PluginDetail.vue`（概览 + 启停 + 编辑代码 + 删除 + 测试面板；声明了环境变量的插件额外显示「去填写」跳转条）。
- 列表项固定单行：名称 +（内置插件）「内置」标签 + 单行省略的描述，描述完整内容与详情页「说明」一样通过 `t-tooltip` 悬停查看；右侧用 `size="small"` 的状态标签显示「已启用 / 已停用」与「待填写变量 / 加载失败」。
- 状态在 `composables/usePlugins.ts`（列表、选中持久化到 localStorage、启停、导入、删除、源码读写）与 `composables/usePluginTest.ts`（只负责搜索：关键字、候选列表、loading）里；影片详情在 `composables/useMoviePreview.ts`（按影片 ID 拉详情 / 封面 / 花絮，并按当前下载设置标注资产）。
- 环境变量不在插件页填写，统一放在**设置 → 账号设置**（`SettingAccountPanel.vue`）：按插件分卡片，每个变量一行多行文本域；环境变量一律按敏感处理，明文永不回传，文本域留空表示保持已保存的值。详情页的「去填写」按钮通过 `/setting?group=account` 直达该分组。
- 安装（导入 / 保存源码）时会在沙箱里执行一次脚本，读取 `env` 声明并写入索引，不联网、不调用四个方法；声明表即账号设置面板的数据源。
- 测试面板 `components/PluginTestPanel.vue` 只留两个入口：搜索关键字（结果每行单行省略 + `t-tooltip` 悬停看全，点行或「详情」按钮打开抽屉）与直接填影片 ID 点「查看详情」。
- 影片详情是命令式抽屉：外壳 `modals/MovieDetailDrawer.tsx`（`openMovieDetailDrawer`，`DrawerPlugin` 680px、`destroyOnClose`）+ 内容 `modals/MovieDetailDrawerContent.vue`（打开即拉一次详情；顶部「影片 ID + 重新拉详情 / 取封面 / 取花絮」；详情 11 格网格；剧集表；下载配置表按当前下载设置标注「会下载 / 当前不下载」，方便核对防盗链请求头）。
- 源码编辑器是命令式弹窗：外壳 `modals/PluginEditorDialog.tsx`（`openPluginEditorDialog`）+ 内容 `modals/PluginEditorDialogContent.vue`（`t-textarea` + 契约提示，保存时主进程先编译校验再落盘）。
- 导入重名时弹 `DialogPlugin.confirm`，确认后带 `overwrite: true` 重试；导入的系统文件选择框由主进程弹出。
- 契约、沙箱白名单、超时、存储与错误码见 [../plugin/01-plugin-module.md](../plugin/01-plugin-module.md)。
- 内置插件（当前只有 `r18-offline`「R18 离线数据包」）用 `PluginSummary.source === 'builtin'` 区分：列表与详情都带「内置」标签，没有源码文件，因此详情页隐藏「编辑代码」「删除」，源文件一行显示「内置实现（无源码文件）」。
- 内置插件详情在测试面板上方挂 `components/OfflinePackPanel.vue`：四个按钮（检查更新 / 下载并导入 / 本地导入 / 删除）、阶段进度与取消、数据包日期 / 导入时间 / 上次检查 / 影片数量 / 库大小 / 库路径（下载与删除走 `DialogPlugin.confirm`）；状态集中在 `composables/useOfflineData.ts`（模块级单例，`ensureSubscribed()` 只订阅一次进度与完成事件）。
- 启动时的「离线数据包有新版本」提示在外壳 `App.vue` 里由 `composables/useOfflineUpdateNotice.ts` 完成：先订阅主进程广播、再读一次状态，**每次启动最多提示一次，且绝不自动下载**（自动检查间隔 7 天，由主进程在启动时判断）。
- 离线数据包的数据源、存储布局、导入流水线与查询规则见 [../plugin/02-builtin-offline-plugin.md](../plugin/02-builtin-offline-plugin.md)。

## 工具

`t-card` + `t-empty` 的结构化占位，用于放置番号解析、文件重命名、NFO 校验等一次性工具。

## 设置

- 页面 `SettingPage.vue`：顶部横向 `t-tabs`（TDesign Vue Next 的 `t-tabs` 没有竖排模式，因此分组以顶部标签呈现），8 个 `t-tab-panel` 分别承载各面板，默认 `path`，支持 `?group=account` 之类的查询参数直达分组。
- 面板：`components/Setting{Path,Scrape,Network,Translate,Naming,Download,File,Account}Panel.vue`。
- 面板统一形态：`const { setting } = storeToRefs(useSettingXxxStore())` + `t-list` / `t-list-item` / `t-list-item-meta`（`title` + `description`），控件放 `#action` 插槽里的 `.setting-field` 容器中。
- `settingOptions.ts` 集中存放下拉选项（`SettingOption<T>` 接口 + 代理协议、目标语言、附属文件命名、分盘样式、NFO 命名、角标位置）。
- `TemplateHintBar.vue` 是命名规则面板顶部的占位符提示条，点击 chip 复制到剪贴板并弹出成功提示。
- 保存是自动的：store 内 `watchDebounced` 300ms 深监听，变更即写盘（细节见 [../setting/01-setting-storage.md](../setting/01-setting-storage.md)）。
- 账号面板按插件渲染环境变量多行文本域（保存以插件为单位，未声明 `env` 时显示空态）；目录选择按钮为提示占位，均待后续接入。

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
| 设置-目录与路径 | 目录选择对话框（当前为提示占位，需主进程 `dialog.showOpenDialog`） |
| 存储-上传 / 下载 | 本机文件与目录选择器（当前为本机绝对路径输入框，需主进程 `dialog.showOpenDialog`） |
| 设置-账号设置 | 面板已接入插件声明的环境变量（见 `setting/02-setting-items.md` 第 8 节）；待办：环境变量的「清空 / 单独重置」交互 |
| 设置-翻译服务 | 翻译服务实现（当前只有开关与目标语言） |
| 工作台 | 刮削任务创建、队列与执行控制；消费插件产出的「下载配置」并真正下载（含封面角标、NFO 生成、命名落盘） |
| 工具 | 番号解析、批量重命名等工具 |
| 插件 | 在线插件仓库 / 远程更新；插件请求走代理；子进程级隔离（`utilityProcess`）；编辑器语法高亮；内置离线数据包的增量更新与后台下载（当前只提示、由用户手动触发） |
| 全局 | 暗色模式（`theme.less` 目前只有亮色一套） |
