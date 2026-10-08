import { h } from 'vue'
import { DialogPlugin } from 'tdesign-vue-next'
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
 * 只负责 DialogPlugin 的生命周期，读写与状态在 TextEditorDialogContent.vue 里。
 */
export function openTextEditorDialog(options: TextEditorDialogOptions): void {
  const dialog = DialogPlugin({
    header: `编辑「${options.name}」`,
    width: '760px',
    placement: 'center',
    footer: false,
    destroyOnClose: true,
    body: () =>
      h(TextEditorDialogContent, {
        name: options.name,
        load: options.load,
        save: options.save,
        onClose: () => dialog.hide()
      })
  })
}
