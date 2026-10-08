import { h } from 'vue'
import { DialogPlugin } from 'tdesign-vue-next'
import type { FileConnection } from '@common/types/file'
import ConnectionDialogContent from './ConnectionDialogContent.vue'

export interface ConnectionDialogOptions {
  /** 传入表示编辑已保存的连接，缺省表示新建 */
  connection?: FileConnection
  /** 保存成功回调，参数是落盘后的连接 */
  onSaved?: (connection: FileConnection) => void
}

/**
 * 新建 / 编辑数据源弹窗的外壳。
 *
 * 只负责 DialogPlugin 的生命周期，表单与校验都在 ConnectionDialogContent.vue 里，
 * 两者通过 close / success 事件通信（禁止在 tsx 里写弹窗内容）。
 */
export function openConnectionDialog(options: ConnectionDialogOptions = {}): void {
  const dialog = DialogPlugin({
    header: options.connection ? '编辑数据源' : '新建数据源',
    width: '560px',
    placement: 'center',
    footer: false,
    destroyOnClose: true,
    body: () =>
      h(ConnectionDialogContent, {
        connection: options.connection,
        onClose: () => dialog.hide(),
        onSuccess: (connection: FileConnection) => {
          dialog.hide()
          options.onSaved?.(connection)
        }
      })
  })
}
