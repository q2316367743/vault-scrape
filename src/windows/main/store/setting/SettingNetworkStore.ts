import { createSettingGroupStore } from './useSettingGroup'

/** 网络连接 */
export const useSettingNetworkStore = createSettingGroupStore('setting:network', 'network')
