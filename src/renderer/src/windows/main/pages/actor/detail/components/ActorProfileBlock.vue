<script setup lang="ts">
/**
 * 演员资料块：头像 + 11 项用户设定数据的只读展示。
 *
 * 契约：
 * - 纯展示，不取数、不改数据，编辑入口在页面 `#extra`；
 * - 头像走 `SensitiveImage` 但不传 `protect`：演员图片不参与 NSFW 保护，永远直接显示；
 * - 空字段统一显示「未填写」，不隐藏行，方便一眼看出还缺什么。
 */
import { computed } from 'vue'
import SensitiveImage from '@/components/SensitiveImage.vue'
import { formatTime } from '@/utils/format'
import {
  actorBirthplaceText,
  actorGenderLabel,
  actorHeightText,
  actorMeasurementsText,
  type ActorDetail
} from '@common/types/actor'

const props = defineProps<{ actor: ActorDetail }>()

const EMPTY = '未填写'

interface ProfileCell {
  label: string
  value: string
}

const cells = computed<ProfileCell[]>(() => {
  const actor = props.actor
  return [
    { label: '性别', value: actor.gender ? actorGenderLabel(actor.gender) : EMPTY },
    { label: '生日', value: actor.birthday || EMPTY },
    { label: '出生地', value: actorBirthplaceText(actor) || EMPTY },
    { label: '身高', value: actorHeightText(actor.height) || EMPTY },
    { label: '三围', value: actorMeasurementsText(actor) || EMPTY },
    { label: '罩杯', value: actor.cup || EMPTY },
    { label: '来源链接', value: actor.sourceUrl || EMPTY },
    { label: '收录时间', value: actor.scrapedAt > 0 ? formatTime(actor.scrapedAt) : '未刮削' },
    { label: '刮削插件', value: actor.scraperId || '—' },
    { label: '资料锁定', value: actor.locked ? '已锁定（刮削只补空白）' : '未锁定' }
  ]
})

const initial = computed(() => props.actor.name.trim().slice(0, 1) || '演')
</script>

<template>
  <section class="profile-block">
    <sensitive-image
      v-if="actor.avatarUrl"
      class="profile-avatar"
      :src="actor.avatarUrl"
      :width="160"
      :height="160"
      :alt="actor.name"
    />
    <div v-else class="profile-avatar is-empty">{{ initial }}</div>

    <div class="profile-body">
      <h3 class="profile-name">{{ actor.name }}</h3>
      <p v-if="actor.tagline" class="profile-tagline">{{ actor.tagline }}</p>

      <dl class="profile-cells">
        <div v-for="cell in cells" :key="cell.label" class="profile-cell">
          <dt>{{ cell.label }}</dt>
          <dd>{{ cell.value }}</dd>
        </div>
      </dl>

      <div v-if="actor.aliases.length > 0" class="profile-line">
        <span class="profile-line-label">别名</span>
        <t-tag v-for="alias in actor.aliases" :key="alias" size="small" variant="light">
          {{ alias }}
        </t-tag>
      </div>

      <div v-if="actor.tags.length > 0" class="profile-line">
        <span class="profile-line-label">我的标签</span>
        <t-tag v-for="tag in actor.tags" :key="tag" size="small" theme="primary" variant="light">
          {{ tag }}
        </t-tag>
      </div>

      <p v-if="actor.overview" class="profile-overview">{{ actor.overview }}</p>
      <p v-else class="profile-overview is-empty">还没有简介。</p>
    </div>
  </section>
</template>

<style scoped lang="less">
.profile-block {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  padding: 16px;
  background-color: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.profile-avatar {
  flex-shrink: 0;
}

.profile-avatar.is-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 160px;
  height: 160px;
  font-size: 48px;
  color: var(--td-text-color-placeholder);
  background-color: var(--td-bg-color-container-hover);
  border-radius: var(--td-radius-medium);
}

.profile-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.profile-name {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.profile-tagline {
  margin: 0;
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.profile-cells {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px 16px;
  margin: 0;
}

.profile-cell {
  min-width: 0;
}

.profile-cell dt {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.profile-cell dd {
  margin: 2px 0 0;
  overflow: hidden;
  font-size: 13px;
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  word-break: break-all;
}

.profile-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.profile-line-label {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.profile-overview {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--td-text-color-primary);
  white-space: pre-wrap;
}

.profile-overview.is-empty {
  color: var(--td-text-color-placeholder);
}
</style>
