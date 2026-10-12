import { createApp } from 'vue'
import 'virtual:uno.css'
import '@/assets/style/global.less'
// 副作用 import：把 `<html theme-mode>` 挂上（TDesign 深色模式的开关），播放窗口才有深色适配。
// 主窗口靠 AppSide 顺带引入，播放窗口没有那一层，必须自己引。
import '@/global/AppTheme'
import PlayApp from './PlayApp.vue'

createApp(PlayApp).mount('#app')
