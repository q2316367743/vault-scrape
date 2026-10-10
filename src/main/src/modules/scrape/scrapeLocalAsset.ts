/**
 * 应用数据目录里的图片落盘（`imageSaveMode === 'appdata'` 时使用）。
 *
 * 契约：
 * - 图片先下载到本机临时文件再拷贝，无论成败都清理临时文件；
 * - 相对路径里的分隔符一律换成下划线，避免在应用数据目录里建多级子目录。
 */
import { copyFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { PluginAsset } from '@common/types/plugin'
import { appDataImageDir } from '$/modules/media/mediaAppData'
import { downloadAssetToTemp } from './scrapeAssets'

/** 图片存到应用数据目录：`<appData>/media/images/<itemId>/`，返回本机绝对路径 */
export async function writeAppDataAsset(
  itemId: string,
  relativePath: string,
  asset: PluginAsset,
  signal: AbortSignal
): Promise<string> {
  const dir = appDataImageDir(itemId)
  await mkdir(dir, { recursive: true })
  const target = join(dir, relativePath.replace(/[\\/]/g, '_'))
  const download = await downloadAssetToTemp(asset, signal)
  try {
    await copyFile(download.localPath, target)
  } finally {
    await download.cleanup()
  }
  return target
}
