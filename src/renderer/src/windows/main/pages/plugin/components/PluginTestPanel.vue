<script setup lang="ts">
/**
 * 插件测试面板：搜索候选，点击候选或直接填影片 ID 都能在影片详情抽屉里查看详情。
 *
 * 契约：测试只读，不落盘、不改插件状态；详情 / 封面 / 花絮都在抽屉里按需拉取。
 */
import { computed, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { PluginMovieCandidate, PluginSummary } from '@common/types/plugin'
import { usePluginTest } from '../composables/usePluginTest'
import { openMovieDetailDrawer } from '../modals/MovieDetailDrawer'

const props = defineProps<{
  /** 当前选中的插件；未选中时只在点击时提示 */
  plugin: PluginSummary | null
}>()

const current = computed(() => props.plugin)
const test = usePluginTest(current)

const movieId = ref('')

function describeCandidate(candidate: PluginMovieCandidate): string {
  const parts = [candidate.id]
  if (candidate.num) parts.push(candidate.num)
  if (candidate.isSeries)
    parts.push(candidate.episodeCount ? `共 ${candidate.episodeCount} 集` : '剧集')
  if (candidate.date) parts.push(candidate.date)
  return parts.join(' · ')
}

function openMovie(id: string): void {
  const plugin = props.plugin
  if (!plugin) {
    MessagePlugin.warning('请先选择一个插件')
    return
  }
  const trimmed = id.trim()
  if (trimmed.length === 0) {
    MessagePlugin.warning('请先填写影片 ID')
    return
  }
  openMovieDetailDrawer({ pluginId: plugin.id, pluginName: plugin.name, movieId: trimmed })
}

function openCandidate(candidate: PluginMovieCandidate): void {
  openMovie(candidate.id)
}
</script>

<template>
  <div class="plugin-test">
    <div class="test-row">
      <t-input
        v-model="test.keyword.value"
        class="test-input"
        placeholder="搜索关键字或番号，例如 100tv00031"
        @enter="test.runSearch"
      />
      <t-button theme="primary" :loading="test.searching.value" @click="test.runSearch">
        搜索
      </t-button>
    </div>

    <div class="test-row">
      <t-input
        v-model="movieId"
        class="test-input"
        placeholder="影片 ID，可直接打开详情"
        @enter="openMovie(movieId)"
      />
      <t-button variant="outline" @click="openMovie(movieId)">查看详情</t-button>
    </div>

    <section v-if="test.candidates.value.length > 0" class="test-block">
      <h4 class="block-title">
        搜索结果（{{ test.candidates.value.length }} 条，点击任意一行打开影片详情）
      </h4>
      <t-list split size="small">
        <t-list-item
          v-for="candidate in test.candidates.value"
          :key="candidate.id"
          class="candidate-item"
        >
          <div class="candidate-row" @click="openCandidate(candidate)">
            <div class="candidate-info">
              <t-tooltip :content="candidate.title || candidate.id" placement="top-left">
                <div class="candidate-title">{{ candidate.title || candidate.id }}</div>
              </t-tooltip>
              <div class="candidate-meta">{{ describeCandidate(candidate) }}</div>
            </div>
          </div>
          <template #action>
            <t-button size="small" variant="outline" @click.stop="openCandidate(candidate)">
              详情
            </t-button>
          </template>
        </t-list-item>
      </t-list>
    </section>

    <t-empty v-else description="填写关键字或影片 ID 开始测试，详情会在抽屉里打开" />
  </div>
</template>

<style scoped>
.plugin-test {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.test-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.test-input {
  flex: 1;
  min-width: 0;
}

.test-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.candidate-item {
  padding-right: 12px;
}

.candidate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  cursor: pointer;
}

.candidate-info {
  flex: 1;
  min-width: 0;
}

.candidate-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--td-text-color-primary);
}

.candidate-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
</style>
