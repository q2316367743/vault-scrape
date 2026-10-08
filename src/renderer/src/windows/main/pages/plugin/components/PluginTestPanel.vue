<script setup lang="ts">
/**
 * 插件测试面板：对当前插件逐个方法试跑，并按当前下载设置标注资产是否会真的被下载。
 *
 * 契约：测试只读，不落盘、不改插件状态；资产表仅展示「下载配置」，真正的下载由后续调度器负责。
 */
import { computed, watch } from 'vue'
import type { PluginSummary } from '@common/types/plugin'
import { usePluginTest } from '../composables/usePluginTest'
import { describeHeaders } from '../pluginUtils'

const props = defineProps<{ plugin: PluginSummary }>()

const current = computed<PluginSummary | null>(() => props.plugin)
const test = usePluginTest(current)

watch(
  () => props.plugin.id,
  () => test.reset()
)

const columns = [
  { colKey: 'source', title: '来源', width: 72 },
  { colKey: 'kindLabel', title: '类型', width: 96 },
  { colKey: 'name', title: '名称', width: 140, ellipsis: true },
  { colKey: 'episode', title: '剧集', width: 80 },
  { colKey: 'method', title: '方法', width: 72 },
  { colKey: 'url', title: '链接', ellipsis: true },
  { colKey: 'headers', title: '请求头', width: 200, ellipsis: true },
  { colKey: 'willDownload', title: '下载设置', width: 120 }
]

const rows = computed(() =>
  test.assetRows.value.map((row) => ({
    key: row.key,
    source: row.source,
    kindLabel: row.kindLabel,
    name: row.asset.name ?? '—',
    episode: row.asset.episode ? `第 ${row.asset.episode.index} 集` : '—',
    method: row.asset.method ?? 'GET',
    url: row.asset.url,
    headers: describeHeaders(row.asset.headers),
    willDownload: row.willDownload ? '会下载' : '当前不下载'
  }))
)
</script>

<template>
  <div class="plugin-test">
    <div class="test-actions">
      <t-input
        v-model="test.keyword.value"
        class="test-input"
        placeholder="搜索关键字或番号"
        @enter="test.runSearch"
      />
      <t-button theme="primary" :loading="test.busy.value === 'search'" @click="test.runSearch">
        搜索
      </t-button>
      <t-input
        v-model="test.movieId.value"
        class="test-input"
        placeholder="影片 ID"
        @enter="test.runDetail"
      />
      <t-button variant="outline" :loading="test.busy.value === 'detail'" @click="test.runDetail">
        拉详情
      </t-button>
      <t-button variant="outline" :loading="test.busy.value === 'covers'" @click="test.runAssets('covers')">
        取封面
      </t-button>
      <t-button variant="outline" :loading="test.busy.value === 'extras'" @click="test.runAssets('extras')">
        取花絮
      </t-button>
    </div>

    <section v-if="test.candidates.value.length > 0" class="test-block">
      <h4 class="block-title">搜索结果（点击一行回填 ID 并拉详情）</h4>
      <t-list split size="small">
        <t-list-item
          v-for="candidate in test.candidates.value"
          :key="candidate.id"
          class="candidate-item"
          @click="test.pickCandidate(candidate)"
        >
          <t-list-item-meta
            :title="candidate.title"
            :description="`${candidate.id}${candidate.num ? ` · ${candidate.num}` : ''}${candidate.isSeries ? ' · 剧集' : ''}`"
          />
        </t-list-item>
      </t-list>
    </section>

    <section v-if="test.detail.value" class="test-block">
      <h4 class="block-title">影片详情</h4>
      <div class="detail-grid">
        <div class="detail-cell">
          <span class="cell-label">标题</span>
          <span>{{ test.detail.value.title }}</span>
        </div>
        <div class="detail-cell">
          <span class="cell-label">番号</span>
          <span>{{ test.detail.value.num || '—' }}</span>
        </div>
        <div class="detail-cell">
          <span class="cell-label">发行日期</span>
          <span>{{ test.detail.value.releaseDate || '—' }}</span>
        </div>
        <div class="detail-cell">
          <span class="cell-label">片商</span>
          <span>{{ test.detail.value.maker || '—' }}</span>
        </div>
        <div class="detail-cell">
          <span class="cell-label">时长（分钟）</span>
          <span>{{ test.detail.value.duration ?? '—' }}</span>
        </div>
        <div class="detail-cell">
          <span class="cell-label">演员</span>
          <span>{{ test.detail.value.actors?.join('、') || '—' }}</span>
        </div>
        <div class="detail-cell">
          <span class="cell-label">剧集数</span>
          <span>{{ test.detail.value.episodes?.length ?? 0 }}</span>
        </div>
        <div class="detail-cell">
          <span class="cell-label">标签</span>
          <span>{{ test.detail.value.tags?.join('、') || '—' }}</span>
        </div>
      </div>
      <p v-if="test.detail.value.plot" class="detail-plot">{{ test.detail.value.plot }}</p>
    </section>

    <section v-if="rows.length > 0" class="test-block">
      <h4 class="block-title">
        下载配置（共 {{ rows.length }} 项，按当前下载设置会下载 {{ test.willDownloadCount.value }} 项）
      </h4>
      <t-table row-key="key" size="small" :columns="columns" :data="rows" :bordered="true" />
    </section>

    <t-empty v-if="rows.length === 0 && test.candidates.value.length === 0 && !test.detail.value"
      description="填写关键字或影片 ID 后点击上方按钮开始测试" />
  </div>
</template>

<style scoped lang="less">
.plugin-test {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 4px 0 16px;
}

.test-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.test-input {
  width: 220px;
}

.test-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.candidate-item {
  cursor: pointer;

  &:hover {
    background: var(--td-bg-color-container-hover);
  }
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 24px;
  font-size: 13px;
  color: var(--td-text-color-primary);
}

.detail-cell {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.cell-label {
  width: 84px;
  flex-shrink: 0;
  color: var(--td-text-color-placeholder);
}

.detail-plot {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--td-text-color-secondary);
}
</style>
