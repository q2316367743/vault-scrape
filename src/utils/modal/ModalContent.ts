/**
 * 命令式弹窗（`DialogPlugin` / `DrawerPlugin`）内容组件的对外契约。
 *
 * 背景：操作按钮统一归外壳的 `footer`（见 AGENTS.md「弹窗与抽屉」），而状态（saving / 校验）还在
 * `.vue` 内容组件里，外壳拿不到。于是约定内容组件用 `defineExpose` 暴露这份契约，外壳用模板 ref 读：
 *
 * ```ts
 * const contentRef = ref<ModalContentExpose | null>(null)
 * DrawerPlugin({
 *   footer: () => h(Button, { loading: contentRef.value?.saving, onClick: () => contentRef.value?.submit() }),
 *   body: () => h(XxxContent, { ref: contentRef })
 * })
 * ```
 *
 * 内容组件自己还需要额外能力（测试连接、当前目录…）时，在外壳侧写
 * `interface XxxContentExpose extends ModalContentExpose { … }` 声明本地扩展，不要往这里加某个弹窗专用的字段。
 */
export interface ModalContentExpose {
  /** 主按钮（保存 / 确定）点击时调用：校验并提交，成功后内容组件自行 `emit('success')` */
  submit: () => void
  /** 主按钮是否正在提交中，外壳绑 `loading` */
  saving?: boolean
  /** 主按钮是否可点，缺省 true，外壳绑 `disabled={canSubmit === false}` */
  canSubmit?: boolean
}
