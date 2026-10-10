import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

/** 九个一级页面（name 同时作为侧栏菜单文案）+ 工具子页 */
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/overview' },
  {
    path: '/overview',
    name: '概览',
    component: () => import('@/windows/main/pages/overview/OverviewPage.vue')
  },
  {
    // 影视墙首页：资料库横排 + 最近添加 / 待刮削 / 推荐三排
    path: '/media',
    name: '影视墙',
    component: () => import('@/windows/main/pages/media/home/MediaHomePage.vue')
  },
  {
    // 单个资料库的内容页：libraryId 走 query，空串表示「全部影片」
    path: '/media/library',
    name: '影视墙资料库',
    component: () => import('@/windows/main/pages/media/wall/MediaWallPage.vue')
  },
  {
    // 影片详情：参数走 query（itemId），可以直接刷新 / 收藏这一刻的地址
    path: '/media/detail',
    name: '影视墙详情',
    component: () => import('@/windows/main/pages/media/detail/MediaDetailPage.vue')
  },
  {
    path: '/workspace',
    name: '工作台',
    component: () => import('@/windows/main/pages/workspace/WorkspacePage.vue')
  },
  {
    path: '/storage',
    name: '存储',
    component: () => import('@/windows/main/pages/storage/StoragePage.vue')
  },
  {
    path: '/plugin',
    name: '插件',
    component: () => import('@/windows/main/pages/plugin/PluginPage.vue')
  },
  {
    path: '/tools',
    name: '工具',
    component: () => import('@/windows/main/pages/tools/ToolsPage.vue')
  },
  {
    path: '/tools/search',
    name: '搜索',
    component: () => import('@/windows/main/pages/tools/search/ToolSearchPage.vue')
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
