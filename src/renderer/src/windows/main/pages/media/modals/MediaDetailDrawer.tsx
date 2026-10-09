import { h } from 'vue'
import { DrawerPlugin } from 'tdesign-vue-next'
import MediaDetailDrawerContent from './MediaDetailDrawerContent.vue'

export interface MediaDetailDrawerOptions {
  /** 视频所属的数据源 ID */
  connectionId: string
  /** 视频在存储内的绝对路径 */
  path: string
  /** 卡片上的展示标题，仅用于抽屉标题 */
  title: string
  /** 数据源名称，仅用于展示 */
  sourceName: string
  /** 打开抽屉那一刻卡片上的 NSFW 保护状态（遮罩只在卡片上点过一次） */
  protect: boolean
}

/**
 * 影片详情抽屉的外壳。
 *
 * 只负责 DrawerPlugin 的生命周期，取数与展示在 MediaDetailDrawerContent.vue 里；
 * 关闭即销毁，避免上一部影片的元信息残留在下一次打开时闪现。
 */
export function openMediaDetailDrawer(options: MediaDetailDrawerOptions): void {
  DrawerPlugin({
    header: `影片详情 · ${options.title}`,
    size: '680px',
    footer: false,
    destroyOnClose: true,
    body: () =>
      h(MediaDetailDrawerContent, {
        connectionId: options.connectionId,
        path: options.path,
        sourceName: options.sourceName,
        protect: options.protect
      })
  })
}
