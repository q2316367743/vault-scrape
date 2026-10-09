/**
 * 工具箱索引：新增工具时在这里登记一条，索引页自动出现入口卡片。
 *
 * 契约：`path` 必须是 `router.ts` 里已注册的工具页路由；索引页只负责跳转，不承载功能。
 */
import type { Component } from 'vue'
import { SearchIcon } from 'tdesign-icons-vue-next'

export interface ToolEntry {
  /** 稳定标识，仅用于列表 key */
  key: string
  name: string
  description: string
  icon: Component
  /** 工具页路由 */
  path: string
}

export const toolEntries: ToolEntry[] = [
  {
    key: 'search',
    name: '搜索',
    description: '选择插件，按关键字搜索影片，或按影片 ID 直查详情',
    icon: SearchIcon,
    path: '/tools/search'
  }
]
