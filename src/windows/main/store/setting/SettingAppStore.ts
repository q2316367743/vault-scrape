import { refreshNsfwProtection } from '@/hooks/UseNsfwProtection'
import { createSettingGroupStore } from './useSettingGroup'

/**
 * 应用设置。
 * 保存成功后刷新 NSFW 保护缓存：保护状态是模块级 ref，不刷新的话「打开开关」要等整页
 * 刷新才生效，表现就是影视墙等页面「设置没生效」。
 */
export const useSettingAppStore = createSettingGroupStore('setting:app', 'app', () => {
  void refreshNsfwProtection()
})
