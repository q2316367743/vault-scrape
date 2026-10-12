# 播放窗口与 mpv 播放（play / host 两个渲染入口）

影视详情页从「详情即播放」改成「详情只管详情」，点「播放」开一个**独立播放窗口**：左侧画面、右侧影片详情侧栏（腾讯视频 / 爱奇艺式的播放入口）。
画面有两种后端：**本机自备的 mpv**（设置项给路径，Windows / macOS）与**内置 artplayer**（兜底，任何平台都能用）。
文档面向上游改动者：只要读这一篇，就能改后端选择、mpv 生命周期、窗口几何、两个渲染入口页与 IPC 契约。

> 相关文档：[资料库（扫描 / 索引）](./01-media-library.md)、[剧集支持](./02-series-support.md)、[影视墙页面](../page/04-media-wall-page.md)、[设置项清单](../setting/02-setting-items.md)、[窗口外观与自定义标题栏](../ui/02-window-chrome.md)、[文件模块](../file/01-file-module.md)。

## 1. 范围与总体结构

- 详情页 `pages/media/detail/MediaDetailPage.vue` 不再内嵌播放器：只保留「选哪一集」与一枚「播放」按钮（`components/MediaPlayBar.vue`）。
- 「播放」调 `playerApi.open({ itemId, episodeId? })`：**主进程开窗口**，渲染层不参与窗口创建。
- 播放窗口已经是打开状态时**复用**同一个窗口：主进程 `loadTarget()` 换片后推 `player:switch`，渲染层按新结果切后端并刷新侧栏。
- mpv **不内置**：用户自己在设置页填路径（或留空自动探测）。没配到 mpv 时**静默**用内置播放器（播放窗口不提示，说明文案只在设置页）。
- 平台范围：Windows 与 macOS。Linux 不在范围内（代码里没有任何 Linux 分支）。

三块渲染入口（`electron.vite.config.ts` 的 `renderer.build.rollupOptions.input` 三个键）：

| 入口 | HTML | 挂载 | 用途 |
| --- | --- | --- | --- |
| `index` | `src/renderer/index.html` | `windows/main/main.ts` | 主窗口 |
| `play` | `src/renderer/play.html` | `windows/play/main.ts` | 播放窗口（唯一有播放逻辑的页面） |
| `host` | `src/renderer/host.html` | `windows/host/main.ts` | mpv 嵌入用的宿主窗口页面（Windows 恒有；macOS 只在 `app.macEmbed` 打开时有意义） |

## 2. 后端选择与降级

决策链收口在 `src/main/src/modules/player/playerSession.ts` 的 `loadTarget(payload): Promise<PlayerLoadResult>`：

| 步骤 | 判断 | 结果 |
| --- | --- | --- |
| 1 | `getItem(itemId)` 取不到条目，或（剧集）取不到媒体源 | `{ backend: 'html5', url: '', reason: '' }` + warn 日志「播放目标没有可用媒体源」 |
| 2 | 起回环播放服务 `startMediaPlayServer()`，拼出 `http://127.0.0.1:<port>/p/<token>/…` | 地址两后端共用 |
| 3 | `locateMpv()` 没找到 mpv | **静默** `{ backend: 'html5', url, reason: '' }` |
| 4 | `MpvRuntime.start()` 抛错（路径错 / 起不来 / IPC 连不上） | `{ backend: 'html5', url, reason }` + warn「mpv 启动失败，改用内置播放器」 |
| 5 | 成功 | `{ backend: 'mpv', url, reason: '' }`，随后靠主进程推状态驱动 UI |

播放**中途** mpv 自己退了（进程退出、用户关掉 mpv 窗口）：`degradeToHtml5()` 把快照改成 `{ ...state, backend: 'html5', ready:false, ended:false, buffering:false, error: reason }` 并落 warn 日志，渲染层的 `usePlaySession` 收到 `error` 非空就建 artplayer 从 `state.position` 续播。

| 场景 | 播放窗口的表现 |
| --- | --- |
| 没配 mpv | 静默用内置播放器，**没有任何提示**（说明只在设置页） |
| 配了 mpv 但起不来 | 回退内置播放器 + 画面顶部 warning 说明原因（`reason`） |
| 播放中途 mpv 退出 | 切内置播放器 + 从当前位置续播 + `error` 文案 |

## 3. 播放地址链路

`storage://` 私有协议是给渲染层的 `net.fetch` 用的，**mpv 吃不了**。所以主进程起一个回环 HTTP 服务转发：

```
media_source → buildMediaUrl() → storage://<连接>/<媒体ID>/<文件名>
             → startMediaPlayServer() → http://127.0.0.1:<port>/p/<32位hex token>/<连接>/<媒体ID>/<文件名>
```

- `src/main/src/modules/media/mediaPlayServer.ts`（已有，播放域直接复用）：懒启动单例，`listen(0, '127.0.0.1')`，路径必须带 `/<token>/` 前缀，否则 404；请求原样转给 `handleMediaRequest()`，**Range / 206 / 416、远端缓存、播放期路径自愈全部沿用 `storage://` 那一套**（见 [资料库文档](./01-media-library.md)）。
- 两个后端吃的是同一个地址，所以「切后端」= 重新 load，不需要重新解析源。
- 进程退出：`src/main/index.ts` 的 `before-quit` 里 `void disposeMediaPlayServer()`。

## 4. 窗口几何：视频区矩形（逐像素）

`src/common/types/player/layout.ts` 是**唯一**定义处，主进程与渲染层共用：

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `headerHeight` | 40 | 自绘标题栏（与主窗口一致） |
| `sidebarWidth` | 360 | 右侧详情侧栏 |
| `controlBarHeight` | 72 | 视频区**下方**控制条（单独占一行，不能浮在画面上） |
| `defaultWidth` / `defaultHeight` | 1280 / 800 | 播放窗口默认尺寸 |
| `minWidth` / `minHeight` | 1040 / 640 | 最小尺寸 |

- `playerStageRect(contentWidth, contentHeight, fullscreen = false)`：非全屏 `{ x:0, y:40, width: W-360, height: H-40-72 }`（**可能为负**，调用方钳制）；全屏 `{ 0, 0, W, H }`。
- 主进程用 `win.getContentBounds()` + 这份函数算宿主窗口 bounds / mpv `geometry`；渲染层 DOM 必须**逐像素对齐**：标题栏 40、右侧栏 360、控制条 72，这些区域之间**不能有 gap / padding / 边框**，否则画面错位。
- 全屏时渲染层收起标题栏 / 控制条 / 侧栏（`player:layout` 推 `PlayerLayoutState.fullscreen`）。**macOS 的 simple fullscreen 不发 `enter/leave-full-screen`**，`togglePlayerFullscreen()` 里主动 `notifyLayout()`。

## 5. 平台差异

| 维度 | Windows | macOS |
| --- | --- | --- |
| 方案 | **宿主窗口 + `--wid` 嵌入** | 默认 **mpv 无边框独立窗口**贴住视频区；`app.macEmbed` 打开时改成嵌入（实验） |
| 宿主窗口 | 恒有：`new BrowserWindow({ parent: playWin, frame:false, focusable:false, skipTaskbar:true, resizable:false, movable:false, …, backgroundColor:'#000000' })`，载 `host.html`；句柄 `getNativeWindowHandle()` 转十进制给 `--wid` | 仅 `macEmbed` 时创建同款 |
| 同步方式 | 每次 `move` / `resize` **立即** `hostWin.setBounds(stageBounds(win))`（不防抖，否则拖动肉眼可见脱节） | 只发 `set_property geometry`（`XxY+X+Y`）；窗口拖动/缩放期间 80ms 防抖；`set_property` 不被支持时由 `restartWithGeometry()` 重启 mpv 接续 |
| 窗口叠加 | 宿主窗口是**原生子窗口，永远压在网页之上** | 独立窗口 + 播放窗口 `transparent: true` 挖洞，几何变化后 `win.moveTop()` 保证我们的窗口压在上面 |
| 交互 | 宿主页 `host.html` 接点击：单击（220ms 延迟）播放/暂停、双击全屏 | 画面就是普通窗口区域，点击由网页接（`PlayStage` 双击全屏） |

两条硬约束（读 mpv 源码得出，别绕）：

1. `resize_child_win()` 会把子窗口 `SetWindowPos(child, 0, 0, rp.right, rp.bottom, …)` —— **父窗口一动，子窗口就被拉成「父窗口整个客户区、原点 (0,0)」**。所以 `--wid` 只能指「尺寸恰好等于视频区」的专用宿主窗口；指播放窗口本身会让 mpv 盖住右侧栏。
2. 嵌入模式下 mpv 对子窗口 `EnableWindow(w32->window, 0)` —— **子窗口不接收鼠标/键盘**，mpv 自带 OSC（`--osc=yes`）点了也没用。所以：mpv 一律 `--osc=no`，控件全部由 Electron 自绘、经 `--input-ipc-server` 驱动。
3. 宿主窗口只在 **mpv 真的在跑** 时显示（`mpvActive && hostReady` → `showInactive()`，否则 `hide()`）：它是原生子窗口，常驻会把内置播放器和网页内容整块盖住。

## 6. mpv 进程与 IPC 控制

`buildMpvArgs()`（`mpvProcess.ts`）基线参数：

```
--no-config --no-scripts --idle=yes --keep-open=yes --force-window=yes --osc=no
--input-terminal=no --input-ipc-server=<addr> --hwdec=auto-safe --volume=<0-100> --title=<标题>
```

按需追加：`--start=<秒，四舍五入到 0.1>`（仅 > 0）、`--pause=yes`、`--mute=yes`、`--speed=<倍速>`（仅 > 0），然后二选一：`--wid=<宿主窗口句柄>` 或 `--no-border --geometry=<XxY+X+Y>`，**最后**才是播放地址。

- `mpvLocator.ts`：`locateMpv()` 探测顺序 = 设置项 `app.mpvPath` → PATH → 常见安装位置（`/opt/homebrew/bin/mpv`、`/usr/local/bin/mpv`、`/usr/bin/mpv`、`/Applications/mpv.app/Contents/MacOS/mpv`、`C:\Program Files\mpv\mpv.exe`、`C:\Program Files (x86)\mpv\mpv.exe`、`%LOCALAPPDATA%\mpv\mpv.exe`）；结果缓存 30 秒，`resetMpvCache()` 由设置页的「检测」（`detectMpv`）在命中时调用 —— 不点检测的话改完路径最多 30 秒才按新值走。`detectMpv(path)` 额外跑 `mpv --version` 取第一行 → `PlayerProbeResult { found, path, version, origin }`（`origin: 'setting' | 'path' | 'well-known' | 'none'`）。
- `mpvIpc.ts`：`MpvIpc.connect(addr, 8000)` 每 150ms 重试；`command()` 带 `request_id`，5 秒超时；`on(name, listener)` 订阅 mpv 事件。地址：Windows `\\.\pipe\vault-scrape-mpv-<8 字节 hex>`，macOS `join(tmpdir(), 'vault-scrape-mpv-<hex>.sock')`（退出时删 socket 文件）。
- `mpvRuntime.ts`：一个 `MpvRuntime` 实例 = 一个 mpv 进程 + 一条 IPC。
  - 订阅 8 个属性：`time-pos`（位置）、`duration`、`pause`、`volume`（mpv 是 0-100，要 /100）、`mute`、`speed`、`cache-buffering-state`（< 100 即 `buffering: true`）、`eof-reached`；事件：`file-loaded` → `{ ready:true, ended:false, error:'' }`、`end-file` → `{ ready:false, ended:true }`。
  - 命令映射：`toggle`→`cycle pause`、`seek`→`seek <s> absolute`、`seekBy`→`seek <d> relative`、`volume`→`set_property volume`（0-1 → 0-100）、`mute`→`set_property mute`、`rate`→`set_property speed`（0.25-4）。**`fullscreen` 不下发 mpv**，是窗口层的事。
  - `open(url)` 复用进程（`loadfile`）；`stop()` 先发 `quit`，1.5 秒不退就 kill；`watch(proc)` 里用 `this.proc !== proc || this.stopping` 过滤掉旧进程 / 主动 stop 的退出，避免误报「mpv 异常退出」。
- `playerSession.ts`：应用级单例。`loadTarget()`、`runCommand()`、`syncCanvas()`、`stopSession()`；状态推送 **200ms 节流**（首次直推）；`setStateSink()`（推状态）、`setMpvCanvasProvider()`（要宿主句柄 / geometry）、`setMpvActiveSink()`（mpv 是否占着画面，决定宿主窗口显隐）；另导出 `currentState()` / `currentTarget()`（后者是「在播哪个条目 / 哪一集、片名是什么」，主窗口标题栏的标签用它）。
- `playerEvents.ts`：`broadcastPlayerStatus(status)` —— 播放状态快照的单向推送，沿用 file / offline / scrape 域的「广播给所有窗口」写法（主窗口句柄没对外暴露，且只有它的标题栏订阅）。

## 7. 公共契约与 IPC 通道

公共类型在 `src/common/types/player/`（`index.ts` + `layout.ts`）：

| 类型 | 关键字段 |
| --- | --- |
| `PlayerOpenPayload` | `itemId`；剧集加 `episodeId`（`MediaEpisodeRef.itemId`） |
| `PlayerLoadResult` | `backend` / `url` / `reason` / `itemId` / `episodeId`（侧栏据此取详情、拨选中集） |
| `PlayerState` | `backend` / `ready` / `paused` / `position` / `duration` / `volume`(0-1) / `muted` / `rate` / `buffering` / `ended` / `error`（非空 = 后端异常，此时 `backend` 已降级 `html5`，渲染层原样显示这句话）；初始值用 `buildPlayerState(backend)` |
| `PlayerCommand` | `toggle` / `seek{position}` / `seekBy{delta}` / `volume{volume}` / `mute{muted}` / `rate{rate}` / `fullscreen{enabled?}`（**不传 `enabled` = 切换当前状态**） |
| `PlayerLayoutState` | `fullscreen` |
| `PlayerProbeResult` | `found` / `path` / `version` / `origin` |
| `PlayerStatus` | `open`（播放窗口是否存在）/ `itemId` / `episodeId` / `title`（片名，剧集是剧集名）/ `subtitle`（剧集这一集，形如 `第 1 季 第 2 集`；影片为空串）/ `state`（整份 `PlayerState`）—— 主窗口标题栏的「正在播放」标签用 |

通道常量在 `src/preload/src/modules/player/playerChannels.ts`（主进程用 `~` 别名引同一份）：

| 通道 | 方向 | 载荷 → 返回 |
| --- | --- | --- |
| `player:open` | 渲染 → 主 | `PlayerOpenPayload` → `void`（开窗或换片） |
| `player:load` | 渲染 → 主 | 无 → `PlayerLoadResult`（**取一次就清空** `pending`） |
| `player:command` | 渲染 → 主 | `PlayerCommand` → `void` |
| `player:close` | 渲染 → 主 | 无 → `void` |
| `player:detect` | 渲染 → 主 | `path: string` → `PlayerProbeResult` |
| `player:snapshot` | 渲染 → 主 | 无 → `PlayerStatus`（主窗口标题栏挂载时拉一次初值） |
| `player:focus` | 渲染 → 主 | 无 → `void`（聚焦播放窗口，最小化过先 `restore()`） |
| `player:switch` | 主 → 渲染 | `PlayerLoadResult`（窗口复用时换片） |
| `player:state` | 主 → 渲染 | `PlayerState`（200ms 节流，只发播放窗口） |
| `player:layout` | 主 → 渲染 | `PlayerLayoutState` |
| `player:status` | 主 → 所有窗口 | `PlayerStatus`（广播；只有主窗口的标题栏订阅，播放 / 宿主窗口收到即丢） |

preload 侧 `src/preload/src/modules/player/player.ts` 暴露 `playerApi`（`open` / `load` / `command` / `close` / `detect` / `getStatus` / `focus` / `onSwitch` / `onState` / `onLayout` / `onStatus`，后四者返回退订函数），渲染层经 `src/renderer/src/api/player.ts` 的 `playerApi` 使用（`@/api` 统一再导出）。
主进程注册在 `src/main/src/modules/player/playerIpc.ts`，由 `registerIpc.ts` 挂 `registerPlayerIpc()`。

### 7.1 主窗口标题栏的「正在播放」标签

需求：播放窗口存在时，主窗口标题栏要显示「正在播放哪个影片 + 播放状态」，点击让播放窗口聚焦。实现口径：

- **快照由主进程组装**：`playerWindow.playerStatus()` = 窗口是否存在（`alive(playWin)`）+ 会话层的 `currentTarget()`（条目 / 集 + 片名）+ `currentState()`（整份 `PlayerState`）。渲染层不查库、不猜窗口在不在。
- **为什么要广播**：主窗口句柄只在 `src/main/index.ts` 的 `createWindow()` 里，没对外暴露；为了不动入口文件，沿用 file / offline / scrape 域的写法把 `player:status` 广播给所有窗口（播放窗口与宿主窗口的页面不订阅，收到即丢）。
- **四处发送**：开窗（`createPlayWindow()`，此时目标还没装载 → 标签显示「正在打开」）、关窗（`closed` 里，`stopSession()` 已清空目标 → `open:false`，标签消失）、换片（窗口复用时 `openPlayerWindow()` 推完 `player:switch` 再兜一次）、状态推送（`setStateSink` 里跟着 200ms 节流走，播放中位置 / 暂停状态实时更新）。
- **片名口径**：剧集给剧集名（不含集名）+ `第 N 季 N 集`，影片给片名；刮削过用条目名，没刮削去掉扩展名 —— 与影视墙 / 详情页一致（`src/main/src/modules/media/mediaWall.ts:151`）。
- **点击只聚焦**：`player:focus` → `focusPlayerWindow()`（`isMinimized()` 先 `restore()`，再 `show()` + `focus()`），不重建窗口、不改播放状态。
- **标签自身**（`components/app/AppPlayerBadge.vue`）：位置在产品名右侧（`afterTitle` 插槽）、样式是一枚胶囊（`--td-bg-color-container-hover` 底色，悬停转 `--td-brand-color-light`，`--td-radius-extraLarge` 圆角，最宽 280px、片名超长省略）；`open === false` 整块不渲染；状态文案优先级 = 出错 → 已播完 → 缓冲中 → 正在打开 → 已暂停 → 正在播放；tooltip 里补进度 / 后端 / 错误原因；图标只在「缓冲 / 未就绪」与「暂停 / 播放」之间切。
- 播放窗口自己不显示这枚标签（它本来就在播），标签只挂在主窗口的 `AppTitleBar` `afterTitle` 插槽（紧挨产品名；`trailing` 在弹性空档之后，会被推到窗口最右，放状态标签会离标题太远）。

## 8. 渲染层结构

| 文件 | 职责 |
| --- | --- |
| `windows/play/PlayApp.vue` | 布局骨架：标题栏 +（视频区 + 控制条）+ 右侧栏；全屏时只留视频区；`watch` 装载结果驱动侧栏与选中集 |
| `windows/play/components/PlayStage.vue` | 视频区（**矩形必须与 `playerStageRect` 一致**）；`stage` 事件把容器交给会话层挂 artplayer；缓冲指示 + `notice` 提示条；双击全屏 |
| `windows/play/components/PlayControlBar.vue` | 高 72px 控制条：播放/暂停、时钟、进度、音量、倍速、全屏；只 `emit('command', …)`，不做播放控制 |
| `windows/play/components/PlaySidePanel.vue` | 宽 360px 侧栏：`SensitiveImage` 封面 + 标题 + 关键元信息 + 复用 `MediaEpisodeList`；只 `emit('select', itemId)` |
| `windows/play/composables/usePlaySession.ts` | 播放会话：订阅 `onState` / `onSwitch` / `onLayout`、`playerApi.load()` 起播；mpv 走主进程，html5 自建 artplayer 并把事件折算成同一份 `PlayerState`；`apply(command)` 分流 |
| `windows/play/composables/usePlaySidebar.ts` | 侧栏取数：`mediaApi.detail({ itemId })` + `useFileConnections` + `useNsfwProtection` + `useEpisodeSelection`；折出 `facts`（番号 / 首播 / 时长 / N 季 M 集 / 体积 / 资料库 / 加入时间） |
| `windows/play/composables/useKeyboard.ts` | 快捷键：空格 / `k` 播放暂停、`←→` ±10s、`↑↓` 音量 ±0.05、`m` 静音、`f` 全屏、`Esc` 退出全屏；输入框内不响应 |
| `windows/host/HostApp.vue` | 宿主页：单击（220ms 延迟，避开双击）播放暂停、双击全屏 |
| `components/app/AppTitleBar.vue` | 自绘标题栏（主窗口与播放窗口共用，`title` prop + `leading` / `afterTitle` / `trailing` 插槽） |
| `components/app/AppPlayerBadge.vue` | 主窗口标题栏的「正在播放」标签（挂在 `afterTitle` 插槽、紧挨产品名）：订阅 `onStatus` + 挂载时 `getStatus()`，无播放窗口时不渲染，点击 `playerApi.focus()` |

- 详情页与播放窗口共用的两块从详情页目录迁到公共位置：`components/media/MediaEpisodeList.vue`（选集区）、`hooks/UseEpisodeSelection.ts`（选集状态），两份文件头部注释都已标注「详情页与播放窗口共用」。
- `components/media/MediaPlayer.vue` **不为播放窗口复用**（它是存储页的文件预览）：播放窗口的内置后端要接主进程命令、要按 `PlayerState` 回传状态，逻辑自建在 `usePlaySession.ts`。
- `play.html` 的 CSP 比 `index.html` 多一项：`media-src 'self' storage: http://127.0.0.1:*`（内置播放器吃回环服务地址，不写会被 CSP 拦掉）。
- 内置后端不会读 `storage://`：两个后端都只吃主进程给的 `http://127.0.0.1:...` 地址，渲染层不拼磁盘路径。

## 9. 设置项（`app` 组）

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `app.mpvPath` | `''` | mpv 可执行文件路径；留空自动探测。**只有配到（或探测到）mpv，播放窗口才用 mpv**；探测不到静默用内置播放器 |
| `app.macEmbed` | `false` | 仅 macOS 的实验开关：把 mpv 画面嵌进播放窗口（`--wid`）。默认关闭，用「mpv 无边框独立窗口贴住视频区」的方案 |

设置页 `pages/setting/components/SettingAppPanel.vue` 里两项都带说明文案与「检测」（`playerApi.detect(setting.mpvPath)`）；macOS 选文件要选到 `mpv.app/Contents/MacOS/mpv` 这一层。

## 10. 关键文件表

| 层 | 文件 |
| --- | --- |
| 公共类型 | `src/common/types/player/index.ts`、`src/common/types/player/layout.ts` |
| 主进程 | `src/main/src/modules/player/{mpvLocator,mpvIpc,mpvProcess,mpvRuntime,playerSession,playerWindow,playerIpc,playerEvents}.ts`；`src/main/src/registerIpc.ts`（挂载）；`src/main/index.ts`（`before-quit` 清理）；`src/main/src/modules/media/mediaPlayServer.ts`（回环服务，复用） |
| preload | `src/preload/src/modules/player/{playerChannels,player}.ts`、`src/preload/index.ts`、`src/preload/index.d.ts` |
| 渲染层 | `src/renderer/{play.html,host.html}`、`src/renderer/src/windows/{play,host}/`、`src/renderer/src/api/player.ts`、`src/renderer/src/components/app/{AppTitleBar,AppPlayerBadge}.vue`、`src/renderer/src/windows/main/App.vue`（标题栏挂标签）、`src/renderer/src/components/media/MediaEpisodeList.vue`、`src/renderer/src/hooks/UseEpisodeSelection.ts` |
| 构建 | `electron.vite.config.ts`（`renderer.build.rollupOptions.input` 三入口） |

## 11. 注意事项与已知限制

1. **不内置 mpv**：用户自备；没配到就静默用内置播放器，播放窗口不提示（说明只在设置页）。
2. **Windows 嵌入模式下画面不参与网页合成**：mpv 子窗口是原生窗口，网页里任何遮罩 / 浮层都盖不住它 —— 所以播放窗口**不做 NSFW 画面遮罩**（只遮侧栏封面），控制条也**必须单独占一行**、不能做成悬停浮层。
3. **嵌入模式下 mpv 不接收输入**（mpv 自己 `EnableWindow(0)`）：mpv 的 `--osc` 关闭，控件全由 Electron 自绘经 IPC 驱动；点击事件由宿主页 `host.html` 接。
4. **macOS 默认方案下画面是独立窗口**：拖动 / 缩放主窗口时 `geometry` 有 80ms 防抖，视觉上可能有一点点滞后；`set_property geometry` 不被支持时会重启 mpv 接续播放（`--start` + `--pause` / `--mute` / `--speed` / `--volume` 一并接续）。
5. **macOS `--wid` 有出黑画面的已知风险**（只保留为实验开关 `app.macEmbed`，默认关闭）。
6. **不用 `BrowserWindow.setParentWindow()`**：Electron 有已知 SIGSEGV 报告，宿主窗口改用构造项 `parent`。
7. **全屏语义**：`PlayerCommand.fullscreen` 不传 `enabled` 就是「切换」；只有窗口层知道当前状态，渲染层不要自己记。
8. **状态权威**：mpv 模式下主进程推的状态是唯一权威；html5 模式下渲染层是权威（主进程推来的 `html5` 状态无 `error` 时直接丢弃）。
9. **Linux 不在范围内**：`--wid` 走的是 Windows / macOS 两套分支，没有 X11 / Wayland 的路径。
10. **`player:load` 是消费式的**：渲染层挂载后取一次，取完清空 `pending`；窗口复用时换片靠 `player:switch` 推事件，不要再调 `load`。
11. **标题栏标签的可见性与真实播放状态会有一点错位**：条目没有可用媒体源时 `player:status` 仍会带片名（主进程只知道「装了这个目标」），标签会显示「正在打开」而画面是空的；`open` 只表示播放窗口存在，不代表已经出画。
12. **标签的状态文案是渲染层折的**，不是主进程字段：`PlayerState.ready / buffering / paused / ended / error` 的优先级写在 `AppPlayerBadge.vue` 里，改文案只改那一个函数（`stateTextOf`）。

## 12. 手工验收清单（交给用户实测）

1. 设置页填 / 选到 mpv 可执行文件 → 点「检测」显示已找到（带版本）；不填时检测报「没找到」。
2. 影视库点开一部影片 → 详情页只有「播放」按钮与选集区，不再内嵌播放器 → 点「播放」开独立窗口（左画面、右侧详情侧栏）。
3. 剧集库：详情页选某一集 → 点「播放」直接播这一集；播放窗口侧栏选集里点另一集 → 画面切到那一集且侧栏高亮跟着换。
4. 窗口拖动 / 缩放：画面跟着视频区走，不越界、不盖住右侧栏（Windows 重点看）。
5. 控制条：播放暂停、拖进度、调音量、静音、1.25× 倍速、全屏；全屏后只剩画面，`Esc` 退出。
6. 快捷键：空格、`←→`、`↑↓`、`m`、`f`、`Esc`。
7. 关掉播放窗口：mpv 进程随之退出（任务管理器 / 活动监视器确认没有残留 `mpv`）。
8. 未配置 mpv：播放窗口静默用内置播放器（无任何 mpv 提示）；故意把 `mpvPath` 填成一个错路径再播放：回退内置播放器并给出原因提示。
9. 播放中手动杀掉 mpv：窗口切到内置播放器并从当前位置续播，顶部提示原因。
10. macOS：默认方案下拖动窗口画面跟随；打开 `app.macEmbed` 后走嵌入方案（可能只有声音没有画面，属已知风险）。
11. 主窗口标题栏：没开播放窗口时**看不到任何标签**；点「播放」后产品名右侧立刻出现胶囊（先「正在打开」→ 再变成「正在播放 · 片名」），剧集标签带上 `第 N 季 N 集`；窗口拉窄时先省略片名、状态文字始终完整。
12. 点标签：已最小化 / 被挡住的播放窗口会被还原并聚焦到最前；暂停、拖进度、换集时标签上的状态文字与进度跟着变。
13. 关掉播放窗口：标签立刻消失；`Esc` / 全屏切换不影响标签。
