/**
 * 手动匹配弹窗外壳（命令式）。
 *
 * 契约：外壳只负责打开弹窗、渲染内容组件与底部按钮；
 * 搜索与选择在 `MediaMatchContent.vue` 里，点「使用所选」只**建一条刮削任务并立即返回 taskId**
 * （刮削是分钟级的，不能把弹窗卡在转圈上），成功回传后关窗、提示并跳进度详情页。
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
  /** 任务建好后的回调：详情页拿 `taskId` 跳刮削进度详情页 */
  onApplied?: (taskId: string) => void
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
          MessageUtil.success('已开始刮削，可在进度页查看进度')
          options.onApplied?.(result.taskId)
        }}
      />
    )
  })
}
