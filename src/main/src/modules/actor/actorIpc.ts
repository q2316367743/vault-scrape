/**
 * 演员模块的 IPC 注册。
 *
 * 契约（沿用 media / scrape 域写法）：
 * 1. 模块内部抛 `ActorError`，**只有 IPC 边界**把错误转成 `ActorResult` 信封；
 * 2. 入参一律按 unknown 从渲染层收窄，缺字段抛 `invalidArgument`；
 * 3. `scrape` 是同步等待一次抓取结果，`scrapeMissing` 只排队、立即返回，
 *    `scrapeStatus` 读队列快照，进度另有 `actor:progress` 单向推送。
 */
import { ipcMain } from 'electron'
import {
  ACTOR_GENDERS,
  ACTOR_IMAGE_KINDS,
  ACTOR_SORTS,
  ActorError,
  describeActorError,
  actorFail,
  actorOk,
  type ActorDetailResult,
  type ActorImageImportRequest,
  type ActorImageImportResult,
  type ActorImageRequest,
  type ActorListRequest,
  type ActorListResult,
  type ActorRemoveRequest,
  type ActorResult,
  type ActorSaveRequest,
  type ActorSaveResult,
  type ActorScrapeMissingResult,
  type ActorScrapeRequest,
  type ActorScrapeResult,
  type ActorScrapeStatus
} from '@common/types/actor'
import {
  readBoolean,
  readEnum,
  readNumber,
  readString,
  readStringArray,
  toSource
} from '@common/types/setting/shared'
import { ActorChannels } from '~/modules/actor/actorChannels'
import { ACTOR_SCRAPE_MISSING_LIMIT, actorScrapeStatus, scrapeActor, scrapeMissingActors } from './actorScrape'
import { importActorImages, removeActorImage } from './actorAsset'
import { loadActorDetail, loadActorList } from './actorService'
import { removeActor, saveActor, setActorAvatarOf } from './actorWrite'

function handle<T>(task: () => Promise<T> | T): Promise<ActorResult<T>> {
  return Promise.resolve()
    .then(task)
    .then((data) => actorOk(data))
    .catch((error: unknown) => {
      const { code, message } = describeActorError(error)
      return actorFail(code, message)
    })
}

function payloadOf(payload: unknown): Record<string, unknown> {
  return toSource(payload) ?? {}
}

function readId(source: Record<string, unknown>, key: string, label: string): string {
  const value = readString(source, key, '').trim()
  if (value.length === 0) throw new ActorError('invalidArgument', `缺少${label}`)
  return value
}

function readListRequest(payload: unknown): ActorListRequest {
  const source = payloadOf(payload)
  return {
    keyword: readString(source, 'keyword', ''),
    tag: readString(source, 'tag', ''),
    sort: readEnum(source, 'sort', ACTOR_SORTS, 'updated'),
    offset: readNumber(source, 'offset', 0),
    limit: readNumber(source, 'limit', 60, 1)
  }
}

function readSaveRequest(payload: unknown): ActorSaveRequest {
  const source = payloadOf(payload)
  return {
    actorId: readString(source, 'actorId', ''),
    name: readString(source, 'name', ''),
    aliases: readStringArray(source, 'aliases', []),
    gender: readEnum(source, 'gender', ACTOR_GENDERS, ''),
    birthday: readString(source, 'birthday', ''),
    birthCountry: readString(source, 'birthCountry', ''),
    birthProvince: readString(source, 'birthProvince', ''),
    birthCity: readString(source, 'birthCity', ''),
    birthCounty: readString(source, 'birthCounty', ''),
    height: readNumber(source, 'height', 0),
    bust: readNumber(source, 'bust', 0),
    waist: readNumber(source, 'waist', 0),
    hip: readNumber(source, 'hip', 0),
    cup: readString(source, 'cup', ''),
    tagline: readString(source, 'tagline', ''),
    sourceUrl: readString(source, 'sourceUrl', ''),
    overview: readString(source, 'overview', ''),
    tags: readStringArray(source, 'tags', []),
    locked: readBoolean(source, 'locked', false)
  }
}

function readImageRequest(payload: unknown): ActorImageRequest {
  const source = payloadOf(payload)
  return {
    actorId: readId(source, 'actorId', '演员 ID'),
    imageId: readId(source, 'imageId', '图片 ID')
  }
}

function readImportRequest(payload: unknown): ActorImageImportRequest {
  const source = payloadOf(payload)
  return {
    actorId: readId(source, 'actorId', '演员 ID'),
    paths: readStringArray(source, 'paths', []),
    kind: readEnum(source, 'kind', ACTOR_IMAGE_KINDS, 'photo')
  }
}

function readScrapeRequest(payload: unknown): ActorScrapeRequest {
  const source = payloadOf(payload)
  return {
    actorId: readId(source, 'actorId', '演员 ID'),
    pluginIds: readStringArray(source, 'pluginIds', [])
  }
}

export function registerActorIpc(): void {
  ipcMain.handle(ActorChannels.list, (_event, payload: unknown) =>
    handle<ActorListResult>(() => loadActorList(readListRequest(payload)))
  )
  ipcMain.handle(ActorChannels.detail, (_event, payload: unknown) =>
    handle<ActorDetailResult>(() =>
      loadActorDetail({ actorId: readId(payloadOf(payload), 'actorId', '演员 ID') })
    )
  )
  ipcMain.handle(ActorChannels.save, (_event, payload: unknown) =>
    handle<ActorSaveResult>(() => saveActor(readSaveRequest(payload)))
  )
  ipcMain.handle(ActorChannels.remove, (_event, payload: unknown) =>
    handle<null>(() => {
      const request: ActorRemoveRequest = { actorId: readId(payloadOf(payload), 'actorId', '演员 ID') }
      removeActor(request)
      return null
    })
  )
  ipcMain.handle(ActorChannels.importImages, (_event, payload: unknown) =>
    handle<ActorImageImportResult>(() => importActorImages(readImportRequest(payload)))
  )
  ipcMain.handle(ActorChannels.removeImage, (_event, payload: unknown) =>
    handle<null>(() => {
      const request = readImageRequest(payload)
      removeActorImage(request.actorId, request.imageId)
      return null
    })
  )
  ipcMain.handle(ActorChannels.setAvatar, (_event, payload: unknown) =>
    handle<null>(() => {
      setActorAvatarOf(readImageRequest(payload))
      return null
    })
  )
  ipcMain.handle(ActorChannels.scrape, (_event, payload: unknown) =>
    handle<ActorScrapeResult>(() => scrapeActor(readScrapeRequest(payload), new AbortController().signal))
  )
  ipcMain.handle(ActorChannels.scrapeMissing, () =>
    handle<ActorScrapeMissingResult>(() => scrapeMissingActors(ACTOR_SCRAPE_MISSING_LIMIT))
  )
  ipcMain.handle(ActorChannels.scrapeStatus, () =>
    handle<ActorScrapeStatus>(() => actorScrapeStatus())
  )
}
