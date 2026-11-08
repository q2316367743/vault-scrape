import { createApp } from 'vue'
import 'virtual:uno.css'
// TDesign 设计 Token 默认值：组件 CSS 自带，但 Token 文件会被 tdesign 的 sideEffects 规则误摇掉，
// 必须显式引（原因见主窗口 main.ts）。排在 global.less 之前，品牌色留给我们覆盖。
import 'tdesign-vue-next/es/style/index.css'
import '@/assets/style/global.less'
// 副作用 import：把 `<html theme-mode>` 挂上（TDesign 深色模式的开关），播放窗口才有深色适配。
// 主窗口靠 AppSide 顺带引入，播放窗口没有那一层，必须自己引。
import '@/global/AppTheme'
import { initAppInfo } from '@/api'
import PlayApp from './PlayApp.vue'

async function bootstrap(): Promise<void> {
  await initAppInfo()
  createApp(PlayApp).mount('#app')
}

void bootstrap().catch((error: unknown) => {
  console.error('[play] 启动失败', error)
  const app = document.getElementById('app')
  if (app) app.textContent = '播放窗口启动失败，请关闭后重试。'
})
