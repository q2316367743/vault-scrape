/**
 * 资源索引：把「存储内的一个目录」扫描成索引行并落库。
 *
 * 契约：
 * - **只索引一层**（与根目录扫描一致），不递归子目录；
 * - 索引写入失败只记日志，**绝不让扫描/刮削失败**（索引是加速与展示用的旁路数据）；
 * - 返回本次列出的文件条目，调用方直接复用，避免再向远端请求一次。
 */
import { createHash } from 'crypto'
import { guessMimeType, normalizeRemotePath, type FileEntry } from '@common/types/file'
import { resourceKindOf, type ResourceItem } from '@common/types/resource'
import { appendLog } from '$/db/repo/logRepo'
import { replaceResourceDir } from '$/db/repo/resourceRepo'
import { getFileClient } from '$/modules/file/fileClientManager'

/**
 * 资源 ID：由「存储 ID + 连接内绝对路径」哈希而来（16 位十六进制）。
 *
 * 稳定且与文件名无关，所以重命名只影响 URL 尾巴上的展示名，不影响定位。
 */
export function resourceIdOf(connectionId: string, path: string): string {
  return createHash('sha1').update(`${connectionId}\n${path}`).digest('hex').slice(0, 16)
}

function warn(message: string): void {
  appendLog({ level: 'warn', scope: 'resource', message })
}

/**
 * 扫描一个目录并把其中的文件写入资源索引。
 *
 * 返回该目录下的**全部文件**条目（含图片、NFO 等），由调用方决定怎么用。
 */
export async function indexDirectory(connectionId: string, dirPath: string): Promise<FileEntry[]> {
  const root = normalizeRemotePath(dirPath)
  const client = await getFileClient(connectionId)
  const entries = await client.list(root)
  const files = entries.filter((entry) => entry.type === 'file')
  const now = Date.now()
  const items = files.map((entry): ResourceItem => {
    const extname = entry.extname.toLowerCase()
    const mime = entry.mime || guessMimeType(entry.name)
    return {
      id: resourceIdOf(connectionId, entry.path),
      connectionId,
      dirPath: root,
      path: entry.path,
      name: entry.name,
      extname,
      mime,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      kind: resourceKindOf(mime, extname),
      indexedAt: now
    }
  })

  try {
    replaceResourceDir(connectionId, root, items)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    warn(`资源索引写入失败（${root}）：${message}`)
  }

  return files
}
