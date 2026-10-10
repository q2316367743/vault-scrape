import { ref } from 'vue'
import { Button, DialogPlugin } from 'tdesign-vue-next'
import type { ModalContentExpose } from '@/utils/modal/ModalContent'
import PluginEditorDialogContent from './PluginEditorDialogContent.vue'

export interface PluginEditorDialogOptions {
  /** 插件 ID，仅用于提示与后续保存定位 */
  id: string
  /** 插件名称，仅用于标题 */
  name: string
  /** 读取插件源码；返回 null 表示读取失败（原因已由调用方提示） */
  load: () => Promise<string | null>
  /** 写回插件源码；返回 false 表示失败（原因已由调用方提示），成功后外壳自行关闭 */
  save: (code: string) => Promise<boolean>
}

/**
 * 插件源码编辑器弹窗的外壳。
 *
 * 只负责 DialogPlugin 的生命周期与 footer 按钮，读写与状态在 PluginEditorDialogContent.vue 里；
 * 保存动作、写入中 / 加载中状态由内容组件经 defineExpose 暴露（见 ModalContentExpose）。
 * 编译校验在主进程，保存成功内容组件会 emit('close') 关掉弹窗。
 */
export function openPluginEditorDialog(options: PluginEditorDialogOptions): void {
  const contentRef = ref<ModalContentExpose | null>(null)
  const dialog = DialogPlugin({
    header: `编辑插件「${options.name}」`,
    width: '960px',
    placement: 'center',
    destroyOnClose: true,
    footer: () => (
      <div class="flex items-center justify-end gap-8px">
        <Button variant="outline" disabled={contentRef.value?.saving} onClick={() => dialog.hide()}>
          取消
        </Button>
        <Button
          theme="primary"
          loading={contentRef.value?.saving}
          disabled={contentRef.value?.canSubmit === false}
          onClick={() => contentRef.value?.submit()}
        >
          保存
        </Button>
      </div>
    ),
    body: () => (
      <PluginEditorDialogContent
        ref={contentRef}
        id={options.id}
        load={options.load}
        save={options.save}
        onClose={() => dialog.hide()}
      />
    )
  })
}
