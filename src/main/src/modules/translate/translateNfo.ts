/**
 * 译文回写 NFO：就地换掉标签正文，**不重跑 `buildNfoXml`**。
 *
 * 为什么不重跑：NFO 里还有图片标签与「刮削前位置」还原记录（`appendRestore`），
 * 重跑要重新推导这两样有状态的东西；按标签名换正文则能逐字节保留其余内容，
 * 也顺手保留其它工具写进去的未知标签。
 *
 * 契约：
 * - 纯文本处理：译文里为空的字段（或原文里没有这个标签）一律整段保持原文，绝不写空标签；
 * - `<tag>` 与 `<actor><name>` 这类重复标签**按位置一一对应**（与译文模型同口径，不靠名字匹配）；
 * - `<studio>` / `<genre>` 不在译文模型里，保持原文；
 * - 结尾补一行宿主私有标记（见 `NFO_TRANSLATED_TAG`），本机据此不再把译文当成原文读回；
 * - 回写前一律先读回文件：关闭了「写入 NFO」、读不到、写不进都只记一条日志，入库的译文照常有效。
 */
import { NFO_TRANSLATED_TAG, escapeXml, nfoTranslatedLine } from '@common/types/scrape'
import type { MediaItemTranslation } from '@common/types/translate'
import type { FileClient } from '$/modules/file/FileClient'
import { loadSetting } from '$/modules/setting/settingStore'

/** 只需要「记一条警告」，避免翻译模块反向依赖刮削模块 */
export interface TranslateLogSink {
  warn: (message: string) => void
}

/** 就地替换第一个同名标签的正文；译文为空或原文没有这个标签时原样返回 */
function replaceFirstTag(xml: string, name: string, value: string): string {
  const text = value.trim()
  if (text.length === 0) return xml
  const pattern = new RegExp(`(<${name}>)[\\s\\S]*?(</${name}>)`)
  // 用函数替换：译文里出现 `$1` 这类字符时不会被当成反向引用
  return xml.replace(pattern, (_match, open: string, close: string) => `${open}${escapeXml(text)}${close}`)
}

/** 按顺序替换全部同名标签；译文不够用时后面的标签保持原文 */
function replaceTagsInOrder(xml: string, name: string, values: readonly string[]): string {
  if (values.length === 0) return xml
  const pattern = new RegExp(`(<${name}>)[\\s\\S]*?(</${name}>)`, 'g')
  let index = 0
  return xml.replace(pattern, (match, open: string, close: string) => {
    const value = (values[index] ?? '').trim()
    index += 1
    return value.length === 0 ? match : `${open}${escapeXml(value)}${close}`
  })
}

/** 演员名在 `<actor>` 块里，只换块内的 `<name>`，别碰到其它同名标签 */
function replaceActorNames(xml: string, names: readonly string[]): string {
  if (names.length === 0) return xml
  let index = 0
  return xml.replace(/<actor>[\s\S]*?<\/actor>/g, (block) => {
    const value = (names[index] ?? '').trim()
    index += 1
    return value.length === 0 ? block : replaceFirstTag(block, 'name', value)
  })
}

/** 把译文标记作为根元素最后一个子元素写进去（重复回写时先去掉旧的那行） */
function withTranslatedMarker(xml: string, language: string): string {
  const line = nfoTranslatedLine(language)
  const existing = new RegExp(
    `[ \\t]*<${NFO_TRANSLATED_TAG}>[\\s\\S]*?</${NFO_TRANSLATED_TAG}>[ \\t]*\\n?`
  )
  const stripped = xml.replace(existing, '')
  const closing = stripped.lastIndexOf('\n</')
  if (closing < 0) return `${stripped}${line}\n`
  return `${stripped.slice(0, closing)}\n${line}${stripped.slice(closing)}`
}

/** 把一份译文打进 NFO 文本（纯函数） */
export function patchNfoXml(xml: string, translation: MediaItemTranslation): string {
  let output = replaceFirstTag(xml, 'title', translation.title)
  output = replaceFirstTag(output, 'originaltitle', translation.originalTitle)
  output = replaceFirstTag(output, 'plot', translation.overview)
  output = replaceFirstTag(output, 'maker', translation.maker)
  output = replaceFirstTag(output, 'label', translation.label)
  output = replaceFirstTag(output, 'series', translation.series)
  output = replaceFirstTag(output, 'director', translation.director)
  output = replaceTagsInOrder(output, 'tag', translation.tags)
  output = replaceActorNames(output, translation.actors)
  return withTranslatedMarker(output, translation.language)
}

/** 要回写的一份 NFO */
export interface NfoPatchTarget {
  path: string
  translation: MediaItemTranslation
}

/** 回写一份 NFO：读回 → 打补丁 → 写回；没开「写入 NFO」或读写失败都返回 false */
export async function writeTranslatedNfo(
  client: FileClient,
  target: NfoPatchTarget,
  log: TranslateLogSink
): Promise<boolean> {
  if (!loadSetting().translate.writeNfo) return false
  try {
    const xml = await client.readText(target.path)
    await client.writeText(target.path, patchNfoXml(xml, target.translation), { overwrite: true })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    log.warn(`译文写入 NFO 失败（${target.path}）：${message}`)
    return false
  }
}

/** 批量回写，返回真正写成功的份数 */
export async function writeTranslatedNfos(
  client: FileClient,
  targets: readonly NfoPatchTarget[],
  log: TranslateLogSink
): Promise<number> {
  let written = 0
  for (const target of targets) {
    if (await writeTranslatedNfo(client, target, log)) written += 1
  }
  return written
}
