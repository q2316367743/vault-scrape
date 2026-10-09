# 渲染层外壳与主题

## 实现思路

界面遵循 Fluent Design：轻微层级差异、克制的阴影与圆角、清晰的悬停/选中反馈。所有 UI 组件来自 TDesign Vue Next，图标来自 `tdesign-icons-vue-next`，不手写 SVG。颜色一律通过 TDesign 的 CSS 变量取用，裸色值只允许出现在 `theme.less` 一处，作为变量的定义源。

布局尺寸（宽度、间距、flex 关系）可以用 UnoCSS 原子类；颜色类必须走 `td-*` 映射（映射到 `var(--td-*)`），不写 `text-blue-500` 这类裸色。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/renderer/index.html` | HTML 入口，脚本指向 `windows/main/main.ts` |
| `src/renderer/src/windows/main/main.ts` | 挂载 Vue 应用，注册 pinia 与 router |
| `src/renderer/src/windows/main/App.vue` | 应用外壳：标题栏 + 侧栏 + 内容区 |
| `src/renderer/src/windows/main/router.ts` | 路由表 |
| `src/renderer/src/windows/main/pages/app/AppTitleBar.vue` | 自定义标题栏：折叠按钮、主题切换按钮、产品名、自绘窗口按钮 |
| `src/renderer/src/windows/main/pages/app/AppSide.vue` | 侧栏容器与菜单数据 |
| `src/renderer/src/components/menu/types.ts` | `SideMenuItem` 接口 |
| `src/renderer/src/components/menu/SideMenu.vue` | 菜单列表容器 |
| `src/renderer/src/components/menu/SideMenuNode.vue` | 单个菜单节点（递归） |
| `src/renderer/src/components/PageLayout/PageLayout.vue` | 页面统一容器 |
| `src/renderer/src/components/PageLayout/SubPageLayout.vue` | 子页面容器：标题左侧返回图标 + `router.back()` |
| `src/renderer/src/global/AppState.ts` | 侧栏折叠状态等全局状态 |
| `src/renderer/src/global/AppTheme.ts` | 主题模式（亮色 / 深色 / 跟随系统）状态与窗口材质同步 |
| `src/renderer/src/hooks/{UseState.ts,UseLog.ts}` | 通用 hooks |
| `src/renderer/src/assets/style/global.less` | 样式入口，仅汇总导入 |
| `src/renderer/src/assets/style/theme.less` | TDesign Token 与 `--fluent-*` 变量定义 |
| `src/renderer/src/assets/style/tdesign-cover.less` | 对 TDesign 组件的少量样式修正 |
| `src/renderer/src/assets/style/customer.less` | 全局 reset 与跨页面共享类 |

## 外壳结构

```
App.vue
└── <div class="shell">                 // 固定定位铺满窗口，纵向 flex，背景透明
    ├── <app-title-bar />               // 40px 通栏标题栏（整条可拖拽）
    └── <t-layout class="main">         // 背景透明，让窗口的系统亚克力透出
        ├── <app-side />                // 左侧栏，透明，折叠时 64px 图标轨道
        └── <t-content class="main-container">
            └── <router-view />         // 页面内容，背景 --fluent-acrylic-bg、圆角 --td-radius-medium
```

侧栏（`AppSide.vue`）使用 `<t-aside :width="collapsed ? '64px' : '224px'">`，内部只有 `<side-menu :items="menuItems" :collapsed="collapsed" />`：产品名已上移到标题栏，侧栏不再有品牌行。折叠状态来自 `@/global/AppState` 的 `collapsed`（在模板中自动解包），经 `useLocalStorage` 持久化到 localStorage 的 `vault-scrape:collapsed`，切换由标题栏按钮调用 `toggleCollapsed()`。窗口层面的材质、标题栏与窗口按钮见 [02-window-chrome.md](./02-window-chrome.md)。

## 菜单

`SideMenuItem` 定义在独立的 `types.ts` 中（`<script setup>` 不能 `export`）：

```ts
export interface SideMenuItem {
  label: string
  icon?: Component
  to?: string
  match?: 'exact' | 'prefix'
  activePaths?: string[]
  children?: SideMenuItem[]
}
```

`SideMenuNode.vue` 负责渲染单个节点：用 `isSelfActive(item)` / `hasActiveDescendant(item)` 判断选中与展开态，`expanded` 的初始值取「是否有后代处于选中」，点击有子项的节点则折叠/展开（`max-height` 过渡动画），否则 `router.push`。选中态使用 `inset 3px 0 0 var(--fluent-item-selected-border)` 的左侧色条 + `--fluent-item-selected` 背景，悬停使用 `--fluent-item-hover`，聚焦环使用 `--fluent-focus-ring`。

当前菜单项与图标：概览 `DashboardIcon`、工作台 `DesktopIcon`、存储 `HardDiskStorageIcon`、插件 `ExtensionIcon`、工具 `ToolsIcon`、设置 `SettingIcon`、日志 `SystemLogIcon`、关于 `InfoCircleIcon`。

「工具」项写成 `{ to: '/tools', match: 'prefix' }`：进入工具箱的子页（如搜索工具 `/tools/search`）时它保持高亮；其余一级页面用默认的 `exact` 全等匹配。

折叠态由 `collapsed` 经显式 props `AppSide → SideMenu → SideMenuNode` 下钻（通用组件不 import 全局状态）：节点隐藏标签与箭头、图标居中，并用 `<t-tooltip placement="right" :disabled="!collapsed">` 在悬停时补回标签，有子项的节点在折叠态下点击不展开。

## 页面容器

`PageLayout.vue` 统一页面的标题区与内容区：

- props：`title: string`、`description?: string`、`padded?: boolean`（默认 `true`）。
- 结构：`.page-header`（高 56px，`#leading` 插槽 + 标题 + 描述，右侧 `#extra` 插槽）+ `.page-container`（`flex: 1; overflow: auto`，内容插槽，默认 `padding: 20px`）。
- `#leading` 是可选插槽（标题之前、页头最左），不传时不渲染任何节点，一级页面的观感不变；子页面容器正是用它放返回按钮。
- `:padded="false"` 给内容区加 `is-flush`：`padding: 0; overflow: hidden`，内容贴到页面边缘，滚动与内边距下放给页面内部。

所有基础页面都用它包裹，保证标题位置、内边距与滚动行为一致。

**子页面容器 `SubPageLayout.vue`**：props 与 `PageLayout` 完全一致（`title` / `description` / `padded`），转发内容插槽与 `#extra`，并额外在 `#leading` 里渲染一枚 `variant="text" shape="square"` 的 `ChevronLeftIcon` 图标按钮（`aria-label="返回"`，无 tooltip、无文字）。点击即 `router.back()` 回退浏览历史，不认目标路由——因此子页面不用自己写返回逻辑，也不要在 `#extra` 里再放返回按钮；直接以 URL 打开子页时返回按钮不产生跳转属既定语义。按钮 `align-self: center` 抵消页头的 baseline 对齐，`margin-right: -6px` 抵消按钮内边距，视觉上贴着标题。

**左右分栏页面（插件页、存储页）的约定**：传 `:padded="false"`，左栏固定 300px、通高、内部自己滚动，只用 `border-right: 1px solid var(--fluent-sidebar-border)` 分隔，不做卡片（无圆角、无阴影、无四周边框）；两栏 `gap: 0`，右侧栏自己补 `padding: 20px`。这样左侧不再被容器的 20px 内边距挤掉一圈宽度。

## 样式分层

- **`theme.less`**：唯一的裸色值集中地。`:root` 定义亮色的一套：TDesign Token（品牌色 `#0f6cbd` 阶梯、语义色 error `#d13438` / warning `#bc4b09` / success `#0e7a0d`、四级文本色、背景 page `#f3f3f3` / container `#ffffff` / secondarycontainer `#fafafa`、边框 `#e0e0e0` 与 `#ebebeb`、`--td-scrollbar-color`、2/4/6/8px 圆角、Segoe UI 字体栈）与 Fluent 语义变量（`--fluent-acrylic-bg`、`--fluent-card-border`、`--fluent-sidebar-border`、`--fluent-item-hover`、`--fluent-item-selected`、`--fluent-item-selected-border`、`--fluent-focus-ring`、`--fluent-elevation-1..3`、`--fluent-radius-smooth`、`--fluent-transition-fast|normal`）；`:root[theme-mode='dark']` 只覆盖随明暗变化的部分，见下节。其中 `--fluent-acrylic-bg`（亮色 `rgba(252, 252, 252, 0.72)`、深色 `rgba(32, 32, 32, 0.72)`）是叠在系统材质**之上**的内容面板填充，模糊能力来自主进程的窗口材质而不是它自身，详见 [02-window-chrome.md](./02-window-chrome.md)。
- **`tdesign-cover.less`**：只做少量修正（按钮/卡片/标签/输入类组件的圆角、列表项过渡、表头背景），不重写组件结构。
- **`customer.less`**：`html` / `body` / `#app` 满高 reset、`*` 盒模型、滚动条宽度 8px；`body` 背景为 `transparent`（窗口底色交给系统材质，铺底色会整片盖住模糊），以及跨页面共享类：
  - `.setting-list`：设置列表容器；
  - `.setting-field`：设置行右侧控件区，`display: flex; gap: 8px; width: 420px; max-width: 100%`，直接子元素（按钮与开关除外）`flex: 1; min-width: 0`；用 `&:has(> .t-switch)` 让纯开关行不占满 420px 宽。`:has()` 在 Electron 39 的 Chromium 中可用。

## 深色模式

三档：亮色 / 深色 / **跟随系统**（默认），选择持久化在 localStorage 的 `vault-scrape:theme-mode`。

- **开关机制**：`<html theme-mode="dark">` 是 TDesign 官方的深色模式开关，深色 Token 块写成 `:root[theme-mode='dark']`；亮色块仍用 `:root`（不写属性或写 `light` 都命中）。因此属性取值只有 `light` / `dark`，三档里的 `auto` 在写属性前就被解析成了两者之一。
- **状态**：`src/renderer/src/global/AppTheme.ts` 用 vueuse 的 `useColorMode({ attribute: 'theme-mode', modes: { light: 'light', dark: 'dark' }, initialValue: 'auto', storageKey: 'vault-scrape:theme-mode' })`。它自带 `prefers-color-scheme` 订阅与属性写入，`auto` 档不需要另写媒体查询；返回值的 `store` 保留用户原始选择（含 `auto`）用于回显，`.value` 是解析结果（`light` / `dark`）。
  - vueuse 15 **没有** `useTheme`（网上不少示例是旧版本或误传），等价能力就是 `useColorMode`；只需要布尔值时用 `useDark`。
- **首屏不闪**：`AppTheme.ts` 在模块求值阶段（早于 `app.mount`）就写好属性，且 `useColorMode` 默认 `disableTransition`，切换时不会出现整屏过渡动画。
- **入口**：标题栏左侧折叠按钮旁的图标按钮，点击出 `t-dropdown` 三选一，当前档位用 `active` 高亮、面板收起后按钮图标即当前档位。图标按档位取 `ModeLightIcon` / `ModeDarkIcon` / `DesktopIcon`，三个按钮共用 `.bar-toggle` / `.theme-toggle` 的 32×32 几何与 `no-drag`，见 [02-window-chrome.md](./02-window-chrome.md)。
- **窗口材质同步**：切换会经 `appWindow:setThemeSource` 通知主进程改 `nativeTheme.themeSource`，macOS vibrancy / Windows acrylic 跟着变深，见 [02-window-chrome.md](./02-window-chrome.md)。
- **深色取值**：按 Fluent 深色调色板重定义随明暗变化的 Token（文本 `#ffffff`/`#d6d6d6`/`#adadad`、禁用 `#5c5c5c`、背景 `#292929`/`#1f1f1f`/`#141414`、描边 `#525252`/`#3d3d3d`、品牌交互阶梯 `#115ea3`/`#0f6cbd`/`#0c3b5e` 与强调蓝 `#479ef5`）与全部 `--fluent-*`；**语义色 error / warning / success 刻意不覆盖**——TDesign 官方深色 Token 里它们与亮色同值，多作前景色或标签底色，跟着变浅反而丢掉警示语义。圆角、字体不随主题变化，仍由 `:root` 提供。
- **不引入官方全量样式**：`tdesign-vue-next/es/style/index.css` 内亮色块是 `:root[theme-mode='light']`、深色块是 `:root[theme-mode='dark']`，特异性均为 (0,2,0)，高于本文件的 `:root`，引入后亮色覆盖会失效；它还会给当前未定义的 100+ 个组件内部 Token 补上取值、改变既有亮色观感。因此深色只覆盖本项目用到的部分，完整度与现状亮色一致。
- **不设 `color-scheme: dark`**：窗口材质靠「根元素与 body 都不铺底色」透出，`color-scheme` 会让根元素用上 UA 的深色底，有盖住材质、丢掉模糊的风险。滚动条改用 `--td-scrollbar-color`（本次一并补齐：`customer.less` 一直在引用它，此前全项目未定义）。

## UnoCSS 桥接

`uno.config.ts` 中 `theme.colors` 把 `td-*` 名称映射到 `var(--td-*)`，并提供 `bg-td-container` / `text-td-secondary` / `border-td-1` 等 shortcuts。顶层 `postprocess` 会给每个工具类值追加 `!important`：UnoCSS 样式表在 TDesign 之前加载，不加会在组件样式生效时被覆盖。

## 注意事项

- 窗口层面的改动（亚克力材质、自定义标题栏、窗口按钮、`appWindow` IPC、侧栏折叠形态）见 [02-window-chrome.md](./02-window-chrome.md)；本文件只覆盖窗口内部的外壳与主题。
- 弹窗与抽屉一律用命令式 API（`DialogPlugin` / `DrawerPlugin`），默认 `placement: center`；外壳与内容拆成两个文件——`.tsx` 外壳导出 `openXxx(options)`，内容组件为 `.vue`，通过 `h()` 渲染。禁止 `<t-dialog :visible>` + `v-if` 的声明式写法，也禁止把弹窗内容写在 tsx 里。
- 组件存放：与页面强相关的组件放该页面目录下的 `components/`；只有真正通用的组件（如 `PageLayout`、`menu`）才放 `src/renderer/src/components/`，业务组件不得进入该目录。
- 页面/store 不直接访问 `window.preload`，统一经 `@/api` 出口。
- 不使用 `unplugin-auto-import`：所有 API 与组合式函数显式 import，避免依赖需要运行 dev/build 才能生成的声明文件。
- 新增图标前先确认 `tdesign-icons-vue-next` 的导出名（可用 `node -e "import('tdesign-icons-vue-next').then(m => console.log(Object.keys(m)))"` 查看），不要臆造图标名，也不要手写 SVG。
