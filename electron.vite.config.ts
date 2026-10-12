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
    // 三个入口页：主窗口 index、播放窗口 play（左侧画面 + 右侧详情侧栏）、
    // mpv 嵌入用的宿主页 host（Windows 恒有；macOS 只在设置里开了嵌入实验开关时有意义）
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          play: resolve('src/renderer/play.html'),
          host: resolve('src/renderer/host.html')
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
