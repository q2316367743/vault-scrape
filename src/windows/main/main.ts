import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'virtual:uno.css'
// TDesign 设计 Token 的默认值（`--td-comp-*` / `--td-font-*` 等）。组件 CSS 由各组件模块自带，
// 但 tdesign-vue-next 的 `sideEffects` 只写 `es/**/style/**`，匹配不到 `es/style/css.mjs`，
// 于是这个 Token 文件在 dev 预打包与 build 时都会被整块摇掉，组件里的 var() 全部没有取值。
// 必须显式引一次；放在 global.less 之前，让 theme.less 里的品牌色覆盖官方默认值。
import 'tdesign-vue-next/es/style/index.css'
import '@/assets/style/global.less'
import { initAppInfo, initJobs } from '@/api'
import App from './App.vue'
import { router } from './router'

/**
 * 挂载前先拿应用信息（平台 / 版本 / 媒体服务基地址）并登记长任务监听：
 * - 存储页会自己拼预览地址，依赖 `mediaBase`；
 * - 长任务监听必须早于任何用户操作，否则可能漏掉执行过快的结果。
 */
async function bootstrap(): Promise<void> {
  await initAppInfo()
  await initJobs()
  createApp(App).use(createPinia()).use(router).mount('#app')
}

void bootstrap().catch((error: unknown) => {
  // 启动失败只给用户一句结论，技术细节进控制台
  console.error('[main] 启动失败', error)
  const app = document.getElementById('app')
  if (app) app.textContent = '插件启动失败，请关闭窗口后重新打开。'
})
