<template>
  <div class="scrape-content">
    <p class="scrape-hint">选择用来抓取「{{ actorName }}」资料的插件，本次只跑选中的这一个。</p>

    <t-loading v-if="loading" class="scrape-loading" text="正在读取演员信息插件…" />

    <t-alert
      v-else-if="options.length === 0"
      theme="warning"
      message="没有可用的演员信息插件，请先到插件页启用一个"
    />

    <t-select
      v-else
      v-model="selectedId"
      :options="options"
      :disabled="saving"
      placeholder="选择插件"
    />

    <t-alert v-if="failure" theme="error" :message="failure" />
  </div>
</template>

<script setup lang="ts">
/**
 * 手动抓取演员资料的弹窗内容：单选一个演员信息插件。
 *
 * 契约（见 AGENTS.md「弹窗与抽屉」）：
 * - 本组件不含操作按钮，取消 / 开始抓取由外壳 `ActorScrapeDialog.tsx` 的 footer 提供；
 * - 通过 `defineExpose` 暴露 `submit` / `saving` / `canSubmit`（ModalContentExpose）；
 * - 只列「启用且加载通过」的演员信息插件（与手动匹配同一口径）；
 * - 默认选中上次用过的插件（`localStorage` 持久化，纯 UI 偏好、不进设置文件），它被停用或删除后回落到第一个可用插件；
 * - 只把选中的那一个插件 ID 交给 `actorApi.scrape`：主进程把空数组理解成「全部启用的插件」，
 *   所以没有选中项时不能提交；
 * - 抓取成功 `emit('success', 结果)`，由外壳关窗并把结果提示给用户。
 */
import { computed, onMounted, ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { MessageUtil } from '@/utils/modal'
import { actorApi, pluginApi } from '@/api'
import type { ActorScrapeResult } from '@common/types/actor'
import type { PluginSummary } from '@common/types/plugin'

/** 上次选中的演员抓取插件；键与其它渲染层偏好保持同一前缀 */
const LAST_PLUGIN_KEY = 'vault-scrape:actor-scrape-plugin'

const props = defineProps<{
  /** 演员 ID（`actor.actor_id`） */
  actorId: string
  /** 演员姓名，仅用于提示文案 */
  actorName: string
}>()

const emit = defineEmits<{
  success: [result: ActorScrapeResult]
}>()

const loading = ref(false)
const saving = ref(false)
const failure = ref('')
const plugins = ref<PluginSummary[]>([])
const selectedId = ref('')
const lastPluginId = useLocalStorage(LAST_PLUGIN_KEY, '')

const options = computed(() =>
  plugins.value.map((plugin) => ({ value: plugin.id, label: `${plugin.name} v${plugin.version}` }))
)
const canSubmit = computed(() => selectedId.value.length > 0 && !saving.value)

/** 读插件清单并回填默认选中项：上次用过的那一个还在就选它，否则选列表第一个 */
async function load(): Promise<void> {
  loading.value = true
  failure.value = ''
  const result = await pluginApi.actor.list()
  loading.value = false
  if (!result.ok) {
    failure.value = result.message
    return
  }
  plugins.value = result.data.filter((item) => item.enabled && item.loadError.length === 0)
  const remembered = plugins.value.find((item) => item.id === lastPluginId.value)
  selectedId.value = remembered?.id ?? plugins.value[0]?.id ?? ''
}

/** 外壳主按钮：只跑选中的插件，成功后才记住这次的选择 */
async function submit(): Promise<void> {
  if (!canSubmit.value) return
  saving.value = true
  const result = await actorApi.scrape({ actorId: props.actorId, pluginIds: [selectedId.value] })
  saving.value = false
  if (!result.ok) {
    failure.value = result.message
    MessageUtil.error(result.message)
    return
  }
  lastPluginId.value = selectedId.value
  emit('success', result.data)
}

defineExpose({ submit, saving, canSubmit })

onMounted(() => {
  void load()
})
</script>

<style scoped lang="less">
.scrape-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scrape-hint {
  margin: 0;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.scrape-loading {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}
</style>
