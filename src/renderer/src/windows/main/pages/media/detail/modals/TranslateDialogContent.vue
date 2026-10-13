<template>
  <div class="translate-content">
    <p class="translate-scope">将翻译：{{ scope }}</p>

    <radio-select
      v-model="pluginId"
      :options="pluginOptions"
      :disabled="saving"
      placeholder="搜索插件"
    />

    <t-alert v-if="failure.length > 0" theme="error" :message="failure" />
  </div>
</template>
<script setup lang="ts">
/**
 * 翻译弹窗的内容：选一个翻译插件 + 开始翻译。
 *
 * 契约（见 AGENTS.md「弹窗与抽屉」）：
 * - 本组件不含「取消 / 开始翻译」按钮，它们由外壳 `TranslateDialog.tsx` 的 footer 提供；
 * - 通过 `defineExpose` 暴露 `submit` / `saving` / `canSubmit`（ModalContentExpose）；
 * - **列出全部翻译插件**（用通用单选控件 `@/components/RadioSelect.vue`），不可用的置灰并把原因写成
 *   选项下方的灰字说明——用户要能看出「哪个填了设置就能用」，只列可用的会让另外两个插件凭空消失；
 * - 默认选中第一个可用的插件（按插件页顺序），与「自动选择」是同一套口径；
 * - 翻译是纯派生写入（只写译文表），失败留在本组件里提示，成功用 `emit('success')` 通知外壳。
 */
import { computed, ref } from 'vue'
import { MessageUtil } from '@/utils/modal'
import { translateApi } from '@/api'
import RadioSelect from '@/components/RadioSelect.vue'
import { isPluginUsable, type PluginSummary } from '@common/types/plugin'
import type { TranslateItemResult } from '@common/types/translate'
import { translatePluginHint } from '@/windows/main/composables/useTranslatePlugins'

const props = defineProps<{
  /** 媒体条目 ID */
  itemId: string
  /** 全部翻译插件（含不可用的），按插件页顺序 */
  plugins: PluginSummary[]
  /** 这条记录是整部剧集：剧集连同每一集的简介一起翻 */
  isSeries: boolean
}>()

const emit = defineEmits<{ success: [result: TranslateItemResult] }>()

const saving = ref(false)
const failure = ref('')
const pluginId = ref(props.plugins.find(isPluginUsable)?.id ?? '')

const canSubmit = computed(() => pluginId.value.length > 0 && !saving.value)

/** 全部插件都列出来，不可用的置灰并把原因写成选项下方的说明 */
const pluginOptions = computed(() =>
  props.plugins.map((plugin) => ({
    label: plugin.name,
    value: plugin.id,
    disabled: !isPluginUsable(plugin),
    description: translatePluginHint(plugin)
  }))
)

const scope = computed(() => {
  const fields = '标题、原名、简介、标签、片商、厂牌、系列、导演与演员名'
  return props.isSeries ? `${fields}；剧集还包括每集的简介` : fields
})

/** 外壳主按钮：把选中的插件交给主进程翻这一条（剧集连每集简介一起翻） */
async function submit(): Promise<void> {
  if (!canSubmit.value) return
  saving.value = true
  try {
    const result = await translateApi.item({ itemId: props.itemId, pluginId: pluginId.value })
    if (!result.ok) {
      failure.value = result.message
      MessageUtil.error(result.message)
      return
    }
    emit('success', result.data)
  } finally {
    saving.value = false
  }
}

defineExpose({ submit, saving, canSubmit })
</script>

<style scoped>
.translate-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.translate-scope {
  margin: 0;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
</style>
