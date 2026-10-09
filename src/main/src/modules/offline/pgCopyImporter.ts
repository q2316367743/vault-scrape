/**
 * PostgreSQL pg_dump 文本格式的 COPY 数据块解析器（流式）。
 *
 * 背景：上游 https://r18.dev/dumps 提供的是 `pg_dump` 文本（PostgreSQL 15），
 * `public.` 前缀、`character varying`、IDENTITY 序列与 `COPY … FROM stdin;` 都不是 SQLite 语法，
 * 因此不能直接喂给 SQLite，必须只抽出 COPY 数据块。
 *
 * 契约：
 * 1. 逐行扫描，只在 `COPY <表> (列) FROM stdin;` 与单独一行 `\.` 之间回调数据；
 * 2. 行是 tab 分隔、字段级转义（`\N` 为 NULL，`\t \n \r \\ \b \f \v`、`\xHH`、八进制）；
 * 3. 只物化 `wanted` 里的表，其余表的块按行丢弃（仍要识别结束行）；
 * 4. 按 ROW_BATCH 批量回调、按 YIELD_ROWS 让出事件循环，避免阻塞主进程；
 * 5. gzip 自动识别（按魔数），进度按**原始文件字节**计算（对 .gz 即压缩字节）。
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { Transform, type Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'

/** COPY 头部：COPY public.<表> (<列>, …) FROM stdin; */
const COPY_HEADER_PATTERN =
  /^COPY\s+(?:public\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s+FROM\s+stdin;\s*$/

/** COPY 块结束标记（单独一行） */
const COPY_TERMINATOR = '\\.'

/** 每批回调的行数 */
const ROW_BATCH = 2000

/** 每导入多少行让出一次事件循环 */
const YIELD_ROWS = 20000

export type PgCopyRow = (string | null)[]

export interface PgCopyTableStart {
  table: string
  columns: string[]
}

export interface PgCopyHandlers {
  onTableStart?: (info: PgCopyTableStart) => void
  onRows?: (table: string, rows: PgCopyRow[]) => void
  onTableEnd?: (table: string, rows: number) => void
  onProgress?: (state: { lines: number; rows: number; bytes: number; total: number; table: string }) => void
  /** 返回 true 时中断解析（取消） */
  shouldAbort?: () => boolean
}

export interface PgCopyStats {
  lines: number
  rows: number
  bytes: number
  tables: Record<string, number>
}

/** 解析被取消 */
export class PgCopyAbortError extends Error {
  constructor() {
    super('数据包导入已取消')
    this.name = 'PgCopyAbortError'
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** 按魔数判断是否 gzip（0x1f 0x8b） */
export function isGzipFile(filePath: string): boolean {
  const fd = openSync(filePath, 'r')
  try {
    const head = Buffer.alloc(2)
    const read = readSync(fd, head, 0, 2, 0)
    return read === 2 && head[0] === 0x1f && head[1] === 0x8b
  } finally {
    closeSync(fd)
  }
}

function decodeHex(value: string): string | null {
  const code = Number.parseInt(value, 16)
  return Number.isFinite(code) ? String.fromCharCode(code) : null
}

/**
 * 还原 PostgreSQL COPY TEXT 的字段转义。
 *
 * 快速路径：不含反斜杠的字段原样返回（绝大多数行）。
 */
export function decodeCopyField(raw: string): string | null {
  if (raw === '\\N') return null
  if (raw.indexOf('\\') < 0) return raw
  let out = ''
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (char !== '\\') {
      out += char
      continue
    }
    const next = raw[index + 1]
    if (next === undefined) {
      out += '\\'
      break
    }
    if (next === 'b') {
      out += '\b'
      index += 1
    } else if (next === 'f') {
      out += '\f'
      index += 1
    } else if (next === 'n') {
      out += '\n'
      index += 1
    } else if (next === 'r') {
      out += '\r'
      index += 1
    } else if (next === 't') {
      out += '\t'
      index += 1
    } else if (next === 'v') {
      out += '\v'
      index += 1
    } else if (next === 'x') {
      const hex = raw.slice(index + 2, index + 4)
      const decoded = /^[0-9A-Fa-f]{2}$/.test(hex) ? decodeHex(hex) : null
      if (decoded === null) {
        out += next
        index += 1
      } else {
        out += decoded
        index += 3
      }
    } else if (next >= '0' && next <= '7') {
      const octal = /^[0-7]{1,3}/.exec(raw.slice(index + 1))?.[0] ?? ''
      const code = Number.parseInt(octal, 8)
      out += Number.isFinite(code) ? String.fromCharCode(code) : next
      index += octal.length
    } else {
      out += next
      index += 1
    }
  }
  return out
}

function splitRow(line: string): PgCopyRow {
  const cells = line.split('\t')
  const values: PgCopyRow = new Array(cells.length)
  for (let index = 0; index < cells.length; index += 1) {
    values[index] = decodeCopyField(cells[index])
  }
  return values
}

function parseColumns(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim().replace(/^"|"$/g, ''))
    .filter((item) => item.length > 0)
}

function countingTransform(onDelta: (delta: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      onDelta(Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk))
      callback(null, chunk)
    }
  })
}

/**
 * 解析一个 dump 文件（自动识别 .sql / .sql.gz）。
 *
 * `wanted` 之外的表只扫描不回调；返回累计统计，供导入器写入元数据。
 */
export async function parsePgDumpFile(
  filePath: string,
  handlers: PgCopyHandlers,
  wanted: ReadonlySet<string>
): Promise<PgCopyStats> {
  const total = statSync(filePath).size
  let bytes = 0
  const counter = countingTransform((delta) => {
    bytes += delta
  })
  const file = createReadStream(filePath, { highWaterMark: 1024 * 1024 })
  file.pipe(counter)
  const input: Readable = isGzipFile(filePath) ? counter.pipe(createGunzip()) : counter

  const lines = { value: 0 }
  const rows = { value: 0 }
  const tables: Record<string, number> = {}
  const shouldAbort = handlers.shouldAbort
  const reader = createInterface({ input, crlfDelay: Infinity })

  let inCopy = false
  let table = ''
  let wantedTable = false
  let tableRows = 0
  let sinceYield = 0
  let batch: PgCopyRow[] = []

  const flush = (): void => {
    if (batch.length === 0) return
    const current = batch
    batch = []
    handlers.onRows?.(table, current)
  }

  try {
    for await (const rawLine of reader) {
      lines.value += 1
      if (shouldAbort?.() === true) throw new PgCopyAbortError()
      if (!inCopy) {
        const matched = COPY_HEADER_PATTERN.exec(rawLine)
        if (!matched) continue
        table = matched[1]
        wantedTable = wanted.has(table)
        inCopy = true
        tableRows = 0
        batch = []
        if (wantedTable) handlers.onTableStart?.({ table, columns: parseColumns(matched[2]) })
        continue
      }
      if (rawLine === COPY_TERMINATOR) {
        if (wantedTable) {
          flush()
          tables[table] = tableRows
          handlers.onTableEnd?.(table, tableRows)
        }
        inCopy = false
        table = ''
        wantedTable = false
        continue
      }
      if (!wantedTable) continue
      batch.push(splitRow(rawLine))
      tableRows += 1
      rows.value += 1
      if (batch.length >= ROW_BATCH) flush()
      sinceYield += 1
      if (sinceYield >= YIELD_ROWS) {
        sinceYield = 0
        handlers.onProgress?.({ lines: lines.value, rows: rows.value, bytes, total, table })
        await yieldToEventLoop()
      }
    }
    // 文件被截断时也要把最后一批交出去，交给上层判定数据包不完整
    if (inCopy && wantedTable) {
      flush()
      tables[table] = tableRows
      handlers.onTableEnd?.(table, tableRows)
    }
    handlers.onProgress?.({ lines: lines.value, rows: rows.value, bytes, total, table })
    return { lines: lines.value, rows: rows.value, bytes, tables }
  } finally {
    reader.close()
    file.destroy()
  }
}
