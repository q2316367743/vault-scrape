import { defineConfig, presetUno } from 'unocss'

// unocss v66 已移除 important 选项：这里给每个工具类的值追加 !important。
// 原因：uno 生成的样式表先于 tdesign 组件库的懒加载 CSS 注入，不加会被组件库样式覆盖。
export default defineConfig({
  presets: [presetUno({ dark: 'class' })],
  theme: {
    colors: {
      // 颜色类一律映射到 tdesign CSS Token，禁止裸色值（见 AGENTS.md）
      'td-brand': 'var(--td-brand-color)',
      'td-brand-hover': 'var(--td-brand-color-hover)',
      'td-text-primary': 'var(--td-text-color-primary)',
      'td-text-secondary': 'var(--td-text-color-secondary)',
      'td-text-placeholder': 'var(--td-text-color-placeholder)',
      'td-bg-container': 'var(--td-bg-color-container)',
      'td-bg-secondary': 'var(--td-bg-color-secondarycontainer)',
      'td-bg-component': 'var(--td-bg-color-component)',
      'td-bg-component-hover': 'var(--td-bg-color-component-hover)',
      'td-border-1': 'var(--td-component-border)',
      'td-border-2': 'var(--td-component-stroke)'
    }
  },
  postprocess: (util) => {
    util.entries.forEach((entry) => {
      const value = entry[1]
      if (typeof value === 'string' && !value.includes('!important')) {
        entry[1] = `${value} !important`
      }
    })
  }
})
