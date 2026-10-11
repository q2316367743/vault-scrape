/**
 * 演员姓名归一化。
 *
 * 契约（演员身份归一的唯一实现，三端共用）：
 * - 归一化结果作为 `actor.name_key` / `actor_alias.alias_key`，也是刮削时匹配同一人的依据；
 * - 规则：NFKC 兼容归一 → 连续空白折叠成单个空格 → 去首尾空格 → 小写；
 * - 只做形状归一，不做拼音 / 翻译 / 罗马字改写（罗马字与汉字靠「别名」手工关联）。
 */

/** 全角空格、制表符等统一按空白处理 */
const BLANK_PATTERN = /\s+/g

/** 姓名归一化；空输入返回空串，调用方据此跳过 */
export function actorNameKey(name: string): string {
  return name.normalize('NFKC').replace(BLANK_PATTERN, ' ').trim().toLowerCase()
}

/** 别名列表归一化：空串丢弃、按键去重，保持输入顺序 */
export function actorNameKeyList(names: readonly string[]): string[] {
  const keys: string[] = []
  for (const name of names) {
    const key = actorNameKey(name)
    if (key.length === 0 || keys.includes(key)) continue
    keys.push(key)
  }
  return keys
}

/** 姓名列表去重：保留原始写法（用于展示与落库），按归一化键去重 */
export function actorUniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of names) {
    const trimmed = name.trim()
    const key = actorNameKey(trimmed)
    if (!trimmed || !key || seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}
