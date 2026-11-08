/**
 * 仓储的 SQL 小工具：统一参数类型、结果断言与 `changes` 读取。
 *
 * `node:sqlite` 返回的是 `Record<string, SQLOutputValue>`，字段形状由本插件的列清单保证，
 * 所以读取边界只做一次断言（不需要每个仓储各写一遍）。
 */
import { prepare } from './client'

export type SqlValue = string | number | bigint | null | Uint8Array

/** 查询多行 */
export function allOf<T>(sql: string, params: SqlValue[] = []): T[] {
  const statement = prepare(sql)
  const rows = params.length > 0 ? statement.all(...params) : statement.all()
  return rows as unknown as T[]
}

/** 查询一行；没有返回 null */
export function oneOf<T>(sql: string, params: SqlValue[] = []): T | null {
  return allOf<T>(sql, params)[0] ?? null
}

/** 执行写语句，返回受影响行数 */
export function runOf(sql: string, params: SqlValue[] = []): number {
  const statement = prepare(sql)
  const result = params.length > 0 ? statement.run(...params) : statement.run()
  return Number(result.changes)
}

/** 参数占位符：`?` 的个数 */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}
