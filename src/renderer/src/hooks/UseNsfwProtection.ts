/**
 * NSFW 保护判定。
 *
 * 契约（对应需求「NSFW 保护开关 + 存储 nsfw 标记」）：
 * - 应用设置 `app.nsfwProtection` 是总开关，只决定「是否具备隐藏能力」；
 * - 存储连接的 `nsfw` 标记决定「哪些存储受保护」；
 * - 因此带存储上下文的页面必须 `protection && connection.nsfw` 同时成立才隐藏内容，
 *   而不带存储上下文的页面（如插件搜索工具）只看总开关。
 * - 保护状态缓存为模块级 ref：一次读取，全应用共享；保存设置后调用
 *   `refreshNsfwProtection()` 立即刷新。
 */
import { computed, ref, type Ref } from 'vue'
import type { FileConnection } from '@common/types/file'
import { settingApi } from '@/api'

const protection = ref(false)
let loaded = false

/** 读取应用设置里的 NSFW 开关；页面在设置保存后主动调用即可刷新 */
export async function refreshNsfwProtection(): Promise<void> {
  loaded = false
  const app = await settingApi.getGroup('app')
  protection.value = app.nsfwProtection
  loaded = true
}

/** NSFW 保护状态：`protection` 为总开关，传入连接后 `active` 才表示该存储是否受保护 */
export function useNsfwProtection(connection?: Ref<FileConnection | null> | null) {
  if (!loaded) void refreshNsfwProtection()
  const active = computed(() =>
    connection ? protection.value && connection.value?.nsfw === true : protection.value
  )
  return { protection, active }
}
