/**
 * 设置归一化的共享读取工具。
 *
 * 契约：设置来源可能是损坏的 JSON、旧版本文件或被手工改错的内容，
 * 所有读取都必须「取值失败即回落默认」，绝不抛错，绝不引入 any。
 */

/** 把 unknown 收窄成可索引对象；非对象返回 null 表示整体回落默认值 */
export function toSource(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null
}

export function readString(
  source: Record<string, unknown>,
  key: string,
  fallback: string
): string {
  const value = source[key]
  return typeof value === 'string' ? value : fallback
}

/** 数值要求有限且不小于 min，否则回落默认值 */
export function readNumber(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  min = 0
): number {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback
}

export function readBoolean(
  source: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const value = source[key]
  return typeof value === 'boolean' ? value : fallback
}

/** 枚举白名单校验，非法值回落默认值 */
export function readEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  options: readonly T[],
  fallback: T
): T {
  const value = source[key]
  if (typeof value !== 'string') return fallback
  return (options as readonly string[]).includes(value) ? (value as T) : fallback
}

/** 字符串数组，逐项过滤非字符串；非数组回落默认值 */
export function readStringArray(
  source: Record<string, unknown>,
  key: string,
  fallback: string[]
): string[] {
  const value = source[key]
  if (!Array.isArray(value)) return fallback
  return value.filter((item): item is string => typeof item === 'string')
}
