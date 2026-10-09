/**
 * 影片详情抽屉状态：按影片 ID 拉详情、封面与花絮，并标注当前下载设置会不会下载。
 *
 * 契约：只读试跑，不落盘、不改插件状态；失败只提示，不抛出。
 */
import { computed, ref, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { MessagePlugin } from 'tdesign-vue-next'
import { pluginApi } from '@/api'
import { useSettingDownloadStore } from '@/windows/main/store'
import type { PluginAsset, PluginMovieDetail } from '@common/types/plugin'
import { toAssetRows } from '../toolUtils'

export type MoviePreviewTask = 'detail' | 'covers' | 'extras' | ''

export function useMoviePreview(pluginId: Ref<string>, movieId: Ref<string>) {
  const { setting } = storeToRefs(useSettingDownloadStore())
  const busy = ref<MoviePreviewTask>('')
  const detail = ref<PluginMovieDetail | null>(null)
  const covers = ref<PluginAsset[]>([])
  const extras = ref<PluginAsset[]>([])

  const assetRows = computed(() => toAssetRows([...covers.value, ...extras.value], setting.value))

  const willDownloadCount = computed(
    () => assetRows.value.filter((row) => row.willDownload).length
  )

  async function runDetail(): Promise<void> {
    busy.value = 'detail'
    const result = await pluginApi.detail(pluginId.value, movieId.value)
    busy.value = ''
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    detail.value = result.data
  }

  async function runAssets(task: 'covers' | 'extras'): Promise<void> {
    busy.value = task
    const result =
      task === 'covers'
        ? await pluginApi.covers(pluginId.value, movieId.value)
        : await pluginApi.extras(pluginId.value, movieId.value)
    busy.value = ''
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    if (task === 'covers') covers.value = result.data
    else extras.value = result.data
  }

  return { busy, detail, covers, extras, assetRows, willDownloadCount, runDetail, runAssets }
}
