/**
 * esbuild 会把 CJS 依赖（axios / cheerio / webdav 等）内联进 ESM 产物，
 * 这些依赖内部可能调用 require('http' / 'zlib' / 'fs')；ESM 模块没有全局 require，
 * esbuild 的 __require 兜底会直接抛 "Dynamic require of ... is not supported"。
 *
 * 因此本文件必须是 core 入口的第一个 import，只补 Node 的 require。
 */
import { createRequire } from 'node:module'

const scope = globalThis as typeof globalThis & { require?: NodeRequire }

if (typeof scope.require === 'undefined') {
  scope.require = createRequire(import.meta.url)
}
