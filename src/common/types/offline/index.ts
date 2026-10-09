/**
 * 离线数据包模块的公共类型出口。
 *
 * 本目录只放纯类型与纯函数，主进程、preload、渲染层共享；
 * 真正的下载 / 导入 / 查询实现位于 `src/main/src/modules/offline/`。
 */
export type { OfflineCheckResult, OfflinePackDate, OfflinePackStatus } from './status'

export {
  OFFLINE_PHASES,
  OFFLINE_PHASE_LABELS,
  type OfflineDone,
  type OfflinePhase,
  type OfflineProgress,
  type OfflineUpdateNotice
} from './progress'

export {
  OFFLINE_AUTO_CHECK_INTERVAL_MS,
  OFFLINE_DUMPS_LATEST_URL,
  OFFLINE_DUMP_FILE_PATTERN,
  OFFLINE_MIN_VIDEO_ROWS,
  OFFLINE_STATE_VERSION,
  buildOfflineState,
  formatBytes,
  formatTime,
  isNewerPackDate,
  normalizeOfflineState,
  normalizePackDate,
  type OfflinePackState
} from './normalize'
