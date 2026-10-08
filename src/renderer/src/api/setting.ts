/**
 * 渲染层读写设置的统一出口。
 * 页面与 store 只从这里取 API，不直接触碰 window.preload（见 AGENTS.md）。
 */
export const settingApi = window.preload.setting
