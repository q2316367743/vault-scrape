/**
 * 敏感值的编解码：插件配置与文件连接密码共用同一套语义。
 *
 * 插件 core 里没有 Electron 的 `safeStorage`（系统钥匙串），这里改用本机密钥文件
 * 做 AES-256-GCM 加密：
 * - 密钥是首次运行时随机生成的 32 字节，落在插件数据目录（`secret.key`，权限 0600）；
 * - 密文格式 `aesgcm:<base64(iv + tag + ciphertext)>`，空串表示「没有值」；
 * - 这不是钥匙串级的安全边界（同机其他程序仍能读到密钥文件），但能保证
 *   备份 / 同步配置文件时密码不以明文出现；
 * - 解密失败由调用方决定抛什么错误（传入错误工厂），绝不静默返回空串。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dataPath } from '../runtime/paths'

const PREFIX = 'aesgcm:'
let cachedKey: Buffer | null = null

/** 读取（或首次生成）本机密钥 */
function secretKey(): Buffer {
  if (cachedKey) return cachedKey
  const file = dataPath('secret.key')
  if (existsSync(file)) {
    const raw = readFileSync(file)
    if (raw.length === 32) {
      cachedKey = raw
      return raw
    }
  }
  const key = randomBytes(32)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, key, { mode: 0o600 })
  try {
    chmodSync(file, 0o600)
  } catch {
    // Windows 上 chmod 语义不同，失败不影响加密
  }
  cachedKey = key
  return key
}

/** 编码敏感值：`aesgcm:` 前缀为密文，空串表示没有值 */
export function encodeSecret(secret: string, _scope: string): string {
  if (secret.length === 0) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`
}

/** 解码敏感值；解密失败时抛出 `describeError` 构造的错误，由调用方决定错误码与文案 */
export function decodeSecret(encoded: string, describeError: (reason: string) => Error): string {
  if (encoded.length === 0) return ''
  // 兼容旧版回落格式（系统钥匙串不可用时的 base64 明文）
  if (encoded.startsWith('plain:')) {
    try {
      return Buffer.from(encoded.slice('plain:'.length), 'base64').toString('utf8')
    } catch {
      return ''
    }
  }
  if (!encoded.startsWith(PREFIX)) {
    // 无法识别的值一律当作没有值，避免把脏数据当密码用
    return ''
  }
  try {
    const raw = Buffer.from(encoded.slice(PREFIX.length), 'base64')
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const ciphertext = raw.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw describeError('敏感值解密失败')
  }
}
