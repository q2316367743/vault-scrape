import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { MessagePlugin } from 'tdesign-vue-next'
import { settingApi } from '@/api'
import { useLog } from '@/hooks/UseLog'
import { buildSetting, type SettingGroupKey, type SettingSchema } from '@common/types/setting'

/**
 * 按分组生成设置 store。
 * 初始值用公共默认值，异步拉取真实值；之后用户改动以 300ms 防抖回写主进程。
 * 回写失败会记录日志并提示一次，避免「改了没反应」的静默失败。
 *
 * 与「改了没生效」直接相关的两点：
 * - 用户在磁盘值回填前就改过时，丢弃回填结果。否则用户刚点的开关会被随后返回的旧值整体
 *   覆盖：界面上开关弹回，磁盘上只剩被覆盖后的旧值，连「点过」的痕迹都留不下。
 * - `onSaved` 在回写成功后触发，用于刷新依赖该分组的缓存（如应用分组的 NSFW 保护状态）。
 */
export function createSettingGroupStore<K extends SettingGroupKey>(
  id: string,
  key: K,
  onSaved?: () => void
) {
  return defineStore(id, () => {
    const logger = useLog({ name: id })
    const setting = ref<SettingSchema[K]>(buildSetting()[key])
    let saveFailedNotified = false
    /** 用户是否改过这个分组，用来区分「用户修改」与「磁盘值回填」 */
    let edited = false
    /** 正在写回磁盘值：此刻 watcher 的触发不代表用户修改 */
    let applyingRemote = false

    watch(
      setting,
      () => {
        if (!applyingRemote) edited = true
      },
      { deep: true, flush: 'sync' }
    )

    watchDebounced(
      setting,
      (value) => {
        void settingApi
          .saveGroup(key, value)
          .then(() => {
            onSaved?.()
          })
          .catch((error: unknown) => {
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
        if (edited) {
          logger.debug('用户在设置加载完成前已修改，保留本地修改')
          return
        }
        applyingRemote = true
        setting.value = group
        applyingRemote = false
        logger.debug('设置分组加载成功')
      })
      .catch((error: unknown) => {
        logger.error('设置分组加载失败', error)
      })

    return { setting }
  })
}
