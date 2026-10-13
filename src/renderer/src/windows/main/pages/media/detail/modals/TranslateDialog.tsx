/**
 * 翻译弹窗外壳（命令式）。
 *
 * 契约：外壳只负责打开弹窗、渲染内容组件与底部按钮；
 * 插件选择与真正调用在 `TranslateDialogContent.vue` 里，成功回传后关窗、提示并让详情页重读
 * （详情页要拿到新写入的译文，重读一次即可，不需要单独的回传载荷）。
 */
import { ref } from 'vue'
import { Button, DialogPlugin } from 'tdesign-vue-next'
import { MessageUtil } from '@/utils/modal'
import type { ModalContentExpose } from '@/utils/modal/ModalContent'
import type { PluginSummary } from '@common/types/plugin'
import type { TranslateItemResult } from '@common/types/translate'
import TranslateDialogContent from './TranslateDialogContent.vue'

export interface TranslateDialogOptions {
  /** 媒体条目 ID */
  itemId: string
  /** 全部翻译插件（含不可用的），按插件页顺序 */
  plugins: PluginSummary[]
  /** 这条记录是整部剧集 */
  isSeries: boolean
  /** 翻译完成后的回调：详情页重读一次，拿到刚写进去的译文 */
  onApplied?: () => void
}

export function openTranslateDialog(options: TranslateDialogOptions): void {
  const contentRef = ref<ModalContentExpose | null>(null)

  const dialog = DialogPlugin({
    header: '翻译影视信息',
    width: '560px',
    placement: 'center',
    destroyOnClose: true,
    footer: () => (
      <div class="flex items-center justify-end gap-8px">
        <Button variant="outline" onClick={() => dialog.hide()}>
          取消
        </Button>
        <Button
          theme="primary"
          loading={contentRef.value?.saving}
          disabled={contentRef.value?.canSubmit === false}
          onClick={() => contentRef.value?.submit()}
        >
          开始翻译
        </Button>
      </div>
    ),
    body: () => (
      <TranslateDialogContent
        ref={contentRef}
        itemId={options.itemId}
        plugins={options.plugins}
        isSeries={options.isSeries}
        onSuccess={(result: TranslateItemResult) => {
          dialog.hide()
          MessageUtil.success(
            result.translatedCount > 0
              ? `翻译完成，译文字段 ${result.translatedCount} 项`
              : '翻译完成，没有可翻译的内容'
          )
          options.onApplied?.()
        }}
      />
    )
  })
}
