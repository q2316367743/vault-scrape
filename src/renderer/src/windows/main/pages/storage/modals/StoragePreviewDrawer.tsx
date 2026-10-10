import { DrawerPlugin } from 'tdesign-vue-next'
import type { FileConnection, FileEntry } from '@common/types/file'
import StoragePreviewContent from './StoragePreviewContent.vue'

export interface StoragePreviewDrawerOptions {
  /** 文件所在的连接（主进程会复核预览路径必须落在它的根目录内） */
  connection: FileConnection
  /** 要预览的文件条目 */
  entry: FileEntry
  /** NSFW 保护是否生效（应用总开关 + 该连接的 nsfw 标记），在打开时定格 */
  protect: boolean
}

/**
 * 存储页预览抽屉的外壳。
 *
 * 只负责 DrawerPlugin 的生命周期，预览内容全在 StoragePreviewContent.vue 里
 * （禁止在 tsx 里写内容）。抽屉是只读的，没有任何弹窗级按钮，因此 `footer: false`。
 */
export function openStoragePreviewDrawer(options: StoragePreviewDrawerOptions): void {
  DrawerPlugin({
    header: options.entry.name,
    size: '860px',
    footer: false,
    destroyOnClose: true,
    body: () => (
      <StoragePreviewContent
        connection={options.connection}
        entry={options.entry}
        protect={options.protect}
      />
    )
  })
}
