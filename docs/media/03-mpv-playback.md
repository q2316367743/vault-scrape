# 播放窗口与 mpv 播放（play / host 两个渲染入口）

影视详情页从「详情即播放」改成「详情只管详情」，点「播放」开一个**独立播放窗口**：左侧画面、右侧影片详情侧栏（腾讯视频 / 爱奇艺式的播放入口）。
画面有两种后端：**本机自备的 mpv**（设置项给路径，**只在 Windows 上启用**）与**内置 artplayer**（兜底）。
**macOS 已停用 mpv**：mpv 的 `--wid`（嵌进已有窗口）在 macOS 没有官方支持，只剩「mpv 独立窗口 + 播放窗口透明挖洞」一条路，而透明窗口会让播放周期性卡顿、窗口跟随还有可见延迟 —— 详见 §11 第 19 条。
文档面向上游改动者：只要读这一篇，就能改后端选择、mpv 生命周期、窗口几何、两个渲染入口页与 IPC 契约。

> 相关文档：[资料库（扫描 / 索引）](./01-media-library.md)、[剧集支持](./02-series-support.md)、[影视墙页面](../page/04-media-wall-page.md)、[设置项清单](../setting/02-setting-items.md)、[窗口外观与自定义标题栏](../ui/02-window-chrome.md)、[文件模块](../file/01-file-module.md)。

## 1. 范围与总体结构

- 详情页 `pages/media/detail/MediaDetailPage.vue` 不再内嵌播放器：只保留「选哪一集」与一枚「播放」按钮（`components/MediaPlayBar.vue`）。
- 「播放」调 `playerApi.open({ itemId, episodeId? })`：**主进程开窗口**，渲染层不参与窗口创建。
- 播放窗口已经是打开状态时**复用**同一个窗口：主进程 `loadTarget()` 换片后推 `player:switch`，渲染层按新结果切后端并刷新侧栏。
- mpv **不内置**：用户自己在设置页填路径（或留空自动探测）。没配到 mpv（或不在 Windows 上）时**静默**用内置播放器（播放窗口不提示，说明文案只在设置页）。
- 平台范围：Windows 与 macOS。Linux 不在范围内（代码里没有任何 Linux 分支）。**mpv 的启用平台只有 Windows**：macOS 上 `locateMpv()` 一进来就返回「没找到」，一律静默走内置播放器。

三块渲染入口（`electron.vite.config.ts` 的 `renderer.build.rollupOptions.input` 三个键）：

| 入口 | HTML | 挂载 | 用途 |
| --- | --- | --- | --- |
| `index` | `src/renderer/index.html` | `windows/main/main.ts` | 主窗口 |
| `play` | `src/renderer/play.html` | `windows/play/main.ts` | 播放窗口（唯一有播放逻辑的页面） |
| `host` | `src/renderer/host.html` | `windows/host/main.ts` | mpv 嵌入用的宿主窗口页面（只在 Windows 用；macOS 停用 mpv 后不再创建） |

## 2. 后端选择与降级

决策链收口在 `src/main/src/modules/player/playerSession.ts` 的 `loadTarget(payload): Promise<PlayerLoadResult>`：

| 步骤 | 判断 | 结果 |
| --- | --- | --- |
| 1 | `getItem(itemId)` 取不到条目，或（剧集）取不到媒体源 | `{ backend: 'html5', url: '', reason: '' }` + warn 日志「播放目标没有可用媒体源」 |
| 2 | 起回环播放服务 `startMediaPlayServer()`，拼出 `http://127.0.0.1:<port>/p/<token>/…` | 地址两后端共用 |
| 3 | 总开关 `app.mpvEnabled` 关掉、平台是 macOS（`locateMpv()` 一进来就返回 `found: false`）、或没探测到 mpv | **静默** `{ backend: 'html5', url, reason: '' }` |
| 4 | `MpvRuntime.start()` 抛错（路径错 / 起不来 / IPC 连不上） | `{ backend: 'html5', url, reason: 'mpv 播放失败，已改用内置播放器' }` + warn「mpv 启动失败，改用内置播放器：（stderr / 退出码）」 |
| 5 | 成功 | `{ backend: 'mpv', url, reason: '' }`，随后靠主进程推状态驱动 UI |

播放**中途** mpv 自己退了（进程退出、用户关掉 mpv 窗口）：`degradeToHtml5()` 把快照改成 `{ ...state, backend: 'html5', ready:false, ended:false, buffering:false, error: 'mpv 已退出，已切回内置播放器' }` 并落 warn 日志（stderr / 退出码进日志），渲染层的 `usePlaySession` 收到 `error` 非空就建 artplayer 从 `state.position` 续播。

| 场景 | 播放窗口的表现 |
| --- | --- |
| **在 macOS 上**（不论设置怎么配） | 一律内置播放器，**没有任何提示**（mpv 已停用，`locateMpv()` 直接返回没找到，见 §11 第 19 条） |
| 关掉总开关「使用 mpv 播放」 | 一律内置播放器，**没有任何提示**（不看路径、也不自动探测） |
| 开着总开关但没配 mpv | 静默用内置播放器，**没有任何提示**（说明只在设置页） |
| 配了 mpv 但起不来 | 回退内置播放器 + 画面顶部 warning 说明（`reason`，一句话人话） |
| 播放中途 mpv 退出 | 切内置播放器 + 从当前位置续播 + `error` 文案 |

## 3. 播放地址链路

`storage://` 私有协议是给渲染层的 `net.fetch` 用的，**mpv 吃不了**。所以主进程起一个回环 HTTP 服务转发：

```
media_source → buildMediaUrl() → storage://<连接>/<媒体ID>/<文件名>
             → startMediaPlayServer() → http://127.0.0.1:<port>/p/<32位hex token>/<连接>/<媒体ID>/<文件名>
```

- `src/main/src/modules/media/mediaPlayServer.ts`（已有，播放域直接复用）：懒启动单例，`listen(0, '127.0.0.1')`，路径必须带 `/<token>/` 前缀，否则 404；请求原样转给 `handleMediaRequest()`，**Range / 206 / 416、远端缓存、播放期路径自愈全部沿用 `storage://` 那一套**（见 [资料库文档](./01-media-library.md)）。响应体是手工抽流（`pipeBody`：`reader.read()` + `write` 返回 false 就等 `drain`），**断开信号听 `ServerResponse` 的 `close` 而不是 `IncomingMessage`**：后者在「请求收完」时就 close（GET 没有请求体，基本等于立即），等我们 `await handleMediaRequest()` 之后再挂就已经错过，而 Chromium 媒体栈缓冲够了会主动掐断 range 请求 —— 掐断后 `drain` 永远不来，底层读取流会被一直吊着（文件句柄泄漏）。
- 两个后端吃的是同一个地址，所以「切后端」= 重新 load，不需要重新解析源。
- 进程退出：`src/main/index.ts` 的 `before-quit` 里 `void disposeMediaPlayServer()`。

## 4. 窗口几何：视频区矩形（逐像素）

`src/common/types/player/layout.ts` 是**唯一**定义处，主进程与渲染层共用：

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `headerHeight` | 40 | 自绘标题栏（与主窗口一致） |
| `sidebarWidth` | 360 | 右侧详情侧栏 |
| `controlBarHeight` | 72 | 控制条高度（**两种摆法**：独占视频区下方一行，或悬浮在画面底部，见下面的 `controlBarRow`） |
| `defaultWidth` / `defaultHeight` | 1280 / 800 | 播放窗口默认尺寸 |
| `minWidth` / `minHeight` | 1040 / 640 | 最小尺寸 |

- `playerStageRect(contentWidth, contentHeight, fullscreen = false, controlBarRow = true)`：非全屏 `{ x:0, y:40, width: W-360, height: H-40-72 }`（**可能为负**，调用方钳制）；`controlBarRow: false` 时**不扣**那 72px（控制条悬浮在画面上）；全屏 `{ 0, 0, W, H }`。
- 主进程用 `win.getContentBounds()` + 这份函数算宿主窗口 bounds / mpv `geometry`；渲染层 DOM 必须**逐像素对齐**：标题栏 40、右侧栏 360、控制条 72，这些区域之间**不能有 gap / padding / 边框**，否则画面错位。
- **mpv 的 `--geometry` 不是 DIP**（macOS 停用 mpv 后这条路径暂时走不到，换算逻辑保留备查）：mpv 在 macOS 上按设备像素读 W/H，且 X/Y 以显示器工作区（菜单栏下方）左上角为原点。`playerWindow.ts` 的 `mpvGeometry()` 负责换算（`screen.getDisplayMatching(bounds)` 取那块屏的 `scaleFactor` 与 `workArea`，乘完再减原点）。2026-10 实测：请求 `600x400+200+600` → 实际窗口 `X=100 Y=333 W=300 H=200`（2x 屏 +8 个点菜单栏）。不换算的表现是「mpv 只有半个尺寸、还跑到左上角压住标题栏」。宿主窗口（`--wid`）那条路不受影响：`setBounds()` 收的就是 DIP。
- `player:layout` 推的是整份 `PlayerLayoutState`（三个字段，渲染层不自己分支）：
  - `fullscreen`：全屏时收起标题栏 / 侧栏 / 控制条。**macOS 的 simple fullscreen 不发 `enter/leave-full-screen`**，`togglePlayerFullscreen()` 里主动 `notifyLayout()`。
  - `controlBarRow`：控制条独占一行（真）还是悬浮在画面底部（假）。**只有「mpv 后端 + 原生窗口画法（Windows 或 `app.macEmbed`）」才为真** —— 原生子窗口永远压在网页之上，浮层会被它整块盖住；macOS 独立窗口模式下我们的窗口在 mpv 之上，才敢悬浮。
  - `transparentStage`：视频区是否透明。**当前恒为 `false`** —— 透明只服务「macOS 独立 mpv 窗口 + 挖洞」，而 macOS 已停用 mpv（见 §11 第 19 条）；字段保留是为了将来恢复该方案时不用改协议。
- `controlBarRow` / `transparentStage` 与 `stageBounds()` 传给 `playerStageRect` 的实参**必须同源**（都走 `playerWindow.ts` 的 `layoutOf()` / `embeddedLayout()`），否则 mpv 画面与网页 DOM 会错位。
- 推布局的时机有四处：进出全屏、`did-finish-load`（页面加载完必推一次，渲染层不靠默认值猜）、**后端变化**（`setStateSink` 里比对 `state.backend`）、换窗口。同一份布局不重复发（`pushedLayout` 去重）。
- 为什么几何不能依赖「当前后端」：`playerSession.loadTarget()` 里先算 canvas（`canvasProvider()`）再置 `backend = 'mpv'`，所以 `playerWindow.ts` 只能按平台能力（`embeddedLayout()`）算矩形；`layoutOf()` 里才用 `currentState().backend` 决定推给渲染层的排法。

## 5. 平台差异

| 维度 | Windows | macOS |
| --- | --- | --- |
| 方案 | **宿主窗口 + `--wid` 嵌入** | **内置 artplayer**（mpv 已停用）。历史方案：mpv 无边框独立窗口贴住视频区、`app.macEmbed` 打开时改成嵌入 —— 都已停用（见 §11 第 19 条） |
| 宿主窗口 | 恒有：`new BrowserWindow({ parent: playWin, frame:false, focusable:false, skipTaskbar:true, resizable:false, movable:false, …, backgroundColor:'#000000' })`，载 `host.html`；句柄 `getNativeWindowHandle()` 转十进制给 `--wid` | 不创建（没有 mpv 画面要嵌） |
| 同步方式 | 每次 `move` / `resize` **立即** `hostWin.setBounds(stageBounds(win))`（不防抖，否则拖动肉眼可见脱节） | 不需要（画面在网页里，跟着 DOM 走） |
| 窗口叠加 | 宿主窗口是**原生子窗口，永远压在网页之上** | 播放窗口**不透明**（`holeNeeded()` 恒 `false`）：透明窗口在 macOS 上要走额外的合成路径，实测会让播放周期性卡顿，而 macOS 已经不用 mpv，没有洞要挖 |
| 窗口外壳 | `frame: false` + `backgroundColor: '#000000'`，三键由 `AppTitleBar` 自绘 | **不写 `frame: false`**：写了会连系统红黄绿灯一起去掉，而 `AppTitleBar` 在 mac 上不画三键（约定是「系统红黄绿灯 + 自绘标题栏」）→ 结果就是窗口既没有标题栏也关不掉。用 `titleBarStyle: 'hidden'` + `trafficLightPosition: { x: 12, y: 14 }`（与主窗口同款），自绘标题栏靠 `padding-left: 80px` 让位 |
| 控制条 | 独占视频区下方一行（`controlBarRow: true`） | 不渲染自绘控制条：自绘那条只在 mpv 后端渲染，macOS 用内置播放器，artplayer 自带一条（「悬浮还是独占一行」在 macOS 上不涉及） |
| 交互 | 宿主页 `host.html` 接点击：单击（220ms 延迟）播放/暂停、双击全屏 | 画面就是普通窗口区域，点击由网页接（`PlayStage` 双击全屏） |

下面三条是 **Windows 嵌入方案**的实现约束（读 mpv 源码得出，别绕；macOS 停用 mpv 后不再涉及）：

1. `resize_child_win()` 会把子窗口 `SetWindowPos(child, 0, 0, rp.right, rp.bottom, …)` —— **父窗口一动，子窗口就被拉成「父窗口整个客户区、原点 (0,0)」**。所以 `--wid` 只能指「尺寸恰好等于视频区」的专用宿主窗口；指播放窗口本身会让 mpv 盖住右侧栏。
2. 嵌入模式下 mpv 对子窗口 `EnableWindow(w32->window, 0)` —— **子窗口不接收鼠标/键盘**，mpv 自带 OSC（`--osc=yes`）点了也没用。所以：mpv 一律 `--osc=no`，控件全部由 Electron 自绘、经 `--input-ipc-server` 驱动。
3. 宿主窗口只在 **mpv 真的在跑** 时显示（`mpvActive && hostReady` → `showInactive()`，否则 `hide()`）：它是原生子窗口，常驻会把内置播放器和网页内容整块盖住。

## 6. mpv 进程与 IPC 控制

`buildMpvArgs()`（`mpvProcess.ts`）基线参数（**只在 Windows 上会被用到**，macOS 停用 mpv）：

```
--no-config --load-scripts=no --terminal=yes --idle=yes --keep-open=yes --force-window=yes --osc=no
--input-terminal=no --input-ipc-server=<addr> --hwdec=auto-safe --volume=<0-100> --title=<标题>
```

两条踩过的坑（改参数前先读）：

- **脚本开关是 `--load-scripts=no`，没有 `--no-scripts` 这个选项**。mpv 0.41 遇到 `--no-scripts` 会 `Error parsing option no-scripts (option not found)` → `Exiting... (Fatal error)`，退出码 1 —— 表现就是「装好了 mpv 却永远报 `mpv 已退出（code=1）`」。
- **`--terminal=yes` 不能省**：mpv 的 stdout/stderr 不是 tty 时（我们就是 `pipe`）一个字都不打印，少了它日志里只剩「mpv 已退出（code=1）」，用户看不到原因。
- 退出信息听 `close` 而不是 `exit`（`mpvProcess.ts`）：`exit` 可能早于 stderr 读完，那会丢掉 mpv 的报错行。
- 刻意避开版本相关的开关（`--focus-on-open`、`--window-dragging` 等）：参数不认识时 mpv 直接退出，而这正是「起不来」最难排查的一类故障。

按需追加：`--start=<秒，四舍五入到 0.1>`（仅 > 0）、`--pause=yes`、`--mute=yes`、`--speed=<倍速>`（仅 > 0），然后二选一：`--wid=<宿主窗口句柄>` 或 `--no-border --geometry=<XxY+X+Y>`，**最后**才是播放地址。

- `mpvLocator.ts`：**macOS 直接返回「没找到」**（`process.platform === 'darwin'` 时在总开关判断与 30 秒缓存之前早退，理由见 §11 第 19 条），所以下面这套探测只在 Windows 上生效。探测顺序 = 设置项 `app.mpvPath` → PATH → 常见安装位置（`/opt/homebrew/bin/mpv`、`/usr/local/bin/mpv`、`/usr/bin/mpv`、`/Applications/mpv.app/Contents/MacOS/mpv`、`C:\Program Files\mpv\mpv.exe`、`C:\Program Files (x86)\mpv\mpv.exe`、`%LOCALAPPDATA%\mpv\mpv.exe`）；结果缓存 30 秒，`resetMpvCache()` 由设置页的「检测」（`detectMpv`）在命中时调用 —— 不点检测的话改完路径最多 30 秒才按新值走。`detectMpv(path)` 额外跑 `mpv --version` 取第一行 → `PlayerProbeResult { found, path, version, origin }`（`origin: 'setting' | 'path' | 'well-known' | 'none'`），**不受总开关影响**（Windows 上关掉总开关也能用它验证路径填得对不对）。
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
| `PlayerLoadResult` | `backend` / `url` / `reason` / `itemId` / `episodeId`（侧栏据此取详情、拨选中集）；**`reason` 与 `PlayerState.error` 都是直接显示给用户的文案，只写结论不写机制**（技术细节进日志），见 §11 第 21 条 |
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
| `windows/play/PlayApp.vue` | 布局骨架：标题栏 +（视频区 + 控制条）+ 右侧栏；全屏时只留视频区；排法（控制条占不占一行、视频区要不要透明）全听主进程推来的 `layout`，不在这里做平台分支；**控制条只在 mpv 后端渲染**（内置 artplayer 自带一条，再来一条就是「多出一行」）；`watch` 装载结果驱动侧栏与选中集 |
| `windows/play/components/PlayStage.vue` | 视频区（**矩形必须与 `playerStageRect` 一致**）；`stage` 事件把容器交给会话层挂 artplayer；缓冲指示 + `notice` 提示条；双击全屏 |
| `windows/play/components/PlayControlBar.vue` | 高 72px 控制条：播放/暂停、时钟、进度、音量、倍速、全屏；`overlay` 决定悬浮（绝对定位贴画面底部）还是独占一行；只 `emit('command', …)`，不做播放控制 |
| `windows/play/components/PlaySidePanel.vue` | 宽 360px 侧栏：`SensitiveImage` 封面 + 标题 + 关键元信息 + 复用 `MediaEpisodeList`；只 `emit('select', itemId)` |
| `windows/play/composables/usePlaySession.ts` | 播放会话：订阅 `onState` / `onSwitch` / `onLayout`、`playerApi.load()` 起播；`layout`（`PlayerLayoutState`，默认「独占一行 + 纯黑」，等主进程推）；`fullscreen` 由 `layout.fullscreen` 派生；mpv 走主进程，html5 自建 artplayer 并把事件折算成同一份 `PlayerState`；`apply(command)` 分流 |
| `windows/play/composables/usePlaySidebar.ts` | 侧栏取数：`mediaApi.detail({ itemId })` + `useFileConnections` + `useNsfwProtection` + `useEpisodeSelection`；折出 `facts`（番号 / 首播 / 时长 / N 季 M 集 / 体积 / 资料库 / 加入时间） |
| `windows/play/composables/useKeyboard.ts` | 快捷键：空格 / `k` 播放暂停、`←→` ±10s、`↑↓` 音量 ±0.05、`m` 静音、`f` 全屏、`Esc` 退出全屏；输入框内不响应 |
| `windows/host/HostApp.vue` | 宿主页：单击（220ms 延迟，避开双击）播放暂停、双击全屏 |
| `components/app/AppTitleBar.vue` | 自绘标题栏（主窗口与播放窗口共用，`title` prop + `leading` / `afterTitle` / `trailing` 插槽） |
| `components/app/AppPlayerBadge.vue` | 主窗口标题栏的「正在播放」标签（挂在 `afterTitle` 插槽、紧挨产品名）：订阅 `onStatus` + 挂载时 `getStatus()`，无播放窗口时不渲染，点击 `playerApi.focus()` |

- 详情页与播放窗口共用的两块从详情页目录迁到公共位置：`components/media/MediaEpisodeList.vue`（选集区）、`hooks/UseEpisodeSelection.ts`（选集状态），两份文件头部注释都已标注「详情页与播放窗口共用」。
- `components/media/MediaPlayer.vue` **不为播放窗口复用**（它是存储页的文件预览）：播放窗口的内置后端要接主进程命令、要按 `PlayerState` 回传状态，逻辑自建在 `usePlaySession.ts`。
- `play.html` 的 CSP 比 `index.html` 多一项：`media-src 'self' storage: http://127.0.0.1:*`（内置播放器吃回环服务地址，不写会被 CSP 拦掉）。
- **播放窗口的深色适配靠 `windows/play/main.ts` 里一句副作用 import `@/global/AppTheme`**：它用 `useColorMode({ attribute: 'theme-mode' })` 把属性挂到 `<html>` 上，TDesign 的深色变量才生效，同时把主题同步给 `nativeTheme`。主窗口是靠 `AppSide.vue` 顺带引入的，播放窗口没有那一层 —— 不引就是「播放窗口永远亮色」，模板里写多少 token 都没用。
- 内置后端不会读 `storage://`：两个后端都只吃主进程给的 `http://127.0.0.1:...` 地址，渲染层不拼磁盘路径。

## 9. 设置项（`app` 组）

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `app.mpvEnabled` | `true` | **用 mpv 播放的总开关**。关掉时一律走内置播放器：不看 `mpvPath`、也不做自动探测（`locateMpv()` 开头早退返回 `found:false`）。这是「想手动取消 mpv」的唯一入口；**macOS 上不生效**（mpv 已停用，设置页显示「暂不支持」标签） |
| `app.mpvPath` | `''` | mpv 可执行文件路径；留空自动探测（**仅 Windows**）。**总开关开着时**才看它：只有配到（或探测到）mpv，播放窗口才用 mpv；探测不到静默用内置播放器；macOS 上设置页**整项不显示** |
| `app.macEmbed` | `false` | 停用字段：macOS 已停用 mpv，本字段当前没有任何效果，设置页也不再暴露，只保留给将来恢复 macOS 方案时用 |

设置页 `pages/setting/components/SettingAppPanel.vue`：第一项是总开关「使用 mpv 播放」；macOS 上它显示成一枚「暂不支持」标签 + 一句结论文案（「macOS 上暂不支持 mpv 播放，一律使用内置播放器」），**路径那一项整项不显示**；Windows 上关掉总开关会把路径输入与「选择 / 检测」一并置灰（文案「总开关：关闭后一律使用内置播放器，忽略下面的路径、也不自动探测」）。**界面文案只说结论，不写实现细节**：像「透明挖洞」「一卡一卡」这类机制与故障描述只出现在代码注释与本文档里，不进 UI。`mpvPath` 带「检测」（`playerApi.detect(setting.mpvPath)`）。改 `mpvEnabled` / `macEmbed` 会改变窗口形态，`settingIpc.ts` 保存后直接 `closePlayerWindow()` —— 见 §11 第 18 条。

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
2. **原生 mpv 窗口下画面不参与网页合成**（只涉及 Windows）：Windows 嵌入模式里 mpv 子窗口是原生窗口，网页里任何遮罩 / 浮层都盖不住它 —— 所以播放窗口**不做 NSFW 画面遮罩**（只遮侧栏封面），控制条在这种模式下**必须单独占一行**、不能做成悬停浮层（`PlayerLayoutState.controlBarRow = true`）。macOS 用内置播放器，画面在网页里、控制条是 artplayer 自带的，两种摆法都不涉及。
3. **嵌入模式下 mpv 不接收输入**（mpv 自己 `EnableWindow(0)`）：mpv 的 `--osc` 关闭，控件全由 Electron 自绘经 IPC 驱动；点击事件由宿主页 `host.html` 接。
4. **macOS 的「独立窗口」方案已停用**（历史记录）：那条路的画面是独立原生窗口，拖动 / 缩放主窗口时 `geometry` 有 80ms 防抖，视觉上会滞后；`set_property geometry` 不被支持时还要重启 mpv 接续播放（`--start` + `--pause` / `--mute` / `--speed` / `--volume` 一并接续）。Windows 走宿主窗口 `setBounds()`，没有这条。
5. **macOS `--wid` 没有官方支持**：mpv 的 `--wid` 只文档化了 X11 / win32 / Android 三种窗口语义，macOS（NSView）不在其中，出黑画面是必然风险 —— 这是停用 macOS mpv 的一条依据（另一条是透明窗口卡顿，见第 19 条）。
6. **不用 `BrowserWindow.setParentWindow()`**：Electron 有已知 SIGSEGV 报告，宿主窗口改用构造项 `parent`。
7. **全屏语义**：`PlayerCommand.fullscreen` 不传 `enabled` 就是「切换」；只有窗口层知道当前状态，渲染层不要自己记。
8. **状态权威**：mpv 模式下主进程推的状态是唯一权威；html5 模式下渲染层是权威（主进程推来的 `html5` 状态无 `error` 时直接丢弃）。
9. **Linux 不在范围内**：`--wid` 走的是 Windows / macOS 两套分支，没有 X11 / Wayland 的路径。
10. **`player:load` 是消费式的**：渲染层挂载后取一次，取完清空 `pending`；窗口复用时换片靠 `player:switch` 推事件，不要再调 `load`。
11. **标题栏标签的可见性与真实播放状态会有一点错位**：条目没有可用媒体源时 `player:status` 仍会带片名（主进程只知道「装了这个目标」），标签会显示「正在打开」而画面是空的；`open` 只表示播放窗口存在，不代表已经出画。
12. **标签的状态文案是渲染层折的**，不是主进程字段：`PlayerState.ready / buffering / paused / ended / error` 的优先级写在 `AppPlayerBadge.vue` 里，改文案只改那一个函数（`stateTextOf`）。
13. **macOS 播放窗口不能写 `frame: false`**：无边框会连系统红黄绿灯一起去掉，而 `AppTitleBar` 在 mac 分支不画窗口三键 → 表现为「播放窗口没有标题栏、也关不掉」。用 `titleBarStyle: 'hidden'`（与主窗口同款），自绘标题栏用 `padding-left: 80px` 给灯让位；Windows 保持 `frame: false` 自绘三键。
14. **mpv 启动失败的原因必须能看见，但只进日志**：`--terminal=yes` 保证非 tty 下也有 stderr，`mpvProcess.ts` 用 `close` 收尾，stderr 与退出码写进 warn 日志（`appendLog`）。**给用户看的只有一句话**：`PlayerLoadResult.reason` / `PlayerState.error` 由主进程直接给成品文案（「mpv 播放失败，已改用内置播放器」「mpv 已退出，已切回内置播放器」），渲染层原样显示，不再往界面里塞 stderr、退出码、参数名。参数名写错（如 `--no-scripts`）会让 mpv 解析参数阶段就 fatal 退出，所以新增参数前先在真机 `mpv --no-config --idle=yes <新参数> <文件>` 跑一遍。
15. **mpv 的 `--geometry` 单位是设备像素、原点是工作区左上角**（macOS 停用 mpv 后暂时走不到，保留备查）：换算在 `playerWindow.ts` 的 `mpvGeometry()` 里（× `scaleFactor`、− `workArea`），忘了换算在 2x 屏上的表现就是「画面只有半个尺寸、还压在标题栏与侧栏上」。Windows 走 `--wid`，没有这条坑。**多显示器留个心眼**：减的是视频区所在那块屏的 `workArea` 原点，但我们没给 mpv 传 `--screen`，所以把播放窗口拖到第二块屏时 mpv 是否仍开在主屏需要真机确认（只影响「画面出现在哪块屏」，不影响尺寸换算）。
16. **播放窗口不再透明**：`holeNeeded()` 现在恒为 `false`（macOS 停用 mpv，没有洞要挖；Windows 走嵌入方案也不需要）。历史上只在「macOS + 总开关开着 + 未开 `macEmbed`」时为真，而透明窗口在 macOS 上要走额外的合成路径（[electron#39895](https://github.com/electron/electron/pull/39895)、[#52389](https://github.com/electron/electron/pull/52389) 都提到非不透明窗口的代价），实测会让播放周期性卡顿。
17. **分段读取的字节区间是闭区间、逐段不重叠**：`handleRangeRequest()` 用 `parseByteRange()` 的结果 `[start, end]`，`Content-Length = end - start + 1`、`Content-Range: bytes start-end/total`；底层 `readRange()`（local `createReadStream{start,end}` / WebDAV `range{start,end}` / SMB 打补丁的 `createFileReadStream{start,end}`）同样是闭区间，`streamToWeb.ts` 每个分片只入队一次。排查「播到的比请求的多 / 少几秒」时**不要**把这里当嫌疑点，先去比对源文件与播放器行为。
18. **改 `mpvEnabled` / `macEmbed` 会关掉播放窗口**：窗口形态（透不透明、控制条让不让行）在建窗口那一刻就定死了，`settingIpc.ts` 保存 `app` 组时比对这两个字段，变了就 `closePlayerWindow()`；否则会出现「在不透明窗口里等 mpv 独立窗口透出来」——表现为只有声音没有画面。macOS 上这两个字段已不再影响窗口形态（恒不透明 + 内置播放器），这条逻辑保留。
19. **macOS 为什么停用 mpv**（想改回来先读这两条依据）：① mpv 的 `--wid` 只在 X11 / win32 / Android 有官方支持（见第 5 条），macOS 想用 mpv 就只剩「mpv 独立无边框窗口 + 播放窗口透明挖洞」一条路；② 那条路要求我们的播放窗口透明，而真机实测（macOS 26.6.2 / Apple M4 Pro / Electron 39.2.6）透明窗口会让播放**周期性卡顿**，且内置播放器在同一个透明窗口里也一样卡 —— 而同一个文件用 QuickTime / 终端 mpv 直接播是流畅的。所以 `mpvLocator.ts` 在 macOS 上一律返回「没找到」，`holeNeeded()` 恒 `false`，播放入口静默走内置播放器。将来若 macOS 的嵌入被官方支持（或有别的办法把画面嵌进网页），把这两处改回来即可。
20. **macOS 上的播放行为**：内置 artplayer 一条龙 —— 画面在网页里、控制条是 artplayer 自带的（不渲染 `PlayControlBar`），播放窗口不透明、标题栏 / 侧栏 / 深色适配照旧；`player:layout` 推来的 `controlBarRow` 与 `transparentStage` 在 macOS 上分别是 `false` / `false`。
21. **界面文案只说结论，不写机制**（已上升为项目规范：`AGENTS.md` RL-10「界面文案」；踩过一次：设置页一度写着「mpv 只能用独立窗口 + 透明挖洞，而透明挖洞会让播放一卡一卡」）：UI 里不出现实现细节（挖洞 / 透明 / 防抖 / IPC）、不出现 stderr、退出码、选项名、也不描述故障现象；这些只写代码注释、`appendLog` 日志与本文档。设置页写「macOS 上暂不支持 mpv 播放，一律使用内置播放器」，播放窗口的降级提示写「mpv 播放失败，已改用内置播放器」。新增提示文案时照这个口径写。

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
10. macOS：播放一律走内置播放器（设置页 mpv 那一项显示「暂不支持」标签、只有一句结论文案，没有路径输入与「选择 / 检测」），画面正常出画、拖动窗口不滞后。
11. 主窗口标题栏：没开播放窗口时**看不到任何标签**；点「播放」后产品名右侧立刻出现胶囊（先「正在打开」→ 再变成「正在播放 · 片名」），剧集标签带上 `第 N 季 N 集`；窗口拉窄时先省略片名、状态文字始终完整。
12. 点标签：已最小化 / 被挡住的播放窗口会被还原并聚焦到最前；暂停、拖进度、换集时标签上的状态文字与进度跟着变。
13. 关掉播放窗口：标签立刻消失；`Esc` / 全屏切换不影响标签。
14. 播放窗口标题栏：macOS 左侧有系统红黄绿灯 + 片名（可关闭 / 最小化 / 缩放），Windows 右侧有自绘三键；全屏时整条收起。
15. 深色模式：设置页切到深色 → 播放窗口标题栏 / 侧栏 / 控制条立刻跟着变深（切「跟随系统」再改系统外观也跟得上）。
16. 内置播放器（未配置 mpv）：视频画面下方**只有 artplayer 自带那一条控制条**，不会再多出一行空白控制条。
17. 控制条摆法：macOS 用 mpv 时控制条**悬浮在画面底部**（画面铺到侧栏底部，不被控制条挤掉 72px）；Windows 用 mpv 时控制条独占画面下方一行（嵌入的原生子窗口不会盖住它）。
18. mpv 起不来时**能看到原因**：把 `mpvPath` 指到一个假文件时，提示里带 mpv 的 stderr 原文与退出码，而不是只有一句「mpv 已退出」。
19. **macOS 卡顿回归项（最重要）**：拿一个之前「一秒一卡」的文件播一遍，画面平滑、不再重复帧；同时确认播放窗口**不透明**（没有挖洞）。
20. mpv 总开关（Windows）：设置页关掉「使用 mpv 播放」→ 播放窗口一律用内置播放器（路径输入与「选择 / 检测」置灰）；再打开后播放 → 回到 mpv。
21. macOS 设置页：mpv 那一项显示「暂不支持」标签 + 一句结论文案（不出现「透明挖洞 / 一卡一卡」这类实现细节），**没有路径输入与「选择 / 检测」按钮**（整项不显示）。
22. Windows 播放中改总开关或 `macEmbed`：原来开着的播放窗口会自动关掉（下次播放按新的窗口形态重建）。
23. Windows 用 mpv 时画面**正好铺满视频区**：不缩在左上角、不压标题栏与侧栏，拖动 / 缩放窗口后依然贴合。
24. macOS 上不再出现 mpv 相关提示：没有「mpv 已退出」告警，画面下方只有 artplayer 自带那一条控制条，没有第二条空白控制条。
