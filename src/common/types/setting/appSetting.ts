import { readBoolean, readString, toSource } from './shared'

/** 应用设置：与具体功能域无关的界面与全局开关 */
export interface SettingApp {
  /**
   * NSFW 保护：开启后，标记为 NSFW 的存储会隐藏列表、搜索与详情页的敏感图片；
   * 没有存储上下文的页面（如工具搜索）只按本开关生效
   */
  nsfwProtection: boolean
  /** 演员图片根目录（头像与图集都放这里），留空表示使用默认位置 */
  actorImageDir: string
  /**
   * mpv 可执行文件路径；留空表示自动探测（PATH 与常见安装位置）。
   *
   * 契约：只有这里配到（或自动探测到）mpv，播放窗口才会用 mpv 播放；否则静默用内置播放器，
   * 播放窗口不作任何提示，说明文案只出现在设置页。
   */
  mpvPath: string
  /**
   * macOS 实验开关：把 mpv 画面嵌进播放窗口（`--wid`）。
   *
   * 契约：macOS 上该路径有出黑画面的已知风险，默认关闭——关闭时用「mpv 无边框窗口贴住视频区」的方案。
   */
  macEmbed: boolean
}

export function buildSettingApp(): SettingApp {
  return {
    nsfwProtection: false,
    actorImageDir: '',
    mpvPath: '',
    macEmbed: false
  }
}

export function normalizeSettingApp(raw: unknown): SettingApp {
  const base = buildSettingApp()
  const source = toSource(raw)
  if (!source) return base
  return {
    nsfwProtection: readBoolean(source, 'nsfwProtection', base.nsfwProtection),
    actorImageDir: readString(source, 'actorImageDir', base.actorImageDir),
    mpvPath: readString(source, 'mpvPath', base.mpvPath),
    macEmbed: readBoolean(source, 'macEmbed', base.macEmbed)
  }
}
