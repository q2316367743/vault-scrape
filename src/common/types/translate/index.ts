/**
 * 翻译域的公共类型出口。
 *
 * 本目录只放纯类型与纯函数，三端共享；真正的实现位于 main 的
 * `src/main/src/modules/translate/`，设计说明见 `docs/plugin/10-translate-integration.md`。
 */
import type { TranslateLanguage } from '../setting/translateSetting'

/**
 * 一个条目的译文。
 *
 * 契约：
 * - **原文永远留在 `media_item` 各列里，本表只存译文**，所以译文是纯派生物：
 *   换目标语言、换插件、重新刮削都可以直接删掉重算，不会伤到原文；
 * - 一行 = 一个条目（`itemId` 唯一）；剧集的每一集是独立条目，各占一行，
 *   且**只填 `overview`**（按产品口径，集标题不翻译），剧集本身那行才填全部字段；
 * - 空串 / 空数组表示「这个字段没有译文」，渲染层读取时回落到原文；
 * - `tags` 与 `actors` 是**按位置对应原文**的数组：`actors` 的顺序就是 `listCastByItem` 的顺序，
 *   长度不一致时按缺失处理（多余的忽略），绝不能靠名字匹配（演员名可能重名、也可能被翻译得不一样）。
 */
export interface MediaItemTranslation {
  itemId: string
  /** 条目所属资料库；用于按库级联清理 */
  libraryId: string
  /** 译文语言 */
  language: TranslateLanguage
  /** 翻译时的源语言；空串表示当时没有设置库语言，由插件自动检测 */
  sourceLanguage: TranslateLanguage | ''
  /** 标题（剧集是剧名） */
  title: string
  /** 原名 */
  originalTitle: string
  /** 简介（剧集是剧集简介，集是集简介） */
  overview: string
  /** 片商 */
  maker: string
  /** 厂牌 */
  label: string
  /** 系列 */
  series: string
  /** 导演 */
  director: string
  /** 标签，按位置对应原文 */
  tags: string[]
  /** 演员名，按位置对应原文 */
  actors: string[]
  /** 产出这份译文的插件 ID */
  pluginId: string
  /** 翻译完成时间；0 表示未知 */
  translatedAt: number
}

export * from './error'
export * from './request'
export * from './result'
