import type { MenuOptions } from '@imengyu/vue3-context-menu'
import Cxt from '@imengyu/vue3-context-menu'
import { themeSystem } from '@/global/AppTheme'

export const useContextMenu = (e: MouseEvent, options: Omit<MenuOptions, 'x' | 'y' | 'theme'>) => {
  e.preventDefault()
  e.stopPropagation()
  Cxt.showContextMenu({
    ...options,
    x: e.x,
    y: e.y,
    theme: themeSystem.value === 'dark' ? 'mac dark' : 'mac'
  })
}
