import { ipcMain } from 'electron'
import type {
  PlayerCommand,
  PlayerLoadResult,
  PlayerOpenPayload,
  PlayerProbeResult,
  PlayerStatus
} from '@common/types/player'
import { readBoolean, readNumber, readString, toSource } from '@common/types/setting/shared'
import { PlayerChannels } from '~/modules/player/playerChannels'
import { detectMpv } from '$/modules/player/mpvLocator'
import { broadcastPlayerStatus } from '$/modules/player/playerEvents'
import { loadTarget, runCommand } from '$/modules/player/playerSession'
import {
  closePlayerWindow,
  focusPlayerWindow,
  openPlayerWindow,
  playerStatus,
  takePlayerTarget,
  togglePlayerFullscreen
} from '$/modules/player/playerWindow'

/** 没有可用目标时的统一回落：空地址 + 内置播放器 */
const EMPTY_RESULT: PlayerLoadResult = {
  backend: 'html5',
  url: '',
  reason: '',
  itemId: '',
  episodeId: ''
}

/** 渲染层来的载荷一律当脏数据读：字段缺失就丢弃，不让它把主进程带崩 */
function readOpenPayload(payload: unknown): PlayerOpenPayload | null {
  const source = toSource(payload)
  if (!source) return null
  const itemId = readString(source, 'itemId', '').trim()
  if (itemId.length === 0) return null
  const episodeId = readString(source, 'episodeId', '').trim()
  return episodeId.length > 0 ? { itemId, episodeId } : { itemId }
}

function readCommand(payload: unknown): PlayerCommand | null {
  const source = toSource(payload)
  if (!source) return null
  switch (readString(source, 'kind', '')) {
    case 'toggle':
      return { kind: 'toggle' }
    case 'seek':
      return { kind: 'seek', position: readNumber(source, 'position', 0) }
    case 'seekBy':
      return { kind: 'seekBy', delta: readNumber(source, 'delta', 0) }
    case 'volume':
      return { kind: 'volume', volume: readNumber(source, 'volume', 0) }
    case 'mute':
      return { kind: 'mute', muted: readBoolean(source, 'muted', false) }
    case 'rate':
      return { kind: 'rate', rate: readNumber(source, 'rate', 1) }
    case 'fullscreen':
      // 没带 enabled 表示「切换」：当前是不是全屏只有窗口层知道，渲染层不必猜
      return source.enabled === undefined
        ? { kind: 'fullscreen' }
        : { kind: 'fullscreen', enabled: readBoolean(source, 'enabled', false) }
    default:
      return null
  }
}

/** 播放域 IPC：窗口控制 + 状态查询 + 目标装载，状态本身由主进程主动推 */
export function registerPlayerIpc(): void {
  ipcMain.handle(PlayerChannels.open, async (_event, payload: unknown): Promise<void> => {
    const target = readOpenPayload(payload)
    if (!target) return
    await openPlayerWindow(target)
  })

  ipcMain.handle(PlayerChannels.load, async (): Promise<PlayerLoadResult> => {
    const target = takePlayerTarget()
    if (!target) return EMPTY_RESULT
    const result = await loadTarget(target)
    // 没有媒体源时不会推播放状态，这里兜一次：标题栏至少知道这次装的是哪个条目
    broadcastPlayerStatus(playerStatus())
    return result
  })

  ipcMain.handle(PlayerChannels.command, async (_event, payload: unknown): Promise<void> => {
    const command = readCommand(payload)
    if (!command) return
    // 全屏是窗口层的事，不能下发给 mpv（嵌入模式下 mpv 管不了父窗口）
    if (command.kind === 'fullscreen') {
      togglePlayerFullscreen(command.enabled)
      return
    }
    await runCommand(command)
  })

  ipcMain.handle(PlayerChannels.close, (): void => {
    closePlayerWindow()
  })

  // 主窗口标题栏的「正在播放」标签：挂载时拉一次快照，点标签要求聚焦播放窗口
  ipcMain.handle(PlayerChannels.snapshot, (): PlayerStatus => playerStatus())

  ipcMain.handle(PlayerChannels.focus, (): void => {
    focusPlayerWindow()
  })

  ipcMain.handle(PlayerChannels.detect, async (_event, path: unknown): Promise<PlayerProbeResult> => {
    const source = toSource({ path })
    return detectMpv(source ? readString(source, 'path', '') : '')
  })
}
