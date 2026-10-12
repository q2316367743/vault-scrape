/**
 * 手动匹配入口：把详情页当前条目交给「手动匹配」弹窗。
 *
 * 为什么单独一个组合式：详情页已经贴着单文件 300 行上限（RL-05），这段只做
 * 「读当前条目 → 开窗 → 应用成功后重读详情」的胶水，留在页面里只会挤占布局代码。
 *
 * 契约：
 * - 弹窗没读到详情（`detail` 为空）时直接不做事；
 * - 只负责开窗，搜索、候选、应用都在弹窗内部（`../modals/MediaMatchDialog.tsx`）；
 * - `reload` 由页面传入（`load()`），应用成功后重读详情，保证页面立刻看到新元数据。
 */
import type { Ref } from 'vue'
import type { MediaDetailResult } from '@common/types/media'
import { openMediaMatchDialog } from '../modals/MediaMatchDialog'

export function useManualMatch(
  detail: Ref<MediaDetailResult | null>,
  protect: Ref<boolean>,
  reload: () => void
): { open: () => void } {
  function open(): void {
    const item = detail.value?.item
    if (!item) return
    openMediaMatchDialog({
      itemId: item.itemId,
      libraryId: item.libraryId,
      nsfwProtected: item.nsfwProtected,
      protect: protect.value,
      onApplied: reload
    })
  }

  return { open }
}
