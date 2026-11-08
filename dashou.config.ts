import { resolve } from 'node:path'

/**
 * core 侧的 esbuild 别名：只影响 `src-dashou/index.ts` 打成的 core.mjs。
 *
 * - `$` → `src-dashou/core`：沿用原 Electron 主进程的模块路径写法；
 * - `@common` → `src/common`：窗口与 core 共用的纯类型 / 纯函数。
 *
 * 窗口侧的别名在 `vite.config.ts` 里，两处必须保持一致。
 */
export default {
  alias: {
    $: resolve('src-dashou/core'),
    '@common': resolve('src/common')
  },
  // `node:sqlite` 是 Node 22 才有的内置模块；显式声明外部化，避免打包器的内置模块清单过旧时误报解析失败
  external: ['node:sqlite']
}
