import { h } from 'vue'
import { DialogPlugin } from 'tdesign-vue-next'
import type { FileConnection } from '@common/types/file'
import type { MediaLibrary } from '@common/types/library'
import LibraryFormContent from './LibraryFormContent.vue'

export interface LibraryFormDialogOptions {
  /** 传入表示编辑已有资料库，缺省表示新建 */
  library?: MediaLibrary
  /** 可选存储列表，由抽屉传入（抽屉自己已经加载过连接） */
  connections: FileConnection[]
  onSaved?: (library: MediaLibrary) => void
}

/**
 * 新建 / 编辑资料库弹窗的外壳。
 *
 * 表单与校验都在 LibraryFormContent.vue 里，两者通过 close / success 事件通信。
 * 资料库根目录与刮削器的最终校验在主进程（`library:save`），这里只做必填提示。
 */
export function openLibraryFormDialog(options: LibraryFormDialogOptions): void {
  const dialog = DialogPlugin({
    header: options.library ? '编辑资料库' : '新建资料库',
    width: '560px',
    placement: 'center',
    footer: false,
    destroyOnClose: true,
    body: () =>
      h(LibraryFormContent, {
        library: options.library,
        connections: options.connections,
        onClose: () => dialog.hide(),
        onSuccess: (library: MediaLibrary) => {
          dialog.hide()
          options.onSaved?.(library)
        }
      })
  })
}
