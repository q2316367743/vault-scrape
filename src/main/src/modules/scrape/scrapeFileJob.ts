/**
 * 单文件刮削流水线：一个视频文件 → 一组已落盘的刮削结果。
 *
 * 契约（严格按需求里的顺序与开关）：
 * 1. **插件按顺序调用**，每个插件都走 `search → detail`；命中详情后只补它缺的资源，
 *    关键信息与启用资源齐全就**提前停止**，不再调用后面的插件（跨插件补全）；
 * 2. 下载哪些资源由 `download` 的五个开关决定；`keepXxx` 为真且目标已存在时跳过；
 * 3. `file.renameAfterSuccess` 为假时不重命名视频，附属文件（NFO / 封面 / 剧照）与视频同名，
 *    视频留在根目录；为真时按 `naming` 模板改名，附属文件再按 `naming.assetNaming` 决定命名；
 * 4. 成功后按 `file.moveAfterSuccess` + `path.successOutputDir` 移动整组文件；失败按失败目录；
 * 5. 单文件失败只产出结果行，不抛给任务；取消通过 `signal` 打断。
 */
import { dirnameRemotePath, FILE_ROOT, joinRemotePath, normalizeRemotePath } from '@common/types/file'
import type { PluginAsset, PluginAssetKind, PluginMovieDetail } from '@common/types/plugin'
import {
  COVER_ASSET_KINDS,
  EXTRA_ASSET_KINDS
} from '@common/types/plugin'
import {
  ScrapeError,
  buildNfoXml,
  enabledAssetKinds,
  extractKeyword,
  keepFlagOf,
  normalizePartToken,
  partTokenOf,
  renderTemplate,
  resolveAssetFile,
  sanitizeName,
  truncateName,
  type ScrapeFileStatus
} from '@common/types/scrape'
import type {
  SettingDownload,
  SettingFile,
  SettingNaming,
  SettingPath,
  SettingScrape
} from '@common/types/setting'
import type { FileClient } from '$/modules/file/FileClient'
import { invokePlugin } from '$/modules/plugin/pluginRegistry'
import { resourceIdOf } from '$/modules/resource/resourceIndex'
import { downloadAssetToTemp } from './scrapeAssets'
import type { ScrapeRunLog } from './scrapeLogFile'
import { pickCandidate } from './scrapeMatcher'
import { readAssets, readCandidates, readDetail } from './scrapePluginData'

/** 参与刮削的插件（顺序即插件页顺序） */
export interface ScrapePluginRef {
  id: string
  name: string
}

/** 任务启动时冻结的设置快照：任务运行期间改设置不影响已启动的任务 */
export interface ScrapeSettingsSnapshot {
  scrape: SettingScrape
  download: SettingDownload
  naming: SettingNaming
  file: SettingFile
  path: SettingPath
}

export interface ScrapeJobContext {
  taskId: string
  connectionId: string
  dirPath: string
  entry: {
    path: string
    name: string
    keyword: string
    num: string
  }
  plugins: readonly ScrapePluginRef[]
  settings: ScrapeSettingsSnapshot
  client: FileClient
  signal: AbortSignal
  log: ScrapeRunLog
}

/** 本次刮削产出的封面（用于工作台列表直接显示） */
export interface ScrapeCoverRef {
  kind: PluginAssetKind
  /** 封面在连接内的路径 */
  path: string
  /** 封面资源 ID（协议地址用它定位） */
  id: string
}

export interface ScrapeJobOutcome {
  status: ScrapeFileStatus
  pluginId: string
  title: string
  message: string
  /** 本次成功产出的封面（按 poster > thumb > fanart 取第一张） */
  cover?: ScrapeCoverRef
}

/** 去掉扩展名 */
function baseNameOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(0, index) : name
}

/** 扩展名（含点），没有扩展名时为空串 */
function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index) : ''
}

/**
 * 按命名规则算出视频最终的基础名。
 *
 * 模板渲染为空时回落原名；分盘标记（CD1 / PART2…）始终按 `partStyle` 附在末尾，
 * 否则同名模板会让同一部作品的分盘文件互相覆盖。
 */
function resolveVideoBase(detail: PluginMovieDetail, originalBase: string, naming: SettingNaming): string {
  const rendered = renderTemplate(naming.fileTemplate, detail, naming)
  const base = truncateName(sanitizeName(rendered) || originalBase, naming.fileNameMaxLength)
  const token = normalizePartToken(partTokenOf(originalBase), naming.partStyle)
  if (token.length === 0) return base
  return truncateName(`${base} ${token}`, naming.fileNameMaxLength)
}

/** 启用的资源 kind 是否已经全部拿到 */
function isSatisfied(
  detail: PluginMovieDetail | null,
  assets: ReadonlyMap<PluginAssetKind, PluginAsset[]>,
  enabled: readonly PluginAssetKind[]
): boolean {
  if (!detail) return false
  return enabled.every((kind) => (assets.get(kind)?.length ?? 0) > 0)
}

/** 输出目录：空串表示原地；以 `/` 开头按连接内绝对路径，否则视为连接根下的子目录 */
export function resolveOutputDir(value: string, fallback: string): string {
  const text = value.trim()
  if (text.length === 0) return fallback
  return text.startsWith('/') ? normalizeRemotePath(text) : joinRemotePath(FILE_ROOT, text)
}

/** NFO 目标文件名（按 download.nfoFileNaming 展开，自动去重） */
function nfoNames(naming: SettingDownload, base: string): string[] {
  if (naming.nfoFileNaming === 'movie') return ['movie.nfo']
  if (naming.nfoFileNaming === 'filename') return [`${base}.nfo`]
  return base === 'movie' ? ['movie.nfo'] : ['movie.nfo', `${base}.nfo`]
}

/** 收集一个插件的资源，只接受尚未拿到的启用 kind */
function collectAssets(
  incoming: readonly PluginAsset[],
  assets: Map<PluginAssetKind, PluginAsset[]>,
  enabled: readonly PluginAssetKind[]
): void {
  for (const asset of incoming) {
    if (!enabled.includes(asset.kind)) continue
    if (asset.kind === 'trailer' || asset.kind === 'poster' || asset.kind === 'fanart') {
      // 这几种默认只取第一条：多版本会导致文件名冲突
      if ((assets.get(asset.kind)?.length ?? 0) > 0) continue
    }
    const bucket = assets.get(asset.kind) ?? []
    bucket.push(asset)
    assets.set(asset.kind, bucket)
  }
}

/** 封面优先级即 `COVER_ASSET_KINDS` 的顺序：poster > thumb > fanart */
function pickCover(
  covers: ReadonlyMap<PluginAssetKind, string>,
  connectionId: string
): ScrapeCoverRef | undefined {
  for (const kind of COVER_ASSET_KINDS) {
    const path = covers.get(kind)
    if (path) return { kind, path, id: resourceIdOf(connectionId, path) }
  }
  return undefined
}

/** 按顺序调用插件，尽可能补齐详情与资源 */
async function collectFromPlugins(
  context: ScrapeJobContext,
  enabled: readonly PluginAssetKind[]
): Promise<{ detail: PluginMovieDetail | null; pluginId: string; assets: Map<PluginAssetKind, PluginAsset[]> }> {
  const assets = new Map<PluginAssetKind, PluginAsset[]>()
  let detail: PluginMovieDetail | null = null
  let pluginId = ''

  for (const plugin of context.plugins) {
    if (context.signal.aborted) throw new ScrapeError('cancelled')
    try {
      if (!detail) {
        const candidates = readCandidates(
          await invokePlugin(plugin.id, 'search', { keyword: context.entry.keyword })
        )
        const picked = pickCandidate(candidates, context.entry.num, context.entry.keyword)
        if (picked) {
          const found = readDetail(await invokePlugin(plugin.id, 'detail', { movieId: picked.id }))
          if (found) {
            detail = found
            pluginId = plugin.id
          }
        }
      }
      if (detail) {
        const movieId = detail.id
        const missingCovers = COVER_ASSET_KINDS.some(
          (kind) => enabled.includes(kind) && (assets.get(kind)?.length ?? 0) === 0
        )
        if (missingCovers) {
          collectAssets(
            readAssets(await invokePlugin(plugin.id, 'covers', { movieId })),
            assets,
            enabled
          )
        }
        const missingExtras = EXTRA_ASSET_KINDS.some(
          (kind) => enabled.includes(kind) && (assets.get(kind)?.length ?? 0) === 0
        )
        if (missingExtras) {
          collectAssets(
            readAssets(await invokePlugin(plugin.id, 'extras', { movieId })),
            assets,
            enabled
          )
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      context.log.warn(`插件 ${plugin.name} 处理失败，继续尝试后续插件：${message}`)
    }
    if (isSatisfied(detail, assets, enabled)) break
  }

  return { detail, pluginId, assets }
}

/** 下载并上传一条资源；返回 false 表示按 keep 策略跳过 */
async function writeAsset(
  context: ScrapeJobContext,
  target: string,
  asset: PluginAsset,
  kind: PluginAssetKind
): Promise<boolean> {
  const { client, settings } = context
  if (keepFlagOf(settings.download, kind) && (await client.exists(target))) {
    context.log.info(`目标已存在，按保留设置跳过：${target}`)
    return false
  }
  const folder = dirnameRemotePath(target)
  if (folder !== FILE_ROOT) await client.mkdir(folder, { recursive: true })
  const download = await downloadAssetToTemp(asset, context.signal)
  try {
    await client.upload(download.localPath, target, { overwrite: true, signal: context.signal })
  } finally {
    await download.cleanup()
  }
  return true
}

/** NFO 落盘；返回实际写入的文件名 */
async function writeNfo(
  context: ScrapeJobContext,
  workDir: string,
  base: string,
  detail: PluginMovieDetail
): Promise<string[]> {
  const { client, settings } = context
  const content = buildNfoXml(detail, settings.naming)
  const written: string[] = []
  for (const name of nfoNames(settings.download, base)) {
    const target = joinRemotePath(workDir, name)
    if (settings.download.keepNfo && (await client.exists(target))) continue
    await client.writeText(target, content, { overwrite: true })
    written.push(name)
  }
  return written
}

/** 执行单个文件的完整流水线 */
export async function runFileJob(context: ScrapeJobContext): Promise<ScrapeJobOutcome> {
  const { entry, settings, client } = context
  const enabled = enabledAssetKinds(settings.download)
  const originalBase = baseNameOf(entry.name)
  const extension = extensionOf(entry.name)

  const { detail, pluginId, assets } = await collectFromPlugins(context, enabled)
  if (!detail) {
    if (settings.file.moveAfterFailure) {
      const failedDir = resolveOutputDir(settings.path.failedOutputDir, context.dirPath)
      if (failedDir !== context.dirPath) {
        await client.mkdir(failedDir, { recursive: true })
        await client.move(entry.path, joinRemotePath(failedDir, entry.name), { overwrite: false })
      }
    }
    return { status: 'failed', pluginId: '', title: '', message: '未找到匹配的刮削结果' }
  }

  const ruleBase = resolveVideoBase(detail, originalBase, settings.naming)
  const assetBase = settings.file.renameAfterSuccess ? ruleBase : originalBase
  const workDir = settings.file.moveAfterSuccess
    ? resolveOutputDir(settings.path.successOutputDir, context.dirPath)
    : context.dirPath
  if (workDir !== context.dirPath) await client.mkdir(workDir, { recursive: true })

  let assetCount = 0
  let assetFailures = 0
  const coverByKind = new Map<PluginAssetKind, string>()
  for (const kind of enabled) {
    const bucket = assets.get(kind) ?? []
    for (let index = 0; index < bucket.length; index += 1) {
      const asset = bucket[index]
      if (!asset) continue
      const plan = resolveAssetFile(asset, index + 1, {
        videoBase: assetBase,
        forceMovieStyle: !settings.file.renameAfterSuccess,
        naming: settings.naming,
        fanartDirName: settings.path.fanartDirName
      })
      const target = joinRemotePath(workDir, plan.relativePath)
      try {
        const stored = await writeAsset(context, target, asset, kind)
        if (stored) assetCount += 1
        // keep 策略跳过时目标同样是一张可用封面，这里一并记下
        if (COVER_ASSET_KINDS.includes(kind) && !coverByKind.has(kind)) {
          coverByKind.set(kind, target)
        }
      } catch (error) {
        if (context.signal.aborted) throw new ScrapeError('cancelled')
        assetFailures += 1
        const message = error instanceof Error ? error.message : '未知错误'
        context.log.warn(`资源写入失败（${plan.relativePath}）：${message}`)
      }
    }
  }

  let nfoNamesWritten: string[] = []
  if (settings.download.generateNfo) {
    try {
      nfoNamesWritten = await writeNfo(context, workDir, assetBase, detail)
    } catch (error) {
      if (context.signal.aborted) throw new ScrapeError('cancelled')
      const message = error instanceof Error ? error.message : '未知错误'
      context.log.warn(`NFO 写入失败：${message}`)
    }
  }

  const finalName = settings.file.renameAfterSuccess ? `${ruleBase}${extension}` : entry.name
  const targetPath = joinRemotePath(workDir, finalName)
  if (targetPath !== entry.path) {
    try {
      await client.move(entry.path, targetPath, { overwrite: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      throw new ScrapeError('moveFailed', `移动文件失败：${message}`)
    }
  }

  const parts = [`插件 ${pluginId}`, `${assetCount} 个资源`]
  if (nfoNamesWritten.length > 0) parts.push(`NFO ${nfoNamesWritten.join('、')}`)
  if (assetFailures > 0) parts.push(`${assetFailures} 个资源失败`)
  if (targetPath !== entry.path) parts.push(`→ ${targetPath}`)

  const cover = pickCover(coverByKind, context.connectionId)

  return {
    status: 'success',
    pluginId,
    title: detail.title,
    message: parts.join('，'),
    ...(cover ? { cover } : {})
  }
}

/** 判断文件是否已在之前的运行里完成（用于「继续」时跳过） */
export function isFinishedStatus(status: ScrapeFileStatus): boolean {
  return status === 'success' || status === 'skipped'
}

/** 文件名解析出的关键词（运行器组装任务行时复用） */
export function keywordOf(name: string): { keyword: string; num: string } {
  const parsed = extractKeyword(name)
  return { keyword: parsed.cleaned, num: parsed.num }
}
