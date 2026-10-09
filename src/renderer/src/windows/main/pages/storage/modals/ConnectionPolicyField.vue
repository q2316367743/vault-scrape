<script setup lang="ts">
/**
 * 存储策略字段：NSFW 标记 + 该存储允许使用的刮削器。
 *
 * 契约：
 * - 刮削器为空数组表示「不限制」，即全部已启用插件都会参与；
 * - 已失效（插件被删/停用/编译失败）的 id 仍然展示，交由用户决定是否移除。
 */
import type { ScraperOption } from '../composables/useScraperOptions'

defineProps<{
  nsfw: boolean
  scrapers: string[]
  options: ScraperOption[]
  loading: boolean
  /** 配置里存在但当前不可用的刮削器 id */
  stale: string[]
}>()

const emit = defineEmits<{
  'update:nsfw': [value: boolean]
  'update:scrapers': [value: string[]]
}>()

function onScrapers(value: unknown): void {
  const list = Array.isArray(value) ? value.map((item) => String(item)) : []
  emit('update:scrapers', list)
}
</script>

<template>
  <div class="policy-field">
    <div class="form-row">
      <span class="form-label">NSFW</span>
      <t-switch :model-value="nsfw" @update:model-value="emit('update:nsfw', $event)" />
      <span class="form-note">标记后，开启「NSFW 保护」时隐藏此数据源的敏感图片</span>
    </div>

    <div class="form-row form-row-top">
      <span class="form-label">刮削器</span>
      <div class="form-control">
        <t-select
          :model-value="scrapers"
          :options="options"
          :loading="loading"
          multiple
          clearable
          placeholder="不选则使用全部已启用插件"
          @update:model-value="onScrapers"
        />
        <p class="form-note">不同存储可能存放不同厂商的内容，这里只勾选覆盖该存储范围的刮削器</p>
        <div v-if="stale.length > 0" class="stale-row">
          <span class="form-note">已失效：</span>
          <t-tag v-for="id in stale" :key="id" size="small" theme="warning" variant="light-outline">
            {{ id }}
          </t-tag>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.form-row-top {
  align-items: flex-start;
}

.form-label {
  width: 76px;
  flex-shrink: 0;
  font-size: 13px;
  line-height: 32px;
  color: var(--td-text-color-secondary);
}

.form-control {
  flex: 1;
  min-width: 0;
}

.form-note {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
}

.stale-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
</style>
