import { readBoolean, readEnum, readNumber, readString, toSource } from './shared'

/** 代理协议 */
export type ProxyType = 'http' | 'https' | 'socket5'

export const PROXY_TYPES: readonly ProxyType[] = ['http', 'https', 'socket5']

/** 网络连接设置 */
export interface SettingNetwork {
  /** 是否启用代理 */
  proxyEnabled: boolean
  /** 代理协议 */
  proxyType: ProxyType
  /** 代理地址，形如 host:port（可带协议前缀） */
  proxyHost: string
  /** 请求超时时间（秒） */
  timeout: number
  /** 请求失败重试次数 */
  retryCount: number
}

export function buildSettingNetwork(): SettingNetwork {
  return {
    proxyEnabled: false,
    proxyType: 'http',
    proxyHost: '',
    timeout: 30,
    retryCount: 3
  }
}

export function normalizeSettingNetwork(raw: unknown): SettingNetwork {
  const base = buildSettingNetwork()
  const source = toSource(raw)
  if (!source) return base
  return {
    proxyEnabled: readBoolean(source, 'proxyEnabled', base.proxyEnabled),
    proxyType: readEnum(source, 'proxyType', PROXY_TYPES, base.proxyType),
    proxyHost: readString(source, 'proxyHost', base.proxyHost),
    timeout: readNumber(source, 'timeout', base.timeout, 1),
    retryCount: readNumber(source, 'retryCount', base.retryCount)
  }
}
