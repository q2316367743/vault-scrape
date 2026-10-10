import { ref } from 'vue'
import { Button, DialogPlugin } from 'tdesign-vue-next'
import type { ModalContentExpose } from '@/utils/modal/ModalContent'
import TextEditorDialogContent from './TextEditorDialogContent.vue'

export interface TextEditorDialogOptions {
  /** 文件名，只用于标题 */
  name: string
  /** 读取文本；返回 null 表示读取失败（原因已由调用方提示） */
  load: () => Promise<string | null>
  /** 写回文本；返回 false 表示失败（原因已由调用方提示），成功后外壳自行关闭 */
  save: (content: string) => Promise<boolean>
}

/**
 * 纯文本编辑器弹窗的外壳（NFO / 字幕 / 配置等小文本）。
 *
 * 只负责 DialogPlugin 的生命周期与 footer 按钮，读写与状态在 TextEditorDialogContent.vue 里；
 * 保存动作、写入中 / 加载中状态由内容组件经 defineExpose 暴露（见 ModalContentExpose）。
 * 取消 / 保存都关闭弹窗：保存成功内容组件自行 emit('close')，内容里取消在写入中禁用。
 */
export function openTextEditorDialog(options: TextEditorDialogOptions): void {
  const contentRef = ref<ModalContentExpose | null>(null)
  const dialog = DialogPlugin({
    header: `编辑「${options.name}」`,
    width: '760px',
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
      <TextEditorDialogContent
        ref={contentRef}
        name={options.name}
        load={options.load}
        save={options.save}
        onClose={() => dialog.hide()}
      />
    )
  })
}
