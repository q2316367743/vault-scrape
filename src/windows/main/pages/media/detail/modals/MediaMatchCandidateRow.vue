<template>
  <t-list-item class="match-item" :class="{ 'is-selected': selected }">
    <div class="match-row" @click="emit('select')">
      <sensitive-image
        v-if="row.candidate.cover"
        class="match-cover"
        :src="row.candidate.cover"
        :protect="protect"
        :width="72"
        :height="100"
        alt="候选封面"
      />
      <div v-else class="match-cover match-cover-empty">无封面</div>
      <div class="match-info">
        <t-tooltip :content="row.candidate.title || row.candidate.id" placement="top-left">
          <div class="match-title">{{ row.candidate.title || row.candidate.id }}</div>
        </t-tooltip>
        <div class="match-meta">
          <t-tag size="small" theme="primary" variant="light-outline">
            {{ row.candidate.num || row.candidate.id }}
          </t-tag>
          <t-tag v-if="row.candidate.date" size="small" theme="warning" variant="light-outline">
            {{ row.candidate.date }}
          </t-tag>
          <t-tag v-if="row.candidate.isSeries" size="small" theme="danger" variant="light-outline">
            {{ row.candidate.episodeCount ? `${row.candidate.episodeCount} 集` : '剧集' }}
          </t-tag>
          <t-tag
            v-for="actor in visibleActors"
            :key="actor"
            size="small"
            theme="success"
            variant="light-outline"
          >
            {{ actor }}
          </t-tag>
          <t-tooltip
            v-if="hiddenActors > 0"
            :content="(row.candidate.actors ?? []).join('、')"
            placement="top-left"
          >
            <t-tag size="small" variant="light-outline">+{{ hiddenActors }}</t-tag>
          </t-tooltip>
        </div>
        <span class="match-plugin">{{ row.pluginName }}</span>
      </div>
    </div>
    <template #action>
      <t-button
        size="small"
        :theme="selected ? 'primary' : 'default'"
        :variant="selected ? 'base' : 'outline'"
        :disabled="disabled"
        @click.stop="emit('select')"
      >
        {{ selected ? '已选择' : '选择' }}
      </t-button>
    </template>
  </t-list-item>
</template>
<script setup lang="ts">
/**
 * 手动匹配弹窗里的一行候选：封面 + 元数据标签 + 选择按钮。
 *
 * 契约：纯展示 + 上报选择，不含任何请求；选中态由父组件（内容组件）持有，避免各组件各存一份。
 */
import { computed } from 'vue'
import SensitiveImage from '@/components/SensitiveImage.vue'
import type { MatchCandidate } from '../composables/useMediaMatchSearch'

/** 每行最多直接显示几个演员标签，多出来的折成 +N */
const ACTOR_TAG_LIMIT = 3

const props = defineProps<{
  row: MatchCandidate
  /** 是否是当前选中的那一行 */
  selected: boolean
  /** 封面是否打码：与详情页同一口径 */
  protect: boolean
  /** 应用进行中：禁止改选 */
  disabled: boolean
}>()

const emit = defineEmits<{ select: [] }>()

const visibleActors = computed(() => (props.row.candidate.actors ?? []).slice(0, ACTOR_TAG_LIMIT))
const hiddenActors = computed(() =>
  Math.max(0, (props.row.candidate.actors?.length ?? 0) - ACTOR_TAG_LIMIT)
)
</script>
<style scoped>
.match-item {
  padding-right: 12px;
}

.match-item.is-selected {
  background-color: var(--td-brand-color-light);
}

.match-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  cursor: pointer;
}

.match-cover {
  flex-shrink: 0;
  border-radius: var(--td-radius-default);
  overflow: hidden;
}

.match-cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 100px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  background-color: var(--td-bg-color-secondarycontainer);
}

.match-info {
  flex: 1;
  min-width: 0;
}

.match-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--td-text-color-primary);
}

.match-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  min-width: 0;
}

.match-plugin {
  display: inline-block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
</style>
