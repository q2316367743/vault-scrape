<script setup lang="ts">
/**
 * 存储策略字段：NSFW 标记。
 *
 * 契约：刮削器不再属于存储（Jellyfin 口径），改由资料库自己配置，见 LibraryFormContent。
 */

defineProps<{
  nsfw: boolean
}>()

const emit = defineEmits<{
  'update:nsfw': [value: boolean]
}>()
</script>

<template>
  <div class="policy-field">
    <div class="form-row">
      <span class="form-label">NSFW</span>
      <t-switch :model-value="nsfw" @update:model-value="emit('update:nsfw', $event)" />
      <span class="form-note">标记后，开启「NSFW 保护」时隐藏此数据源的敏感图片</span>
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

.form-label {
  width: 76px;
  flex-shrink: 0;
  font-size: 13px;
  line-height: 32px;
  color: var(--td-text-color-secondary);
}

.form-note {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
}
</style>
