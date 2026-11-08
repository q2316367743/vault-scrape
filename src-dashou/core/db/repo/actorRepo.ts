/**
 * 演员仓储：`actor` / `actor_alias` / `actor_image` / `media_cast` 四张表的读写。
 *
 * 契约：
 * - 返回 schema 行类型，展示形状由 actor 模块组装；
 * - 身份唯一键是 `name_key`：新增前先按姓名键查、再按别名键查，都匹配不到才建新演员；
 * - `tags` 是 JSON 文本列，读写都走本文件的转换函数，解析失败回落空数组；
 * - 与影视的关联是**弱关联**：`media_cast` 只存演员名字与名字键，双向查询都按 `name_key` 匹配；
 * - 删除演员时连带清掉别名与图片行，**不动** `media_cast`（那只是名字）。
 */
import { randomUUID } from 'node:crypto'
import { actorNameKey } from '@common/types/actor'
import type { ActorGender, ActorImageKind, ActorImageSource, ActorSort } from '@common/types/actor'
import { boolOf, transaction } from '../client'
import { ACTOR_ALIAS_COLUMNS, ACTOR_COLUMNS, ACTOR_COLUMNS_PREFIXED, ACTOR_IMAGE_COLUMNS } from '../columns'
import { allOf, oneOf, placeholders, runOf, type SqlValue } from '../query'
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

/** ActorProfilePatch 的 camelCase 键 → SQL 列名 */
const ACTOR_COLUMN_OF: Readonly<Record<keyof ActorProfilePatch, string>> = {
  name: 'name',
  gender: 'gender',
  birthday: 'birthday',
  birthCountry: 'birth_country',
  birthProvince: 'birth_province',
  birthCity: 'birth_city',
  birthCounty: 'birth_county',
  height: 'height',
  bust: 'bust',
  waist: 'waist',
  hip: 'hip',
  cup: 'cup',
  tagline: 'tagline',
  sourceUrl: 'source_url',
  overview: 'overview',
  tags: 'tags',
  avatarImageId: 'avatar_image_id',
  locked: 'locked',
  scraperId: 'scraper_id',
  scrapedAt: 'scraped_at'
}

function parseTags(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

/** `tags` JSON 文本列 → 字符串数组（解析失败回落空数组） */
export function actorTagsOf(row: ActorRow): string[] {
  return parseTags(row.tags)
}

/** SQLite 的 0/1 → boolean */
function toActorRow(row: ActorRow): ActorRow {
  return { ...row, locked: boolOf(row.locked) }
}

/** 把补丁转成「列 = 值」；`name` 与 `name_key` 始终一起写，避免身份键与姓名脱节 */
function actorAssignments(patch: ActorProfilePatch): { columns: string[]; params: SqlValue[] } {
  const columns: string[] = []
  const params: SqlValue[] = []
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const column = ACTOR_COLUMN_OF[key as keyof ActorProfilePatch]
    if (!column) continue
    columns.push(`${column} = ?`)
    if (key === 'name') {
      params.push(value as string, actorNameKey(value as string))
      columns.push('name_key = ?')
      continue
    }
    if (key === 'tags') {
      params.push(JSON.stringify(value))
      continue
    }
    if (key === 'locked') {
      params.push(value ? 1 : 0)
      continue
    }
    params.push(value as SqlValue)
  }
  return { columns, params }
}

/** 作品数：弱关联下直接数 `media_cast` 里名字键相同的行，不必 join */
const FILM_COUNT_SQL = '(SELECT count(*) FROM media_cast WHERE media_cast.name_key = actor.name_key)'

export function getActor(id: string): ActorRow | null {
  const row = oneOf<ActorRow>(`SELECT ${ACTOR_COLUMNS} FROM actor WHERE id = ?`, [id])
  return row ? toActorRow(row) : null
}

/** 按姓名匹配（身份归一后再比） */
export function findActorByName(name: string): ActorRow | null {
  const key = actorNameKey(name)
  if (!key) return null
  const row = oneOf<ActorRow>(`SELECT ${ACTOR_COLUMNS} FROM actor WHERE name_key = ?`, [key])
  return row ? toActorRow(row) : null
}

/** 按别名匹配 */
export function findActorByAlias(alias: string): ActorRow | null {
  const key = actorNameKey(alias)
  if (!key) return null
  const row = oneOf<ActorAliasRow>(
    `SELECT ${ACTOR_ALIAS_COLUMNS} FROM actor_alias WHERE alias_key = ?`,
    [key]
  )
  return row ? getActor(row.actorId) : null
}

/** 按姓名找，找不到就建一个只有姓名的演员 */
export function ensureActorByName(input: ActorCreateInput): ActorRow {
  const existing = findActorByName(input.name)
  if (existing) return existing

  const now = Date.now()
  const extra = actorAssignments(input)
  const columns = ['id', 'name', 'name_key', 'created_at', 'updated_at']
  const params: SqlValue[] = [input.id, input.name, actorNameKey(input.name), now, now]
  // actorAssignments 会重复写 name / name_key，这里跳过它们，只取其余字段
  for (let index = 0; index < extra.columns.length; index += 1) {
    const column = extra.columns[index]
    if (column.startsWith('name =') || column.startsWith('name_key =')) continue
    columns.push(column.replace(' = ?', ''))
    params.push(extra.params[index])
  }
  runOf(
    `INSERT INTO actor (${columns.join(', ')}) VALUES (${placeholders(columns.length)})
      ON CONFLICT(name_key) DO NOTHING`,
    params
  )
  const created = findActorByName(input.name)
  if (!created) throw new Error(`演员写入失败：${input.name}`)
  return created
}

export function updateActor(id: string, patch: ActorProfilePatch): boolean {
  const { columns, params } = actorAssignments(patch)
  if (columns.length === 0) return false
  params.push(Date.now(), id)
  return (
    runOf(`UPDATE actor SET ${columns.join(', ')}, updated_at = ? WHERE id = ?`, params) > 0
  )
}

/** 姓名或别名模糊匹配；SQLite 的 LIKE 对 ASCII 不区分大小写 */
function actorFilter(keyword: string, tag: string): { where: string; params: SqlValue[] } {
  const clauses: string[] = []
  const params: SqlValue[] = []
  const trimmedKeyword = keyword.trim()
  if (trimmedKeyword) {
    const pattern = `%${trimmedKeyword}%`
    clauses.push(
      '(actor.name LIKE ? OR EXISTS (SELECT 1 FROM actor_alias WHERE actor_alias.actor_id = actor.id AND actor_alias.alias LIKE ?))'
    )
    params.push(pattern, pattern)
  }
  const trimmedTag = tag.trim()
  if (trimmedTag) {
    clauses.push('actor.tags LIKE ?')
    params.push(`%${JSON.stringify(trimmedTag)}%`)
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listActors(query: ActorListQuery): ActorListEntry[] {
  const filter = actorFilter(query.keyword, query.tag)
  const order =
    query.sort === 'name'
      ? 'actor.name ASC'
      : query.sort === 'films'
        ? `${FILM_COUNT_SQL} DESC`
        : 'actor.updated_at DESC'
  const rows = allOf<ActorRow & { filmCount: number }>(
    `SELECT ${ACTOR_COLUMNS_PREFIXED}, ${FILM_COUNT_SQL} AS filmCount
      FROM actor ${filter.where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...filter.params, query.limit, query.offset]
  )
  return rows.map((row) => ({
    actor: toActorRow(row),
    filmCount: Number(row.filmCount ?? 0)
  }))
}

export function countActors(keyword: string, tag: string): number {
  const filter = actorFilter(keyword, tag)
  const row = oneOf<{ total: number }>(
    `SELECT count(*) AS total FROM actor ${filter.where}`,
    filter.params
  )
  return Number(row?.total ?? 0)
}

/** 库里出现过的全部用户标签（去重后按中文排序） */
export function listAllTags(): string[] {
  const rows = allOf<{ tags: string }>('SELECT tags FROM actor')
  const tags = new Set<string>()
  for (const row of rows) for (const tag of parseTags(row.tags)) tags.add(tag)
  return [...tags].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

/** 资料不全的演员：从未抓取、没有头像或没有生日，供「抓取缺失资料」批量排队 */
export function listIncompleteActors(limit: number): ActorRow[] {
  return allOf<ActorRow>(
    `SELECT ${ACTOR_COLUMNS} FROM actor
      WHERE scraped_at = 0 OR avatar_image_id = '' OR birthday = ''
      ORDER BY updated_at ASC LIMIT ?`,
    [limit]
  ).map(toActorRow)
}

/** 某个演员名下的作品数（按归一化姓名键数 `media_cast`） */
export function countFilmsByNameKey(nameKey: string): number {
  if (!nameKey) return 0
  const row = oneOf<{ total: number }>(
    'SELECT count(*) AS total FROM media_cast WHERE name_key = ?',
    [nameKey]
  )
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
  return allOf<ActorRow>(
    `SELECT ${ACTOR_COLUMNS} FROM actor WHERE name_key IN (${placeholders(keys.size)})`,
    [...keys]
  ).map(toActorRow)
}

export function listAliases(actorId: string): ActorAliasRow[] {
  return allOf<ActorAliasRow>(
    `SELECT ${ACTOR_ALIAS_COLUMNS} FROM actor_alias WHERE actor_id = ? ORDER BY alias ASC`,
    [actorId]
  )
}

/** 整组替换别名（保存演员时调用） */
export function replaceAliases(actorId: string, aliases: readonly string[]): void {
  transaction(() => {
    runOf('DELETE FROM actor_alias WHERE actor_id = ?', [actorId])
    const seen = new Set<string>()
    for (const alias of aliases) {
      const trimmed = alias.trim()
      const key = actorNameKey(trimmed)
      if (!trimmed || !key || seen.has(key)) continue
      seen.add(key)
      runOf(
        `INSERT INTO actor_alias (id, actor_id, alias, alias_key) VALUES (?, ?, ?, ?)
          ON CONFLICT DO NOTHING`,
        [randomUUID(), actorId, trimmed, key]
      )
    }
  })
}

export function getActorImage(imageId: string): ActorImageRow | null {
  return oneOf<ActorImageRow>(
    `SELECT ${ACTOR_IMAGE_COLUMNS} FROM actor_image WHERE id = ?`,
    [imageId]
  )
}

export function listActorImages(actorId: string): ActorImageRow[] {
  return allOf<ActorImageRow>(
    `SELECT ${ACTOR_IMAGE_COLUMNS} FROM actor_image WHERE actor_id = ? ORDER BY created_at ASC`,
    [actorId]
  )
}

export function insertActorImage(input: ActorImageInput): void {
  runOf(
    `INSERT INTO actor_image (id, actor_id, kind, path, name, extname, mime, size, width,
      height, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.actorId,
      input.kind,
      input.path,
      input.name,
      input.extname,
      input.mime,
      input.size,
      input.width,
      input.height,
      input.source,
      Date.now()
    ]
  )
}

/** 删除一张图片行，并在它是头像时清空演员的头像引用 */
export function deleteActorImage(actorId: string, imageId: string): boolean {
  const row = getActorImage(imageId)
  if (!row || row.actorId !== actorId) return false
  runOf('DELETE FROM actor_image WHERE id = ?', [imageId])
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
  transaction(() => {
    runOf('DELETE FROM media_cast WHERE item_id = ?', [itemId])
    const seen = new Set<string>()
    for (const name of names) {
      const trimmed = name.trim()
      const key = actorNameKey(trimmed)
      if (!key || seen.has(key)) continue
      runOf(
        `INSERT INTO media_cast (item_id, actor_name, name_key, ordinal) VALUES (?, ?, ?, ?)
          ON CONFLICT DO NOTHING`,
        [itemId, trimmed, key, seen.size]
      )
      seen.add(key)
    }
  })
}

/** 某个条目的参演名单，按出演顺序 */
export function listItemCastNames(itemId: string): string[] {
  return allOf<{ name: string }>(
    'SELECT actor_name AS name FROM media_cast WHERE item_id = ? ORDER BY ordinal ASC',
    [itemId]
  ).map((row) => row.name)
}

/** 某个演员（按姓名键）的出演作品 ID，按条目入库时间倒序 */
export function listItemIdsByActorNameKey(nameKey: string): string[] {
  if (!nameKey) return []
  return allOf<{ itemId: string }>(
    `SELECT media_cast.item_id AS itemId FROM media_cast
      INNER JOIN media_item ON media_item.id = media_cast.item_id
      WHERE media_cast.name_key = ? ORDER BY media_item.date_added DESC`,
    [nameKey]
  ).map((row) => row.itemId)
}

/** 条目被删时清掉它的参演名单 */
export function deleteCastByItems(itemIds: readonly string[]): number {
  if (itemIds.length === 0) return 0
  return runOf(
    `DELETE FROM media_cast WHERE item_id IN (${placeholders(itemIds.length)})`,
    itemIds as SqlValue[]
  )
}

/** 删除演员：连同别名与图片行一起删；返回图片行供调用方清磁盘文件（`media_cast` 是名字，不动） */
export function deleteActor(actorId: string): ActorImageRow[] {
  const images = listActorImages(actorId)
  transaction(() => {
    runOf('DELETE FROM actor_alias WHERE actor_id = ?', [actorId])
    runOf('DELETE FROM actor_image WHERE actor_id = ?', [actorId])
    runOf('DELETE FROM actor WHERE id = ?', [actorId])
  })
  return images
}
