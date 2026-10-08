/**
 * 文件模块的请求参数。
 *
 * 契约：所有连接内路径都是统一的 POSIX 路径（`/` 为连接根）；
 * 上传的 localPath / 下载的 localPath 是本机绝对路径，不受连接根限制。
 */
export interface FileCreateOptions {
  /** 默认 false：目标已存在时抛 alreadyExists */
  overwrite?: boolean
}

export interface FileMkdirOptions {
  /** 默认 true：逐级创建 */
  recursive?: boolean
}

export interface FileRemoveOptions {
  /** 默认 true：目录递归删除 */
  recursive?: boolean
}

export interface FileTransferOptions extends FileCreateOptions {
  /** 传输进度回调，实现层已节流；transferred/total 单位为字节 */
  onProgress?: (transferred: number, total: number) => void
  signal?: AbortSignal
}

/** 只需要目标路径的操作：list / stat / exists / readText */
export interface FileTargetRequest {
  connectionId: string
  path: string
}

export interface FileMkdirRequest extends FileMkdirOptions {
  connectionId: string
  path: string
}

export interface FileCreateRequest extends FileCreateOptions {
  connectionId: string
  path: string
}

export interface FileWriteTextRequest extends FileCreateOptions {
  connectionId: string
  path: string
  content: string
}

export interface FileRemoveRequest extends FileRemoveOptions {
  connectionId: string
  path: string
}

export interface FileMoveRequest extends FileCreateOptions {
  connectionId: string
  from: string
  to: string
}

export interface FileCopyRequest extends FileCreateOptions {
  connectionId: string
  from: string
  to: string
}

export interface FileUploadRequest extends FileCreateOptions {
  connectionId: string
  /** 本机绝对路径 */
  localPath: string
  /** 连接内路径 */
  remotePath: string
}

export interface FileDownloadRequest extends FileCreateOptions {
  connectionId: string
  /** 连接内路径 */
  remotePath: string
  /** 本机绝对路径 */
  localPath: string
}
