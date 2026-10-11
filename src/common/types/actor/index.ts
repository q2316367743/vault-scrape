/**
 * 演员模块的公共形状（三端共享，禁止引入 `node:*`）。
 *
 * 组成：
 * - 用户设定数据：姓名 / 性别 / 头像 / 别名 / 生日 / 出生地 / 身高 / 三围 / 罩杯 /
 *   标语 / 来源链接 / 简介 / 用户标签，全部落在 SQLite 的 `actor`、`actor_alias`、`actor_image`；
 * - 关联：`media_cast` 用「影片 ID + 演员姓名归一化键」做弱关联，影片详情页与演员详情页共用这一份名单；
 * - 图片：文件落在应用数据目录，渲染层只拿 `storage://actor/{图片ID}/{文件名}`。
 */
export * from './gender'
export * from './normalize'
export * from './image'
export * from './error'
export * from './result'
export * from './detail'
export * from './request'
