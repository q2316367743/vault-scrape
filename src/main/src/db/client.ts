import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

/**
 * 数据库单例：建库 + 开 WAL + 执行迁移。
 * 所有 SQL 都发生在主进程，渲染层只通过 IPC 访问。
 */
type DbInstance = BetterSQLite3Database<typeof schema>

let instance: DbInstance | null = null

function databaseFilePath(): string {
  return join(app.getPath('home'), '.vault-scrape', 'db', 'vault-scrape.db')
}

export function initDb(): DbInstance {
  if (instance) return instance
  const file = databaseFilePath()
  mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const database = drizzle(sqlite, { schema })
  // 迁移目录随 resources 一起打包（electron-builder 已 asarUnpack resources/**）
  migrate(database, { migrationsFolder: join(__dirname, '../../resources/drizzle') })
  instance = database
  return database
}

export function db(): DbInstance {
  if (!instance) throw new Error('[db] initDb() 未调用')
  return instance
}
