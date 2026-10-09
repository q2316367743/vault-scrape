import { h } from 'vue'
import { DrawerPlugin } from 'tdesign-vue-next'
import MovieDetailDrawerContent from './MovieDetailDrawerContent.vue'

export interface MovieDetailDrawerOptions {
  /** 插件 ID：详情 / 封面 / 花絮都调用这个插件 */
  pluginId: string
  /** 插件名称，仅用于标题 */
  pluginName: string
  /** 影片 ID：抽屉打开即拉一次详情 */
  movieId: string
}

/**
 * 影片详情抽屉的外壳。
 *
 * 只负责 DrawerPlugin 的生命周期，取数与展示在 MovieDetailDrawerContent.vue 里；
 * 关闭即销毁，避免上一次的详情残留在下一次打开时闪现。
 */
export function openMovieDetailDrawer(options: MovieDetailDrawerOptions): void {
  DrawerPlugin({
    header: `影片详情 · ${options.pluginName}`,
    size: '680px',
    footer: false,
    destroyOnClose: true,
    body: () =>
      h(MovieDetailDrawerContent, {
        pluginId: options.pluginId,
        movieId: options.movieId
      })
  })
}
