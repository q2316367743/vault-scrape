/**
 * 渲染层控制窗口外观的统一出口（最小化 / 最大化 / 关闭 / 平台信息）。
 * 页面与 store 只从这里取 API，不直接触碰 window.preload（见 AGENTS.md）。
 */
export const appWindowApi = window.preload.appWindow
