/**
 * 刮削模块的渲染层入口。
 *
 * 契约：主进程桥（`window.preload.scrape`）直接透出，不再包装；
 * 目录浏览（`scrape:browse`）当前没有渲染层入口，整库刮削由影视墙的资料库抽屉发起。
 */
export const scrapeApi = window.preload.scrape
