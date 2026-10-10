<script setup lang="ts">
/**
 * 存储页预览抽屉的内容。
 *
 * 契约：只读，没有任何写操作。按文件类型分派：
 * - video / audio → 与影视墙详情页共用的播放器（`storage://` 路径预览地址 + 区间播放）；
 * - image → SensitiveImage（敏感图片的统一出口，不用裸 t-image）；
 * - nfo → 先读原文，再交给 StorageNfoPreview（结构化字段 / 原始 XML 可切换）；
 * - 其它 → 不支持预览（表格本来就没有入口，这里兜底）。
 */
import { computed, onMounted, ref } from 'vue'
import {
  buildFilePreviewUrl,
  filePreviewKindOf,
  type FileConnection,
  type FileEntry
} from '@common/types/file'
import { fileApi } from '@/api'
import MediaPlayer from '@/components/media/MediaPlayer.vue'
import SensitiveImage from '@/components/SensitiveImage.vue'
import StorageNfoPreview from '../components/StorageNfoPreview.vue'
import { formatEntryTime, formatFileSize } from '../storageUtils'

const props = defineProps<{
  /** 文件所在的连接（主进程会复核预览路径必须落在它的根目录内） */
  connection: FileConnection
  /** 要预览的文件条目 */
  entry: FileEntry
  /** NSFW 保护是否生效（应用总开关 + 该连接的 nsfw 标记） */
  protect: boolean
}>()

const kind = computed(() => filePreviewKindOf(props.entry.mime, props.entry.extname))

/** 播放地址：路径形式，媒体 ID 形式只覆盖已入库的影片 */
const url = computed(() =>
  buildFilePreviewUrl(props.connection.id, props.entry.path, props.entry.modifiedAt)
)

const fallbackText = computed(() =>
  kind.value === 'audio'
    ? '音频读不出来：文件可能已被移动或删除，也可能是编码放不了；可以先用本机播放器打开它。'
    : '视频读不出来：文件可能已被移动或删除，也可能是封装 / 编码放不了；可以先用本机播放器打开它。'
)

/** nfo 原文：只有 nfo 会读，失败把中文原因透传给 StorageNfoPreview */
const nfoText = ref('')
const nfoLoading = ref(false)
const nfoFailure = ref('')

async function loadNfo(): Promise<void> {
  if (kind.value !== 'nfo') return
  nfoLoading.value = true
  const result = await fileApi.readText({
    connectionId: props.connection.id,
    path: props.entry.path
  })
  nfoLoading.value = false
  if (!result.ok) {
    nfoFailure.value = result.message
    return
  }
  nfoText.value = result.data
}

onMounted(loadNfo)
</script>

<template>
  <section class="preview">
    <div class="preview-meta">
      <span>{{ formatFileSize(entry.size) }}</span>
      <span>{{ formatEntryTime(entry.modifiedAt) }}</span>
      <span class="preview-path" :title="entry.path">{{ entry.path }}</span>
    </div>

    <media-player
      v-if="kind === 'video' || kind === 'audio'"
      :url="url"
      :protect="protect"
      :fallback-text="fallbackText"
    />

    <div v-else-if="kind === 'image'" class="preview-image">
      <sensitive-image :src="url" :protect="protect" :alt="entry.name" fit="contain" />
    </div>

    <storage-nfo-preview
      v-else-if="kind === 'nfo'"
      :text="nfoText"
      :loading="nfoLoading"
      :failure="nfoFailure"
    />

    <t-empty v-else description="该类型不支持预览：存储页只预览媒体文件与 nfo" />
  </section>
</template>

<style scoped lang="less">
.preview {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-width: 0;
}

.preview-meta {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
  min-width: 0;
  font-size: 12px;
  color: var(--td-text-color-secondary);
}

.preview-path {
  overflow: hidden;
  color: var(--td-text-color-placeholder);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-image {
  flex: 1;
  min-height: 320px;
}
</style>
