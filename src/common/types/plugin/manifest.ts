/**
 * 插件元信息、环境变量声明与摘要。
 *
 * 契约：
 * - `meta.id` 唯一，同时是插件源码的文件名（`<id>.js`）；
 * - 环境变量（账号、Cookie、站点地址等）由插件声明，取值落在
 *   `~/.vault-scrape/plugin/plugins.json`，不并入 settings.json；
 * - 环境变量一律按敏感文本处理：safeStorage 加密落盘、取值只在设置页填写
 *   且不回显、界面只回「已填写 / 未填写」、明文永不跨 IPC。
 */
import type { PluginErrorCode } from './error'

/**
 * 插件 ID 规则：kebab-case，最长 64 字符。
 * ID 同时充当源码文件名，必须严格校验以防路径逃逸。
 */
export const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

/** 一处配置（存储 / 资料库）最多能勾选的插件数量，防止脏数据撑爆配置文件 */
export const PLUGIN_ID_LIMIT = 200

/**
 * 插件 ID 列表归一化：去首尾空白、只留合法 ID、去重、限量。
 *
 * 存储与资料库都存「刮削器 ID 数组」，两处必须用同一套清洗规则，
 * 否则同一份脏数据在两处会归一成不同结果。
 */
export function normalizePluginIds(input: readonly string[], limit = PLUGIN_ID_LIMIT): string[] {
  const result: string[] = []
  for (const item of input) {
    const id = item.trim()
    if (id.length === 0 || !PLUGIN_ID_PATTERN.test(id) || result.includes(id)) continue
    result.push(id)
    if (result.length >= limit) break
  }
  return result
}

export interface PluginMeta {
  /** 唯一标识，kebab-case；同时是源码文件名 */
  id: string
  name: string
  version: string
  author?: string
  description?: string
  /** 优先匹配的番号前缀，供后续多插件选源 */
  prefixes?: string[]
  homepage?: string
}

/**
 * 语义化版本比较：按 `.` 分段，每段取前导数字比较，缺失段按 0 处理。
 *
 * 只认数字，因此 `1.0.0-beta` 与 `1.0.0` 视为相同（预发布后缀不参与排序）；
 * 返回 <0 / 0 / >0，供导入时「同名只保留最新」择优使用。
 */
export function comparePluginVersion(left: string, right: string): number {
  const leftParts = left.split('.')
  const rightParts = right.split('.')
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftNumber = leadingNumber(leftParts[index])
    const rightNumber = leadingNumber(rightParts[index])
    if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1
  }
  return 0
}

/** 取版本段的前导数字；没有数字时按 0 处理 */
function leadingNumber(part: string | undefined): number {
  const matched = part?.match(/^\d+/)
  return matched ? Number.parseInt(matched[0], 10) : 0
}

/**
 * 插件声明的环境变量。
 *
 * 账号类参数（站点地址、Cookie、Token…）都是文本，所以声明只描述「要填什么」，
 * 值一律按敏感文本处理：多行文本域填写、加密落盘、界面只回「是否已填写」。
 */
export interface PluginEnvField {
  key: string
  label: string
  required?: boolean
  placeholder?: string
  description?: string
}

/** 环境变量取值：插件方法拿到的 `env`，键值都是字符串 */
export type PluginEnvValue = Record<string, string>

/**
 * 插件来源：
 * - `file`：用户导入 / 编辑的 `.js` 脚本，落盘在 `~/.vault-scrape/plugin/<id>.js`；
 * - `builtin`：随应用内置的原生实现（如 R18 离线数据包），索引里有记录（`builtin: true`）但没有源码文件，不可编辑、不可删除、不可被同名覆盖。
 */
export type PluginSource = 'file' | 'builtin'

/** 渲染层可见的插件摘要（不含源码与环境变量明文） */
export interface PluginSummary {
  id: string
  name: string
  version: string
  author: string
  description: string
  enabled: boolean
  /** 插件来源：内置插件不可编辑源码、不可删除 */
  source: PluginSource
  /** 插件源码在本机的绝对路径；内置插件为空串 */
  filePath: string
  /** 是否声明了环境变量 */
  hasEnv: boolean
  /** 必填环境变量是否已填写 */
  envReady: boolean
  /** 最近一次加载失败原因，非空表示当前不可用 */
  loadError: string
}

/** 环境变量读取结果：只回声明表与非敏感信息，已填写的值不回读 */
export interface PluginEnvSnapshot {
  fields: PluginEnvField[]
  /** key -> 是否已填写 */
  filled: Record<string, boolean>
}

/**
 * 环境变量保存草稿。
 *
 * 契约：只提交本次改动的项，缺省或空串表示「保持已保存的值」，与文件模块的密码约定一致。
 */
export interface PluginEnvDraft {
  values: Record<string, string>
}

/** 单个插件文件导入失败的原因 */
export interface PluginImportFailure {
  filePath: string
  code: PluginErrorCode
  message: string
}

/**
 * 被跳过的插件文件：同批或本机已有更新的版本，本次不落盘。
 *
 * 契约：`skipped` 是**非错误**语义，渲染层按提示处理，不能计入导入失败。
 */
export interface PluginImportSkipped {
  filePath: string
  id: string
  name: string
  /** 最终保留（未被替换）的版本号 */
  keptVersion: string
  /** 可直接展示的中文原因，例如「本机已安装更新的版本 v2.0.0」 */
  message: string
}

/** 批量导入结果：逐个文件独立成败，一个失败不影响其余文件 */
export interface PluginImportResult {
  imported: PluginSummary[]
  /** 因同名已有更新版本而跳过的文件 */
  skipped: PluginImportSkipped[]
  failed: PluginImportFailure[]
}
