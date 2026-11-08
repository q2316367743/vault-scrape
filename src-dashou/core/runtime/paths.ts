/**
 * 应用数据目录。
 *
 * 契约：
 * - 一切可写数据都落在宿主给的插件私有目录（`ctx.paths.data`），跨版本保留；
 * - 目录布局沿用原 Electron 版本：`db/`、`setting/`、`plugin/`、`file/`、`media/`、`cache/`、`log/`；
 * - 本模块不依赖 `ctx`，由 `onReady` 调一次 `initPaths()` 注入绝对路径，其余模块直接用 `dataPath()`。
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

let dataRoot = ''
let root = ''

/** core 启动时注入插件数据目录与包目录 */
export function initPaths(data: string, pluginRoot: string): void {
  dataRoot = data
  root = pluginRoot
}

/** 插件包目录（只读） */
export function appRoot(): string {
  return root
}

/** 插件数据目录下的路径；可传多段相对路径 */
export function dataPath(...segments: string[]): string {
  return join(dataRoot, ...segments)
}

/** 确保某个数据子目录存在 */
export function ensureDataDir(...segments: string[]): string {
  const target = dataPath(...segments)
  mkdirSync(target, { recursive: true })
  return target
}
