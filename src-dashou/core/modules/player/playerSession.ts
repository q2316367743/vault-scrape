/**
 * 播放会话：管「当前播什么、播到哪」，并把状态广播给主窗口的「正在播放」标签。
 *
 * 契约：
 * - 插件里没有 mpv（无法把原生窗口嵌进宿主窗口），播放后端固定为内置 artplayer；
 * - 地址由 core 的媒体服务给出（`buildMediaUrl` 生成的是本机 HTTP 地址），
 *   渲染层拿到后直接交给 artplayer；
 * - 播放状态由播放窗口实时回报（`reportState`），core 只保存快照并广播，
 *   不重复解析视频进度；
 * - 换片、换集统一走 `loadTarget`；找不到媒体源时返回空地址，渲染层显示提示。
 */
import { buildMediaUrl } from '@common/types/media'
import {
  buildPlayerState,
  type PlayerLoadResult,
  type PlayerOpenPayload,
  type PlayerState
} from '@common/types/player'
import { stripExtension } from '@common/types/scrape'
import { appendLog } from '$/db/repo/logRepo'
import { getItem, listSourcesByItem } from '$/db/repo/mediaRepo'
import type { MediaItemRow, MediaSourceRow } from '$/db/schema'
import { primarySourceOf } from '$/modules/media/mediaWall'

/** 当前装载的播放目标：主窗口标题栏据此显示「正在播放什么」 */
export interface PlayerTargetInfo {
  itemId: string
  /** 剧集正在播的那一集；影片为空串 */
  episodeId: string
  title: string
  /** 剧集这一集的说明（形如 `第 1 季 第 2 集`）；影片为空串 */
  subtitle: string
}

let state: PlayerState = buildPlayerState('html5')
let target: PlayerTargetInfo | null = null

export function currentState(): PlayerState {
  return { ...state }
}

export function currentTarget(): PlayerTargetInfo | null {
  return target ? { ...target } : null
}

/** 播放窗口回报的实时状态：保存快照即可，广播由窗口层负责 */
export function reportState(next: PlayerState): void {
  state = { ...next }
}

/**
 * 装载播放目标：解析媒体源并拼出可直接播放的地址。
 *
 * 找不到条目或媒体源时返回空地址（渲染层给出「还没有媒体源」的提示），不抛错。
 */
export async function loadTarget(payload: PlayerOpenPayload): Promise<PlayerLoadResult> {
  const episodeId = payload.episodeId ?? ''
  const item = getItem(payload.itemId)
  const episode = episodeId.length > 0 && episodeId !== payload.itemId ? getItem(episodeId) : null
  const owner =
    episodeId.length > 0 && episodeId !== payload.itemId ? episode : item
  const source = owner ? resolveSource(owner) : null
  target = item ? targetOf(item, episode) : null
  state = buildPlayerState('html5')
  if (!item || !source) {
    appendLog({
      level: 'warn',
      scope: 'player',
      message: `播放目标没有可用媒体源：item=${payload.itemId}`
    })
    return { backend: 'html5', url: '', reason: '', itemId: payload.itemId, episodeId }
  }
  return {
    backend: 'html5',
    url: buildMediaUrl(source.connectionId, source.id, source.name),
    reason: '',
    itemId: payload.itemId,
    episodeId
  }
}

/** 收摊：清掉当前目标与状态（播放窗口关闭 / 退出时调用） */
export function stopSession(): void {
  target = null
  state = buildPlayerState('html5')
}

/** 条目 + 可选剧集条目 → 该播哪条媒体源（只有 `episode` 挂源，剧集 / 季条目没有） */
function resolveSource(owner: MediaItemRow): MediaSourceRow | null {
  return primarySourceOf(owner, listSourcesByItem(owner.id)) ?? null
}

/** 组装「在播什么」：剧集给剧集名 + 这一集的说明，影片只给片名 */
function targetOf(item: MediaItemRow, episode: MediaItemRow | null): PlayerTargetInfo {
  return {
    itemId: item.id,
    episodeId: episode?.id ?? '',
    title: displayTitle(item),
    subtitle: episode ? episodeLabel(episode) : ''
  }
}

/** 片名口径与影视墙一致：刮削过就是条目名，没刮削过去掉扩展名 */
function displayTitle(row: MediaItemRow): string {
  return row.scrapedAt > 0 ? row.name : stripExtension(row.name)
}

/** 集说明：特别篇（季号 0）只写集号 */
function episodeLabel(episode: MediaItemRow): string {
  const season = episode.seasonNumber > 0 ? `第 ${episode.seasonNumber} 季 ` : ''
  return `${season}第 ${episode.episodeNumber} 集`
}
