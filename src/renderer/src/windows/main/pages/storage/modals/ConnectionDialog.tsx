import { ref } from 'vue'
import { Button, DialogPlugin } from 'tdesign-vue-next'
import type { FileConnection } from '@common/types/file'
import type { ModalContentExpose } from '@/utils/modal/ModalContent'
import ConnectionDialogContent from './ConnectionDialogContent.vue'

export interface ConnectionDialogOptions {
  /** 传入表示编辑已保存的连接，缺省表示新建 */
  connection?: FileConnection
  /** 保存成功回调，参数是落盘后的连接 */
  onSaved?: (connection: FileConnection) => void
}

/** 内容组件在通用契约之外还暴露了「测试连接」，footer 左侧按钮要用 */
interface ConnectionDialogExpose extends ModalContentExpose {
  test: () => void
  testing?: boolean
}

/**
 * 新建 / 编辑数据源弹窗的外壳。
 *
 * 只负责 DialogPlugin 的生命周期与 footer 按钮，表单与校验都在 ConnectionDialogContent.vue 里；
 * 「测试连接」和「保存」两个动作分别由内容组件经 defineExpose 暴露（见 ModalContentExpose）。
 * 编辑态下连接 id 与不可变字段在主进程侧校验，这里不做。
 */
export function openConnectionDialog(options: ConnectionDialogOptions = {}): void {
  const contentRef = ref<ConnectionDialogExpose | null>(null)
  const dialog = DialogPlugin({
    header: options.connection ? '编辑数据源' : '新建数据源',
    width: '560px',
    placement: 'center',
    destroyOnClose: true,
    footer: () => (
      <div class="flex items-center justify-between">
        <Button
          variant="outline"
          loading={contentRef.value?.testing}
          onClick={() => contentRef.value?.test()}
        >
          测试连接
        </Button>
        <div class="flex items-center gap-8px">
          <Button variant="outline" onClick={() => dialog.hide()}>
            取消
          </Button>
          <Button
            theme="primary"
            loading={contentRef.value?.saving}
            onClick={() => contentRef.value?.submit()}
          >
            保存
          </Button>
        </div>
      </div>
    ),
    body: () => (
      <ConnectionDialogContent
        ref={contentRef}
        connection={options.connection}
        onSuccess={(connection: FileConnection) => {
          dialog.hide()
          options.onSaved?.(connection)
        }}
      />
    )
  })
}
