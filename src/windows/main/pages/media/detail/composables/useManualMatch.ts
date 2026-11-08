/**
 * 手动匹配入口：把详情页当前条目交给「手动匹配」弹窗。
 *
 * 为什么单独一个组合式：详情页已经贴着单文件 300 行上限（RL-05），这段只做
 * 「读当前条目 → 开窗 → 拿 taskId 跳进度页」的胶水，留在页面里只会挤占布局代码。
 *
 * 契约：
 * - 弹窗没读到详情（`detail` 为空）时直接不做事；
 * - 只负责开窗，搜索、候选、建任务都在弹窗内部（`../modals/MediaMatchDialog.tsx`）；
 * - 应用是「建一条刮削任务并立即返回」，所以这里**不等结果、也不重读详情**：
 *   拿到 `taskId` 后直接跳 `/overview/scrape?taskId=…`，进度与最终产物都在那个页面看。
 */
import type { Ref } from 'vue'
import type { MediaDetailResult } from '@common/types/media'
import { openMediaMatchDialog } from '../modals/MediaMatchDialog'

export function useManualMatch(
  detail: Ref<MediaDetailResult | null>,
  protect: Ref<boolean>
): { open: () => void } {
  const router = useRouter()

  function open(): void {
    const item = detail.value?.item
    if (!item) return
    openMediaMatchDialog({
      itemId: item.itemId,
      libraryId: item.libraryId,
      nsfwProtected: item.nsfwProtected,
      protect: protect.value,
      onApplied: (taskId) => void router.push({ path: '/overview/scrape', query: { taskId } })
    })
  }

  return { open }
}
