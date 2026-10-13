/**
 * 插件类别：影片信息 / 演员信息 / 翻译 / 存储，四类插件互相独立。
 *
 * 契约：
 * - 类别由插件 `meta.kind` 显式声明；缺失或非法一律加载失败（旧插件必须补上 kind 再导入）；
 * - 宿主只认该类别的 `all` 方法表：缺 `required` 或实现了别类方法都在编译期报 `invalidPlugin`；
 * - 同一 id 允许在不同类别里各存一份（目录、索引、IPC 通道都按类别隔离）；
 * - 各类别的方法入参形状不同：影片 / 演员是一个字符串，翻译与存储是对象
 *   （见 `./translate` 与 `./storage`）。
 */
import type { PluginMethod } from './define'

export type PluginKind = 'movie' | 'actor' | 'translate' | 'storage'

export const PLUGIN_KINDS: readonly PluginKind[] = ['movie', 'actor', 'translate', 'storage']

export const PLUGIN_KIND_LABELS: Readonly<Record<PluginKind, string>> = {
  movie: '影片信息',
  actor: '演员信息',
  translate: '翻译',
  storage: '存储'
}

/** 四个插件页的副标题：一句话说清这一类别负责什么 */
export const PLUGIN_KIND_DESCRIPTIONS: Readonly<Record<PluginKind, string>> = {
  movie: '导入本机 JS 影片插件：按番号搜索影片，抓取详情、封面与花絮。',
  actor: '导入本机 JS 演员插件：按姓名抓取演员资料与头像图集。',
  translate: '导入本机 JS 翻译插件：给定文本与目标语言，返回译文。',
  storage: '导入本机 JS 存储插件：把网盘等云端存储接入应用，安装后在存储页新增连接。'
}

export interface PluginKindMethodTable {
  /** 必须实现的方法，缺一个就加载失败 */
  required: readonly PluginMethod[]
  /** 可选方法，实现了才生效 */
  optional: readonly PluginMethod[]
  /** 该类别允许出现的全部方法名（IPC 边界用它校验待测方法） */
  all: readonly PluginMethod[]
}

function methodTable(
  required: readonly PluginMethod[],
  optional: readonly PluginMethod[]
): PluginKindMethodTable {
  return { required, optional, all: [...required, ...optional] }
}

export const PLUGIN_KIND_METHODS: Readonly<Record<PluginKind, PluginKindMethodTable>> = {
  movie: methodTable(['search', 'detail', 'covers', 'extras'], []),
  actor: methodTable(['actor'], ['actorAssets']),
  translate: methodTable(['translate'], []),
  storage: methodTable(['list', 'stat', 'resolve'], [])
}

export function isPluginKind(value: unknown): value is PluginKind {
  return PLUGIN_KINDS.some((kind) => kind === value)
}
