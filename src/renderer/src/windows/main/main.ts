import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'virtual:uno.css'
import '@/assets/style/global.less'
import App from './App.vue'
import { router } from './router'

createApp(App).use(createPinia()).use(router).mount('#app')
