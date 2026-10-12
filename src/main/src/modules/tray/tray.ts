/**
 * 托盘域：常驻托盘图标（只有「打开」「退出」两项）与主窗口的隐藏语义。
 *
 * 契约（三平台同一套行为，平台差异只有 Dock 一处）：
 * - **关闭 = 隐藏**：点窗口关闭键时不退出进程，只 `hide()`，后台任务（刮削 / 演员补全）继续跑；
 *   托盘「打开」是唯一的主窗口恢复入口，「退出」才真的结束进程（`app.quit()` → `before-quit`
 *   置位 `quitting` → 各窗口放行关闭）。
 * - **macOS Dock**：窗口不显示时 `app.dock.hide()`，重新显示时 `app.dock.show()`。
 *   Windows / Linux 不需要等价代码：窗口隐藏后任务栏图标由系统自动移除。
 * - Dock 的判据是「**还有没有可见窗口**」而不是「主窗口可不可见」：独立播放窗口还开着时
 *   收掉 Dock 就没有入口把它找回来了，所以有任何一个可见窗口就保持 Dock 可见。
 *
 * 托盘图标用 `resources/logo16.png`：16pt 是 macOS 菜单栏的图标尺寸，同目录下的
 * `logo16@2x.png`（32px）会被 Electron 自动当成 2x 图取用。**不能用 256 / 512 的大图**——
 * macOS 按原始像素尺寸摆放托盘图标，大图会把整个托盘区铺满。
 * logo 是深蓝色（`#315264`），深色菜单栏下几乎看不见，所以标成 macOS 模板图交给系统按
 * 菜单栏前景色重绘；其它平台该标记无效，仍显示原色。
 * 路径退五级到仓库根（`src/main/index.ts` 里的同名导入退两级，别照抄）。
 */
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import trayIconPath from '../../../../../resources/logo16.png?asset'
import { mainWindow } from '$/modules/appWindow/appWindowIpc'

/** 托盘实例：必须留引用，被 GC 掉图标就从托盘区消失 */
let tray: Tray | null = null

/** 本次关闭是不是「退出应用」：由 `before-quit` 置位，置位后窗口的 `close` 不再拦截 */
let quitting = false

/** 是不是正在退出应用：窗口的 `close` 拦截据此判断该隐藏还是放行 */
export function isQuitting(): boolean {
  return quitting
}

/** 标记「本次关闭是退出应用」：`before-quit` 里调，之后窗口的 `close` 一律放行 */
export function markQuitting(): void {
  quitting = true
}

/** 显示并聚焦主窗口；主窗口已关闭时是空操作 */
export function showMainWindow(): void {
  const win = mainWindow()
  if (!win) return
  win.show()
  win.focus()
}

/** 建托盘（幂等）：菜单只有「打开」「退出」，并接管主窗口的关闭与显隐 */
export function createTray(win: BrowserWindow): void {
  if (tray) return
  const trayIcon = nativeImage.createFromPath(trayIconPath)
  // 深色菜单栏下深蓝 logo 几乎不可见：交给系统按菜单栏前景色重绘（只在 macOS 生效）
  trayIcon.setTemplateImage(true)
  tray = new Tray(trayIcon)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开', click: () => showMainWindow() },
      // 真正的退出：`app.quit()` 会先发 `before-quit`，由它置位 `quitting` 后各窗口才放行关闭
      { label: '退出', click: () => app.quit() }
    ])
  )

  /** 关闭拦截：非退出场景一律改成隐藏，窗口根节点不动，重开比重建便宜且状态全在 */
  const onClose = (event: Electron.Event): void => {
    if (quitting) return
    event.preventDefault()
    win.hide()
    syncDockVisibility()
  }
  /** 窗口重新显示（托盘「打开」、activate、以后的其它恢复入口）时把 Dock 找回来 */
  const onShow = (): void => syncDockVisibility()
  win.on('close', onClose)
  win.on('show', onShow)
  win.on('closed', () => {
    win.off('close', onClose)
    win.off('show', onShow)
  })
}

/** 按当前可见窗口同步 macOS Dock 显隐；非 macOS 是空操作 */
function syncDockVisibility(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  if (hasVisibleWindow()) app.dock.show()
  else app.dock.hide()
}

function hasVisibleWindow(): boolean {
  return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isVisible())
}
