import { createSettingGroupStore } from './useSettingGroup'

/** 应用设置 */
export const useSettingAppStore = createSettingGroupStore('setting:app', 'app')
