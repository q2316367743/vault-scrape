/**
 * 存储插件示例（kind: 'storage'）——面向「假想的 JSON API 网盘」的完整骨架。
 *
 * 用途：
 * 1. 演示存储插件的全部契约（list / stat / resolve 三个必需方法）；
 * 2. 作为真实网盘插件（如 123pan）的迁移模板：token 管理、路径 → 文件 ID
 *    的逐级解析、游标分页、下载直链解析，真实网盘插件照这个结构填 API 细节即可。
 *
 * 注意：
 * - 这是**示例**，不指向任何真实网盘；不填连接配置里的接口地址就没有可用后端；
 * - 插件是纯 JS（无 import / require），运行在沙箱里，联网只能走 ctx.request；
 * - 方法之间的互调用**顶层函数 + 闭包**（宿主重建插件时方法会被单独摘出调用，
 *   方法内不要用 this）；
 * - 第一版存储插件是**只读**的：浏览、扫描入库、读 NFO、播放；不支持写回。
 *
 * 安装：插件页「存储」tab 导入本文件；然后在存储页「新建数据源」选择该插件，
 * 按提示填写接口地址与访问令牌（令牌加密保存在本机，界面不回显）。
 */

// ---------------------------------------------------------------------------
// 内部基础设施：真实网盘插件通常需要「token 管理 + 路径 → 文件 ID 解析」两块，
// 下面的写法可以直接搬去 123pan 等网盘插件，替换成对应平台的 API 细节。
// ---------------------------------------------------------------------------

/**
 * 路径 → 文件 ID 的解析缓存：按「父 ID + 段名」存，列目录时顺手填充。
 * 网盘 API 普遍按文件 ID 寻址，而宿主全链路用的都是连接内 POSIX 路径，
 * 插件要自己把路径翻译成 ID；缓存挂在这份脚本编译产物的闭包里，连接存活期间有效。
 */
const idCache = {}

function cacheKey(parentId, name) {
  return `${parentId}/${name}`
}

/** 带鉴权头的请求：统一塞令牌、统一检查状态码；ctx.request 只负责传输，状态码插件自己判断 */
async function apiGet(env, path, query) {
  const base = String(env.baseUrl || '').replace(/\/+$/, '')
  const search = new URLSearchParams(query || {}).toString()
  const url = `${base}${path}${search ? `?${search}` : ''}`
  const response = await ctx.request({
    url,
    headers: { Authorization: `Bearer ${String(env.accessToken || '')}` }
  })
  if (response.status === 401) {
    throw new Error('访问令牌无效或已过期，请更新连接配置')
  }
  if (response.status !== 200) {
    throw new Error(`接口返回状态码 ${response.status}`)
  }
  return JSON.parse(response.data)
}

function rememberChildren(parentId, entries) {
  for (const item of entries) {
    if (item.type === 'folder') {
      idCache[cacheKey(parentId, item.name)] = item.id
    }
  }
}

/** 逐级从根目录往下解析路径，已解析的层级直接走缓存 */
async function resolveId(env, path) {
  const segments = String(path || '').split('/').filter((item) => item.length > 0)
  let parentId = '0' // 约定：根目录 ID 为 '0'（123pan 也是 0）
  let currentPath = ''
  for (const segment of segments) {
    currentPath = `${currentPath}/${segment}`
    const cached = idCache[cacheKey(parentId, segment)]
    if (cached !== undefined) {
      parentId = cached
      continue
    }
    // 缓存未命中：列父目录找到这一段（一次 API 调用）
    const page = await apiGet(env, '/v1/files', { parentId, name: segment })
    const hit = (page.items || []).find((item) => item.name === segment)
    if (!hit) throw new Error(`路径不存在：${currentPath}`)
    idCache[cacheKey(parentId, segment)] = hit.id
    rememberChildren(hit.id, hit.children || [])
    parentId = hit.id
  }
  return parentId
}

/** 平台条目 → 插件条目：字段口径见 docs/plugin/11-storage-plugins.md */
function toEntry(item, parentPath) {
  const isDir = item.type === 'folder'
  return {
    path: parentPath === '/' ? `/${item.name}` : `${parentPath}/${item.name}`,
    name: item.name,
    type: isDir ? 'directory' : 'file',
    size: isDir ? 0 : Number(item.size || 0),
    modifiedAt: Number(item.updatedAt || 0)
  }
}

definePlugin({
  meta: {
    kind: 'storage',
    id: 'storage-demo',
    name: '示例网盘',
    version: '1.0.0',
    author: 'you',
    description: '存储插件契约示例：演示列表、详情与下载直链三个必需方法的写法。'
  },

  // 连接配置字段模板：每个连接各填一份（同一个插件可以建多个连接）。
  // secret: true 的字段加密落盘、界面不回显；其余字段明文存储、可回显。
  env: [
    {
      key: 'baseUrl',
      label: '接口地址',
      required: true,
      placeholder: 'https://api.example.com',
      description: '网盘开放 API 的根地址，不要带结尾斜杠'
    },
    {
      key: 'accessToken',
      label: '访问令牌',
      required: true,
      secret: true,
      description: '在网盘开放平台申请，本机加密保存，界面不回显'
    }
  ],

  // -------------------------------------------------------------------------
  // 三个必需方法（第一版只读）。宿主的 readRange / readText / download 都建立在
  // resolve 给出的直链上：直链 + 请求头由插件给出，Range 请求由宿主统一发起。
  // -------------------------------------------------------------------------

  /**
   * 列目录（游标分页，单页即可）。
   * 返回 { entries, nextCursor? }；nextCursor 非空时宿主会带着它继续调用直到翻完。
   * cursor 的内容完全由插件自定义（平台 cursor、偏移量或上一页末尾的文件 ID 都行）。
   */
  async list(input, env) {
    const parentPath = String(input.path || '/')
    const parentId = await resolveId(env, parentPath)
    const query = { parentId, limit: 100 }
    if (input.cursor) query.cursor = input.cursor
    const page = await apiGet(env, '/v1/files', query)
    const entries = (page.items || []).map((item) => toEntry(item, parentPath))
    // 顺手填充路径 → ID 缓存，后续 stat / resolve 就不用再逐级找
    for (const raw of page.items || []) {
      if (raw.type === 'folder') {
        idCache[cacheKey(parentId, raw.name)] = raw.id
      }
    }
    return { entries, nextCursor: page.nextCursor || undefined }
  },

  /** 查询单个条目；不存在时抛错（宿主按「目标不存在」处理） */
  async stat(input, env) {
    const path = String(input.path || '/')
    if (path === '/') {
      return { path: '/', name: '', type: 'directory', size: 0, modifiedAt: 0 }
    }
    const parentPath = path.slice(0, path.lastIndexOf('/')) || '/'
    const name = path.slice(path.lastIndexOf('/') + 1)
    const parentId = await resolveId(env, parentPath)
    const page = await apiGet(env, '/v1/files', { parentId, name })
    const hit = (page.items || []).find((item) => item.name === name)
    if (!hit) throw new Error(`路径不存在：${path}`)
    return toEntry(hit, parentPath)
  },

  /**
   * 解析下载直链：宿主播放（Range）、读 NFO、下载落盘全部拿这条直链取字节。
   * 返回 { url, headers?, ttlSeconds? }：
   * - headers：防盗链需要的 Cookie / UA 等，宿主取字节时原样携带（重定向后也带着）；
   * - ttlSeconds：直链有效期（秒），宿主在有效期内复用，过期自动重新调 resolve。
   */
  async resolve(input, env) {
    const fileId = await resolveId(env, String(input.path || '/'))
    const info = await apiGet(env, `/v1/files/${fileId}/download`, {})
    if (!info.url) throw new Error('平台没有返回下载地址')
    return {
      url: info.url,
      headers: { 'User-Agent': 'vault-scrape-storage-demo/1.0' },
      ttlSeconds: Number(info.expiresIn || 300)
    }
  }
})
