/**
 * 资料库 IPC 的统一返回信封。
 *
 * 契约：contextBridge 传自定义错误附加属性不可靠，所以在 IPC 边界把异常转成
 * `{ ok: false, code, message }` 的值返回，渲染层只按 `code` 判断。
 */
import type { LibraryErrorCode } from './error'

export type LibraryResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: LibraryErrorCode; message: string }

export function libraryOk<T>(data: T): LibraryResult<T> {
  return { ok: true, data }
}

export function libraryFail<T = never>(code: LibraryErrorCode, message: string): LibraryResult<T> {
  return { ok: false, code, message }
}

export function isLibraryOk<T>(result: LibraryResult<T>): result is { ok: true; data: T } {
  return result.ok
}
