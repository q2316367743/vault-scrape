import { readBoolean, toSource } from './shared'

/** 应用设置：与具体功能域无关的界面与全局开关 */
export interface SettingApp {
  /**
   * NSFW 保护：开启后，标记为 NSFW 的存储会隐藏列表、搜索与详情页的敏感图片；
   * 没有存储上下文的页面（如工具搜索）只按本开关生效
   */
  nsfwProtection: boolean
}

export function buildSettingApp(): SettingApp {
  return {
    nsfwProtection: false
  }
}

export function normalizeSettingApp(raw: unknown): SettingApp {
  const base = buildSettingApp()
  const source = toSource(raw)
  if (!source) return base
  return {
    nsfwProtection: readBoolean(source, 'nsfwProtection', base.nsfwProtection)
  }
}
