# 托盘与 macOS Dock

## 实现思路

桌面端「关闭 = 退进程」的默认语义会连后台任务一起带走（刮削、演员补全、离线包下载都在主进程跑），
所以这一版把主窗口的关闭改成**隐藏**，用一个常驻托盘当恢复入口：

- **托盘**：`src/main/src/modules/tray/tray.ts` 建 `Tray`，菜单**只有两项**——「打开」（显示并聚焦主窗口）、
  「退出」（真的结束进程）。
- **关闭 = 隐藏**：主窗口的 `close` 事件被拦截，非退出场景一律 `event.preventDefault()` + `win.hide()`。
  窗口根节点不销毁，重开比重建便宜，渲染层状态（当前路由、滚动位置、表单草稿）全部还在。
- **退出**：托盘「退出」只是 `app.quit()`；`app.on('before-quit')` 里先 `markQuitting()` 置位退出标志，
  之后再关窗口就不再拦截。Cmd + Q、系统注销等其它退出路径走的是同一个 `before-quit`，不需要各写一份。
- **macOS Dock**：窗口不显示时 `app.dock.hide()`，重新显示时 `app.dock.show()`。Windows / Linux 不需要
  等价代码——窗口隐藏后任务栏图标由系统自动移除（这也是「只 macOS 生效」的原因）。

没有新增任何 IPC 通道、preload 桥或渲染层改动：全部发生在主进程，渲染层仍然只调 `appWindow:close`
（见 [窗口外观与自定义标题栏](./02-window-chrome.md) 的 appWindow 契约）。

## 托盘

| 项 | 说明 |
| --- | --- |
| 菜单项 | `打开` / `退出`，仅此两项；用 `Menu.buildFromTemplate` + `Tray.setContextMenu`（Windows / Linux 右键、macOS 左键都会弹这一份） |
| 图标 | `resources/logo16.png`（`import trayIconPath from '../../../../../resources/logo16.png?asset'`，从 `modules/tray/` 退五级到仓库根）+ 同目录 `logo16@2x.png`（32px，靠 Electron 的 `@2x` 约定自动取用）。**不能拿大图**：macOS 按原始像素摆放托盘图标，256 / 512 会把整个托盘区铺满。logo 是深蓝（`#315264`），深色菜单栏下几乎不可见，所以 `setTemplateImage(true)` 交给系统按菜单栏前景色重绘（该标记只在 macOS 生效，其它平台仍是原色） |
| 生命周期 | 模块级 `let tray` 持引用（被 GC 掉图标会从托盘区消失）；`createTray()` 幂等，重复调用直接返回 |
| 退出标志 | `quitting` 由 `markQuitting()` 置位，`isQuitting()` 供关闭拦截读取 |

`createTray(win)` 在 `createWindow()` 里紧跟 `bindAppWindow(mainWindow)` 调用，绑定两件事：

```ts
win.on('close', (event) => {
  if (quitting) return          // 退出流程：放行，交给 before-quit 收尾
  event.preventDefault()
  win.hide()
  syncDockVisibility()
})
win.on('show', () => syncDockVisibility())
```

`closed` 时把这两个监听解绑，避免窗口重建后旧监听挂着已销毁的窗口。

## macOS Dock 隐藏

```ts
function syncDockVisibility(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  if (hasVisibleWindow()) app.dock.show()
  else app.dock.hide()
}
function hasVisibleWindow(): boolean {
  return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isVisible())
}
```

- 判据是「**还有没有可见窗口**」而不是「主窗口可不可见」：独立播放窗口（见
  [播放窗口与 mpv 播放](../media/03-mpv-playback.md)）还开着并可见时，把 Dock 收掉就没有入口把它找回来了，
  所以只要还有任何一个可见窗口就保持 Dock 可见。
- 触发点只有两处：主窗口 `close`（隐藏后同步）、主窗口 `show`（恢复后同步）。托盘「打开」走
  `showMainWindow()` → `win.show()` → `show` 事件，因此 Dock 图标会跟着回来，不需要在托盘里再写一次。
- `app.dock` 在 Windows / Linux 上是 `undefined`，所以先判平台再判 `!app.dock` 收窄类型，不写 `as` 断言。

## 与 activate 的关系

Dock 图标被隐藏时点不到它，恢复入口是托盘；但 `app.dock.show()` 之后点 Dock 图标仍会触发 `activate`，
而这时窗口其实已经存在（只是被隐藏过），旧代码的 `getAllWindows().length === 0` 判断会把它当成「已打开」
而不做任何事。所以 `activate` 改成两分支：

```ts
if (BrowserWindow.getAllWindows().length === 0) createWindow()
else showMainWindow()
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/src/modules/tray/tray.ts` | 托盘创建与菜单、关闭拦截、`quitting` 标志、macOS Dock 同步 |
| `src/main/src/modules/appWindow/appWindowIpc.ts` | `bindAppWindow(win)` / `mainWindow()`：窗口域里唯一的应用主窗口引用（托盘据此显示聚焦） |
| `src/main/index.ts` | `createWindow()` 里 `bindAppWindow` + `createTray`；`before-quit` 里 `markQuitting()`；`activate` 恢复隐藏窗口 |

## 注意事项

- **不要**把「关闭 = 隐藏」写进渲染层：`appWindow:close` 仍然只做 `close()`，语义在主进程一处定义。
- 新增窗口（如播放窗口）如果也要「关闭即隐藏」，需要自己绑一套同样的拦截；托盘当前只管主窗口。
- 后台任务在窗口隐藏期间照常运行；主进程崩溃 / 被强杀时窗口状态不落盘，重启回到正常显示。
- 托盘图标的彩色 PNG 在深色菜单栏下观感一般；将来要做 macOS 专用的黑白模板图标，加资源后改
  `nativeImage.createFromPath(...).setTemplateImage(true)` 即可，不改这份契约。

## 手工验收清单

只做 `yarn typecheck`，运行期行为由人工验证：

1. 启动后托盘出现图标，菜单只有「打开」「退出」两项。
2. macOS 点红黄绿灯关闭（Windows / Linux 点自绘关闭键）→ 窗口消失、进程仍在（活动监视器可见）。
3. macOS 上第 2 步同时 Dock 图标消失。
4. 托盘「打开」→ 窗口回来并获得焦点；macOS 上 Dock 图标同时回来。
5. 先开播放窗口（影视墙详情页点播放），再关闭主窗口 → macOS Dock 仍在（还有可见窗口）。
6. 托盘「退出」→ 进程真的结束（活动监视器不再有进程），WebDAV / SMB 连接与 mpv 正常释放。
7. Cmd + Q → 与第 6 步一致（走 `before-quit` 的同一条路径）。
