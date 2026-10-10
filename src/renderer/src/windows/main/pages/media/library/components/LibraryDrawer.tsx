import { DrawerPlugin } from 'tdesign-vue-next'
import LibraryDrawerContent from './LibraryDrawerContent.vue'

export interface LibraryDrawerOptions {
  /** 资料库配置或影片归库发生变化（新建/删除/扫描/刮削）时的回调 */
  onChanged?: () => void
}

/**
 * 资料库抽屉的外壳。
 *
 * 只负责 DrawerPlugin 的生命周期，列表与两个动作都在 LibraryDrawerContent.vue 里
 * （禁止在 tsx 里写内容）。抽屉不提供 footer：所有操作都在行内按钮上。
 */
export function openLibraryDrawer(options: LibraryDrawerOptions = {}): void {
  DrawerPlugin({
    header: '资料库',
    size: '720px',
    footer: false,
    destroyOnClose: true,
    body: () => <LibraryDrawerContent onChanged={() => options.onChanged?.()} />
  })
}
