<template>
  <div class="match-content">
    <t-alert
      v-if="blocked"
      theme="warning"
      message="这条影视所属的资料库没有可用的刮削器，请先到「资料库」里为它配置刮削器"
    />
    <template v-else>
      <div class="match-search">
        <t-input
          v-model="keyword"
          class="match-input"
          :placeholder="placeholder"
          :disabled="saving"
          clearable
          @enter="onSearch"
        />
        <t-button
          theme="primary"
          :loading="searching"
          :disabled="saving"
          @click="onSearch"
        >
          搜索
        </t-button>
      </div>

      <p v-if="hint.length > 0" class="match-hint">{{ hint }}</p>
      <t-alert v-if="failure.length > 0" theme="error" :message="failure" />

      <t-loading v-if="loading" class="match-loading" text="正在读取可用刮削器…" />
      <section v-else class="match-result">
        <t-list v-if="candidates.length > 0" split size="small">
          <media-match-candidate-row
            v-for="row in candidates"
            :key="row.key"
            :row="row"
            :selected="row.key === selectedKey"
            :protect="protect"
            :disabled="saving"
            @select="select(row)"
          />
        </t-list>
        <t-empty v-else :description="emptyText" />
      </section>
    </template>
  </div>
</template>
<script setup lang="ts">
/**
 * 手动匹配弹窗的内容：搜索框 + 候选列表 + 应用。
 *
 * 契约（见 AGENTS.md「弹窗与抽屉」）：
 * - 本组件不含「取消 / 使用所选」按钮，它们由外壳 `MediaMatchDialog.tsx` 的 footer 提供；
 * - 通过 `defineExpose` 暴露 `submit` / `saving` / `canSubmit`（ModalContentExpose）；
 * - 应用成功用 `emit('success', 结果)` 通知外壳（关窗 + 提示 + 刷新详情），失败留在本组件里提示；
 * - 搜索只读，真正落盘的是主进程 `scrape:match`（与自动刮削同一条流水线）。
 */
import { computed, onMounted, ref } from 'vue'
import { MessageUtil } from '@/utils/modal'
import { scrapeApi } from '@/api'
import type { ScrapeMatchResult } from '@common/types/scrape'
import MediaMatchCandidateRow from './MediaMatchCandidateRow.vue'
import { useMediaMatchSearch, type MatchCandidate } from '../composables/useMediaMatchSearch'

const props = defineProps<{
  /** 媒体条目 ID */
  itemId: string
  /** 条目所属资料库：可用刮削器按它的 scrapers 取 */
  libraryId: string
  /** 条目是否受 NSFW 保护：决定输入框语义（番号 / TMDB ID 与关键字） */
  nsfwProtected: boolean
  /** 封面是否打码：与详情页同一口径 */
  protect: boolean
}>()

const emit = defineEmits<{
  success: [result: ScrapeMatchResult]
}>()

const {
  keyword,
  loading,
  searching,
  searched,
  failure,
  candidates,
  blocked,
  placeholder,
  pluginNames,
  load,
  runSearch
} = useMediaMatchSearch({
  libraryId: props.libraryId,
  nsfwProtected: props.nsfwProtected
})

const saving = ref(false)
const selectedKey = ref('')

const selected = computed(
  () => candidates.value.find((row) => row.key === selectedKey.value) ?? null
)
const canSubmit = computed(() => selected.value !== null && !saving.value)
const hint = computed(() => {
  if (blocked.value || pluginNames.value.length === 0) return ''
  const mode = props.nsfwProtected ? '按番号搜索' : '按 TMDB ID 或关键字搜索'
  return `${mode}，搜索范围：${pluginNames.value}`
})
const emptyText = computed(() =>
  searched.value
    ? '没有搜索到候选，换个关键字再试'
    : '填写搜索内容后点「搜索」或按回车'
)

function select(row: MatchCandidate): void {
  if (saving.value) return
  selectedKey.value = row.key
}

async function onSearch(): Promise<void> {
  selectedKey.value = ''
  await runSearch()
}

/** 外壳主按钮：把选中的候选交给主进程跑完整刮削流水线 */
async function submit(): Promise<void> {
  const row = selected.value
  if (!row || saving.value) return
  saving.value = true
  try {
    const result = await scrapeApi.match({
      itemId: props.itemId,
      pluginId: row.pluginId,
      movieId: row.candidate.id
    })
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

onMounted(() => {
  void load()
})
</script>
<style scoped>
.match-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.match-search {
  display: flex;
  align-items: center;
  gap: 8px;
}

.match-input {
  flex: 1;
  min-width: 0;
}

.match-hint {
  margin: 0;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.match-loading {
  display: flex;
  justify-content: center;
  padding: 24px 0;
}

.match-result {
  max-height: 380px;
  overflow: auto;
}
</style>
