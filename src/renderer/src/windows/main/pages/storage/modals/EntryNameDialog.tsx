import { ref } from 'vue'
import { Button, DialogPlugin } from 'tdesign-vue-next'
import type { ModalContentExpose } from '@/utils/modal/ModalContent'
import EntryNameDialogContent from './EntryNameDialogContent.vue'

export interface EntryNameDialogOptions {
  title: string
  /** 输入框左侧的字段名 */
  label: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  onConfirm: (name: string) => void
}

/**
 * 单名称输入弹窗的外壳（新建文件夹 / 新建文件 / 重命名共用）。
 *
 * 只负责 DialogPlugin 的生命周期与 footer 按钮，输入与校验在 EntryNameDialogContent.vue 里；
 * 确认按钮的禁用态（名称为空）由内容组件经 defineExpose 暴露（见 ModalContentExpose）。
 * 名称的合法性与是否重名由主进程最终判定，这里只管非空。
 */
export function openEntryNameDialog(options: EntryNameDialogOptions): void {
  const contentRef = ref<ModalContentExpose | null>(null)
  const dialog = DialogPlugin({
    header: options.title,
    width: '440px',
    placement: 'center',
    destroyOnClose: true,
    footer: () => (
      <div class="flex items-center justify-end gap-8px">
        <Button variant="outline" onClick={() => dialog.hide()}>
          取消
        </Button>
        <Button
          theme="primary"
          disabled={contentRef.value?.canSubmit === false}
          onClick={() => contentRef.value?.submit()}
        >
          {options.confirmText ?? '确定'}
        </Button>
      </div>
    ),
    body: () => (
      <EntryNameDialogContent
        ref={contentRef}
        label={options.label}
        defaultValue={options.defaultValue}
        placeholder={options.placeholder}
        onSuccess={(name: string) => {
          dialog.hide()
          options.onConfirm(name)
        }}
      />
    )
  })
}
