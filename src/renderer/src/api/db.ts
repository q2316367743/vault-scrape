/**
 * 渲染层访问数据库的统一出口。
 * 页面与 store 只从这里取 API，不直接触碰 window.preload（见 AGENTS.md）。
 */
export const dbApi = window.preload.db
