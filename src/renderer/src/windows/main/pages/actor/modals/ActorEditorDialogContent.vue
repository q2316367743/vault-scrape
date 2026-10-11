<script setup lang="ts">
/**
 * 演员编辑弹窗的内容：用户设定数据表单。
 *
 * 契约（见 AGENTS.md「弹窗与抽屉」）：
 * - 本组件不含任何操作按钮，取消 / 保存由外壳 `ActorEditorDialog.tsx` 的 footer 提供；
 * - 通过 `defineExpose` 暴露 `submit` / `saving` / `canSubmit`（ModalContentExpose）；
 * - 只提交用户能改的字段；头像与图集在详情页单独管理，不在这里出现；
 * - 保存成功后 `emit('success', actorId)`，由外壳关窗并通知调用方刷新。
 */
import { computed, reactive, ref } from 'vue'
import { MessageUtil } from '@/utils/modal'
import { actorApi } from '@/api'
import {
  ACTOR_GENDERS,
  ACTOR_GENDER_LABELS,
  type ActorDetail,
  type ActorGender,
  type ActorSaveRequest
} from '@common/types/actor'

const props = defineProps<{
  /** 传入表示编辑，缺省表示新增 */
  actor?: ActorDetail
}>()

const emit = defineEmits<{
  success: [actorId: string]
  close: []
}>()

const saving = ref(false)
const name = ref(props.actor?.name ?? '')
const aliases = ref<string[]>([...(props.actor?.aliases ?? [])])
const tags = ref<string[]>([...(props.actor?.tags ?? [])])

const form = reactive({
  gender: (props.actor?.gender ?? '') as ActorGender,
  birthday: props.actor?.birthday ?? '',
  birthCountry: props.actor?.birthCountry ?? '',
  birthProvince: props.actor?.birthProvince ?? '',
  birthCity: props.actor?.birthCity ?? '',
  birthCounty: props.actor?.birthCounty ?? '',
  height: props.actor?.height ?? 0,
  bust: props.actor?.bust ?? 0,
  waist: props.actor?.waist ?? 0,
  hip: props.actor?.hip ?? 0,
  cup: props.actor?.cup ?? '',
  tagline: props.actor?.tagline ?? '',
  sourceUrl: props.actor?.sourceUrl ?? '',
  overview: props.actor?.overview ?? '',
  locked: props.actor?.locked ?? false
})

const GENDER_OPTIONS = ACTOR_GENDERS.map((value) => ({
  value,
  label: ACTOR_GENDER_LABELS[value]
}))

const canSubmit = computed(() => name.value.trim().length > 0)

function requestOf(): ActorSaveRequest {
  return {
    actorId: props.actor?.actorId ?? '',
    name: name.value.trim(),
    aliases: aliases.value,
    gender: form.gender,
    birthday: form.birthday.trim(),
    birthCountry: form.birthCountry.trim(),
    birthProvince: form.birthProvince.trim(),
    birthCity: form.birthCity.trim(),
    birthCounty: form.birthCounty.trim(),
    height: Number(form.height) || 0,
    bust: Number(form.bust) || 0,
    waist: Number(form.waist) || 0,
    hip: Number(form.hip) || 0,
    cup: form.cup.trim(),
    tagline: form.tagline.trim(),
    sourceUrl: form.sourceUrl.trim(),
    overview: form.overview,
    tags: tags.value,
    locked: form.locked
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) {
    MessageUtil.warning('请填写演员姓名')
    return
  }
  saving.value = true
  const result = await actorApi.save(requestOf())
  saving.value = false
  if (!result.ok) {
    MessageUtil.error(result.message)
    return
  }
  MessageUtil.success(props.actor ? '已保存演员资料' : '已新增演员')
  emit('success', result.data.actorId)
}

defineExpose({ submit, saving, canSubmit })
</script>

<template>
  <t-form class="actor-form" label-align="top" :data="form">
    <div class="form-row">
      <t-form-item label="姓名" required>
        <t-input v-model="name" clearable placeholder="必填，与其它演员重名会提示冲突" />
      </t-form-item>
      <t-form-item label="性别">
        <t-select v-model="form.gender" :options="GENDER_OPTIONS" placeholder="未设置" />
      </t-form-item>
    </div>

    <t-form-item label="别名">
      <t-tag-input v-model="aliases" clearable placeholder="回车添加别名，可以多个" />
    </t-form-item>

    <div class="form-row">
      <t-form-item label="生日">
        <t-date-picker v-model="form.birthday" clearable placeholder="出生日期" />
      </t-form-item>
      <t-form-item label="出生地 · 国家">
        <t-input v-model="form.birthCountry" clearable placeholder="如 日本" />
      </t-form-item>
    </div>

    <div class="form-row">
      <t-form-item label="出生地 · 省 / 州">
        <t-input v-model="form.birthProvince" clearable placeholder="如 东京都" />
      </t-form-item>
      <t-form-item label="出生地 · 市">
        <t-input v-model="form.birthCity" clearable placeholder="如 东京市" />
      </t-form-item>
    </div>

    <div class="form-row">
      <t-form-item label="出生地 · 区 / 县">
        <t-input v-model="form.birthCounty" clearable placeholder="如 涩谷区" />
      </t-form-item>
      <t-form-item label="罩杯">
        <t-input v-model="form.cup" clearable placeholder="如 D" />
      </t-form-item>
    </div>

    <div class="form-row form-row-four">
      <t-form-item label="身高（cm）">
        <t-input-number v-model="form.height" :min="0" :max="260" theme="normal" />
      </t-form-item>
      <t-form-item label="胸围（cm）">
        <t-input-number v-model="form.bust" :min="0" :max="200" theme="normal" />
      </t-form-item>
      <t-form-item label="腰围（cm）">
        <t-input-number v-model="form.waist" :min="0" :max="200" theme="normal" />
      </t-form-item>
      <t-form-item label="臀围（cm）">
        <t-input-number v-model="form.hip" :min="0" :max="200" theme="normal" />
      </t-form-item>
    </div>

    <t-form-item label="标语">
      <t-input v-model="form.tagline" clearable placeholder="一句话印象" />
    </t-form-item>

    <t-form-item label="来源链接">
      <t-input v-model="form.sourceUrl" clearable placeholder="资料页地址" />
    </t-form-item>

    <t-form-item label="简介">
      <t-textarea v-model="form.overview" :autosize="{ minRows: 4, maxRows: 10 }" />
    </t-form-item>

    <t-form-item label="用户标签">
      <t-tag-input v-model="tags" clearable placeholder="回车添加标签，仅自己可见" />
    </t-form-item>

    <t-form-item label="锁定资料">
      <t-space direction="vertical" size="4px">
        <t-switch v-model="form.locked" />
        <span class="form-hint">锁定后刮削只补空白字段，不会覆盖你填好的内容</span>
      </t-space>
    </t-form-item>
  </t-form>
</template>

<style scoped lang="less">
.actor-form {
  // 弹窗内容用网格排两列 / 四列，窄字段不各自占满整行
  display: flex;
  flex-direction: column;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.form-row-four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.form-hint {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
</style>
