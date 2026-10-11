<script setup lang="ts">
/**
 * 演员卡片：头像 + 名字（外加性别、作品数与标签的轻量提示）。
 *
 * 契约：
 * - 只消费 `ActorSummary`，不取数、不路由；点击只 `emit('select')`，由页面决定跳哪个详情页；
 * - 头像走 `SensitiveImage`：演员图片没有存储上下文，保护与否只看应用总开关；
 * - 没有头像时显示姓名首字占位，不请求、不报错。
 */
import { computed } from 'vue'
import SensitiveImage from '@/components/SensitiveImage.vue'
import { useNsfwProtection } from '@/hooks/UseNsfwProtection'
import { actorGenderLabel, type ActorSummary } from '@common/types/actor'

const props = defineProps<{ actor: ActorSummary }>()
const emit = defineEmits<{ select: [actorId: string] }>()

const { protection } = useNsfwProtection()

const initial = computed(() => props.actor.name.trim().slice(0, 1) || '演')
const genderText = computed(() => (props.actor.gender ? actorGenderLabel(props.actor.gender) : ''))
const meta = computed(() =>
  [genderText.value, `${props.actor.filmCount} 部作品`].filter((item) => item.length > 0).join(' · ')
)
const visibleTags = computed(() => props.actor.tags.slice(0, 3))
const restTagCount = computed(() => Math.max(0, props.actor.tags.length - visibleTags.value.length))
</script>

<template>
  <article class="actor-card" @click="emit('select', actor.actorId)">
    <sensitive-image
      v-if="actor.avatarUrl"
      class="actor-avatar"
      :src="actor.avatarUrl"
      :protect="protection"
      :width="96"
      :height="96"
      :alt="actor.name"
    />
    <div v-else class="actor-avatar is-empty">{{ initial }}</div>

    <div class="actor-name">{{ actor.name }}</div>
    <div class="actor-meta">{{ meta }}</div>

    <div v-if="visibleTags.length > 0" class="actor-tags">
      <t-tag v-for="item in visibleTags" :key="item" size="small" variant="light">{{ item }}</t-tag>
      <span v-if="restTagCount > 0" class="actor-tags-rest">+{{ restTagCount }}</span>
    </div>
  </article>
</template>

<style scoped lang="less">
.actor-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  text-align: center;
  cursor: pointer;
  background-color: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  transition: box-shadow 0.2s ease;

  &:hover {
    box-shadow: var(--td-shadow-2);
  }
}

.actor-avatar {
  border-radius: 50%;
}

.actor-avatar.is-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 96px;
  height: 96px;
  font-size: 32px;
  color: var(--td-text-color-placeholder);
  background-color: var(--td-bg-color-container-hover);
}

.actor-name {
  margin-top: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.actor-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--td-text-color-secondary);
}

.actor-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: center;
  margin-top: 6px;
}

.actor-tags-rest {
  font-size: 12px;
  line-height: 20px;
  color: var(--td-text-color-placeholder);
}
</style>
