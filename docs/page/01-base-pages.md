# 基础页面

## 实现思路

六个基础页面覆盖「看状态、干活、调试、配置、查日志、看版本」六件事。当前只有概览、日志、关于、设置四个页面接了真实数据（数据库与设置 IPC），工作台与工具是结构化占位，等刮削流程落地后填充。

页面目录位于 `src/renderer/src/windows/main/pages/<页面名>/`，页面私有组件放在同目录的 `components/` 下。

## 路由

`src/renderer/src/windows/main/router.ts`，使用 `createWebHashHistory`（Electron 文件协议下无需服务端配合）：

| 路径 | 页面 | 名称 |
| --- | --- | --- |
| `/` | 重定向到 `/overview` | — |
| `/overview` | `pages/overview/OverviewPage.vue` | 概览 |
| `/workspace` | `pages/workspace/WorkspacePage.vue` | 工作台 |
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

## 工具

`t-card` + `t-empty` 的结构化占位，用于放置番号解析、文件重命名、NFO 校验等一次性工具。

## 设置

- 页面 `SettingPage.vue`：顶部横向 `t-tabs`（TDesign Vue Next 的 `t-tabs` 没有竖排模式，因此分组以顶部标签呈现），8 个 `t-tab-panel` 分别承载各面板，默认 `path`。
- 面板：`components/Setting{Path,Scrape,Network,Translate,Naming,Download,File,Account}Panel.vue`。
- 面板统一形态：`const { setting } = storeToRefs(useSettingXxxStore())` + `t-list` / `t-list-item` / `t-list-item-meta`（`title` + `description`），控件放 `#action` 插槽里的 `.setting-field` 容器中。
- `settingOptions.ts` 集中存放下拉选项（`SettingOption<T>` 接口 + 代理协议、目标语言、附属文件命名、分盘样式、NFO 命名、角标位置）。
- `TemplateHintBar.vue` 是命名规则面板顶部的占位符提示条，点击 chip 复制到剪贴板并弹出成功提示。
- 保存是自动的：store 内 `watchDebounced` 300ms 深监听，变更即写盘（细节见 [../setting/01-setting-storage.md](../setting/01-setting-storage.md)）。
- 账号面板为 `t-empty` 占位；目录选择按钮为提示占位，均待后续接入。

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
| 设置-账号设置 | 站点账号参数（需先确定刮削源站点） |
| 设置-翻译服务 | 翻译服务实现（当前只有开关与目标语言） |
| 工作台 | 刮削任务创建、队列与执行控制 |
| 工具 | 番号解析、批量重命名等工具 |
| 全局 | 暗色模式（`theme.less` 目前只有亮色一套） |
