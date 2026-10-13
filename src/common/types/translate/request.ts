/**
 * 翻译 IPC 的入参。
 *
 * 契约：两个通道都只认条目 ID；`itemId` 由主进程校验存在，不存在报 `invalidItem`。
 */
export interface TranslateItemRequest {
  itemId: string
  /**
   * 本次使用的翻译插件 ID；缺省表示「按设置自动挑」。
   *
   * 手动翻译由弹窗显式传选中的插件；刮削后的自动翻译不传，走 `setting.translate.pluginId`
   * 或插件页顺序里第一个可用的插件。
   */
  pluginId?: string
}

/** 丢弃某条目的译文（重新刮削前、清除刮削成果时使用） */
export interface TranslateClearRequest {
  itemId: string
}
