import { onBeforeUnmount, onMounted } from 'vue'
import type { Ref } from 'vue'
import type { PlayerCommand, PlayerState } from '@common/types/player'

/**
 * 播放窗口的键盘快捷键。
 *
 * 契约：
 * - 动作与内置后端无关：一律走 `session.apply(command)`（mpv 转发到主进程，内置后端在渲染层执行）；
 * - **输入框 / 下拉框 / 可编辑区域里不响应**（侧栏有 `t-select`，空格和方向键得留给它）；
 * - 空格与方向键要 `preventDefault()`：否则页面会滚动、按钮会被「空格」当成点击；
 * - Esc 只在全屏时发「退出全屏」，非全屏不发声（交给窗口层自己判断当前状态）。
 */
export interface KeyboardSession {
  state: Ref<PlayerState>
  fullscreen: Ref<boolean>
  apply(command: PlayerCommand): Promise<void>
}

/** 方向键一次跳转的秒数 */
const SEEK_STEP = 10
/** 音量一次调整的步长 */
const VOLUME_STEP = 0.05

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return EDITABLE_TAGS.has(target.tagName) || target.isContentEditable
}

/** 夹到合法区间的工具，音量 / 倍速都要用 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function useKeyboard(session: KeyboardSession): void {
  function send(command: PlayerCommand): void {
    void session.apply(command)
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (isEditable(event.target)) return

    const { state, fullscreen } = session

    switch (event.key) {
      case ' ':
      case 'k':
      case 'K':
        event.preventDefault()
        send({ kind: 'toggle' })
        break
      case 'ArrowLeft':
        event.preventDefault()
        send({ kind: 'seekBy', delta: -SEEK_STEP })
        break
      case 'ArrowRight':
        event.preventDefault()
        send({ kind: 'seekBy', delta: SEEK_STEP })
        break
      case 'ArrowUp':
        event.preventDefault()
        send({ kind: 'volume', volume: clamp(state.value.volume + VOLUME_STEP, 0, 1) })
        break
      case 'ArrowDown':
        event.preventDefault()
        send({ kind: 'volume', volume: clamp(state.value.volume - VOLUME_STEP, 0, 1) })
        break
      case 'm':
      case 'M':
        send({ kind: 'mute', muted: !state.value.muted })
        break
      case 'f':
      case 'F':
        send({ kind: 'fullscreen' })
        break
      case 'Escape':
        if (fullscreen.value) send({ kind: 'fullscreen', enabled: false })
        break
      default:
        break
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
