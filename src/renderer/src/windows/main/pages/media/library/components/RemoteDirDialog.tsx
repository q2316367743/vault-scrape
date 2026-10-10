import { ref } from 'vue'
import { Button, DialogPlugin } from 'tdesign-vue-next'
import type { ModalContentExpose } from '@/utils/modal/ModalContent'
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

/** 内容组件在通用契约之外还暴露了当前浏览路径，footer 左侧要显示它 */
interface RemoteDirPickerExpose extends ModalContentExpose {
  path: string
}

/**
 * 「选择媒体目录」弹窗的外壳。
 *
 * 契约：
 * - 媒体目录一律是**连接内路径**（`/` 表示连接根），所以只能通过远程列目录来挑，
 *   不能复用本机目录选择器；
 * - 目录浏览与加载失败提示都在 RemoteDirPickerContent.vue，两者通过 pick / close 通信；
 * - footer 左侧跟着内容组件暴露的当前路径走（见 ModalContentExpose）。
 */
export function openRemoteDirPicker(options: RemoteDirPickerOptions): void {
  const contentRef = ref<RemoteDirPickerExpose | null>(null)
  const dialog = DialogPlugin({
    header: '选择媒体目录',
    width: '640px',
    placement: 'center',
    destroyOnClose: true,
    footer: () => (
      <div class="flex items-center justify-between gap-12px">
        <span class="overflow-hidden text-12px text-td-text-placeholder whitespace-nowrap text-ellipsis">
          {`当前目录：${contentRef.value?.path ?? ''}`}
        </span>
        <div class="flex flex-shrink-0 items-center gap-8px">
          <Button variant="outline" onClick={() => dialog.hide()}>
            取消
          </Button>
          <Button theme="primary" onClick={() => contentRef.value?.submit()}>
            选择当前目录
          </Button>
        </div>
      </div>
    ),
    body: () => (
      <RemoteDirPickerContent
        ref={contentRef}
        connectionId={options.connectionId}
        connectionName={options.connectionName}
        initialPath={options.initialPath}
        onPick={(remotePath: string) => {
          dialog.hide()
          options.onPick(remotePath)
        }}
      />
    )
  })
}
