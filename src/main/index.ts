import { app, shell, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { appendLog } from '$/db/repo/logRepo'
import { bindWindowState } from '$/modules/appWindow/appWindowIpc'
import { disposeFileClients } from '$/modules/file/fileClientManager'
import { registerIpc } from '$/registerIpc'

/**
 * 平台差异化的窗口外观：亚克力材质 + 自定义标题栏。
 *
 * 显式标注返回类型是为了让三个分支里的字面量按 BrowserWindowConstructorOptions 收窄，
 * 否则条件返回的对象字面量会被推宽成 string，无法通过 typecheck。
 */
function platformWindowOptions(): BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    // macOS：隐藏标题栏但保留系统红黄绿灯；vibrancy 是亚克力在 macOS 的对应物
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 14 },
      vibrancy: 'under-window',
      visualEffectState: 'active'
    }
  }
  if (process.platform === 'win32') {
    // Windows 11 系统亚克力；Windows 10 会忽略该材质，退化为 CSS 半透明分层
    return { frame: false, backgroundMaterial: 'acrylic' }
  }
  // Linux 无系统材质：无边框 + 渲染层纯 CSS 半透明
  return { frame: false }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    ...platformWindowOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  bindWindowState(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 注册全部 IPC 域（内部会初始化数据库），再落一条启动日志便于验证链路
  registerIpc()
  appendLog({ level: 'info', scope: 'app', message: 'vault-scrape 启动' })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 退出前释放文件模块的连接（WebDAV/SMB 会话、句柄）
app.on('before-quit', () => {
  void disposeFileClients()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
