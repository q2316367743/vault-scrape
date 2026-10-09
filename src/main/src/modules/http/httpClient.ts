/**
 * 主进程 HTTP 客户端：axios 单例 + 代理注入。
 *
 * 契约：
 * 1. 网络设置（代理开关 / 协议 / 地址 / 超时）由请求拦截器每次请求实时读取，改设置无需重建实例；
 * 2. 拦截器只负责「是否注入代理」与「未显式指定 timeout 时的兜底」，重试语义归调用方；
 * 3. 代理地址非法、端口缺失或为不支持的 socket5 时一律回落直连，并写一条 warn（同一原因每进程只写一次），
 *    绝不抛错打断请求；
 * 4. 关闭代理或回落直连时写入 `proxy: false`，即屏蔽 HTTP_PROXY / HTTPS_PROXY / NO_PROXY 环境变量，
 *    让设置面板成为代理的唯一事实来源。
 */
import axios, { type AxiosProxyConfig } from 'axios'
import type { ProxyType, SettingNetwork } from '@common/types/setting'
import { appendLog } from '$/db/repo/logRepo'
import { loadSetting } from '$/modules/setting/settingStore'

/** axios 能直接消费的代理协议；SOCKS 不在其列（需额外引入 socks-proxy-agent） */
const SUPPORTED_PROXY_PROTOCOLS: readonly string[] = ['http', 'https']

/** 设置里的 socket5 及其在地址前缀中可能出现的等价写法 */
const SOCKS_PROTOCOLS: readonly string[] = ['socket5', 'socks5', 'socks']

/** 告警去重：同一 key 每进程只写一条日志 */
const warnedKeys = new Set<string>()

interface ProxyResolution {
  /** 写入 config.proxy；false 表示明确直连 */
  proxy: AxiosProxyConfig | false
  warningKey?: string
  warningMessage?: string
}

function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return
  warnedKeys.add(key)
  appendLog({ level: 'warn', scope: 'http', message })
}

/** 带协议前缀时前缀优先，否则按设置里的代理协议补全；不可解析返回 null */
function parseProxyUrl(raw: string, proxyType: ProxyType): URL | null {
  const text = raw.trim()
  if (!text) return null
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${proxyType}://${text}`)
  } catch {
    return null
  }
}

function toProxyConfig(url: URL, protocol: string): AxiosProxyConfig {
  const auth = url.username
    ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
    : null
  return {
    protocol,
    host: url.hostname,
    port: Number(url.port),
    ...(auth ? { auth } : {})
  }
}

function invalid(proxyHost: string, reason: string): ProxyResolution {
  return {
    proxy: false,
    warningKey: `invalid:${reason}:${proxyHost}`,
    warningMessage: `代理地址不可用（${reason}），本次请求直连：${proxyHost || '（空）'}`
  }
}

/** 把网络设置换算成 axios 的 proxy 配置 */
function resolveProxy(network: SettingNetwork): ProxyResolution {
  if (!network.proxyEnabled) return { proxy: false }
  const url = parseProxyUrl(network.proxyHost, network.proxyType)
  if (!url) return invalid(network.proxyHost, '无法解析')
  const protocol = url.protocol.replace(':', '').toLowerCase()
  if (SOCKS_PROTOCOLS.includes(protocol)) {
    return {
      proxy: false,
      warningKey: `socks:${network.proxyHost}`,
      warningMessage: `当前版本不支持 SOCKS5 代理，本次请求直连：${network.proxyHost}`
    }
  }
  if (!SUPPORTED_PROXY_PROTOCOLS.includes(protocol)) return invalid(network.proxyHost, protocol)
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return invalid(network.proxyHost, '端口缺失或非法')
  }
  return { proxy: toProxyConfig(url, protocol) }
}

/** 全局共享实例：代理与超时兜底都在拦截器里按最新设置决定 */
export const httpClient = axios.create()

httpClient.interceptors.request.use((config) => {
  const network = loadSetting().network
  const { proxy, warningKey, warningMessage } = resolveProxy(network)
  config.proxy = proxy
  if (config.timeout === undefined) config.timeout = Math.max(1000, network.timeout * 1000)
  if (warningKey && warningMessage) warnOnce(warningKey, warningMessage)
  return config
})
