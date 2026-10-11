<script setup lang="ts">
/**
 * 影片详情页的参演演员条：头像 + 名字，点击跳演员详情。
 *
 * 契约：
 * - 数据来自影片详情的 `actors`（主进程已按出演顺序返回），本组件不取数；
 * - 头像走 `SensitiveImage` 但不传 `protect`：演员图片不参与 NSFW 保护，永远直接显示；
 * - 没有头像时用姓名首字占位，绝不显示破图。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import SensitiveImage from '@/components/SensitiveImage.vue'
import type { MediaActorRef } from '@common/types/media'

const props = defineProps<{ actors: MediaActorRef[] }>()

const router = useRouter()

/** 头像缺失时用首字占位，和演员列表卡片保持一致 */
function initialOf(actor: MediaActorRef): string {
  return actor.name.trim().slice(0, 1) || '演'
}

const count = computed(() => props.actors.length)

function open(actorId: string): void {
  // 弱关联只保证名字：极端情况下（名单写进库但演员行被手工删掉）没有 id 可跳
  if (!actorId) return
  void router.push({ name: '演员详情', query: { actorId } })
}
</script>

<template>
  <section class="actor-strip">
    <h4 class="block-title">参演演员（{{ count }}）</h4>
    <div class="actor-row">
      <div
        v-for="actor in actors"
        :key="actor.actorId"
        class="actor-item"
        @click="open(actor.actorId)"
      >
        <sensitive-image
          v-if="actor.avatarUrl"
          class="actor-avatar"
          :src="actor.avatarUrl"
          :width="56"
          :height="56"
          :alt="actor.name"
        />
        <div v-else class="actor-avatar is-empty">{{ initialOf(actor) }}</div>
        <span class="actor-name" :title="actor.name">{{ actor.name }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped lang="less">
.actor-strip {
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

.actor-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.actor-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  width: 72px;
  cursor: pointer;
}

.actor-avatar {
  border-radius: 50%;
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}

.actor-item:hover .actor-avatar {
  box-shadow: var(--td-shadow-2);
  transform: translateY(-2px);
}

.actor-avatar.is-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  font-size: 20px;
  color: var(--td-text-color-placeholder);
  background-color: var(--td-bg-color-container-hover);
}

.actor-name {
  width: 100%;
  overflow: hidden;
  font-size: 12px;
  color: var(--td-text-color-primary);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
