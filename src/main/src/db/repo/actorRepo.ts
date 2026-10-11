/**
 * 演员仓储：`actor` / `actor_alias` / `actor_image` / `media_cast` 四张表的读写。
 *
 * 契约：
 * - 返回 schema 行类型，展示形状由 actor 模块组装；
 * - 身份唯一键是 `name_key`：新增前先按姓名键查、再按别名键查，都匹配不到才建新演员；
 * - `tags` 是 JSON 文本列，读写都走本文件的转换函数，解析失败回落空数组；
 * - 与影视的关联是**弱关联**：`media_cast` 只存演员名字与名字键，双向查询（演员→作品、
 *   作品→演员）都按 `name_key` 匹配，任何一边改名都不会产生悬挂行；
 * - 删除演员时连带清掉别名与图片行，**不动** `media_cast`（那只是名字）。
 */
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, exists, inArray, like, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { actorNameKey } from '@common/types/actor'
import type { ActorGender, ActorImageKind, ActorImageSource, ActorSort } from '@common/types/actor'
import { db } from '../client'
import { actorAliasTable, actorImageTable, actorTable, mediaCastTable, mediaItemTable } from '../schema'
import type { ActorAliasRow, ActorImageRow, ActorRow } from '../schema'

/** 演员资料的写入补丁：只写出现的字段 */
export interface ActorProfilePatch {
  name?: string
  gender?: ActorGender
  birthday?: string
  birthCountry?: string
  birthProvince?: string
  birthCity?: string
  birthCounty?: string
  height?: number
  bust?: number
  waist?: number
  hip?: number
  cup?: string
  tagline?: string
  sourceUrl?: string
  overview?: string
  tags?: string[]
  avatarImageId?: string
  locked?: boolean
  scraperId?: string
  scrapedAt?: number
}

/** 新建演员：只有姓名是必填，其余走默认值 */
export interface ActorCreateInput extends ActorProfilePatch {
  id: string
  name: string
}

/** 列表一行：演员行 + 出演作品数 */
export interface ActorListEntry {
  actor: ActorRow
  filmCount: number
}

export interface ActorListQuery {
  keyword: string
  tag: string
  sort: ActorSort
  offset: number
  limit: number
}

export interface ActorImageInput {
  id: string
  actorId: string
  kind: ActorImageKind
  path: string
  name: string
  extname: string
  mime: string
  size: number
  width: number
  height: number
  source: ActorImageSource
}

type ActorColumns = Partial<typeof actorTable.$inferInsert>

function parseTags(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** `tags` JSON 文本列 → 字符串数组（解析失败回落空数组） */
export function actorTagsOf(row: ActorRow): string[] {
  return parseTags(row.tags)
}

/** 把补丁转成列集合；`name` 与 `nameKey` 始终一起写，避免身份键与姓名脱节 */
function actorColumns(patch: ActorProfilePatch): ActorColumns {
  const columns: ActorColumns = {}
  if (patch.name !== undefined) {
    columns.name = patch.name
    columns.nameKey = actorNameKey(patch.name)
  }
  if (patch.gender !== undefined) columns.gender = patch.gender
  if (patch.birthday !== undefined) columns.birthday = patch.birthday
  if (patch.birthCountry !== undefined) columns.birthCountry = patch.birthCountry
  if (patch.birthProvince !== undefined) columns.birthProvince = patch.birthProvince
  if (patch.birthCity !== undefined) columns.birthCity = patch.birthCity
  if (patch.birthCounty !== undefined) columns.birthCounty = patch.birthCounty
  if (patch.height !== undefined) columns.height = patch.height
  if (patch.bust !== undefined) columns.bust = patch.bust
  if (patch.waist !== undefined) columns.waist = patch.waist
  if (patch.hip !== undefined) columns.hip = patch.hip
  if (patch.cup !== undefined) columns.cup = patch.cup
  if (patch.tagline !== undefined) columns.tagline = patch.tagline
  if (patch.sourceUrl !== undefined) columns.sourceUrl = patch.sourceUrl
  if (patch.overview !== undefined) columns.overview = patch.overview
  if (patch.tags !== undefined) columns.tags = JSON.stringify(patch.tags)
  if (patch.avatarImageId !== undefined) columns.avatarImageId = patch.avatarImageId
  if (patch.locked !== undefined) columns.locked = patch.locked
  if (patch.scraperId !== undefined) columns.scraperId = patch.scraperId
  if (patch.scrapedAt !== undefined) columns.scrapedAt = patch.scrapedAt
  return columns
}

/** 作品数：弱关联下直接数 `media_cast` 里名字键相同的行，不必 join */
const filmCountOf = sql<number>`(select count(*) from ${mediaCastTable} where ${mediaCastTable.nameKey} = ${actorTable.nameKey})`

export function getActor(id: string): ActorRow | null {
  return db().select().from(actorTable).where(eq(actorTable.id, id)).get() ?? null
}

/** 按姓名匹配（身份归一后再比） */
export function findActorByName(name: string): ActorRow | null {
  const key = actorNameKey(name)
  if (!key) return null
  return db().select().from(actorTable).where(eq(actorTable.nameKey, key)).get() ?? null
}

/** 按别名匹配 */
export function findActorByAlias(alias: string): ActorRow | null {
  const key = actorNameKey(alias)
  if (!key) return null
  const row =
    db().select().from(actorAliasTable).where(eq(actorAliasTable.aliasKey, key)).get() ?? null
  return row ? getActor(row.actorId) : null
}

/** 按姓名找，找不到就建一个只有姓名的演员 */
export function ensureActorByName(input: ActorCreateInput): ActorRow {
  const existing = findActorByName(input.name)
  if (existing) return existing

  const now = Date.now()
  db()
    .insert(actorTable)
    .values({
      id: input.id,
      name: input.name,
      nameKey: actorNameKey(input.name),
      createdAt: now,
      updatedAt: now,
      ...actorColumns(input)
    })
    .onConflictDoNothing({ target: actorTable.nameKey })
    .run()
  const created = findActorByName(input.name)
  if (!created) throw new Error(`演员写入失败：${input.name}`)
  return created
}

export function updateActor(id: string, patch: ActorProfilePatch): boolean {
  const columns = actorColumns(patch)
  if (Object.keys(columns).length === 0) return false
  return db()
    .update(actorTable)
    .set({ ...columns, updatedAt: Date.now() })
    .where(eq(actorTable.id, id))
    .run().changes > 0
}

/** 姓名或别名模糊匹配；SQLite 的 LIKE 对 ASCII 不区分大小写 */
function keywordFilter(pattern: string): SQL | undefined {
  return or(
    like(actorTable.name, pattern),
    exists(
      db()
        .select({ one: sql`1` })
        .from(actorAliasTable)
        .where(and(eq(actorAliasTable.actorId, actorTable.id), like(actorAliasTable.alias, pattern)))
    )
  )
}

/** 用户标签匹配：`tags` 是 JSON 文本，直接按「JSON 里的整个字符串」匹配即可 */
function tagFilter(tag: string): SQL | undefined {
  const trimmed = tag.trim()
  return trimmed ? like(actorTable.tags, `%${JSON.stringify(trimmed)}%`) : undefined
}

function actorFilters(keyword: string, tag: string): SQL[] {
  const filters: SQL[] = []
  if (keyword.trim()) {
    const matched = keywordFilter(`%${keyword.trim()}%`)
    if (matched) filters.push(matched)
  }
  const tagged = tagFilter(tag)
  if (tagged) filters.push(tagged)
  return filters
}

export function listActors(query: ActorListQuery): ActorListEntry[] {
  const filters = actorFilters(query.keyword, query.tag)
  const rows = db()
    .select({ actor: actorTable, filmCount: filmCountOf })
    .from(actorTable)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(
      query.sort === 'name'
        ? asc(actorTable.name)
        : query.sort === 'films'
          ? desc(filmCountOf)
          : desc(actorTable.updatedAt)
    )
    .limit(query.limit)
    .offset(query.offset)
    .all()
  return rows.map((row) => ({ actor: row.actor, filmCount: Number(row.filmCount) }))
}

export function countActors(keyword: string, tag: string): number {
  const filters = actorFilters(keyword, tag)
  const row = db()
    .select({ total: sql<number>`count(*)` })
    .from(actorTable)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .get()
  return Number(row?.total ?? 0)
}

/** 库里出现过的全部用户标签（去重后按中文排序） */
export function listAllTags(): string[] {
  const rows = db().select({ tags: actorTable.tags }).from(actorTable).all()
  const tags = new Set<string>()
  for (const row of rows) for (const tag of parseTags(row.tags)) tags.add(tag)
  return [...tags].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

/** 资料不全的演员：从未抓取、没有头像或没有生日，供「抓取缺失资料」批量排队 */
export function listIncompleteActors(limit: number): ActorRow[] {
  return db()
    .select()
    .from(actorTable)
    .where(
      or(
        eq(actorTable.scrapedAt, 0),
        eq(actorTable.avatarImageId, ''),
        eq(actorTable.birthday, '')
      )
    )
    .orderBy(asc(actorTable.updatedAt))
    .limit(limit)
    .all()
}

/** 某个演员名下的作品数（按归一化姓名键数 `media_cast`） */
export function countFilmsByNameKey(nameKey: string): number {
  if (!nameKey) return 0
  const row = db()
    .select({ total: sql<number>`count(*)` })
    .from(mediaCastTable)
    .where(eq(mediaCastTable.nameKey, nameKey))
    .get()
  return Number(row?.total ?? 0)
}

/** 按姓名批量取演员行（影片详情页的演员条一次把名字换成头像） */
export function listActorsByNames(names: readonly string[]): ActorRow[] {
  const keys = new Set<string>()
  for (const name of names) {
    const key = actorNameKey(name)
    if (key) keys.add(key)
  }
  if (keys.size === 0) return []
  return db()
    .select()
    .from(actorTable)
    .where(inArray(actorTable.nameKey, [...keys]))
    .all()
}

export function listAliases(actorId: string): ActorAliasRow[] {
  return db()
    .select()
    .from(actorAliasTable)
    .where(eq(actorAliasTable.actorId, actorId))
    .orderBy(asc(actorAliasTable.alias))
    .all()
}

/** 整组替换别名（保存演员时调用） */
export function replaceAliases(actorId: string, aliases: readonly string[]): void {
  db().delete(actorAliasTable).where(eq(actorAliasTable.actorId, actorId)).run()
  const seen = new Set<string>()
  for (const alias of aliases) {
    const trimmed = alias.trim()
    const key = actorNameKey(trimmed)
    if (!trimmed || !key || seen.has(key)) continue
    seen.add(key)
    db()
      .insert(actorAliasTable)
      .values({ id: randomUUID(), actorId, alias: trimmed, aliasKey: key })
      .onConflictDoNothing()
      .run()
  }
}

export function getActorImage(imageId: string): ActorImageRow | null {
  return (
    db().select().from(actorImageTable).where(eq(actorImageTable.id, imageId)).get() ?? null
  )
}

export function listActorImages(actorId: string): ActorImageRow[] {
  return db()
    .select()
    .from(actorImageTable)
    .where(eq(actorImageTable.actorId, actorId))
    .orderBy(asc(actorImageTable.createdAt))
    .all()
}

export function insertActorImage(input: ActorImageInput): void {
  db()
    .insert(actorImageTable)
    .values({ ...input, createdAt: Date.now() })
    .run()
}

/** 删除一张图片行，并在它是头像时清空演员的头像引用 */
export function deleteActorImage(actorId: string, imageId: string): boolean {
  const row = getActorImage(imageId)
  if (!row || row.actorId !== actorId) return false
  db().delete(actorImageTable).where(eq(actorImageTable.id, imageId)).run()
  const actor = getActor(actorId)
  if (actor?.avatarImageId === imageId) updateActor(actorId, { avatarImageId: '' })
  return true
}

export function setActorAvatar(actorId: string, imageId: string): boolean {
  const row = getActorImage(imageId)
  if (!row || row.actorId !== actorId) return false
  return updateActor(actorId, { avatarImageId: imageId })
}

/** 整组替换某个条目的参演名单（扫描与刮削都走这里）；只存名字，下标即出演顺序 */
export function replaceItemCast(itemId: string, names: readonly string[]): void {
  db().delete(mediaCastTable).where(eq(mediaCastTable.itemId, itemId)).run()
  const seen = new Set<string>()
  for (const name of names) {
    const trimmed = name.trim()
    const key = actorNameKey(trimmed)
    if (!key || seen.has(key)) continue
    db()
      .insert(mediaCastTable)
      .values({ itemId, actorName: trimmed, nameKey: key, ordinal: seen.size })
      .onConflictDoNothing()
      .run()
    seen.add(key)
  }
}

/** 某个条目的参演名单，按出演顺序 */
export function listItemCastNames(itemId: string): string[] {
  return db()
    .select({ name: mediaCastTable.actorName })
    .from(mediaCastTable)
    .where(eq(mediaCastTable.itemId, itemId))
    .orderBy(asc(mediaCastTable.ordinal))
    .all()
    .map((row) => row.name)
}

/** 某个演员（按姓名键）的出演作品 ID，按条目入库时间倒序 */
export function listItemIdsByActorNameKey(nameKey: string): string[] {
  if (!nameKey) return []
  return db()
    .select({ itemId: mediaCastTable.itemId })
    .from(mediaCastTable)
    .innerJoin(mediaItemTable, eq(mediaItemTable.id, mediaCastTable.itemId))
    .where(eq(mediaCastTable.nameKey, nameKey))
    .orderBy(desc(mediaItemTable.dateAdded))
    .all()
    .map((row) => row.itemId)
}

/** 条目被删时清掉它的参演名单 */
export function deleteCastByItems(itemIds: readonly string[]): number {
  if (itemIds.length === 0) return 0
  return db()
    .delete(mediaCastTable)
    .where(inArray(mediaCastTable.itemId, [...itemIds]))
    .returning({ itemId: mediaCastTable.itemId })
    .all().length
}

/** 删除演员：连同别名与图片行一起删；返回图片行供调用方清磁盘文件（`media_cast` 是名字，不动） */
export function deleteActor(actorId: string): ActorImageRow[] {
  const images = listActorImages(actorId)
  db().delete(actorAliasTable).where(eq(actorAliasTable.actorId, actorId)).run()
  db().delete(actorImageTable).where(eq(actorImageTable.actorId, actorId)).run()
  db().delete(actorTable).where(eq(actorTable.id, actorId)).run()
  return images
}
