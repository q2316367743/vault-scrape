import { ref } from 'vue'
import { Button, DialogPlugin } from 'tdesign-vue-next'
import { MessageUtil } from '@/utils/modal'
import type { ModalContentExpose } from '@/utils/modal/ModalContent'
import type { ActorScrapeResult } from '@common/types/actor'
import ActorScrapeDialogContent from './ActorScrapeDialogContent.vue'

export interface ActorScrapeDialogOptions {
  /** 演员 ID（`actor.actor_id`） */
  actorId: string
  /** 演员姓名，仅用于弹窗内提示文案 */
  actorName: string
  /** 抓取流程结束（成功或用户放弃）后的回调，详情页拿它重新取数 */
  onDone?: () => void
}

/**
 * 打开「抓取演员资料」弹窗：手动选一个演员信息插件跑一次抓取。
 *
 * 与 `useMediaMatchSearch` 之类的自动流程不同，这里永远只跑用户选中的那一个插件；
 * 空的 `pluginIds` 会被主进程理解成「全部启用的插件」，所以选中项由内容组件保证非空。
 */
export function openActorScrapeDialog(options: ActorScrapeDialogOptions): void {
  const contentRef = ref<ModalContentExpose | null>(null)

  const onSuccess = (result: ActorScrapeResult): void => {
    dialog.hide()
    MessageUtil.info(result.message)
    options.onDone?.()
  }

  const dialog = DialogPlugin({
    header: '抓取演员资料',
    width: '520px',
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
          开始抓取
        </Button>
      </div>
    ),
    body: () => (
      <ActorScrapeDialogContent
        ref={contentRef}
        actorId={options.actorId}
        actorName={options.actorName}
        onSuccess={onSuccess}
      />
    )
  })
}
