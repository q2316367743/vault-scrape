import { defineStore } from 'pinia'
import { ref } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { settingApi } from '@/api'
import { useLog } from '@/hooks/UseLog'
import { buildSetting, type SettingGroupKey, type SettingSchema } from '@common/types/setting'

/**
 * 按分组生成设置 store。
 * 初始值用公共默认值，异步拉取真实值；之后任何改动以 300ms 防抖回写主进程。
 */
export function createSettingGroupStore<K extends SettingGroupKey>(id: string, key: K) {
  return defineStore(id, () => {
    const logger = useLog({ name: id })
    const setting = ref<SettingSchema[K]>(buildSetting()[key])

    watchDebounced(
      setting,
      (value) => {
        void settingApi.saveGroup(key, value)
      },
      { debounce: 300, deep: true }
    )

    settingApi
      .getGroup(key)
      .then((group) => {
        setting.value = group
        logger.debug('设置分组加载成功')
      })
      .catch((error: unknown) => {
        logger.error('设置分组加载失败', error)
      })

    return { setting }
  })
}
