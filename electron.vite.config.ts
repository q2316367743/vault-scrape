import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { TDesignResolver } from 'unplugin-vue-components/resolvers'

// main / preload 共用同一套别名：$ = 主进程源码，~ = 预加载源码（IPC 契约所在处）
const nodeAlias = {
  $: resolve('src/main/src'),
  '~': resolve('src/preload/src'),
  '@resources': resolve('resources'),
  '@common': resolve('src/common')
}

export default defineConfig({
  main: {
    resolve: { alias: nodeAlias },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    resolve: { alias: nodeAlias },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    base: './',
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@common': resolve('src/common')
      }
    },
    server: {
      port: 7743
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
        eslintrc: {
          enabled: true
        }
      }),
      Components({
        resolvers: [
          TDesignResolver({
            library: 'vue-next'
          })
        ]
      })
    ]
  }
})
