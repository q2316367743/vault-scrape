/**
 * 离线数据包导入的进度与事件负载。
 *
 * 契约：进度与完成事件由主进程单向推送给发起任务的窗口（参照 file 域的 transfer 通道），
 * 渲染层订阅后只做展示；`percent` 为 -1 表示总量不可知（解析阶段按行数展示）。
 */

/** 导入流水线的阶段 */
export type OfflinePhase =
  | 'idle'
  | 'checking'
  | 'precheck'
  | 'downloading'
  | 'importing'
  | 'verifying'
  | 'swapping'
  | 'done'
  | 'failed'

export const OFFLINE_PHASES: readonly OfflinePhase[] = [
  'idle',
  'checking',
  'precheck',
  'downloading',
  'importing',
  'verifying',
  'swapping',
  'done',
  'failed'
]

export const OFFLINE_PHASE_LABELS: Readonly<Record<OfflinePhase, string>> = {
  idle: '空闲',
  checking: '检查更新',
  precheck: '检查磁盘空间',
  downloading: '下载数据包',
  importing: '导入数据',
  verifying: '校验数据',
  swapping: '切换数据包',
  done: '已完成',
  failed: '已失败'
}

/** 一条进度事件 */
export interface OfflineProgress {
  jobId: string
  phase: OfflinePhase
  /** 0-100；-1 表示总量不可知 */
  percent: number
  /** 面向用户的阶段说明 */
  message: string
  /** 已导入的行数（解析阶段之后累计） */
  rows: number
  /** 当前正在导入的表名，非导入阶段为空串 */
  table: string
}

/** 任务结束事件 */
export interface OfflineDone {
  jobId: string
  ok: boolean
  /** 失败原因或成功摘要 */
  message: string
}

/** 自动检查命中有新版本时的推送负载 */
export interface OfflineUpdateNotice {
  latestPackDate: string
  packDate: string
}
