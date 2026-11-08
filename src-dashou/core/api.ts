/**
 * core 的 API 总表：窗口侧通过 `plugin:api|<name>` 调到这里。
 *
 * 契约：
 * - 每个域一个 `xxxApi` 对象，名字是扁平 camelCase（窗口侧用 `useApi<CoreApi>()` 调用）；
 * - 长任务（可能超过宿主 30s 上限）不走直接调用，而是登记进 `registerLongJobs()`，
 *   由 `coreJob` 启动、结果通过 `core:job:done` 回传；
 * - 本文件只做拼装，不写业务。
 */
import type { PluginContext } from '@dashou/core'
import { actorApi } from './modules/actor/actorApi'
import { dbApi } from './db/dbApi'
import { fileApi } from './modules/file/fileApi'
import { libraryApi } from './modules/library/libraryApi'
import { mediaApi } from './modules/media/mediaApi'
import { offlineApi } from './modules/offline/offlineApi'
import { playerApi } from './modules/player/playerApi'
import { pluginApi } from './modules/plugin/pluginApi'
import { scrapeApi } from './modules/scrape/scrapeApi'
import { settingApi } from './modules/setting/settingApi'
import { translateApi } from './modules/translate/translateApi'
import { appApi } from './runtime/appApi'
import { dialogApi } from './runtime/dialogApi'
import { registerJob, startJob } from './runtime/jobs'

/** 需要走长任务通道的方法：名字 → 实际处理器 */
const LONG_JOBS = {
  'dialog.open': dialogApi.dialogOpen,
  'dialog.save': dialogApi.dialogSave,
  'plugin.import': pluginApi.pluginImport,
  'plugin.invoke': pluginApi.pluginInvoke,
  'library.scan': libraryApi.libraryScan,
  'scrape.match': scrapeApi.scrapeMatch,
  'actor.scrape': actorApi.actorScrape,
  'actor.importImages': actorApi.actorImportImages,
  'translate.item': translateApi.translateItem,
  'offline.importLocal': offlineApi.offlineImportLocal,
  'media.clearNfo': mediaApi.mediaClearNfo,
  'file.remove': fileApi.fileRemove,
  'file.testConnection': fileApi.fileTestConnection
} as const

/** 在 `onReady` 里注册一次长任务处理器 */
export function registerLongJobs(): void {
  for (const [name, handler] of Object.entries(LONG_JOBS)) {
    registerJob(name, handler)
  }
}

export const api = {
  ...actorApi,
  ...dbApi,
  ...fileApi,
  ...libraryApi,
  ...mediaApi,
  ...offlineApi,
  ...playerApi,
  ...pluginApi,
  ...scrapeApi,
  ...settingApi,
  ...translateApi,
  ...appApi,
  ...dialogApi,

  /** 长任务入口：立即返回 jobId，结果走 `core:job:done` */
  coreJob: (ctx: PluginContext, payload: unknown): { jobId: string } => startJob(ctx, payload)
}

export type Api = typeof api
