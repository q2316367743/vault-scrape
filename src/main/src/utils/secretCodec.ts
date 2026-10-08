/**
 * 敏感值的编解码：插件配置与文件连接密码共用同一套语义。
 *
 * 契约：
 * 1. 空串表示「没有值」；
 * 2. 优先 `safeStorage`（系统钥匙串）加密，不可用时回落 base64 并在控制台告警；
 * 3. 解码失败由调用方决定抛什么错误（传入错误工厂），绝不静默返回空串；
 * 4. 明文只存在于主进程内存中，永不落盘、永不跨 IPC。
 */
import { safeStorage } from 'electron'

const SAFE_PREFIX = 'safe:'
const PLAIN_PREFIX = 'plain:'

/** 编码敏感值：`safe:` 前缀为钥匙串密文，`plain:` 前缀为系统不支持钥匙串时的明文回落 */
export function encodeSecret(secret: string, scope: string): string {
  if (secret.length === 0) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return `${SAFE_PREFIX}${safeStorage.encryptString(secret).toString('base64')}`
  }
  console.warn(`[${scope}] 系统钥匙串不可用，敏感值将以明文形式保存在本机配置文件中`)
  return `${PLAIN_PREFIX}${Buffer.from(secret, 'utf-8').toString('base64')}`
}

/** 解码敏感值；解密失败时抛出 `describeError` 构造的错误，由调用方决定错误码与文案 */
export function decodeSecret(encoded: string, describeError: (reason: string) => Error): string {
  if (encoded.length === 0) return ''
  if (encoded.startsWith(SAFE_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(encoded.slice(SAFE_PREFIX.length), 'base64'))
    } catch {
      throw describeError('系统钥匙串解密失败')
    }
  }
  if (encoded.startsWith(PLAIN_PREFIX)) {
    return Buffer.from(encoded.slice(PLAIN_PREFIX.length), 'base64').toString('utf-8')
  }
  return ''
}
