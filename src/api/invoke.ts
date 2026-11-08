/**
 * 调用 core 自有 API 的唯一底层入口。
 *
 * 契约：方法名与 `src-dashou/core/api.ts` 的键一一对应；失败抛宿主统一的 `PluginError`。
 */
import { invoke } from '@dashou/api'

export function callCore<T>(method: string, args?: unknown): Promise<T> {
  return invoke<T>(`plugin:api|${method}`, args)
}
