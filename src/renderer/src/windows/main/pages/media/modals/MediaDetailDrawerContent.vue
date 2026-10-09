<script setup lang="ts">
/**
 * 影片详情抽屉内容：读同目录 NFO 补全元信息，同时展示磁盘上的文件事实。
 *
 * 契约：
 * - 只读：不下载、不写 NFO、不改索引；
 * - 取数一律走 mediaApi，失败只显示中文提示并允许重试，绝不抛出；
 * - 没有 NFO（或 NFO 看不懂）是正常情况：标题按磁盘文件名推断，封面取同目录图片或刮削记录。
 */
import { computed, onMounted, ref } from 'vue'
import { FilmIcon, RefreshIcon } from 'tdesign-icons-vue-next'
import SensitiveImage from '@/components/SensitiveImage.vue'
import { mediaApi } from '@/api'
import type { MediaDetailResult, MediaWallItem } from '@common/types/media'
import { formatDuration, formatSize, formatTime } from '../mediaUtils'

interface DetailCell {
  label: string
  value: string
  wide?: boolean
}

const props = defineProps<{
  /** 视频所属的数据源 ID */
  connectionId: string
  /** 视频在存储内的绝对路径 */
  path: string
  /** 数据源名称，仅用于展示 */
  sourceName: string
  /** 打开抽屉那一刻卡片上的 NSFW 保护状态 */
  protect: boolean
}>()

const loading = ref(false)
const failure = ref('')
const detail = ref<MediaDetailResult | null>(null)

/** 刮削状态：靠同目录产出判定「已刮削」时没有刮削时间可显示 */
function scrapedText(item: MediaWallItem): string {
  if (!item.scraped) return '未刮削'
  return item.scrapedAt > 0 ? `已刮削 · ${formatTime(item.scrapedAt)}` : '已刮削'
}

/** 磁盘上的事实：这条记录是什么、在哪、多大 */
const fileCells = computed<DetailCell[]>(() => {
  const data = detail.value
  if (!data) return []
  return [
    { label: '标题', value: data.item.title || '—', wide: true },
    { label: '番号', value: data.item.num || '未识别' },
    { label: '数据源', value: props.sourceName || '未知数据源' },
    { label: '文件名', value: data.item.name, wide: true },
    { label: '所在目录', value: data.item.dirPath || '—', wide: true },
    { label: '体积', value: formatSize(data.item.size) },
    { label: '磁盘修改时间', value: formatTime(data.item.modifiedAt) },
    { label: '刮削状态', value: scrapedText(data.item) }
  ]
})

/** NFO 里的元信息：字段口径与写入侧一致 */
const nfoCells = computed<DetailCell[]>(() => {
  const meta = detail.value?.meta
  if (!meta) return []
  return [
    { label: '标题', value: meta.title || '—', wide: true },
    { label: '番号', value: meta.num || '—' },
    { label: '原名', value: meta.originalTitle || '—' },
    { label: '发行日期', value: meta.releaseDate || '—' },
    { label: '时长', value: formatDuration(meta.duration) },
    { label: '片商', value: meta.maker || '—' },
    { label: '厂牌', value: meta.label || '—' },
    { label: '系列', value: meta.series || '—' },
    { label: '导演', value: meta.director || '—' },
    { label: '演员', value: meta.actors.join('、') || '—', wide: true },
    { label: '标签', value: meta.tags.join('、') || '—', wide: true }
  ]
})

async function load(): Promise<void> {
  loading.value = true
  failure.value = ''
  const result = await mediaApi.detail({ connectionId: props.connectionId, path: props.path })
  loading.value = false
  if (!result.ok) {
    failure.value = result.message
    return
  }
  detail.value = result.data
}

onMounted(() => void load())
</script>

<template>
  <div class="media-drawer">
    <div class="drawer-head">
      <span class="drawer-path">{{ path }}</span>
      <t-button size="small" variant="outline" :loading="loading" @click="load">
        <template #icon><refresh-icon /></template>
        重新读取
      </t-button>
    </div>

    <t-alert v-if="failure" theme="error" :message="failure" />

    <t-loading v-if="loading && !detail" size="small" text="正在读取影片信息…" />

    <template v-else-if="detail">
      <div class="drawer-block overview">
        <sensitive-image
          v-if="detail.item.coverUrl"
          class="overview-cover"
          :src="detail.item.coverUrl"
          :protect="protect"
          :width="200"
          :height="280"
          alt="影片封面"
          fit="cover"
        />
        <div v-else class="overview-cover is-empty">
          <film-icon size="32px" />
          <span>{{ detail.item.scraped ? '没有找到封面' : '未刮削' }}</span>
        </div>
        <dl class="detail-grid overview-grid">
          <div
            v-for="cell in fileCells"
            :key="cell.label"
            class="detail-cell"
            :class="{ 'is-wide': cell.wide }"
          >
            <dt>{{ cell.label }}</dt>
            <dd>{{ cell.value }}</dd>
          </div>
        </dl>
      </div>

      <section class="drawer-block">
        <h4 class="block-title">NFO 元信息</h4>
        <template v-if="detail.meta">
          <p v-if="detail.nfoPath" class="nfo-path">来源：{{ detail.nfoPath }}</p>
          <dl class="detail-grid">
            <div
              v-for="cell in nfoCells"
              :key="cell.label"
              class="detail-cell"
              :class="{ 'is-wide': cell.wide }"
            >
              <dt>{{ cell.label }}</dt>
              <dd>{{ cell.value }}</dd>
            </div>
          </dl>
          <t-textarea
            v-if="detail.meta.plot"
            class="detail-plot"
            :value="detail.meta.plot"
            :autosize="{ minRows: 12, maxRows: 24 }"
          ></t-textarea>
        </template>
        <t-empty
          v-else
          description="同目录没有可用的 NFO：标题按磁盘文件名推断，封面取同目录图片；重新刮削并生成 NFO 后即可补全"
        />
      </section>
    </template>

    <t-empty v-else-if="!failure" description="还没有影片信息" />
  </div>
</template>

<style scoped lang="less">
.media-drawer {
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

.drawer-path {
  min-width: 0;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  word-break: break-all;
}

.drawer-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.overview {
  flex-direction: row;
  align-items: flex-start;
  gap: 16px;
}

.overview-cover {
  flex-shrink: 0;
}

.overview-cover.is-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  background-color: var(--td-bg-color-container-hover);
  border-radius: var(--td-radius-default);
}

.overview-grid {
  flex: 1;
  min-width: 0;
}

.block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.nfo-path {
  margin: 0;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  word-break: break-all;
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
</style>
