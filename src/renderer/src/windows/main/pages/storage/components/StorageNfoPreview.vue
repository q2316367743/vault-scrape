<script setup lang="ts">
/**
 * nfo 预览：结构化字段 + 原始 XML 两个视图。
 *
 * 契约：只渲染传进来的文本，自己不取数。
 * - 字段标签与影视墙详情页 `nfoCells` 保持同一套口径，但空字段直接不渲染（详情页是占位 `—`）；
 * - `parseNfoXml` 认不出 `<movie>` 结构时返回 null，不报错，提示可切到原始 XML。
 */
import { computed, ref } from 'vue'
import { parseNfoXml, type MediaNfoMeta } from '@common/types/media'

interface NfoField {
  label: string
  value: string
  /** 占满整行（长文本、多值字段） */
  wide: boolean
}

const props = withDefaults(
  defineProps<{
    /** nfo 原文 */
    text: string
    /** 原文读取中 */
    loading?: boolean
    /** 原文读取失败原因 */
    failure?: string
  }>(),
  { loading: false, failure: '' }
)

/** t-tabs 的 value 是 string | number，这里不收窄，省掉模板里的类型摩擦 */
const mode = ref<string>('meta')

const meta = computed<MediaNfoMeta | null>(() => (props.text.length > 0 ? parseNfoXml(props.text) : null))
const plot = computed(() => meta.value?.plot ?? '')

const fields = computed<NfoField[]>(() => {
  const data = meta.value
  if (!data) return []
  const rows: NfoField[] = []
  const push = (label: string, value: string, wide = false): void => {
    if (value.length > 0) rows.push({ label, value, wide })
  }
  push('标题', data.title, true)
  push('番号', data.num)
  push('原名', data.originalTitle)
  push('发行日期', data.releaseDate)
  if (data.duration > 0) push('时长', `${data.duration} 分钟`)
  push('片商', data.maker)
  push('厂牌', data.label)
  // 详情页不展示 studio（常与片商重复），只在确实不同的时候单独列出来
  if (data.studio.length > 0 && data.studio !== data.maker) push('制作', data.studio)
  push('系列', data.series)
  push('导演', data.director)
  push('演员', data.actors.join('、'), true)
  push('标签', data.tags.join('、'), true)
  return rows
})
</script>

<template>
  <section class="nfo-preview">
    <div v-if="loading" class="nfo-hint">正在读取 nfo…</div>

    <t-alert v-else-if="failure" theme="error" title="nfo 读取失败" :message="failure" />

    <t-tabs v-else v-model="mode">
      <t-tab-panel value="meta" label="解析字段">
        <div class="nfo-panel">
          <t-alert
            v-if="!meta"
            theme="warning"
            message="这份文件没有解析出影片字段（不是标准的 movie nfo），可以切到「原始 XML」查看原文。"
          />
          <p v-else-if="fields.length === 0" class="nfo-hint">没有解析出可展示的字段。</p>

          <dl v-if="fields.length > 0" class="fact-grid">
            <div
              v-for="field in fields"
              :key="field.label"
              class="fact-cell"
              :class="{ 'is-wide': field.wide }"
            >
              <dt>{{ field.label }}</dt>
              <dd>{{ field.value }}</dd>
            </div>
          </dl>

          <div v-if="plot.length > 0" class="nfo-plot">
            <div class="nfo-plot-title">剧情</div>
            <t-textarea :value="plot" :autosize="{ minRows: 6, maxRows: 20 }" readonly />
          </div>
        </div>
      </t-tab-panel>

      <t-tab-panel value="raw" label="原始 XML">
        <div class="nfo-panel">
          <p v-if="text.length === 0" class="nfo-hint">文件是空的。</p>
          <t-textarea
            v-else
            :value="text"
            :autosize="{ minRows: 12, maxRows: 30 }"
            readonly
          />
        </div>
      </t-tab-panel>
    </t-tabs>
  </section>
</template>

<style scoped lang="less">
.nfo-preview {
  min-width: 0;
}

.nfo-panel {
  min-width: 0;
  padding-top: 8px;
}

.nfo-hint {
  margin: 0;
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.fact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  margin: 0;
}

.fact-cell {
  min-width: 0;
}

.fact-cell.is-wide {
  grid-column: 1 / -1;
}

.fact-cell dt {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.fact-cell dd {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--td-text-color-primary);
  word-break: break-word;
}

.nfo-plot {
  margin-top: 16px;
}

.nfo-plot-title {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
</style>
