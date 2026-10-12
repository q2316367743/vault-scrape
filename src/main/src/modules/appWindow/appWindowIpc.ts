import { BrowserWindow, ipcMain, nativeTheme, type IpcMainInvokeEvent } from 'electron'
import { AppWindowChannels, type WindowThemeSource } from '~/modules/appWindow/appWindowChannels'

/** 合法取值白名单：渲染层入参不可信，非法值交给 Electron 会直接抛错 */
const THEME_SOURCES: readonly WindowThemeSource[] = ['light', 'dark', 'system']

/** 应用主窗口：托盘要能看见它（显示 / 聚焦），窗口域里只留这一个引用 */
let appWin: BrowserWindow | null = null

/** 登记应用主窗口；窗口关闭后自动置空，调用方不必自己解绑 */
export function bindAppWindow(win: BrowserWindow): void {
  appWin = win
  win.on('closed', () => {
    if (appWin === win) appWin = null
  })
}

/** 当前应用主窗口；已关闭或还没建时返回 null */
export function mainWindow(): BrowserWindow | null {
  return appWin && !appWin.isDestroyed() ? appWin : null
}

/** 从 IPC 事件反查发起调用的窗口：多窗口时各自操作自己 */
function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

/**
 * 把窗口最大化状态推给渲染层，供自绘标题栏切换「最大化 / 还原」图标。
 * 系统标题栏被隐藏后，渲染层无法自行感知最大化状态，只能由窗口事件驱动。
 */
export function bindWindowState(win: BrowserWindow): void {
  const push = (maximized: boolean): void => {
    if (!win.isDestroyed()) win.webContents.send(AppWindowChannels.maximizedChanged, maximized)
  }
  win.on('maximize', () => push(true))
  win.on('unmaximize', () => push(false))
}

/** appWindow 域 IPC 注册：只暴露窗口控制能力，不做业务 */
export function registerAppWindowIpc(): void {
  ipcMain.handle(AppWindowChannels.minimize, (event) => senderWindow(event)?.minimize())
  ipcMain.handle(AppWindowChannels.toggleMaximize, (event) => {
    const win = senderWindow(event)
    if (!win) return false
    // 直接返回目标态：maximize/unmaximize 是异步生效的，随后由 bindWindowState 推送确认
    if (win.isMaximized()) {
      win.unmaximize()
      return false
    }
    win.maximize()
    return true
  })
  ipcMain.handle(AppWindowChannels.close, (event) => senderWindow(event)?.close())
  ipcMain.handle(
    AppWindowChannels.isMaximized,
    (event) => senderWindow(event)?.isMaximized() ?? false
  )
  // 主题是应用级设置，不需要按窗口区分：改了之后所有窗口的材质一起变
  ipcMain.handle(AppWindowChannels.setThemeSource, (_event, source: WindowThemeSource) => {
    if (THEME_SOURCES.includes(source)) nativeTheme.themeSource = source
  })
}
