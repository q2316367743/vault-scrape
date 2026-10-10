import { ref } from 'vue'
import { Button, DialogPlugin } from 'tdesign-vue-next'
import type { ModalContentExpose } from '@/utils/modal/ModalContent'
import PathDialogContent from './PathDialogContent.vue'

export interface PathDialogOptions {
  title: string
  /** 输入框左侧的字段名 */
  label: string
  defaultValue?: string
  placeholder?: string
  /** 输入框下方的说明，例如远端路径以连接根为起点 */
  hint?: string
  confirmText?: string
  /** 是否提供「目标已存在时覆盖」开关（上传 / 下载 / 复制 / 移动都需要） */
  withOverwrite?: boolean
  onConfirm: (path: string, overwrite: boolean) => void
}

/**
 * 单路径输入弹窗的外壳（上传、下载、复制到、移动到共用）。
 *
 * 只负责 DialogPlugin 的生命周期与 footer 按钮，输入与校验在 PathDialogContent.vue 里；
 * 确认按钮的禁用态（路径为空）由内容组件经 defineExpose 暴露（见 ModalContentExpose）。
 * 路径是否存在、能否写入由具体操作的主进程逻辑判定，这里只管非空。
 */
export function openPathDialog(options: PathDialogOptions): void {
  const contentRef = ref<ModalContentExpose | null>(null)
  const dialog = DialogPlugin({
    header: options.title,
    width: '560px',
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
      <PathDialogContent
        ref={contentRef}
        label={options.label}
        defaultValue={options.defaultValue}
        placeholder={options.placeholder}
        hint={options.hint}
        withOverwrite={options.withOverwrite}
        onSuccess={(path: string, overwrite: boolean) => {
          dialog.hide()
          options.onConfirm(path, overwrite)
        }}
      />
    )
  })
}
