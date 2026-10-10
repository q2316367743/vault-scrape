import { createSettingGroupStore } from './useSettingGroup'

/** 资料库设置：各资料库类型的媒体后缀清单 */
export const useSettingLibraryStore = createSettingGroupStore('setting:library', 'library')
