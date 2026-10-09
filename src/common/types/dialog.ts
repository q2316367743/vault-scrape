/**
 * 系统文件/目录选择框（Electron dialog）的公共契约。
 *
 * 这里是渲染层与主进程共用的形状：渲染层只描述「想要什么样的框」，
 * 主进程负责把不可信的入参逐字段收窄后再交给 Electron。
 */

/** 文件类型过滤器；extensions 不带点，`'*'` 表示所有文件 */
export interface DialogFilter {
  name: string
  extensions: string[]
}

/** 「打开」框入参：选文件或选目录 */
export interface DialogOpenOptions {
  title?: string
  buttonLabel?: string
  /** 初始目录；选文件时也可以带推荐文件名 */
  defaultPath?: string
  filters?: DialogFilter[]
  /** true = 只能选目录；缺省只能选文件 */
  directory?: boolean
}

/** 「保存」框入参：defaultPath 建议写成含文件名的完整路径 */
export interface DialogSaveOptions {
  title?: string
  buttonLabel?: string
  defaultPath?: string
  filters?: DialogFilter[]
}

/**
 * 选择框结果。
 *
 * 用户取消不是错误：取消时 `canceled` 为 true、`filePaths` 为空数组，
 * 调用方按「什么都不做」处理即可；真正的失败由主进程抛错、渲染层 try/catch 兜底。
 */
export interface DialogResult {
  canceled: boolean
  /** 用户取消时为空数组；「保存」框至多一项 */
  filePaths: string[]
}
