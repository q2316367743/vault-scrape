/**
 * 文件模块的公共类型出口。
 *
 * 本目录只放纯类型与纯函数，三端共享；
 * 真正的能力实现位于 main 的 `src/main/src/modules/file/`。
 */
export {
  FILE_ERROR_CODES,
  FILE_ERROR_MESSAGES,
  FileError,
  describeFileError,
  type FileErrorCode
} from './error'

export {
  FILE_ROOT,
  basenameRemotePath,
  dirnameRemotePath,
  extnameOf,
  isFileRoot,
  joinRemotePath,
  normalizeRemotePath,
  splitRemotePath
} from './path'

export {
  createFileEntry,
  guessMimeType,
  sortFileEntries,
  type FileEntry,
  type FileEntryInput,
  type FileEntryType
} from './entry'

export {
  FILE_PROTOCOL_LABELS,
  FILE_PROTOCOLS,
  SMB_DEFAULT_PORT,
  WEBDAV_AUTH_TYPES,
  describeConnection,
  describeScrapers,
  scraperIdsOf,
  usesAllScrapers,
  type FileConnection,
  type FileConnectionDraft,
  type FileProtocol,
  type LocalConnection,
  type LocalConnectionDraft,
  type SmbConnection,
  type SmbConnectionDraft,
  type WebdavAuthType,
  type WebdavConnection,
  type WebdavConnectionDraft
} from './connection'

export type {
  FileCopyRequest,
  FileCreateOptions,
  FileCreateRequest,
  FileDownloadRequest,
  FileMkdirOptions,
  FileMkdirRequest,
  FileMoveRequest,
  FileRemoveOptions,
  FileRemoveRequest,
  FileTargetRequest,
  FileTransferOptions,
  FileUploadRequest,
  FileWriteTextRequest
} from './request'

export type {
  FileTransferDoneEvent,
  FileTransferKind,
  FileTransferProgressEvent,
  FileTransferStart
} from './transfer'

export { fileFail, fileOk, isFileOk, type ConnectionTestResult, type FileResult } from './result'
