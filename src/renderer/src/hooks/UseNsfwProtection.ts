/**
 * NSFW 保护判定。
 *
 * 契约（对应需求「NSFW 保护开关 + 存储 nsfw 标记 + 库级 nsfwProtection」）：
 * - 应用设置 `app.nsfwProtection` 是**唯一前提**（总开关）：它关着时什么都不隐藏，
 *   存储 `nsfw` 标记与资料库 `nsfwProtection` 都只是「把这块内容划入敏感范围」，
 *   不是各自独立的隐藏开关；
 * - 总开关开启时，命中「存储连接的 `nsfw` 标记」或「所属资料库的 `nsfwProtection`」即隐藏；
 * - 因此带存储上下文的页面用 `protection && connection.nsfw`（`active`），
 *   带资料库上下文的页面用 `protect`，不带上下文的页面（如插件搜索工具）只看总开关。
 * - 保护状态缓存为模块级 ref：一次读取，全应用共享；保存设置后调用
 *   `refreshNsfwProtection()` 立即刷新。
 */
import { computed, ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import type { FileConnection } from '@common/types/file'
import { settingApi } from '@/api'
import { useLog } from '@/hooks/UseLog'

const logger = useLog({ name: 'nsfw-protection' })
const protection = ref(false)
let loaded = false

/** 读取应用设置里的 NSFW 开关；设置保存成功后会由应用设置 store 主动调用刷新 */
export async function refreshNsfwProtection(): Promise<void> {
  loaded = false
  try {
    const app = await settingApi.getGroup('app')
    protection.value = app.nsfwProtection
    loaded = true
  } catch (error: unknown) {
    logger.error('NSFW 保护状态读取失败，保持当前状态并在下次使用时重试', error)
  }
}

/**
 * NSFW 保护状态。
 *
 * @param connection 当前内容的存储连接；不带存储上下文就不传
 * @param libraryProtected 当前内容所属资料库的 `nsfwProtection`（可以是 ref 或取值函数）
 */
export function useNsfwProtection(
  connection?: Ref<FileConnection | null> | null,
  libraryProtected: MaybeRefOrGetter<boolean> = false
) {
  if (!loaded) void refreshNsfwProtection()
  /** 总开关 + 存储 `nsfw` 标记；不带存储上下文时就是总开关本身 */
  const active = computed(() =>
    connection ? protection.value && connection.value?.nsfw === true : protection.value
  )
  /**
   * 带资料库上下文的最终口径：**以总开关为前提**，
   * 命中「存储 `nsfw` 标记」或「库级 `nsfwProtection`」任一即遮罩；总开关关闭时一律不遮。
   */
  const protect = computed(
    () => protection.value && (connection?.value?.nsfw === true || toValue(libraryProtected))
  )
  return { protection, active, protect }
}
