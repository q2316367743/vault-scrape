/**
 * 插件文件的批量导入预处理：读取、编译、批内择优。
 *
 * 契约：
 * 1. 逐个文件独立成败：读不出或编译失败只记入 `failed`，不影响同批其它文件；
 * 2. 同 id 在批内只保留最新：先比 `meta.version`，版本相同再比源文件 mtime，落选者进 `skipped`；
 * 3. 本模块只做预处理，**不写索引、不写源码**：与本机已安装记录的比较和落盘由 `pluginRegistry` 完成；
 * 4. 编译期的 console 输出先缓冲，等 id 确定后由 `flush(id)` 落到对应类别的插件日志。
 */
import { statSync } from 'node:fs'
import { basename } from 'node:path'
import {
  comparePluginVersion,
  describePluginError,
  type PluginImportFailure,
  type PluginImportSkipped,
  type PluginKind,
  type PluginMeta
} from '@common/types/plugin'
import { appendLog } from '$/db/repo/logRepo'
import { createPluginLogSink } from './pluginHost'
import { compilePlugin, type CompiledPlugin } from './pluginRuntime'
import { readPluginFile } from './pluginStore'
import type { LogLevel } from '@common/types/log'

interface BufferedLog {
  level: LogLevel
  message: string
  detail?: string
}

/** 批内候选：编译结果 + 源文件 mtime（同版本时用于排序） */
export interface ImportCandidate {
  filePath: string
  source: string
  compiled: CompiledPlugin
  flush: (id: string) => void
  mtimeMs: number
}

export interface PreparedImport {
  /** 批内每个 id 的胜者，顺序即文件被选中的顺序 */
  winners: ImportCandidate[]
  skipped: PluginImportSkipped[]
  failed: PluginImportFailure[]
}

/** 编译导入的源码，并把顶层 console 输出暂存到 id 确定后再落库 */
function compileImported(
  kind: PluginKind,
  source: string,
  fileName: string
): { compiled: CompiledPlugin; flush: (id: string) => void } {
  const buffer: BufferedLog[] = []
  const compiled = compilePlugin(
    kind,
    source,
    (level, message, detail) => {
      buffer.push({ level, message, detail })
    },
    fileName
  )
  return {
    compiled,
    flush: (id) => {
      const sink = createPluginLogSink(kind, id)
      for (const item of buffer) sink(item.level, item.message, item.detail)
    }
  }
}

/** 读源文件 mtime；读不到时按 0 处理，不影响导入成败 */
function fileMtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

/** 批内择优：版本高者胜；版本相同取 mtime 更大者；两者都相同则由先选中者保持胜出 */
function isNewerCandidate(candidate: ImportCandidate, current: ImportCandidate): boolean {
  const byVersion = comparePluginVersion(
    candidate.compiled.meta.version,
    current.compiled.meta.version
  )
  if (byVersion !== 0) return byVersion > 0
  return candidate.mtimeMs > current.mtimeMs
}

export function preparePluginImport(
  kind: PluginKind,
  paths: readonly string[]
): PreparedImport {
  const winners = new Map<string, ImportCandidate>()
  const skipped: PluginImportSkipped[] = []
  const failed: PluginImportFailure[] = []

  function skip(filePath: string, meta: PluginMeta, keptVersion: string, message: string): void {
    skipped.push({ filePath, id: meta.id, name: meta.name, keptVersion, message })
    appendLog({
      level: 'info',
      scope: `plugin:${kind}:${meta.id}`,
      message: `已跳过旧版本插件：${basename(filePath)}`
    })
  }

  for (const filePath of paths) {
    try {
      const source = readPluginFile(filePath)
      const { compiled, flush } = compileImported(kind, source, basename(filePath))
      const candidate: ImportCandidate = {
        filePath,
        source,
        compiled,
        flush,
        mtimeMs: fileMtime(filePath)
      }
      const current = winners.get(compiled.meta.id)
      if (current && isNewerCandidate(candidate, current)) {
        winners.set(compiled.meta.id, candidate)
        skip(
          current.filePath,
          current.compiled.meta,
          compiled.meta.version,
          `同批中已保留更新的版本 v${compiled.meta.version}`
        )
        continue
      }
      if (current) {
        skip(
          filePath,
          compiled.meta,
          current.compiled.meta.version,
          `同批中已保留更新的版本 v${current.compiled.meta.version}`
        )
        continue
      }
      winners.set(compiled.meta.id, candidate)
    } catch (error) {
      const { code, message } = describePluginError(error)
      failed.push({ filePath, code, message })
    }
  }

  return { winners: [...winners.values()], skipped, failed }
}
