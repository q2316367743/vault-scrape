<script setup lang="ts">
/**
 * 影片详情抽屉内容：某个影片 ID 的详情、剧集、封面与花絮，以及按当前下载设置标注的下载配置。
 *
 * 契约：只读试跑，不落盘、不改插件状态；取数一律走 pluginApi，失败只提示不抛出。
 */
import { computed, onMounted, toRef } from 'vue'
import { describeHeaders } from '../toolUtils'
import { useMoviePreview } from '../composables/useMoviePreview'

const props = defineProps<{
  /** 插件 ID：详情 / 封面 / 花絮都调用这个插件 */
  pluginId: string
  /** 影片 ID */
  movieId: string
}>()

const emit = defineEmits<{ close: [] }>()

const preview = useMoviePreview(toRef(props, 'pluginId'), toRef(props, 'movieId'))

const detailCells = computed(() => {
  const detail = preview.detail.value
  if (!detail) return []
  return [
    { label: '标题', value: detail.title || '—', wide: true },
    { label: '番号', value: detail.num || '—' },
    { label: '原名', value: detail.originalTitle || '—' },
    { label: '发行日期', value: detail.releaseDate || '—' },
    { label: '时长', value: detail.duration ? `${detail.duration} 分钟` : '—' },
    { label: '片商', value: detail.maker || '—' },
    { label: '厂牌', value: detail.label || '—' },
    { label: '系列', value: detail.series || '—' },
    { label: '导演', value: detail.director || '—' },
    { label: '演员', value: detail.actors?.join('、') || '—', wide: true },
    { label: '标签', value: detail.tags?.join('、') || '—', wide: true }
  ]
})

const episodeColumns = [
  { colKey: 'index', title: '集数', width: 72 },
  { colKey: 'title', title: '标题', ellipsis: true },
  { colKey: 'duration', title: '时长', width: 88 },
  { colKey: 'releaseDate', title: '发行日期', width: 120 }
]

const episodeRows = computed(() =>
  (preview.detail.value?.episodes ?? []).map((episode, position) => ({
    key: episode.id ?? `${episode.index}-${position}`,
    index: `第 ${episode.index} 集`,
    title: episode.title ?? '—',
    duration: episode.duration ? `${episode.duration} 分钟` : '—',
    releaseDate: episode.releaseDate ?? '—'
  }))
)

const assetColumns = [
  { colKey: 'source', title: '来源', width: 72 },
  { colKey: 'kindLabel', title: '类型', width: 96 },
  { colKey: 'name', title: '名称', width: 140, ellipsis: true },
  { colKey: 'episode', title: '剧集', width: 80 },
  { colKey: 'method', title: '方法', width: 72 },
  { colKey: 'url', title: '链接', ellipsis: true },
  { colKey: 'headers', title: '请求头', width: 200, ellipsis: true },
  { colKey: 'willDownload', title: '下载设置', width: 120 }
]

const assetRows = computed(() =>
  preview.assetRows.value.map((row) => ({
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

onMounted(() => {
  void preview.runDetail()
})
</script>

<template>
  <div class="movie-drawer">
    <div class="drawer-head">
      <span class="movie-id">影片 ID：{{ movieId }}</span>
      <div class="head-actions">
        <t-button
          size="small"
          variant="outline"
          :loading="preview.busy.value === 'detail'"
          @click="preview.runDetail"
        >
          重新拉详情
        </t-button>
        <t-button
          size="small"
          variant="outline"
          :loading="preview.busy.value === 'covers'"
          @click="preview.runAssets('covers')"
        >
          取封面
        </t-button>
        <t-button
          size="small"
          variant="outline"
          :loading="preview.busy.value === 'extras'"
          @click="preview.runAssets('extras')"
        >
          取花絮
        </t-button>
      </div>
    </div>

    <t-loading
      v-if="preview.busy.value === 'detail' && !preview.detail.value"
      size="small"
      text="正在拉取详情…"
    />

    <section v-else-if="preview.detail.value" class="drawer-block">
      <dl class="detail-grid">
        <div
          v-for="cell in detailCells"
          :key="cell.label"
          class="detail-cell"
          :class="{ 'is-wide': cell.wide }"
        >
          <dt>{{ cell.label }}</dt>
          <dd>{{ cell.value }}</dd>
        </div>
      </dl>
      <p v-if="preview.detail.value.plot" class="detail-plot">{{ preview.detail.value.plot }}</p>
    </section>

    <t-empty v-else description="还没有详情数据" />

    <section v-if="episodeRows.length > 0" class="drawer-block">
      <h4 class="block-title">剧集（{{ episodeRows.length }}）</h4>
      <t-table row-key="key" size="small" :columns="episodeColumns" :data="episodeRows" bordered />
    </section>

    <section v-if="assetRows.length > 0" class="drawer-block">
      <h4 class="block-title">
        下载配置（共 {{ assetRows.length }} 项，按当前下载设置会下载
        {{ preview.willDownloadCount.value }} 项）
      </h4>
      <t-table row-key="key" size="small" :columns="assetColumns" :data="assetRows" bordered />
    </section>

  </div>
</template>

<style scoped>
.movie-drawer {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.movie-id {
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drawer-block {
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

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  margin: 0;
}

.detail-cell {
  min-width: 0;
}

.detail-cell.is-wide {
  grid-column: 1 / -1;
}

.detail-cell dt {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.detail-cell dd {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--td-text-color-primary);
  word-break: break-word;
}

.detail-plot {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--td-text-color-secondary);
  white-space: pre-wrap;
}

.drawer-foot {
  display: flex;
  justify-content: flex-end;
}
</style>
