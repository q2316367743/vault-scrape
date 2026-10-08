import { h } from 'vue'
import { DialogPlugin } from 'tdesign-vue-next'
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
 * 只负责 DialogPlugin 的生命周期，读写与状态在 PluginEditorDialogContent.vue 里。
 */
export function openPluginEditorDialog(options: PluginEditorDialogOptions): void {
  const dialog = DialogPlugin({
    header: `编辑插件「${options.name}」`,
    width: '960px',
    placement: 'center',
    footer: false,
    destroyOnClose: true,
    body: () =>
      h(PluginEditorDialogContent, {
        id: options.id,
        load: options.load,
        save: options.save,
        onClose: () => dialog.hide()
      })
  })
}
