import { normalizeNum, type ScrapeKeyword } from './keyword'
import type { PartStyle } from '../setting'

/** 文件名解析出的作品标识 */
export interface ScrapeMediaRef {
  /** 原始番号，识别不到时为空串 */
  num: string
  /** 番号里的字母前缀，如 SSIS */
  prefix: string
  /** 分盘序号（CD1/PART2/DISC3），非分盘为 0 */
  part: number
}

const PART_PATTERN = /(?:^|[\s_\-.])(CD|PART|DISC|D)\s*0*(\d{1,2})$/
/** 带捕获组的尾部分盘标记：捕获分隔符与完整标记（含前导零） */
const PART_TOKEN_PATTERN = /(^|[\s_\-.])((?:CD|PART|DISC|D)\s*0*\d{1,2})$/i

/** 从名称尾部解析分盘序号，解析不到返回 0 */
export function parsePartIndex(name: string): number {
  const matched = PART_PATTERN.exec(name.trim().toUpperCase())
  if (!matched) return 0
  const value = Number.parseInt(matched[2] ?? '', 10)
  return Number.isFinite(value) ? value : 0
}

/** 取名称尾部的分盘标记原文（如 `CD01`），没有则返回空串 */
export function partTokenOf(name: string): string {
  const matched = PART_TOKEN_PATTERN.exec(name.trim())
  return matched?.[2]?.trim() ?? ''
}

/**
 * 按分盘样式归一标记：`origin` 保持原样，其余统一成 CD/PART/DISC 并去掉前导零。
 *
 * 传空标记返回空串，方便调用方直接拼接。
 */
export function normalizePartToken(token: string, partStyle: PartStyle): string {
  const raw = token.trim()
  if (raw.length === 0) return ''
  if (partStyle === 'origin') return raw
  const digits = /(\d{1,2})$/.exec(raw)?.[1] ?? ''
  if (digits.length === 0) return raw
  const label = partStyle === 'cd' ? 'CD' : partStyle === 'part' ? 'PART' : 'DISC'
  return `${label}${Number.parseInt(digits, 10)}`
}

/** 组装作品标识：番号 + 前缀 + 分盘序号 */
export function parseFileNum(keyword: ScrapeKeyword): ScrapeMediaRef {
  const compact = normalizeNum(keyword.num)
  const prefix = /^[A-Z]+/.exec(compact)?.[0] ?? ''
  return {
    num: keyword.num,
    prefix,
    part: parsePartIndex(keyword.cleaned)
  }
}

