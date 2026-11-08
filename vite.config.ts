import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { TDesignResolver } from 'unplugin-vue-components/resolvers'

/** 工程根（`"type": "module"` 下没有 __dirname） */
const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * 打包时把样式内联进两个 HTML。
 *
 * 为什么内联：插件页面由 `plugin://<id>/ui/...` 提供，外链样式表对安装版来说是一次额外的
 * 协议请求；一旦这条请求因为协议 / 来源判断 / 缓存出问题，窗口就会「有内容但没有样式」。
 * 页面自带全部样式后，安装包里只剩 HTML + JS，样式不依赖任何外部请求（也省掉首屏样式请求）。
 *
 * 配套 `build.cssCodeSplit: false`：全部样式收成一个文件，再整体灌进每个入口的 `<head>`。
 * 开发版不受影响：dev server 自己按模块注入样式，这个插件只作用于 `vite build`。
 */
function inlineCssPlugin(): Plugin {
  return {
    name: 'vault-scrape-inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const styles: string[] = []
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'asset' || !fileName.endsWith('.css')) continue
        const source = output.source
        styles.push(typeof source === 'string' ? source : new TextDecoder().decode(source))
        delete bundle[fileName]
      }
      if (styles.length === 0) return
      const css = styles.join('\n')
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'asset' || !fileName.endsWith('.html')) continue
        const html = String(output.source)
        output.source = html
          .replace(/<link[^>]*rel="stylesheet"[^>]*>\s*/g, '')
          .replace('</head>', `  <style>\n${css}\n  </style>\n</head>`)
      }
    }
  }
}

/**
 * 搭手插件的前端工程：窗口页面由 `plugin://<id>/ui/...` 加载，
 * 因此 base 必须是相对的，构建产物直接进 `dist/`，由 CLI 复制成包内 `ui/`。
 *
 * 两个窗口入口：
 * - `index.html`：主窗口（影视墙 / 演员 / 存储 / 插件 / 设置）；
 * - `play.html`：播放窗口（core 在运行时按需创建）。
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
      '@common': resolve(root, 'src/common')
    }
  },
  server: {
    port: 5188,
    watch: { ignored: ['**/src-dashou/dashou-dist/**', '**/src-dashou/ui/**'] }
  },
  build: {
    outDir: 'dist',
    // 全部样式收成一个文件，供 inlineCssPlugin 整体内联进各入口 HTML
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        play: resolve(root, 'play.html')
      }
    }
  },
  plugins: [
    vue(),
    vueJsx(),
    UnoCSS(),
    AutoImport({
      resolvers: [
        TDesignResolver({
          library: 'vue-next'
        })
      ],
      imports: ['vue', '@vueuse/core', 'vue-router'],
      dts: 'auto-imports.d.ts'
    }),
    Components({
      resolvers: [
        TDesignResolver({
          library: 'vue-next'
        })
      ],
      dts: 'components.d.ts'
    }),
    inlineCssPlugin()
  ]
})
