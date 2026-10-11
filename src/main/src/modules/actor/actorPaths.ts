import { app } from 'electron'
import { accessSync, constants, mkdirSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { appendLog } from '$/db/repo/logRepo'
import { loadSetting } from '$/modules/setting/settingStore'

/**
 * 演员图片的落盘位置。
 *
 * 默认放在应用数据目录（`~/.vault-scrape/media/actor`），设置里填了绝对路径就用设置；
 * 目录不可用时回落到默认位置并记一条日志 —— 图片写失败不应该让整个演员模块不可用。
 *
 * 布局：`<根目录>/<演员 ID>/<图片 ID>.<扩展名>`，同一演员的图片放在一起，删演员即可整目录带走。
 */

/** 默认根目录（应用数据目录） */
function defaultActorImageRoot(): string {
  return join(app.getPath('home'), '.vault-scrape', 'media', 'actor')
}

/** 设置里配置的根目录；没有配置或不合法时返回空串 */
function configuredActorImageRoot(): string {
  const configured = loadSetting().app.actorImageDir.trim()
  return configured && isAbsolute(configured) ? configured : ''
}

/** 目录存在且可写 */
function isUsableDirectory(directory: string): boolean {
  try {
    mkdirSync(directory, { recursive: true })
    accessSync(directory, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 演员图片根目录。
 *
 * 每次调用都做一次可用性检查：设置里换目录后不需要重启进程，
 * 旧目录里的图片仍然按 `actor_image.path` 的绝对路径继续可读。
 */
export function actorImageRoot(): string {
  const configured = configuredActorImageRoot()
  if (configured && isUsableDirectory(configured)) return configured

  const fallback = defaultActorImageRoot()
  if (isUsableDirectory(fallback)) {
    if (configured) {
      appendLog({
        level: 'warn',
        scope: 'actor',
        message: `演员图片目录不可用，已回落到默认位置：${configured}`
      })
    }
    return fallback
  }

  appendLog({
    level: 'warn',
    scope: 'actor',
    message: `演员图片目录不可写，图片导入会失败：${fallback}`
  })
  return fallback
}

/** 某个演员的图片目录（不保证已创建，写入前由调用方创建） */
export function actorImageDir(actorId: string): string {
  return join(actorImageRoot(), actorId)
}

/** 计算一张新图片的落盘路径 */
export function buildActorImagePath(actorId: string, imageId: string, extname: string): string {
  const extension = extname.startsWith('.') ? extname : `.${extname}`
  return join(actorImageDir(actorId), `${imageId}${extension}`)
}

/**
 * 文件是否位于演员图片根目录之内。
 *
 * 删除图片前必须过这一道：`actor_image.path` 来自数据库，
 * 只有确认它在我们自己的目录里，才允许真的删文件。
 */
export function isInsideActorRoot(filePath: string): boolean {
  const relativePath = relative(actorImageRoot(), filePath)
  return relativePath.length > 0 && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}
