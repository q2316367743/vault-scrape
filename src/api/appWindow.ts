/**
 * 窗口外观的统一出口（最小化 / 最大化 / 关闭 / 平台信息）。
 *
 * 宿主没有窗口材质 API（vibrancy / acrylic 由宿主决定），所以旧版的
 * `setThemeSource` 变成空操作；最大化状态由窗口尺寸事件反查，不依赖主进程推送。
 */
import { getCurrentWindow, platform, type UnlistenFn } from '@dashou/api'
import { callCore } from './invoke'

export const appWindowApi = {
  /** 是否 macOS：标题栏据此决定保留系统红黄绿灯还是渲染自绘的窗口按钮 */
  isMac: platform() === 'macos',

  minimize: (): Promise<void> => getCurrentWindow().minimize(),

  toggleMaximize: async (): Promise<boolean> => {
    const win = getCurrentWindow()
    if (await win.isMaximized()) {
      await win.unmaximize()
      return false
    }
    await win.maximize()
    return true
  },

  close: (): Promise<void> => getCurrentWindow().close(),

  isMaximized: (): Promise<boolean> => getCurrentWindow().isMaximized(),

  /** 用系统默认浏览器打开 http(s) 链接（窗口本身不导航） */
  openUrl: (url: string): Promise<void> => callCore('openUrl', url),

  /** 宿主不允许插件改窗口材质，保留方法名让调用方无需分支 */
  setThemeSource: (_source: 'light' | 'dark' | 'system'): void => undefined,

  /** 订阅最大化状态变化，返回取消订阅函数（组件卸载时必须调用） */
  onMaximizedChange: (listener: (maximized: boolean) => void): (() => void) => {
    const win = getCurrentWindow()
    let unlisten: UnlistenFn | null = null
    let closed = false
    const check = (): void => {
      void win.isMaximized().then((value) => {
        if (!closed) listener(value)
      })
    }
    void win.onResized(check).then((fn) => {
      if (closed) fn()
      else unlisten = fn
    })
    check()
    return () => {
      closed = true
      unlisten?.()
      unlisten = null
    }
  }
}

export type AppWindowApi = typeof appWindowApi
