/**
 * artplayer 的简体中文词条。
 *
 * artplayer 自带的语言包只有 `zh-tw`（没有 `zh-cn`），所以按官方 `Option.i18n`
 * 的写法内联一份；只覆盖会出现在界面上的键，其余按键回落到 artplayer 内置英文。
 */
import type { I18n } from 'artplayer'

export const artplayerI18n: I18n = {
  'zh-cn': {
    Play: '播放',
    Pause: '暂停',
    Volume: '音量',
    Mute: '静音',
    Rate: '倍速',
    Reconnect: '重新连接',
    Screenshot: '截图',
    'Video Info': '影片信息',
    'Video Load Failed': '视频加载失败',
    Close: '关闭',
    'Show Setting': '显示设置',
    'Hide Setting': '隐藏设置',
    'Play Speed': '播放速度',
    'Aspect Ratio': '画面比例',
    Default: '默认',
    Normal: '正常',
    Open: '开启',
    'Switch Video': '切换视频',
    'Switch Subtitle': '切换字幕',
    Fullscreen: '全屏',
    'Exit Fullscreen': '退出全屏',
    'Web Fullscreen': '网页全屏',
    'Exit Web Fullscreen': '退出网页全屏',
    'Mini Player': '迷你播放器',
    'PIP Mode': '画中画',
    'Exit PIP Mode': '退出画中画',
    'PIP Not Supported': '当前环境不支持画中画',
    'Fullscreen Not Supported': '当前环境不支持全屏',
    'Subtitle Offset': '字幕偏移',
    'Last Seen': '上次看到',
    'Jump Play': '跳转播放',
    'Video Flip': '画面翻转',
    Horizontal: '水平翻转',
    Vertical: '垂直翻转'
  }
}
