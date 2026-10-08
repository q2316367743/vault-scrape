# 窗口外观与自定义标题栏

## 实现思路

窗口外观由两部分协作：**系统材质**提供真正的模糊，**渲染层透明化**让材质透出来。

- 亚克力一律用原生系统材质（macOS `vibrancy`、Windows 11 `backgroundMaterial`），**不使用 CSS `backdrop-filter`**：页面内元素的 `backdrop-filter` 只能采样到窗口内已绘制的内容，采不到窗口背后的桌面，写在本项目里不会产生模糊，属于无效代码。
- 窗口**不设** `transparent: true`、**不设** `backgroundColor`。`transparent` 会带来一连串代价（macOS 丢失原生阴影、Windows 下不可缩放且无法双击标题栏最大化），而 macOS 只需 `vibrancy` 就能透出材质；显式 `backgroundColor` 则会盖住系统材质。
- 标题栏自绘，但 macOS **保留系统红黄绿灯**（只隐藏标题栏条），Windows / Linux 隐藏系统边框后由渲染层自绘最小化 / 最大化 / 关闭。

## 平台材质矩阵

| 平台 | 窗口构造参数 | 材质来源 | 窗口按钮 |
| --- | --- | --- | --- |
| macOS | `titleBarStyle: 'hidden'`、`trafficLightPosition: { x: 12, y: 14 }`、`vibrancy: 'under-window'`、`visualEffectState: 'active'` | 系统 vibrancy（真模糊） | 系统红黄绿灯 |
| Windows | `frame: false`、`backgroundMaterial: 'acrylic'` | Windows 11 亚克力；Windows 10 忽略该值 | 渲染层自绘三键 |
| Linux | `frame: false` | 无系统材质，退化为 CSS 半透明 | 渲染层自绘三键 |

- 代码位置：`src/main/index.ts` 的 `platformWindowOptions(): BrowserWindowConstructorOptions`，在 `createWindow()` 里以 `...platformWindowOptions()` 展开。**必须显式标注返回类型**，否则三个分支返回的对象字面量会被推宽成 `string`，`typecheck` 报错。
- `thickFrame` 保持默认 `true`：Win / Linux 的无边框窗口才有缩放、阴影与 Aero Snap。
- `visualEffectState: 'active'` 与 `vibrancy` 必须同时给，否则窗口失焦时材质会被系统置为不活跃。

## 渲染层透明链路

自下而上都不铺底色，材质才透得出来：

| 位置 | 处理 |
| --- | --- |
| `assets/style/customer.less` | `body` 的 `background` 改为 `transparent`（原本是 `--td-bg-color-page`，会整片盖住材质） |
| `windows/main/App.vue` | `.shell`（`position: fixed; inset: 0`，纵向 flex）背景透明；`t-layout.main` 覆盖掉 TDesign 的页面底色为 `transparent` |
| `windows/main/App.vue` | `t-content.main-container` 用 `--fluent-acrylic-bg` 作为**叠在材质上的内容面板**，并加 `1px solid var(--fluent-card-border)` 描边 |
| `windows/main/pages/app/AppSide.vue` | `.app-side` 背景 `transparent`，只留 `border-right: 1px solid var(--fluent-sidebar-border)` |

因此侧栏直接透出系统材质，内容区用一层略亮的半透明面板与侧栏区分层级。`--fluent-acrylic-bg` 在 `theme.less` 中定义为 `rgba(252, 252, 252, 0.72)`，是**叠层填充**而非模糊来源，改名换值时不要误以为它承担模糊职责。

## 自定义标题栏

组件 `src/renderer/src/windows/main/pages/app/AppTitleBar.vue`，与 `AppSide.vue` 同级——它是外壳部件，不放 `src/renderer/src/components/`。

- **几何**：高 40px 通栏，整条 `-webkit-app-region: drag`（同时写 `app-region: drag`）；其中的按钮显式声明 `no-drag`，否则点击会被窗口拖动吞掉。macOS 下 `.title-bar.is-mac` 用 `padding-left: 80px` 给红黄绿灯让位。
- **内容**：左侧折叠按钮（`MenuFoldIcon` / `MenuUnfoldIcon` 切换）+ 主题切换按钮（`ModeLightIcon` / `ModeDarkIcon` / `DesktopIcon` 对应亮色 / 深色 / 跟随系统，点击出 `t-dropdown` 三选一）+ 产品名 `vault-scrape`；非 macOS 时右侧三个 46×40 的自绘按钮（`MinusIcon` / `Fullscreen1Icon`↔`FullscreenExit1Icon` / `CloseIcon`），关闭键悬停用 `--td-error-color` + `--td-text-color-anti` 还原 Windows 11 语义。
- **主题按钮**：几何与折叠按钮共用 `.bar-toggle, .theme-toggle { width: 32px; height: 32px; padding: 0 }` 与同一条 `no-drag` 声明；不套 `t-tooltip`——`t-dropdown` 与 `t-tooltip` 都会接管触发元素的引用，两层弹层互抢同一个按钮会出问题，档位名称交给下拉面板与 `aria-label` 承担。三档的状态与配色见 [01-renderer-shell.md](./01-renderer-shell.md) 的「深色模式」。
- **最大化状态**：系统标题栏隐藏后渲染层无法自行感知最大化，只能由主进程驱动。`bindWindowState(win)` 监听窗口 `maximize` / `unmaximize`，经 `appWindow:maximizedChanged` 单向推送；渲染层 `onMaximizedChange(listener)` 订阅并返回退订函数，组件 `onUnmounted` 时必须调用。
- **样式压制**：窗口按钮用 `t-button variant="text"`，几何与关闭键悬停态写在 `.window-buttons .window-button` 父级选择器下，靠层叠特异性（而非 `!important`）压过 TDesign 自带样式。

## appWindow 域 IPC 契约

沿用四段式：契约常量 → preload 薄封装 → main handler → 渲染层 api 出口。

| 通道 | 方向与形式 | preload 方法 | 返回 |
| --- | --- | --- | --- |
| `appWindow:minimize` | 渲染层 → 主进程 `invoke` | `minimize()` | `Promise<void>` |
| `appWindow:toggleMaximize` | `invoke` | `toggleMaximize()` | `Promise<boolean>`（目标态，`true` = 已最大化） |
| `appWindow:close` | `invoke` | `close()` | `Promise<void>` |
| `appWindow:isMaximized` | `invoke` | `isMaximized()` | `Promise<boolean>` |
| `appWindow:setThemeSource` | `invoke` | `setThemeSource(source)` | `Promise<void>`，`source: 'light' \| 'dark' \| 'system'` |
| `appWindow:maximizedChanged` | 主进程 → 渲染层 `send` | `onMaximizedChange(listener)` | `() => void`（退订函数） |

- `setThemeSource` 的取值与 Electron `nativeTheme.themeSource` 对齐（契约里导出为 `WindowThemeSource`），渲染层的 `auto` 档在 `AppTheme.ts` 里映射成 `system`；主进程侧有白名单校验，非法值直接忽略而不是交给 Electron 抛错。
- 主题是应用级设置，handler 不需要 `BrowserWindow.fromWebContents` 反查窗口（其余通道需要）：改了之后所有窗口的材质一起变。

- 另有 `isMac: boolean`（值为 `process.platform === 'darwin'`），是 preload 里的**常量**而非 IPC。刻意不用 `NodeJS.Platform` 类型：`tsconfig.web.json` 里 Node 命名空间不可解析。
- `toggleMaximize` 直接返回目标态而不是调用后的 `isMaximized()`：`maximize()` / `unmaximize()` 异步生效，紧接着查询会拿到旧值（随后的推送事件会确认最终状态）。
- 所有 handler 都用 `BrowserWindow.fromWebContents(event.sender)` 反查发起窗口，多窗口时各操作自己。
- 相关文件：`src/preload/src/modules/appWindow/{appWindowChannels.ts,appWindow.ts}`、`src/main/src/modules/appWindow/appWindowIpc.ts`、`src/renderer/src/api/appWindow.ts`，并在 `src/preload/index.ts`（暴露 `appWindow`）、`src/preload/index.d.ts`（`window.preload.appWindow` 类型）、`src/main/src/registerIpc.ts`（挂一行）各登记一次。

## 窗口材质跟随深色主题

macOS 的 vibrancy 与 Windows 的 acrylic 由**主进程**的系统主题决定，渲染层改 CSS 变量改不动它。所以主题档位一落定就同步一次 `nativeTheme.themeSource`：

- **一处触发**：`AppTheme.ts` 里对 `themeMode` 做 `watch(..., { immediate: true })`——手动切换与启动时的初始同步走同一条路径，不需要在别处再补一次初始化。
- **映射**：渲染层三档 `light` / `dark` / `auto` → 主进程 `light` / `dark` / `system`（`auto` 保留 Electron 自己的「跟随系统」语义，而不是让渲染层去读系统偏好）。
- **影响范围**：`nativeTheme.themeSource` 是应用级的，除窗口材质外也会带动系统绘制的原生控件（macOS 红黄绿灯、右键菜单等），这三者本来就该一致。
- **不设 `transparent: true` 与 `backgroundColor`** 的前提不变：材质负责模糊，渲染层只负责让底色透明，深色下换成深色半透明填充（`--fluent-acrylic-bg`），见 [01-renderer-shell.md](./01-renderer-shell.md)。

## 侧栏折叠

- **状态**：`src/renderer/src/global/AppState.ts` 中 `collapsed = useLocalStorage('vault-scrape:collapsed', false)`（`@vueuse/core`）+ `toggleCollapsed()`。key 与旧的手写 localStorage 实现保持一致，历史值 `"true"` / `"false"` 与新的 JSON 值都能解析，重启后保持。
- **形态**：224px ↔ 64px 图标轨道。`AppSide.vue` 用 `<t-aside :width="collapsed ? '64px' : '224px'">`，宽度过渡 `--fluent-transition-normal`；`.side-inner` 不再设 `min-width`（否则会撑破 64px 轨道）。产品名已上移到标题栏，侧栏不再有品牌行。
- **下钻方式**：折叠态经显式 props `AppSide → SideMenu → SideMenuNode` 传递，通用菜单组件不直接 import 全局状态。
- **折叠态表现**：隐藏标签与箭头（`.menu-item.is-collapsed` 让图标居中）、用 `t-tooltip placement="right"` 在悬停时显示标签（`:disabled="!collapsed"`）、有子项的节点点击不展开（当前菜单只有一级项，等价于无操作）。
- **展开入口**：标题栏左侧的折叠按钮，一键展开。

## 调整旋钮

| 想改什么 | 改哪里 |
| --- | --- |
| 材质观感 / 强度 | macOS 改 `vibrancy` 取值；Windows 改 `backgroundMaterial`；三端统一的半透明层浓淡改 `theme.less` 的 `--fluent-acrylic-bg`（亮 / 深各一份） |
| 深色主题配色 | `theme.less` 的 `:root[theme-mode='dark']` 块；档位默认值与入口见 [01-renderer-shell.md](./01-renderer-shell.md) 的「深色模式」 |
| 窗口材质的深浅跟随 | 渲染层档位由 `AppTheme.ts` 的 `themeMode` 决定，主进程只做 `nativeTheme.themeSource` 落值 |
| 标题栏高度、红黄绿灯位置 | `AppTitleBar.vue` 的 `.title-bar` 高度、`.title-bar.is-mac` 的 `padding-left` **与** `platformWindowOptions()` 的 `trafficLightPosition` 需一起改 |
| 窗口按钮尺寸 | `AppTitleBar.vue` 中 `.window-button` 的 46×40 |

## 已知限制

- Linux 与 Windows 10 没有系统亚克力（Windows 10 忽略 `backgroundMaterial`），退化为 CSS 半透明、**没有模糊**，是有意的降级；这两端深色主题只影响渲染层，`nativeTheme` 没有材质可改。
- 深色主题只覆盖本项目用到的 Token，TDesign 组件内部那些从来没定义过的 Token 在两种主题下都缺值（与现状一致）；将来若要改成引入官方全量样式，必须同时把 `theme.less` 的选择器改写成 `:root[theme-mode='...']`，原因见 [01-renderer-shell.md](./01-renderer-shell.md) 的「深色模式」。
- 折叠态下点击分组项无反应（菜单目前只有一级，无分组可展开）。
- dev（`localhost:7743`）与 prod（`file://`）的 localStorage 不同源，折叠状态互不影响——这是既有行为，不是缺陷。
- 打开 DevTools 时窗口材质表现可能与正常运行时不同，不作为验收依据。
- 若 macOS 上红黄绿灯与标题栏内容重叠，只需调 `trafficLightPosition` 或 `.title-bar.is-mac` 的 `padding-left`。

## 注意事项

- 只做 `yarn typecheck`，不跑 `dev` / `build` 作为验证手段。
- 新增 TDesign 组件（如本项目新引入的 `TTooltip`）必须**手工**补进 `src/renderer/src/renderer/components.d.ts` 的两处列表：该文件由 `unplugin-vue-components` 在 dev/build 时生成，不跑构建就不会自动更新，缺失会导致 `typecheck` 失败。
