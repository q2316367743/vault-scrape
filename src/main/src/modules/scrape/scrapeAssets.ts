/**
 * 资源落盘：把插件给出的 `PluginAsset` 下载到本地临时文件，再上传到连接内目标路径。
 *
 * 契约：
 * - 插件只给「链接 + 请求头」，下载走共享 `httpClient`（代理、超时、字符集无关），
 *   `responseType: 'arraybuffer'` 保证二进制不被解码破坏；
 * - 目标已存在且对应 `keepXxx` 为真时**跳过**（调用方用 `resolveAssetFile` 与 `exists` 判定）；
 * - 临时文件落在系统临时目录的 `vault-scrape-scrape` 子目录，文件名用随机 UUID，用完即删；
 * - 下载失败按 network.retryCount 重试，最终失败抛错由单文件流水线收敛成「失败」结果行。
 */
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { PluginAsset } from '@common/types/plugin'
import { ScrapeError } from '@common/types/scrape'
import { httpClient } from '$/modules/http/httpClient'
import { loadSetting } from '$/modules/setting/settingStore'

export interface AssetDownload {
  /** 本机临时文件绝对路径 */
  localPath: string
  /** 删除临时文件；失败静默 */
  cleanup: () => Promise<void>
}

function tempDir(): string {
  return join(tmpdir(), 'vault-scrape-scrape')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}

/** 资源请求方法：插件只声明过 GET / POST，缺省按 GET */
function assetMethod(asset: PluginAsset): 'GET' | 'POST' {
  return asset.method === 'POST' ? 'POST' : 'GET'
}

/** 下载一条资源到临时文件 */
export async function downloadAssetToTemp(asset: PluginAsset, signal: AbortSignal): Promise<AssetDownload> {
  const retryCount = Math.max(0, Math.floor(loadSetting().network.retryCount))
  const dir = tempDir()
  await mkdir(dir, { recursive: true })
  const localPath = join(dir, `${randomUUID()}`)
  let lastError: unknown = new ScrapeError('downloadFailed', '资源下载失败')

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    if (signal.aborted) throw new ScrapeError('cancelled', '任务已取消')
    try {
      const response = await httpClient.request<ArrayBuffer>({
        url: asset.url,
        method: assetMethod(asset),
        headers: asset.headers,
        data: asset.body,
        responseType: 'arraybuffer',
        signal
      })
      await writeFile(localPath, Buffer.from(response.data))
      return {
        localPath,
        cleanup: async (): Promise<void> => {
          await rm(localPath, { force: true }).catch(() => undefined)
        }
      }
    } catch (error) {
      lastError = error
      if (signal.aborted) throw new ScrapeError('cancelled', '任务已取消')
      if (attempt < retryCount) await delay(500)
    }
  }

  const message = lastError instanceof Error ? lastError.message : '资源下载失败'
  throw new ScrapeError('downloadFailed', `资源下载失败：${message}`)
}
