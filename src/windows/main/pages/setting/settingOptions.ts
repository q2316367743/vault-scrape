import type {
  AssetNaming,
  BadgeCorner,
  PartStyle,
  ProxyType,
  TranslateLanguage
} from '@common/types/setting'

/** 设置项下拉选项 */
export interface SettingOption<T> {
  value: T
  label: string
}

export const proxyTypeOptions: SettingOption<ProxyType>[] = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socket5', label: 'SOCKS5' }
]

export const translateLanguageOptions: SettingOption<TranslateLanguage>[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' }
]

export const assetNamingOptions: SettingOption<AssetNaming>[] = [
  { value: 'fixed', label: '固定命名' },
  { value: 'movie', label: '跟随影片文件名' }
]

export const partStyleOptions: SettingOption<PartStyle>[] = [
  { value: 'origin', label: '保持原始后缀' },
  { value: 'cd', label: '统一为 CD1 / CD2' },
  { value: 'part', label: '统一为 PART1 / PART2' },
  { value: 'disc', label: '统一为 DISC1 / DISC2' }
]

export const badgeCornerOptions: SettingOption<BadgeCorner>[] = [
  { value: 'top-left', label: '左上角' },
  { value: 'top-right', label: '右上角' },
  { value: 'bottom-left', label: '左下角' },
  { value: 'bottom-right', label: '右下角' }
]
