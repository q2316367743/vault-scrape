/**
 * 根目录扫描：把根目录下的视频文件解析成待刮削条目。
 *
 * 契约：
 * - **只读根目录一层**，不递归子目录（对齐「只读取根目录文件」的需求）；
 * - 解析番号只是「猜」，识别不到时退回清洗后的关键词；
 * - 同番号重复文件（试看/分盘重复等）标记 `duplicateOf`，刮削时跳过，避免重复下载资源。
 */
import { extractKeyword, isVideoExt, normalizeNum, type ScrapeScanEntry } from '@common/types/scrape'
import { normalizeRemotePath } from '@common/types/file'
import { indexDirectory } from '$/modules/resource/resourceIndex'

/** 扫描入参（连接内根目录） */
export interface ScrapeVideoScanRequest {
  connectionId: string
  dirPath: string
}

/**
 * 列出根目录下的视频文件。
 *
 * 排序固定按文件名，保证「第一次出现的那个」在重复判定里稳定。
 * 顺带把该目录的文件写入资源索引（索引失败不影响扫描结果）。
 */
export async function listRootVideos(request: ScrapeVideoScanRequest): Promise<ScrapeScanEntry[]> {
  const dirPath = normalizeRemotePath(request.dirPath)
  const entries = await indexDirectory(request.connectionId, dirPath)
  const videos = entries
    .filter((entry) => entry.type === 'file' && isVideoExt(entry.extname))
    .sort((left, right) => left.name.localeCompare(right.name))

  const firstByNum = new Map<string, string>()
  return videos.map((entry): ScrapeScanEntry => {
    const keyword = extractKeyword(entry.name)
    const key = normalizeNum(keyword.num)
    let duplicateOf: string | undefined
    if (key.length > 0) {
      const first = firstByNum.get(key)
      if (first) duplicateOf = first
      else firstByNum.set(key, entry.path)
    }
    return {
      path: entry.path,
      name: entry.name,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      keyword: keyword.cleaned,
      num: keyword.num,
      ...(duplicateOf ? { duplicateOf } : {})
    }
  })
}
