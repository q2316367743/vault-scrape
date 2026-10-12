/**
 * 插件源码的沙箱编译与调用。
 *
 * 契约：
 * 1. 插件是纯 JavaScript 脚本：宿主先注入 `definePlugin`，再执行脚本，取其返回值作为插件定义；
 * 2. 插件按类别编译：`compilePlugin(kind, …)` 只认 `meta.kind === kind` 的插件，并按该类别的
 *    方法表校验（缺必需方法、实现了别类方法都报 `invalidPlugin`）；
 * 3. 沙箱全局为白名单：console / 定时器 / URL 编解码 / cheerio，其余（require、process、Buffer、动态 import）一概不提供；
 * 4. vm 只做稳定性隔离，**不是安全边界**：插件是用户自己引入的本机脚本；
 * 5. 顶层执行超时 5 秒、单次调用超时 30 秒；跨 realm 的异常不能 `instanceof Error`，
 *    一律按结构读 `message` / `stack`。
 */
import vm from 'node:vm'
import * as cheerio from 'cheerio'
import type { LogLevel } from '@common/types/log'
import {
  PLUGIN_ACTOR_ASSET_KINDS,
  PLUGIN_KIND_LABELS,
  PLUGIN_KIND_METHODS,
  PLUGIN_METHOD_NAMES,
  PluginError,
  normalizeActorDetail,
  normalizeAssets,
  normalizeCandidates,
  normalizeEnvFields,
  normalizeDetail,
  normalizeMeta,
  normalizeTranslateResult,
  type ActorPlugin,
  type MoviePlugin,
  type PluginDefinition,
  type PluginEnvField,
  type PluginEnvValue,
  type PluginContext,
  type PluginHtmlLoader,
  type PluginKind,
  type PluginMeta,
  type PluginMethod,
  type PluginTranslateRequest,
  type TranslatePlugin
} from '@common/types/plugin'
import { readString, toSource } from '@common/types/setting/shared'

/** 顶层脚本执行超时 */
export const PLUGIN_TOP_LEVEL_TIMEOUT_MS = 5000
/** 单次方法调用超时 */
export const PLUGIN_CALL_TIMEOUT_MS = 30000

/** 插件的日志出口：由调用方注入（主进程写入日志表，scope 固定为 `plugin:<类别>:<id>`） */
export type PluginLogSink = (level: LogLevel, message: string, detail?: string) => void

/** 插件方法的统一签名：入参是关键字 / 影片 ID / 演员姓名，外加环境变量与宿主上下文 */
export type PluginHandler = (
  input: string,
  env: PluginEnvValue,
  ctx: PluginContext
) => unknown

/** 翻译方法的签名：入参是对象（`{ text, from?, to }`），与其余方法的字符串入参区分开 */
export type PluginTranslateHandler = (
  request: PluginTranslateRequest,
  env: PluginEnvValue,
  ctx: PluginContext
) => unknown

/** 编译结果 */
export interface CompiledPlugin {
  meta: PluginMeta
  /** 插件声明的环境变量（安装 / 保存时在沙箱执行脚本读出） */
  env: PluginEnvField[]
  plugin: PluginDefinition
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
function readHandler<T>(source: Record<string, unknown>, method: PluginMethod): T | null {
  const value = source[method]
  return typeof value === 'function' ? (value as T) : null
}

/** 插件定义里实际实现的方法，未实现的一律不挂 */
interface PluginHandlers {
  search?: PluginHandler
  detail?: PluginHandler
  covers?: PluginHandler
  extras?: PluginHandler
  actor?: PluginHandler
  actorAssets?: PluginHandler
  translate?: PluginTranslateHandler
}

function readHandlers(source: Record<string, unknown>): PluginHandlers {
  const handlers: PluginHandlers = {}
  const search = readHandler<PluginHandler>(source, 'search')
  const detail = readHandler<PluginHandler>(source, 'detail')
  const covers = readHandler<PluginHandler>(source, 'covers')
  const extras = readHandler<PluginHandler>(source, 'extras')
  const actor = readHandler<PluginHandler>(source, 'actor')
  const actorAssets = readHandler<PluginHandler>(source, 'actorAssets')
  const translate = readHandler<PluginTranslateHandler>(source, 'translate')
  if (search) handlers.search = search
  if (detail) handlers.detail = detail
  if (covers) handlers.covers = covers
  if (extras) handlers.extras = extras
  if (actor) handlers.actor = actor
  if (actorAssets) handlers.actorAssets = actorAssets
  if (translate) handlers.translate = translate
  return handlers
}

/** 按类别方法表校验：缺必需方法、实现别类方法都直接拒绝，避免「写了却不生效」 */
function assertHandlers(kind: PluginKind, handlers: PluginHandlers): void {
  const table = PLUGIN_KIND_METHODS[kind]
  const implemented = PLUGIN_METHOD_NAMES.filter((method) => handlers[method] !== undefined)
  const foreign = implemented.filter((method) => !table.all.includes(method))
  if (foreign.length > 0) {
    throw new PluginError(
      'invalidPlugin',
      `${PLUGIN_KIND_LABELS[kind]}插件不能实现其它类别的方法：${foreign.join(' / ')}，请拆成独立插件`
    )
  }
  const missing = table.required.filter((method) => handlers[method] === undefined)
  if (missing.length > 0) {
    throw new PluginError(
      'invalidPlugin',
      `${PLUGIN_KIND_LABELS[kind]}插件必须实现方法：${missing.join(' / ')}`
    )
  }
}

/** 在宿主 realm 里重建影片插件：方法返回值一律归一化成宿主 realm 的纯对象 */
function buildMoviePlugin(meta: PluginMeta, handlers: PluginHandlers): MoviePlugin {
  const { search, detail, covers, extras } = handlers
  if (!search || !detail || !covers || !extras) {
    throw new PluginError('invalidPlugin', '影片信息插件缺少必需方法')
  }
  return {
    meta,
    search: async (keyword, env, ctx) => normalizeCandidates(await search(keyword, env, ctx)),
    detail: async (movieId, env, ctx) => {
      const normalized = normalizeDetail(await detail(movieId, env, ctx), movieId)
      if (!normalized) {
        throw new PluginError('invokeFailed', '插件返回的影片详情不合法（title 必填）')
      }
      return normalized
    },
    covers: async (movieId, env, ctx) =>
      normalizeAssets(await covers(movieId, env, ctx), ['poster', 'thumb', 'fanart']),
    extras: async (movieId, env, ctx) =>
      normalizeAssets(await extras(movieId, env, ctx), ['still', 'trailer'])
  }
}

/** 在宿主 realm 里重建演员插件 */
function buildActorPlugin(meta: PluginMeta, handlers: PluginHandlers): ActorPlugin {
  const actor = handlers.actor
  if (!actor) throw new PluginError('invalidPlugin', '演员信息插件缺少必需方法：actor')
  const plugin: ActorPlugin = {
    meta,
    actor: async (name, env, ctx) => {
      const detail = normalizeActorDetail(await actor(name, env, ctx), name)
      if (!detail) throw new PluginError('invokeFailed', '插件返回的演员资料不合法（name 必填）')
      return detail
    }
  }
  const actorAssets = handlers.actorAssets
  if (actorAssets) {
    plugin.actorAssets = async (name, env, ctx) =>
      normalizeAssets(await actorAssets(name, env, ctx), PLUGIN_ACTOR_ASSET_KINDS)
  }
  return plugin
}

/** 在宿主 realm 里重建翻译插件：译文同样走一次归一化，空译文直接报错 */
function buildTranslatePlugin(meta: PluginMeta, handlers: PluginHandlers): TranslatePlugin {
  const translate = handlers.translate
  if (!translate) throw new PluginError('invalidPlugin', '翻译插件缺少必需方法：translate')
  return {
    meta,
    translate: async (request, env, ctx) => {
      const result = normalizeTranslateResult(await translate(request, env, ctx))
      if (!result) throw new PluginError('invokeFailed', '插件返回的译文不合法（text 必填）')
      return result
    }
  }
}

function buildPlugin(
  kind: PluginKind,
  meta: PluginMeta,
  handlers: PluginHandlers
): PluginDefinition {
  if (kind === 'movie') return buildMoviePlugin(meta, handlers)
  if (kind === 'actor') return buildActorPlugin(meta, handlers)
  return buildTranslatePlugin(meta, handlers)
}

/**
 * 编译插件源码。
 *
 * @param kind 目标类别：既决定校验用的方法表，也要求 `meta.kind` 与之完全一致
 * @param filename 仅供堆栈显示；主进程调用时传 `<id>.js`
 */
export function compilePlugin(
  kind: PluginKind,
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
  const context = vm.createContext(sandbox, { name: `plugin:${kind}:${filename}` })
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
      '插件 meta 不合法：需要 id（小写 kebab-case）、name、version、kind（movie / actor / translate）'
    )
  }
  if (meta.kind !== kind) {
    throw new PluginError(
      'invalidPlugin',
      `插件声明的类别是「${PLUGIN_KIND_LABELS[meta.kind]}」，不能在「${PLUGIN_KIND_LABELS[kind]}」类别里加载或导入`
    )
  }
  const handlers = readHandlers(definition)
  assertHandlers(kind, handlers)
  // 兼容早期示例里的 `config` 写法：`env` 优先，其次 `config`，并在后者出现时提醒一次
  const declared = definition.env ?? definition.config
  if (definition.env === undefined && definition.config !== undefined) {
    log('warn', '插件仍在使用旧的 config 声明，请改名为 env')
  }
  return {
    meta,
    env: normalizeEnvFields(declared),
    plugin: buildPlugin(kind, meta, handlers)
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
