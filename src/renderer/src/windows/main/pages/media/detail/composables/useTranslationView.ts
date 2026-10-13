/**
 * 详情页的「原文 / 译文」开关。
 *
 * 契约：
 * - 译文是派生物：开关只决定**用哪一份字段渲染**，不改数据、不发请求，也没有任何写操作；
 * - 详情换了条目（同一路由换 query）时回到原文，避免把上一部片子的选择带过去；
 * - 有译文才谈得上切：`detail.translation` 为 null 时 `showing` 恒为 false，界面按原文渲染；
 * - 结果由页面喂给 `mediaDetailCells.translatedDetail` 覆盖字段，头部与正文共用同一份视图。
 */
import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { MediaDetailResult } from '@common/types/media'
import { TRANSLATE_LANGUAGE_LABELS } from '@common/types/setting/translateSetting'

export function useTranslationView(detail: Ref<MediaDetailResult | null>) {
  const showTranslation = ref(false)

  watch(
    () => detail.value?.item.itemId,
    () => {
      showTranslation.value = false
    }
  )

  const translation = computed(() => detail.value?.translation ?? null)
  /** 这个条目有没有译文（决定要不要显示切换条） */
  const hasTranslation = computed(() => translation.value !== null)
  /** 最终口径：用户选了译文**且**确实有译文 */
  const showing = computed(() => showTranslation.value && hasTranslation.value)
  /** 译文语言的中文名，如「简体中文」；没有译文时是空串 */
  const languageLabel = computed(() => {
    const language = translation.value?.language
    return language ? TRANSLATE_LANGUAGE_LABELS[language] : ''
  })

  function setShowTranslation(value: boolean): void {
    showTranslation.value = value
  }

  return { showTranslation, hasTranslation, showing, languageLabel, setShowTranslation }
}
