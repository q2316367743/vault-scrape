import { h } from 'vue'
import { DialogPlugin } from 'tdesign-vue-next'
import RemoteDirPickerContent from './RemoteDirPickerContent.vue'

export interface RemoteDirPickerOptions {
  /** 要浏览的存储（数据源）ID */
  connectionId: string
  /** 存储名称，只用于展示 */
  connectionName: string
  /** 打开时定位到的连接内路径；缺省从连接根目录开始 */
  initialPath?: string
  /** 选中当前目录后回调，参数是**连接内绝对路径** */
  onPick: (remotePath: string) => void
}

/**
 * 「选择媒体目录」弹窗的外壳。
 *
 * 契约：
 * - 媒体目录一律是**连接内路径**（`/` 表示连接根），所以只能通过远程列目录来挑，
 *   不能复用本机目录选择器；
 * - 目录浏览与加载失败提示都在 RemoteDirPickerContent.vue，两者通过 pick / close 通信。
 */
export function openRemoteDirPicker(options: RemoteDirPickerOptions): void {
  const dialog = DialogPlugin({
    header: '选择媒体目录',
    width: '640px',
    placement: 'center',
    footer: false,
    destroyOnClose: true,
    body: () =>
      h(RemoteDirPickerContent, {
        connectionId: options.connectionId,
        connectionName: options.connectionName,
        initialPath: options.initialPath,
        onClose: () => dialog.hide(),
        onPick: (remotePath: string) => {
          dialog.hide()
          options.onPick(remotePath)
        }
      })
  })
}
