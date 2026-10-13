/**
 * NSFW 保护判定。
 *
 * 契约（对应需求「应用设置总开关 + 库级 nsfwProtection」）：
 * - 应用设置 `app.nsfwProtection` 是**唯一前提**（总开关）：它关着时什么都不隐藏，
 *   资料库的 `nsfwProtection` 只是「把这块内容划入敏感范围」，不是独立开关；
 * - **存储连接上没有 NSFW 标记**，所以判定只需要总开关与库级标记两个输入；
 * - `protection` 是总开关本身，给没有资料库上下文的页面用（如存储页预览、插件搜索工具）；
 * - `protect` = 总开关 && 库级标记，给带资料库上下文的页面用（如影视墙卡片、详情页）；
 * - 保护状态缓存为模块级 ref：一次读取，全应用共享；保存设置后调用
 *   `refreshNsfwProtection()` 立即刷新。
 */
import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
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
 * @param libraryProtected 当前内容所属资料库的 `nsfwProtection`（可以是 ref 或取值函数）；
 *   不带资料库上下文（如存储页预览）就不传
 */
export function useNsfwProtection(libraryProtected: MaybeRefOrGetter<boolean> = false) {
  if (!loaded) void refreshNsfwProtection()
  /** 最终遮罩口径：**以总开关为前提**，库级 `nsfwProtection` 命中才遮；总开关关闭时一律不遮 */
  const protect = computed(() => protection.value && toValue(libraryProtected))
  return { protection, protect }
}
