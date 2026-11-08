/**
 * 数据库单例：`node:sqlite` 建库 + 幂等建表。
 *
 * 契约：
 * - 只用 Node 内置的 `node:sqlite`，不引入原生模块，插件换机器不需要重编译；
 * - 建表 SQL 取自插件包内的 `assets/schema.sql`（`CREATE TABLE IF NOT EXISTS`），
 *   新建库直接可用，老库重复执行无副作用；
 * - 布尔列在 SQLite 里是 0/1，仓储层统一用 `boolOf()` 转换；
 * - `transaction()` 提供同步事务，异常自动回滚。
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { appRoot, dataPath } from '../runtime/paths'

let instance: DatabaseSync | null = null

function databaseFilePath(): string {
  return dataPath('db', 'vault-scrape.db')
}

/** 建库并执行建表 SQL；重复调用返回同一个句柄 */
export function initDb(): DatabaseSync {
  if (instance) return instance
  const file = databaseFilePath()
  mkdirSync(dirname(file), { recursive: true })
  const sqlite = new DatabaseSync(file)
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec('PRAGMA busy_timeout = 5000')
  const schema = readFileSync(join(appRoot(), 'assets', 'schema.sql'), 'utf8')
  sqlite.exec(schema)
  instance = sqlite
  return sqlite
}

export function db(): DatabaseSync {
  if (!instance) throw new Error('数据库尚未初始化')
  return instance
}

/** 同步事务：回调抛错则回滚并原样抛出 */
export function transaction<T>(task: () => T): T {
  const sqlite = db()
  sqlite.exec('BEGIN')
  try {
    const result = task()
    sqlite.exec('COMMIT')
    return result
  } catch (error) {
    try {
      sqlite.exec('ROLLBACK')
    } catch {
      // 回滚失败没有补救手段，保留原始异常
    }
    throw error
  }
}

/** 预编译语句的薄封装：仓储里只关心 SQL 与参数 */
export function prepare(sql: string): StatementSync {
  return db().prepare(sql)
}

/** SQLite 的 0/1 → boolean */
export function boolOf(value: unknown): boolean {
  return value === 1 || value === true
}
