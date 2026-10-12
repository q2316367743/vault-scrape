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
   * 用 mpv 播放的总开关。
   *
   * 契约：关掉时一律走内置播放器——不看 `mpvPath`、也不做自动探测，这是「想手动取消 mpv」的唯一入口；
   * 打开时再由 `mpvPath`（留空＝自动探测 PATH 与常见安装位置）决定到底用不用。
   * **macOS 上本开关不生效**：mpv 在 macOS 已停用（见 `mpvLocator`），设置页显示为「已停用」。
   */
  mpvEnabled: boolean
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
   * 契约：mpv 在 macOS 已停用，本字段当前没有任何效果（设置页也不再暴露），保留给将来恢复 macOS 方案时用；
   * 历史背景：macOS 上 `--wid` 有出黑画面的风险，关掉时改成「mpv 无边框窗口贴住视频区」，而那条路要求
   * 播放窗口透明挖洞，实测会让播放卡顿。
   */
  macEmbed: boolean
}

export function buildSettingApp(): SettingApp {
  return {
    nsfwProtection: false,
    actorImageDir: '',
    mpvEnabled: true,
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
    mpvEnabled: readBoolean(source, 'mpvEnabled', base.mpvEnabled),
    mpvPath: readString(source, 'mpvPath', base.mpvPath),
    macEmbed: readBoolean(source, 'macEmbed', base.macEmbed)
  }
}
