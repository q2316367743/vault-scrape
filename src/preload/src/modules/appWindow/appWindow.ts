import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { AppWindowChannels, type WindowThemeSource } from './appWindowChannels'

/** 渲染层控制窗口与读取平台信息的唯一入口 */
export const appWindowApi = {
  /** 是否 macOS：标题栏据此决定保留系统红黄绿灯还是渲染自绘的窗口按钮 */
  isMac: process.platform === 'darwin',
  minimize: (): Promise<void> => ipcRenderer.invoke(AppWindowChannels.minimize),
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke(AppWindowChannels.toggleMaximize),
  close: (): Promise<void> => ipcRenderer.invoke(AppWindowChannels.close),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(AppWindowChannels.isMaximized),
  /** 设置窗口材质主题：macOS vibrancy / Windows acrylic 的深浅由主进程决定 */
  setThemeSource: (source: WindowThemeSource): Promise<void> =>
    ipcRenderer.invoke(AppWindowChannels.setThemeSource, source),
  /** 订阅最大化状态变化，返回取消订阅函数（组件卸载时必须调用） */
  onMaximizedChange: (listener: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, maximized: boolean): void => listener(maximized)
    ipcRenderer.on(AppWindowChannels.maximizedChanged, handler)
    return () => {
      ipcRenderer.removeListener(AppWindowChannels.maximizedChanged, handler)
    }
  }
}

export type AppWindowApi = typeof appWindowApi
