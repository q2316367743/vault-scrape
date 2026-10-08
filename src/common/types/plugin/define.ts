/**
 * 插件作者面向的契约（`definePlugin` 的入参形状）。
 *
 * 契约：
 * - 插件是纯 JavaScript 脚本，运行在 `node:vm` 沙箱里，只有 `env`、`ctx` 与白名单全局；
 * - 插件用 `env: [...]` 声明自己需要的环境变量（账号、Cookie、站点地址等），
 *   安装时宿主会在沙箱里执行一次脚本、读取这份声明并生成填写表单；
 * - 四个方法全部返回 Promise，签名统一为 `(入参, env, ctx)`，宿主负责归一化与超时保护；
 * - `definePlugin` 由宿主注入，插件脚本以 `definePlugin({ ... })` 结尾即可。
 */
import type { LogLevel } from '../log'
import type { PluginAsset } from './asset'
import type { PluginEnvField, PluginEnvValue, PluginMeta } from './manifest'
import type { PluginMovieCandidate, PluginMovieDetail } from './movie'

export interface PluginRequestOptions {
  url: string
  /** 缺省按 GET 处理 */
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** 覆盖网络设置里的超时（毫秒） */
  timeout?: number
}

export interface PluginResponse {
  status: number
  headers: Record<string, string>
  /** 响应体文本，JSON 由插件自行 JSON.parse */
  data: string
}

/** 宿主注入给插件的运行时上下文 */
export interface PluginContext {
  /** 统一出口的 HTTP：自带超时、重试与刮削节奏延迟 */
  request: (options: PluginRequestOptions) => Promise<PluginResponse>
  /** 写日志：scope 固定为 plugin:<id> */
  log: (level: LogLevel, message: string, detail?: string) => void
}

/**
 * 沙箱注入的全局 `$`：就是 cheerio 的 `load`，`$('<html>…')` 返回可链式选择的对象；
 * 沙箱同时注入整个 `cheerio` 命名空间，插件里写 `const $ = cheerio.load(html)` 亦可。
 * 这里只声明成函数，具体链式 API 由 cheerio 提供（插件是纯 JavaScript，无类型依赖）。
 */
export type PluginHtmlLoader = (html: string) => unknown

export interface ScrapePlugin {
  meta: PluginMeta
  /**
   * 声明插件运行需要的环境变量；安装 / 保存时宿主在沙箱里执行脚本读取它。
   * 单插件上限 50 项，key 只允许字母、数字、下划线与短横线。
   */
  env?: PluginEnvField[]
  /** 1. 通过名称 / 番号获取影片列表 */
  search(keyword: string, env: PluginEnvValue, ctx: PluginContext): Promise<PluginMovieCandidate[]>
  /** 2. 通过影片 ID 获取影片信息 */
  detail(movieId: string, env: PluginEnvValue, ctx: PluginContext): Promise<PluginMovieDetail>
  /** 3. 获取封面类资源（poster / thumb / fanart）的下载配置 */
  covers(movieId: string, env: PluginEnvValue, ctx: PluginContext): Promise<PluginAsset[]>
  /** 4. 获取花絮类资源（still / trailer）的下载配置 */
  extras(movieId: string, env: PluginEnvValue, ctx: PluginContext): Promise<PluginAsset[]>
}

/** 宿主注入沙箱的定义函数 */
export type DefinePlugin = (definition: ScrapePlugin) => ScrapePlugin

export type PluginMethod = 'search' | 'detail' | 'covers' | 'extras'

export const PLUGIN_METHODS: readonly PluginMethod[] = ['search', 'detail', 'covers', 'extras']

export interface PluginInvokePayload {
  /** kind 为 search 时必填 */
  keyword?: string
  /** kind 为 detail / covers / extras 时必填 */
  movieId?: string
}

export type PluginInvokeData = PluginMovieCandidate[] | PluginMovieDetail | PluginAsset[]
