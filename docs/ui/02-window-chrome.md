# 窗口外观与自定义标题栏

> 本文描述**搭手插件版**的窗口外观契约。原 Electron 版（系统材质、`nativeTheme`、preload IPC、托盘隐藏窗口）
> 已删除；宿主窗口的材质、主题与生命周期由搭手决定，插件只管页面内容与自绘标题栏。

## 运行模型

- 主窗口由 `plugin.json` 的 `windows[0]` 声明，宿主创建并加载包内 `ui/index.html`；播放窗口由 core 在用户点播放时
  动态创建（`core/modules/player/playerWindow.ts`），见 [architecture/02-plugin-runtime.md](../architecture/02-plugin-runtime.md)。
- 插件**不能**改窗口材质（vibrancy / acrylic）、不能读 `nativeTheme`、不能自绘关闭行为；窗口的深浅由宿主主题决定。
- 自绘标题栏 `src/components/app/AppTitleBar.vue` 被主窗口与播放窗口共用，几何与窗口按钮语义只有一份。

## 自定义标题栏

- **几何**：高 40px 通栏，整条 `-webkit-app-region: drag`（写 `app-region: drag`）；其中按钮显式声明 `no-drag`，
  否则点击被窗口拖动吞掉。macOS 下 `.title-bar.is-mac` 用 `padding-left: 80px` 给红黄绿灯让位。
- **内容**：左侧 `leading` 插槽（主窗口放侧栏折叠按钮）+ 产品名（`title` prop，播放窗口传影片名）+ `afterTitle`
  插槽（主窗口放「正在播放」胶囊 `AppPlayerBadge.vue`）+ `trailing` 插槽；非 macOS 时右侧三个自绘按钮
  （最小化 / 最大化 / 关闭）。
- **窗口按钮**：最小化 / 最大化 / 关闭经 `src/api/appWindow.ts` 调 `@dashou/api` 的 `getCurrentWindow()`，对应权限在
  `plugin.json` 的 `main-ui` capability 里声明。最大化状态用 `onResized()` + `isMaximized()` 反查（宿主不推送 maximize 事件）。
- **样式压制**：按钮用 `t-button variant="text"`，几何与关闭键悬停态写在 `.window-buttons .window-button` 父级选择器下，
  靠层叠特异性压过 TDesign 自带样式。

## 主题

- 三档：亮色 / 深色 / **跟随窗口**（默认）。选择经 `src/global/UiPrefs.ts` 存到 core 配置目录的 `ui-prefs.json`，
  不再用 localStorage。
- `auto` 档以宿主窗口主题为准：`getCurrentWindow().theme()` 取初值、`onThemeChanged()` 跟随；浏览器预览
  （`hasInternals()` 为假）退化为 `prefers-color-scheme`。二者都见 `src/global/AppTheme.ts`。
- 实际生效主题写到 `<html theme-mode>`，这是 TDesign 深色模式的开关；`initTheme()` 在窗口 bootstrap 里、
  `app.mount` 之前调用，避免首屏闪白。深色 Token 与 Fluent 变量见 [01-renderer-shell.md](./01-renderer-shell.md)。
- 入口在「设置 → 应用设置」的 `t-radio-group`（`SettingAppPanel.vue`），不再放标题栏。

## 侧栏折叠

- 状态在 `src/global/AppState.ts`：`collapsed = useUiPref('collapsed', false)`，`toggleCollapsed()` 切换；持久化走 core。
- 形态：224px ↔ 64px 图标轨道；折叠态隐藏标签与箭头、用 `t-tooltip placement="right"` 悬停显示标签。
- 下钻方式：折叠态经显式 props `AppSide → SideMenu → SideMenuNode` 传递，通用菜单组件不直接 import 全局状态。

## 相关文件

| 文件 | 职责 |
| --- | --- |
| `src/components/app/AppTitleBar.vue` | 自绘标题栏、窗口按钮、折叠入口 |
| `src/components/app/AppPlayerBadge.vue` | 主窗口标题栏的「正在播放」标签 |
| `src/api/appWindow.ts` | 窗口控制出口（`@dashou/api` 的 `getCurrentWindow`） |
| `src/global/AppTheme.ts` / `UiPrefs.ts` | 主题与 UI 偏好的状态及持久化 |
| `src-dashou/plugin.json` | 窗口声明与 capability 权限 |
| `src-dashou/core/modules/player/playerWindow.ts` | 播放窗口动态创建 |

## 注意事项

- 只做 `pnpm typecheck`，不跑 `dev` / `build` 作为验证手段（RL-07）。
- 托盘、Dock、关闭即隐藏、窗口材质等概念属于原 Electron 版，插件里不存在；历史记录见
  [04-tray-and-dock.md](./04-tray-and-dock.md) 与 [media/03-mpv-playback.md](../media/03-mpv-playback.md)（均已标注过时）。
