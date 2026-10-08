import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

/** 六个一级页面：name 同时作为侧栏菜单文案 */
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/overview' },
  {
    path: '/overview',
    name: '概览',
    component: () => import('@/windows/main/pages/overview/OverviewPage.vue')
  },
  {
    path: '/workspace',
    name: '工作台',
    component: () => import('@/windows/main/pages/workspace/WorkspacePage.vue')
  },
  {
    path: '/tools',
    name: '工具',
    component: () => import('@/windows/main/pages/tools/ToolsPage.vue')
  },
  {
    path: '/setting',
    name: '设置',
    component: () => import('@/windows/main/pages/setting/SettingPage.vue')
  },
  {
    path: '/log',
    name: '日志',
    component: () => import('@/windows/main/pages/log/LogPage.vue')
  },
  {
    path: '/about',
    name: '关于',
    component: () => import('@/windows/main/pages/about/AboutPage.vue')
  }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes
})
