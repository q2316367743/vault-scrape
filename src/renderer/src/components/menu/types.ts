import type { Component } from 'vue'

/** 侧栏菜单项：有 children 时渲染为可展开分组，否则按 to 跳转 */
export interface SideMenuItem {
  /** 菜单文案 */
  label: string
  /** tdesign 图标组件 */
  icon?: Component
  /** 目标路由路径 */
  to?: string
  /** 选中判定方式：exact 全等（默认） / prefix 前缀匹配 */
  match?: 'exact' | 'prefix'
  /** 显式指定选中路径集合，优先级高于 match */
  activePaths?: string[]
  /** 子菜单 */
  children?: SideMenuItem[]
}
