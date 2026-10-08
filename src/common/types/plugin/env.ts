/**
 * 插件环境变量声明与取值的归一化。
 *
 * 契约：
 * - 声明表来自插件源码，取值来自落盘文件，两者都可能被手工改坏，一律逐项校验；
 * - 环境变量一律按敏感文本处理（多行文本域填写、密文落盘、界面只回「是否已填写」）；
 * - 归一化绝不抛错、绝不引入 any。
 */
import { readString, toSource } from '../setting/shared'
import type { PluginEnvField, PluginEnvValue } from './manifest'

/** 单个插件最多允许声明的环境变量数 */
export const PLUGIN_ENV_FIELD_LIMIT = 50

/** 环境变量 key 允许的字符 */
const ENV_KEY_PATTERN = /^[A-Za-z0-9_-]+$/

function warn(message: string): void {
  console.warn(`[plugin] ${message}`)
}

function normalizeField(raw: unknown): PluginEnvField | null {
  const source = toSource(raw)
  if (!source) return null
  const key = readString(source, 'key', '')
  if (!ENV_KEY_PATTERN.test(key)) return null
  const label = readString(source, 'label', '') || key
  const placeholder = readString(source, 'placeholder', '')
  const description = readString(source, 'description', '')
  return {
    key,
    label,
    required: source.required === true,
    placeholder: placeholder.length > 0 ? placeholder : undefined,
    description: description.length > 0 ? description : undefined
  }
}

/** 声明表：非法项丢弃，重复 key 只保留第一个，超量截断 */
export function normalizeEnvFields(raw: unknown): PluginEnvField[] {
  const list = Array.isArray(raw) ? raw : []
  if (list.length > PLUGIN_ENV_FIELD_LIMIT) {
    warn(`环境变量声明 ${list.length} 个，超出上限 ${PLUGIN_ENV_FIELD_LIMIT}，已截断`)
  }
  const fields: PluginEnvField[] = []
  for (const item of list.slice(0, PLUGIN_ENV_FIELD_LIMIT)) {
    const field = normalizeField(item)
    if (!field) continue
    if (fields.some((item) => item.key === field.key)) {
      warn(`环境变量 key 重复：${field.key}，已忽略后一个`)
      continue
    }
    fields.push(field)
  }
  return fields
}

/** 落盘的取值：只保留声明过的 key，值必须是非空字符串（密文由存储层负责） */
export function normalizeEnvValues(
  fields: readonly PluginEnvField[],
  raw: unknown
): PluginEnvValue {
  const source = toSource(raw)
  const values: PluginEnvValue = {}
  if (!source) return values
  for (const field of fields) {
    const value = source[field.key]
    if (typeof value === 'string' && value.length > 0) values[field.key] = value
  }
  return values
}

/** 渲染层可见的「已填写」掩码：只暴露是否存在，不暴露内容 */
export function readEnvFilledMask(
  fields: readonly PluginEnvField[],
  values: PluginEnvValue
): Record<string, boolean> {
  const filled: Record<string, boolean> = {}
  for (const field of fields) {
    filled[field.key] = (values[field.key] ?? '').length > 0
  }
  return filled
}

/** 必填环境变量是否都已填写，按「已填写」掩码判断，不回读明文 */
export function isEnvReady(
  fields: readonly PluginEnvField[],
  filled: Record<string, boolean>
): boolean {
  return fields.every((field) => field.required !== true || filled[field.key] === true)
}
