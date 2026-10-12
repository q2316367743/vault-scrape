/**
 * 手动匹配弹窗外壳（命令式）。
 *
 * 契约：外壳只负责打开弹窗、渲染内容组件与底部按钮；
 * 搜索、选择与「应用」都在 `MediaMatchContent.vue` 里，应用成功后通过 `emit('success')` 回传。
 */
import { ref } from 'vue'
import { Button, DialogPlugin } from 'tdesign-vue-next'
import { MessageUtil } from '@/utils/modal'
import type { ModalContentExpose } from '@/utils/modal/ModalContent'
import type { ScrapeMatchResult } from '@common/types/scrape'
import MediaMatchContent from './MediaMatchContent.vue'

export interface MediaMatchDialogOptions {
  /** 媒体条目 ID（`media_item.id`） */
  itemId: string
  /** 条目所属资料库：可用的刮削器按它的 `scrapers` 取 */
  libraryId: string
  /** 条目是否受 NSFW 保护：决定输入框语义（番号 / TMDB ID 与关键字） */
  nsfwProtected: boolean
  /** 封面是否打码：与详情页同一口径 */
  protect: boolean
  /** 应用成功后的回调：详情页用它重新读取条目 */
  onApplied?: () => void
}

export function openMediaMatchDialog(options: MediaMatchDialogOptions): void {
  const contentRef = ref<ModalContentExpose | null>(null)

  const dialog = DialogPlugin({
    header: '手动匹配元数据',
    width: '760px',
    placement: 'center',
    destroyOnClose: true,
    footer: () => (
      <div class="flex items-center justify-end gap-8px">
        <Button variant="outline" onClick={() => dialog.hide()}>
          取消
        </Button>
        <Button
          theme="primary"
          loading={contentRef.value?.saving}
          disabled={contentRef.value?.canSubmit === false}
          onClick={() => contentRef.value?.submit()}
        >
          使用所选
        </Button>
      </div>
    ),
    body: () => (
      <MediaMatchContent
        ref={contentRef}
        itemId={options.itemId}
        libraryId={options.libraryId}
        nsfwProtected={options.nsfwProtected}
        protect={options.protect}
        onSuccess={(result: ScrapeMatchResult) => {
          dialog.hide()
          if (result.status === 'success') {
            MessageUtil.success(`已使用「${result.title}」的元数据${result.message ? `：${result.message}` : ''}`)
          } else {
            MessageUtil.warning(result.message)
          }
          options.onApplied?.()
        }}
      />
    )
  })
}
