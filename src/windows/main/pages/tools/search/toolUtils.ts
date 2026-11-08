/**
 * 工具箱页面用到的小工具：资源类型归属与「当前下载设置是否会下载」判定。
 *
 * 判定复用 `@common/types/scrape/asset.ts` 的 `downloadFlagOf`：
 * thumb/poster/fanart/still/trailer 各自对应下载开关，
 * banner / logo 没有开关、始终下载。
 */
import {
  COVER_ASSET_KINDS,
  PLUGIN_ASSET_KIND_LABELS,
  type PluginAsset,
  type PluginAssetKind
} from '@common/types/plugin'
import { downloadFlagOf } from '@common/types/scrape/asset'
import type { SettingDownload } from '@common/types/setting'

/** 资源类型的中文标签 */
export function assetKindLabel(kind: PluginAssetKind): string {
  return PLUGIN_ASSET_KIND_LABELS[kind]
}

/** 资源归属：封面类还是花絮类 */
export function assetSourceLabel(kind: PluginAssetKind): string {
  return COVER_ASSET_KINDS.includes(kind) ? '封面' : '花絮'
}

/** 当前下载设置是否会下载该类型 */
export function isAssetDownloaded(kind: PluginAssetKind, download: SettingDownload): boolean {
  return downloadFlagOf(download, kind)
}

/** 资产表格的一行 */
export interface PluginAssetRow {
  key: string
  asset: PluginAsset
  source: string
  kindLabel: string
  /** 当前下载设置是否会实际下载 */
  willDownload: boolean
}

export function toAssetRows(
  assets: readonly PluginAsset[],
  download: SettingDownload
): PluginAssetRow[] {
  return assets.map((asset, index) => ({
    key: `${asset.kind}-${index}`,
    asset,
    source: assetSourceLabel(asset.kind),
    kindLabel: assetKindLabel(asset.kind),
    willDownload: isAssetDownloaded(asset.kind, download)
  }))
}

/** 请求头摘要：用来在表格里一眼看出插件有没有给防盗链信息 */
export function describeHeaders(headers: Record<string, string> | undefined): string {
  const entries = Object.entries(headers ?? {})
  if (entries.length === 0) return '—'
  return entries.map(([key, value]) => `${key}: ${value}`).join('；')
}
