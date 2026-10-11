import { ref } from 'vue'
import { Button, DialogPlugin } from 'tdesign-vue-next'
import type { ActorDetail } from '@common/types/actor'
import type { ModalContentExpose } from '@/utils/modal/ModalContent'
import ActorEditorDialogContent from './ActorEditorDialogContent.vue'

export interface ActorEditorDialogOptions {
  /** 传入表示编辑已有演员，缺省表示新增 */
  actor?: ActorDetail
  /** 保存成功回调，参数是演员 ID */
  onSaved?: (actorId: string) => void
}

/**
 * 新增 / 编辑演员弹窗的外壳。
 *
 * 只负责 DialogPlugin 的生命周期与 footer 按钮，表单与提交都在 ActorEditorDialogContent.vue 里
 * （见 AGENTS.md「弹窗与抽屉」：内容组件不含操作按钮，用 defineExpose 暴露 submit / saving / canSubmit）。
 */
export function openActorEditorDialog(options: ActorEditorDialogOptions = {}): void {
  const contentRef = ref<ModalContentExpose | null>(null)
  const dialog = DialogPlugin({
    header: options.actor ? '编辑演员资料' : '新增演员',
    width: '720px',
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
          保存
        </Button>
      </div>
    ),
    body: () => (
      <ActorEditorDialogContent
        ref={contentRef}
        actor={options.actor}
        onSuccess={(actorId: string) => {
          dialog.hide()
          options.onSaved?.(actorId)
        }}
      />
    )
  })
}
