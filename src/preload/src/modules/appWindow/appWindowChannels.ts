/**
 * appWindow 域 IPC 契约：通道常量。
 * preload 桥与 main handler 共用这一份定义（main 通过别名 ~ 引用）。
 */
export const AppWindowChannels = {
  minimize: 'appWindow:minimize',
  toggleMaximize: 'appWindow:toggleMaximize',
  close: 'appWindow:close',
  isMaximized: 'appWindow:isMaximized',
  setThemeSource: 'appWindow:setThemeSource',
  /** main → renderer 单向推送：自绘标题栏据此切换「最大化 / 还原」图标 */
  maximizedChanged: 'appWindow:maximizedChanged'
} as const

/** 窗口材质主题：取值与 Electron `nativeTheme.themeSource` 对齐（`system` 即跟随系统） */
export type WindowThemeSource = 'light' | 'dark' | 'system'
