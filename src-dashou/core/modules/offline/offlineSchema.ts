/**
 * 离线库（r18.db）的表结构与导入白名单。
 *
 * 契约：
 * 1. 列定义**不在这里写死**：上游 dump 的 `COPY … (列列表) FROM stdin;` 头部给出了列名，
 *    建表时按头部动态生成（全部 TEXT 亲和），上游小改版（增列/换序）不会导致导入失败；
 * 2. 这里只声明「我们自己知道」的约束（主键、索引、生成列）与行数下限，
 *    且只在依赖列全部存在时才应用，避免上游删列后建表失败；
 * 3. 所有列一律 TEXT 亲和：番号、日期、ID 都是字符串，避免 SQLite 把纯数字番号转成数字。
 */

/** 离线库自身的元数据表名（不在上游表清单里） */
export const OFFLINE_META_TABLE = 'offline_meta'

/** 离线库 schema 版本，写在 offline_meta.schema_version */
export const OFFLINE_DB_SCHEMA_VERSION = 1

/** 生成列：番号归一化（大写 + 去掉连字符），用于番号精确/前缀匹配 */
export const DVD_ID_NORM_COLUMN = 'dvd_id_norm'
const DVD_ID_NORM_EXPRESSION = "upper(replace(dvd_id, char(45), ''))"

export interface OfflineTableSpec {
  name: string
  /** 复合 / 单列主键；依赖列缺失时整条约束放弃 */
  primaryKey?: readonly string[]
  /** 普通索引；依赖列缺失时跳过该条 */
  indexes?: readonly (readonly string[])[]
  /** 生成列；依赖列缺失时跳过 */
  generated?: readonly { name: string; expression: string; requires: string }[]
  /** 该表的行数下限，缺省用全局下限 */
  minRows?: number
}

/**
 * 需要导入的上游表。
 *
 * 跳过 `machine_translation`（123 MB，当前无用途）与 /histrion 系列
 * （`derived_actor` / `derived_video_actor` / `source_dmm_histrion` / `source_dmm_video_histrion`）。
 */
export const OFFLINE_TABLE_SPECS: readonly OfflineTableSpec[] = [
  {
    name: 'derived_video',
    primaryKey: ['content_id', 'site_id', 'service_code'],
    indexes: [[DVD_ID_NORM_COLUMN], ['content_id']],
    generated: [
      { name: DVD_ID_NORM_COLUMN, expression: DVD_ID_NORM_EXPRESSION, requires: 'dvd_id' }
    ]
  },
  { name: 'derived_video_actress', primaryKey: ['content_id', 'actress_id'], indexes: [['content_id']] },
  { name: 'derived_video_category', primaryKey: ['content_id', 'category_id'], indexes: [['content_id']] },
  { name: 'derived_video_director', primaryKey: ['content_id', 'director_id'], indexes: [['content_id']] },
  { name: 'derived_video_author', primaryKey: ['content_id', 'author_id'], indexes: [['content_id']] },
  { name: 'source_dmm_trailer', primaryKey: ['content_id', 'url'], indexes: [['content_id']] },
  { name: 'derived_actress', primaryKey: ['id'] },
  { name: 'derived_category', primaryKey: ['id'] },
  { name: 'derived_director', primaryKey: ['id'] },
  { name: 'derived_author', primaryKey: ['id'] },
  { name: 'derived_maker', primaryKey: ['id'] },
  { name: 'derived_label', primaryKey: ['id'] },
  { name: 'derived_series', primaryKey: ['id'] },
  { name: 'derived_site', primaryKey: ['id'] }
]

export const OFFLINE_TABLE_NAMES: readonly string[] = OFFLINE_TABLE_SPECS.map((spec) => spec.name)

export const OFFLINE_TABLE_NAME_SET: ReadonlySet<string> = new Set(OFFLINE_TABLE_NAMES)

export function findTableSpec(table: string): OfflineTableSpec | null {
  return OFFLINE_TABLE_SPECS.find((spec) => spec.name === table) ?? null
}

export function isOfflineTable(table: string): boolean {
  return OFFLINE_TABLE_NAME_SET.has(table)
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function hasColumns(columns: readonly string[], required: readonly string[]): boolean {
  return required.every((name) => columns.includes(name))
}

/** 按 COPY 头部的列名建表；约束只在依赖列存在时应用 */
export function buildCreateTableSql(table: string, columns: readonly string[]): string {
  const spec = findTableSpec(table)
  const parts = columns.map((column) => `${quoteIdentifier(column)} TEXT`)
  if (spec?.generated) {
    for (const item of spec.generated) {
      if (!hasColumns(columns, [item.requires]) || hasColumns(columns, [item.name])) continue
      parts.push(`${quoteIdentifier(item.name)} TEXT GENERATED ALWAYS AS (${item.expression}) VIRTUAL`)
    }
  }
  if (spec?.primaryKey && hasColumns(columns, spec.primaryKey)) {
    const keys = spec.primaryKey.map(quoteIdentifier).join(', ')
    parts.push(`PRIMARY KEY (${keys})`)
  }
  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table)} (\n  ${parts.join(',\n  ')}\n)`
}

/** 建索引语句；依赖列缺失时返回空数组 */
export function buildIndexSql(table: string, columns: readonly string[]): string[] {
  const spec = findTableSpec(table)
  if (!spec?.indexes) return []
  const statements: string[] = []
  for (const indexColumns of spec.indexes) {
    if (!hasColumns(columns, indexColumns)) continue
    const name = `idx_r18_${table}_${indexColumns.join('_')}`
    const keys = indexColumns.map(quoteIdentifier).join(', ')
    statements.push(
      `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(name)} ON ${quoteIdentifier(table)} (${keys})`
    )
  }
  return statements
}

/**
 * 插入语句。
 *
 * 统一 `INSERT OR IGNORE`：上游 dump 没有唯一约束，重复的关联行（如同一影片同一类别）
 * 由主键吸收，避免整包因个别重复行失败。
 */
export function buildInsertSql(table: string, columns: readonly string[]): string {
  const keys = columns.map(quoteIdentifier).join(', ')
  const marks = columns.map(() => '?').join(', ')
  return `INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${keys}) VALUES (${marks})`
}
