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
              <div class="candidate-meta">
                <t-tag size="small" theme="primary" variant="light-outline">
                  <template #icon><tag-icon /></template>{{ numText(candidate) }}
                </t-tag>
                <t-tag v-if="candidate.date" theme="warning" size="small" variant="light-outline">
                  <template #icon><calendar-icon /></template>{{ candidate.date }}
                </t-tag>
                <t-tag
                  v-if="candidate.isSeries"
                  size="small"
                  theme="danger"
                  variant="light-outline"
                >
                  <template #icon><play-circle-icon /></template>
                  {{ candidate.episodeCount ? `${candidate.episodeCount} 集` : '剧集' }}
                </t-tag>
                <t-tag
                  v-for="actor in visibleActors(candidate)"
                  :key="actor"
                  size="small"
                  theme="success"
                  variant="light-outline"
                >
                  <template #icon><user-icon /></template>{{ actor }}
                </t-tag>
                <t-tooltip
                  v-if="hiddenActorCount(candidate) > 0"
                  :content="(candidate.actors ?? []).join('、')"
                  placement="top-left"
                >
                  <t-tag size="small" variant="light-outline"
                    >+{{ hiddenActorCount(candidate) }}</t-tag
                  >
                </t-tooltip>
              </div>
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
<script setup lang="ts">
/**
 * 插件测试面板：搜索候选，点击候选或直接填影片 ID 都能在影片详情抽屉里查看详情。
 *
 * 契约：测试只读，不落盘、不改插件状态；详情 / 封面 / 花絮都在抽屉里按需拉取。
 */
import { computed, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { CalendarIcon, PlayCircleIcon, TagIcon, UserIcon } from 'tdesign-icons-vue-next'
import type { PluginMovieCandidate, PluginSummary } from '@common/types/plugin'
import { usePluginTest } from '../composables/usePluginTest'
import { openMovieDetailDrawer } from '../modals/MovieDetailDrawer'

/** 列表里每个候选最多直接显示几个演员标签，多出来的折成 +N */
const ACTOR_TAG_LIMIT = 3

const props = defineProps<{
  /** 当前选中的插件；未选中时只在点击时提示 */
  plugin: PluginSummary | null
}>()

const current = computed(() => props.plugin)
const test = usePluginTest(current)

const movieId = ref('')

/** 番号优先，没有番号时退回影片 ID（两个都要靠它区分条目） */
function numText(candidate: PluginMovieCandidate): string {
  return candidate.num || candidate.id
}

function visibleActors(candidate: PluginMovieCandidate): string[] {
  return (candidate.actors ?? []).slice(0, ACTOR_TAG_LIMIT)
}

function hiddenActorCount(candidate: PluginMovieCandidate): number {
  return Math.max(0, (candidate.actors?.length ?? 0) - ACTOR_TAG_LIMIT)
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
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  min-width: 0;
}
</style>
