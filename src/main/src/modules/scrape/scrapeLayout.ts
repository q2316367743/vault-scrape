/**
 * 刮削产物的目录规范（Jellyfin 风格）。
 *
 * 契约：
 * - 影片**一定**落在以影片基础名命名的文件夹里：`<根目录>/<base>/`；
 *   根目录由资料库策略决定——移动开关打开时是移动目标目录，否则是视频原目录；
 * - 文件夹名 / 视频文件名 / NFO 文件名**三处同源同值**（都是 `base`，即命名模板的渲染结果），
 *   视频扩展名沿用源文件，NFO 固定 `<base>.nfo`；
 * - 图片与视频同目录，剧照放 `scrape.fanartDirName` 子目录；
 * - 纯路径计算，不做任何 IO。
 */
import { FILE_ROOT, joinRemotePath, normalizeRemotePath } from '@common/types/file'

/** 影片文件夹名（= 视频基础名 = NFO 基础名） */
export function movieFolderName(base: string): string {
  return base.trim()
}

/** 视频文件名：扩展名沿用源文件（含点，可能为空串） */
export function movieFileName(base: string, extension: string): string {
  return `${movieFolderName(base)}${extension}`
}

/** NFO 文件名：固定与影片同名，只此一份 */
export function nfoFileName(base: string): string {
  return `${movieFolderName(base)}.nfo`
}

/** 移动目标目录：空串表示原地；以 `/` 开头按连接内绝对路径，否则视为连接根下的子目录 */
export function resolveOutputDir(value: string, fallback: string): string {
  const text = value.trim()
  if (text.length === 0) return fallback
  return text.startsWith('/') ? normalizeRemotePath(text) : joinRemotePath(FILE_ROOT, text)
}

/** 影片目录 = 根目录 + 文件夹名 */
export function movieDirOf(rootDir: string, base: string): string {
  return joinRemotePath(rootDir, movieFolderName(base))
}
