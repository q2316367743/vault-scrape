import { onBeforeUnmount, ref, watchPostEffect } from 'vue'
import type { Ref } from 'vue'

/** 悬浮条高度，与 `MediaDetailToolbar.vue` 里 `.detail-bar` 的 height 保持一致：横幅什么时候显形看它 */
const BAR_HEIGHT = 56

/**
 * 详情页的滚动状态：头部的标题被滚出视野后，吸顶悬浮条要退成一条半透明横幅。
 *
 * 用法：页面用 `useTemplateRef` 拿到滚动容器（根节点）与紧跟头部的那枚 1px 哨兵传进来，
 * 换一个 `collapsed` 交给悬浮条。
 *
 * 为什么不按 `scrollTop` 猜阈值：头部高度随窗口宽度与标题 / 要点行的换行而变，
 * 所以直接让哨兵和滚动容器相交判断——`rootMargin` 收掉横幅那一条，哨兵跑到它上面就是标题已经滚出去了。
 * 刷新后浏览器恢复滚动位置、窗口拉伸、要点行换行这些都不用额外处理，相交变化会自己重算。
 */
export function useDetailScroll(
  scrollBox: Readonly<Ref<HTMLElement | null>>,
  heroEnd: Readonly<Ref<HTMLElement | null>>
): Readonly<Ref<boolean>> {
  const collapsed = ref(false)
  let observer: IntersectionObserver | null = null

  watchPostEffect(() => {
    const box = scrollBox.value
    const target = heroEnd.value
    observer?.disconnect()
    observer = null
    if (!box || !target) return
    observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        collapsed.value = entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0)
      },
      { root: box, rootMargin: `-${BAR_HEIGHT}px 0px 0px 0px` }
    )
    observer.observe(target)
  })

  onBeforeUnmount(() => observer?.disconnect())

  return collapsed
}
