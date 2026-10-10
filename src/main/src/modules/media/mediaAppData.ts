/**
 * 应用数据目录里的媒体图片（`library.imageSaveMode = 'appdata'`）。
 *
 * 这类图片不在任何连接的根目录下，用连接的 `resolveInsideRoot` 定位会越界，
 * 因此用一个固定的伪连接 ID 参与 `storage://` 地址，协议端按绝对路径直接读盘。
 *
 * 目录口径与库文件、日志、设置保持一致：`~/.vault-scrape/media/images/<条目ID>/`。
 */
import { app } from 'electron'
import { join } from 'path'

/** 伪连接 ID：字符集与真实连接 ID 一致，不会与真实连接撞名 */
export const APPDATA_CONNECTION_ID = 'appdata'

/** 全部应用数据图片的根目录：`~/.vault-scrape/media/images` */
export function appDataImageRoot(): string {
  return join(app.getPath('home'), '.vault-scrape', 'media', 'images')
}

/** 某个条目的图片目录：`~/.vault-scrape/media/images/<条目ID>/` */
export function appDataImageDir(itemId: string): string {
  return join(appDataImageRoot(), itemId)
}
