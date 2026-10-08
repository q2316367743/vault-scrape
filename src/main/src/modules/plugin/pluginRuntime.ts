/**
 * 插件源码的沙箱编译与调用。
 *
 * 契约：
 * 1. 插件是纯 JavaScript 脚本：宿主先注入 `definePlugin`，再执行脚本，取其返回值作为插件定义；
 * 2. 沙箱全局为白名单：console / 定时器 / URL 编解码 / cheerio，其余（require、process、Buffer、动态 import）一概不提供；
 * 3. vm 只做稳定性隔离，**不是安全边界**：插件是用户自己引入的本机脚本；
 * 4. 顶层执行超时 5 秒、单次调用超时 30 秒；跨 realm 的异常不能 `instanceof Error`，
 *    一律按结构读 `message` / `stack`。
 */
import vm from 'node:vm'
import * as cheerio from 'cheerio'
import type { LogLevel } from '@common/types/log'
import {
  PLUGIN_METHODS,
  PluginError,
  normalizeAssets,
  normalizeCandidates,
  normalizeEnvFields,
  normalizeDetail,
  normalizeMeta,
  type PluginEnvField,
  type PluginEnvValue,
  type PluginContext,
  type PluginHtmlLoader,
  type PluginMeta,
  type PluginMethod,
  type ScrapePlugin
} from '@common/types/plugin'
import { readString, toSource } from '@common/types/setting/shared'

/** 顶层脚本执行超时 */
export const PLUGIN_TOP_LEVEL_TIMEOUT_MS = 5000
/** 单次方法调用超时 */
export const PLUGIN_CALL_TIMEOUT_MS = 30000

/** 插件的日志出口：由调用方注入（主进程写入日志表，scope 固定为 `plugin:<id>`） */
export type PluginLogSink = (level: LogLevel, message: string, detail?: string) => void

/** 插件方法的统一签名：入参是关键字 / 影片 ID，外加环境变量与宿主上下文 */
export type PluginHandler = (
  input: string,
  env: PluginEnvValue,
  ctx: PluginContext
) => unknown

/** 编译结果 */
export interface CompiledPlugin {
  meta: PluginMeta
  /** 插件声明的环境变量（安装 / 保存时在沙箱执行脚本读出） */
  env: PluginEnvField[]
  plugin: ScrapePlugin
}

/** 把任意异常收敛成文案 + 明细；跨 realm 的 Error 只能按结构读取 */
export function describeThrown(error: unknown): { message: string; detail: string } {
  const source = toSource(error)
  const message = source ? readString(source, 'message', '') : ''
  const stack = source ? readString(source, 'stack', '') : ''
  if (message.length > 0) return { message, detail: stack }
  if (typeof error === 'string') return { message: error, detail: '' }
  if (error instanceof Error) return { message: error.message, detail: error.stack ?? '' }
  return { message: '', detail: '' }
}

function isVmTimeout(error: unknown): boolean {
  const source = toSource(error)
  return source !== null && readString(source, 'code', '') === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
}

function formatArgs(args: unknown[]): string {
  return args
    .map((item) => {
      if (typeof item === 'string') return item
      if (item === undefined) return 'undefined'
      if (item === null) return 'null'
      try {
        return JSON.stringify(item) ?? String(item)
      } catch {
        return '[无法序列化的值]'
      }
    })
    .join(' ')
}

/** 沙箱白名单：除下列全局外，脚本只能访问新 realm 自带的语言内建对象 */
function createSandbox(log: PluginLogSink): {
  sandbox: Record<string, unknown>
  takeDefinition: () => unknown
} {
  let captured: unknown
  const $: PluginHtmlLoader = (html: string) => cheerio.load(html)
  const emit =
    (level: LogLevel) =>
    (...args: unknown[]): void => {
      log(level, formatArgs(args))
    }
  const sandbox: Record<string, unknown> = {
    /** 与 Vite 的 defineConfig 同构：插件脚本以 `definePlugin({ ... })` 结尾即可 */
    definePlugin: (definition: unknown): unknown => {
      captured = definition
      return definition
    },
    console: {
      log: emit('info'),
      info: emit('info'),
      debug: emit('debug'),
      warn: emit('warn'),
      error: emit('error')
    },
    cheerio,
    $,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    atob,
    btoa
  }
  return { sandbox, takeDefinition: () => captured }
}

/**
 * 读取定义对象上的一个方法。
 *
 * 这里必须断言：vm realm 里的函数在宿主侧只有 `Function` 类型，
 * 不断言就拿不到具体签名（RL-03 禁止的是「不必要」的断言）。
 */
function readHandler(source: Record<string, unknown>, method: PluginMethod): PluginHandler | null {
  const value = source[method]
  return typeof value === 'function' ? (value as PluginHandler) : null
}

function readHandlers(source: Record<string, unknown>): Record<PluginMethod, PluginHandler> | null {
  const handlers = PLUGIN_METHODS.map((method) => readHandler(source, method))
  const [search, detail, covers, extras] = handlers
  if (!search || !detail || !covers || !extras) return null
  return { search, detail, covers, extras }
}

/** 在宿主 realm 里重建插件对象：方法返回值一律归一化成宿主 realm 的纯对象 */
function buildPlugin(meta: PluginMeta, handlers: Record<PluginMethod, PluginHandler>): ScrapePlugin {
  return {
    meta,
    search: async (keyword, env, ctx) => normalizeCandidates(await handlers.search(keyword, env, ctx)),
    detail: async (movieId, env, ctx) => {
      const detail = normalizeDetail(await handlers.detail(movieId, env, ctx), movieId)
      if (!detail) throw new PluginError('invokeFailed', '插件返回的影片详情不合法（title 必填）')
      return detail
    },
    covers: async (movieId, env, ctx) =>
      normalizeAssets(await handlers.covers(movieId, env, ctx), ['poster', 'thumb', 'fanart']),
    extras: async (movieId, env, ctx) =>
      normalizeAssets(await handlers.extras(movieId, env, ctx), ['still', 'trailer'])
  }
}

/**
 * 编译插件源码。
 *
 * @param filename 仅供堆栈显示；主进程调用时传 `<id>.js`
 */
export function compilePlugin(
  source: string,
  log: PluginLogSink,
  filename = 'plugin.js'
): CompiledPlugin {
  let script: vm.Script
  try {
    script = new vm.Script(source, { filename })
  } catch (error) {
    const { message } = describeThrown(error)
    throw new PluginError('evalFailed', `插件代码语法错误：${message || '语法不合法'}`)
  }

  const { sandbox, takeDefinition } = createSandbox(log)
  const context = vm.createContext(sandbox, { name: `plugin:${filename}` })
  let completion: unknown
  try {
    completion = script.runInContext(context, {
      timeout: PLUGIN_TOP_LEVEL_TIMEOUT_MS,
      displayErrors: true
    })
  } catch (error) {
    if (isVmTimeout(error)) {
      throw new PluginError(
        'timeout',
        `插件顶层代码执行超时（${PLUGIN_TOP_LEVEL_TIMEOUT_MS} 毫秒）`
      )
    }
    const { message } = describeThrown(error)
    throw new PluginError('evalFailed', `插件代码执行失败：${message || '未知错误'}`)
  }

  const definition = toSource(takeDefinition() ?? completion)
  if (!definition) {
    throw new PluginError('invalidPlugin', '插件脚本没有调用 definePlugin，或返回的不是对象')
  }
  const meta = normalizeMeta(definition.meta)
  if (!meta) {
    throw new PluginError(
      'invalidPlugin',
      '插件 meta 不合法：需要 id（小写 kebab-case）、name、version'
    )
  }
  const handlers = readHandlers(definition)
  if (!handlers) {
    throw new PluginError('invalidPlugin', `插件必须实现方法：${PLUGIN_METHODS.join(' / ')}`)
  }
  // 兼容早期示例里的 `config` 写法：`env` 优先，其次 `config`，并在后者出现时提醒一次
  const declared = definition.env ?? definition.config
  if (definition.env === undefined && definition.config !== undefined) {
    log('warn', '插件仍在使用旧的 config 声明，请改名为 env')
  }
  return {
    meta,
    env: normalizeEnvFields(declared),
    plugin: buildPlugin(meta, handlers)
  }
}

export interface InvokeOptions {
  id: string
  method: PluginMethod
  timeoutMs?: number
  /** 失败时把插件原始堆栈写进日志（跨 realm 的 Error 只能按结构读取） */
  log?: PluginLogSink
}

/**
 * 调用插件方法并施加超时保护。
 *
 * 说明：超时只让宿主立刻拿到 timeout 错误，**不会中断**插件里已跑起来的同步代码
 * （vm 无法抢占宿主线程），这也是文档里要求插件不要写长同步循环的原因。
 */
export function invokeWithTimeout<T>(
  task: () => Promise<T>,
  options: InvokeOptions
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? PLUGIN_CALL_TIMEOUT_MS
  return new Promise<T>((resolve, reject) => {
    const fail = (error: unknown): void => {
      clearTimeout(timer)
      if (error instanceof PluginError) {
        reject(error)
        return
      }
      const { message, detail } = describeThrown(error)
      options.log?.(
        'error',
        `插件 ${options.method} 执行失败：${message || '未知错误'}`,
        detail
      )
      reject(
        new PluginError(
          'invokeFailed',
          `插件 ${options.method} 执行失败：${message || detail || '未知错误'}`
        )
      )
    }
    const timer = setTimeout(() => {
      reject(
        new PluginError(
          'timeout',
          `插件 ${options.id} 的 ${options.method} 调用超时（${timeoutMs} 毫秒）`
        )
      )
    }, timeoutMs)
    timer.unref()
    try {
      task().then((value) => {
        clearTimeout(timer)
        resolve(value)
      }, fail)
    } catch (error) {
      fail(error)
    }
  })
}
