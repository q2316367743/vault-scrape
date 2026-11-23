/**
 * 插件目录（搭手标准目录）。
 *
 * 契约：
 * - 六类目录全部由宿主 `ctx.paths` 提供，`onReady` 里 `initPaths()` 注入一次，
 *   其余模块用 `dataPath()` / `configPath()` / `cachePath()` / `logPath()` / `tempPath()` 取绝对路径；
 * - 目录语义按搭手约定划分：
 *   data（跨版本保留的业务数据）/ config（配置与密钥）/ cache（可清理缓存）
 *   / log（日志）/ temp（启动即清理的临时文件）/ pluginRoot（只读插件包）；
 * - 本模块不依赖 `ctx`，未初始化就取路径会直接抛错，让启动顺序问题在开发期暴露。
 */
import { join } from 'node:path'

interface PluginDirs {
  data: string
  config: string
  cache: string
  log: string
  temp: string
  pluginRoot: string
}

let dirs: PluginDirs | null = null

/** core 启动时注入宿主给的六类目录 */
export function initPaths(input: PluginDirs): void {
  dirs = input
}

function root(): PluginDirs {
  if (!dirs) throw new Error('插件目录尚未初始化')
  return dirs
}

/** 插件包目录（只读） */
export function appRoot(): string {
  return root().pluginRoot
}

/** 插件私有数据目录：跨版本保留的业务数据 */
export function dataPath(...segments: string[]): string {
  return join(root().data, ...segments)
}

/** 配置目录：设置、连接配置、插件索引、密钥 */
export function configPath(...segments: string[]): string {
  return join(root().config, ...segments)
}

/** 缓存目录：可随时清理，不影响业务数据 */
export function cachePath(...segments: string[]): string {
  return join(root().cache, ...segments)
}

/** 日志目录 */
export function logPath(...segments: string[]): string {
  return join(root().log, ...segments)
}

/** 临时目录：宿主启动时清理 */
export function tempPath(...segments: string[]): string {
  return join(root().temp, ...segments)
}
