import { ref } from 'vue'
import { Button, DrawerPlugin } from 'tdesign-vue-next'
import type { FileConnection } from '@common/types/file'
import type { MediaLibrary } from '@common/types/library'
import type { ModalContentExpose } from '@/utils/modal/ModalContent'
import LibraryFormContent from './LibraryFormContent.vue'

export interface LibraryFormDrawerOptions {
  /** 传入表示编辑已有资料库，缺省表示新建 */
  library?: MediaLibrary
  /** 可选存储列表，由抽屉传入（抽屉自己已经加载过连接） */
  connections: FileConnection[]
  onSaved?: (library: MediaLibrary) => void
}

/**
 * 新建 / 编辑资料库抽屉的外壳。
 *
 * 表单与校验都在 LibraryFormContent.vue 里，两者通过 success 事件通信；
 * 取消 / 保存按钮由这里提供（`footer`），不随表单滚动；保存动作与 saving 状态由内容组件
 * 经 `defineExpose` 暴露（见 ModalContentExpose）。
 * 资料库根目录与刮削器的最终校验在主进程（`library:save`），这里只做必填提示。
 */
export function openLibraryFormDrawer(options: LibraryFormDrawerOptions): void {
  const contentRef = ref<ModalContentExpose | null>(null)
  const drawer = DrawerPlugin({
    header: options.library ? '编辑资料库' : '新建资料库',
    size: '800px',
    destroyOnClose: true,
    footer: () => (
      <div class="flex items-center justify-end gap-8px">
        <Button variant="outline" onClick={() => drawer.hide?.()}>
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
    ),
    body: () => (
      <LibraryFormContent
        ref={contentRef}
        library={options.library}
        connections={options.connections}
        onSuccess={(library: MediaLibrary) => {
          drawer.hide?.()
          options.onSaved?.(library)
        }}
      />
    )
  })
}
