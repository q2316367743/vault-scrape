import { h } from 'vue'
import { DialogPlugin } from 'tdesign-vue-next'
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
 * 只负责 DialogPlugin 的生命周期，输入与校验在 EntryNameDialogContent.vue 里。
 */
export function openEntryNameDialog(options: EntryNameDialogOptions): void {
  const dialog = DialogPlugin({
    header: options.title,
    width: '440px',
    placement: 'center',
    footer: false,
    destroyOnClose: true,
    body: () =>
      h(EntryNameDialogContent, {
        label: options.label,
        defaultValue: options.defaultValue ?? '',
        placeholder: options.placeholder ?? '',
        confirmText: options.confirmText ?? '确定',
        onClose: () => dialog.hide(),
        onSuccess: (name: string) => {
          dialog.hide()
          options.onConfirm(name)
        }
      })
  })
}
