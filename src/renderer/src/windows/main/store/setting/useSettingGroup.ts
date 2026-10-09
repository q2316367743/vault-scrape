import { defineStore } from 'pinia'
import { ref } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { MessagePlugin } from 'tdesign-vue-next'
import { settingApi } from '@/api'
import { useLog } from '@/hooks/UseLog'
import { buildSetting, type SettingGroupKey, type SettingSchema } from '@common/types/setting'

/**
 * 按分组生成设置 store。
 * 初始值用公共默认值，异步拉取真实值；之后任何改动以 300ms 防抖回写主进程。
 * 回写失败会记录日志并提示一次，避免「改了没反应」的静默失败。
 */
export function createSettingGroupStore<K extends SettingGroupKey>(id: string, key: K) {
  return defineStore(id, () => {
    const logger = useLog({ name: id })
    const setting = ref<SettingSchema[K]>(buildSetting()[key])
    let saveFailedNotified = false

    watchDebounced(
      setting,
      (value) => {
        void settingApi.saveGroup(key, value).catch((error: unknown) => {
          logger.error('设置分组保存失败', error)
          if (!saveFailedNotified) {
            saveFailedNotified = true
            MessagePlugin.error('设置保存失败，请查看控制台日志')
          }
        })
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
