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

/** 渲染层可见的插件摘要（不含源码与环境变量明文） */
export interface PluginSummary {
  id: string
  name: string
  version: string
  author: string
  description: string
  enabled: boolean
  /** 插件源码在本机的绝对路径 */
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

/** 批量导入结果：逐个文件独立成败，一个失败不影响其余文件 */
export interface PluginImportResult {
  imported: PluginSummary[]
  failed: PluginImportFailure[]
}
