/**
 * 数据源（连接）列表的页面状态：加载、选中、删除、连通性测试。
 *
 * 选中项持久化到 localStorage，重开页面仍停在上次的数据源；
 * 该连接已被删除时自动回落到第一个可用连接。
 */
import { computed, ref } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { MessagePlugin } from 'tdesign-vue-next'
import { fileApi } from '@/api'
import { type ConnectionTestResult, type FileConnection, type FileConnectionDraft } from '@common/types/file'

const ACTIVE_CONNECTION_KEY = 'vault-scrape:storage-active-connection'

/** 已保存连接 → 草稿：不带 password 即沿用密钥串里已存的密码 */
function toConnectionDraft(connection: FileConnection): FileConnectionDraft {
  if (connection.protocol === 'local') {
    return {
      id: connection.id,
      protocol: 'local',
      name: connection.name,
      rootPath: connection.rootPath
    }
  }
  if (connection.protocol === 'webdav') {
    return {
      id: connection.id,
      protocol: 'webdav',
      name: connection.name,
      url: connection.url,
      username: connection.username,
      authType: connection.authType
    }
  }
  return {
    id: connection.id,
    protocol: 'smb',
    name: connection.name,
    host: connection.host,
    port: connection.port,
    share: connection.share,
    domain: connection.domain,
    username: connection.username
  }
}

export function useStorageConnections() {
  const storedActiveId = useLocalStorage(ACTIVE_CONNECTION_KEY, '')
  const connections = ref<FileConnection[]>([])
  const loading = ref(false)
  const activeId = ref(storedActiveId.value)

  const activeConnection = computed(
    () => connections.value.find((item) => item.id === activeId.value) ?? null
  )

  function applyActive(id: string): void {
    activeId.value = id
    storedActiveId.value = id
  }

  async function refresh(): Promise<void> {
    loading.value = true
    const result = await fileApi.listConnections()
    loading.value = false
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    connections.value = result.data
    if (result.data.some((item) => item.id === activeId.value)) return
    const first = result.data[0]
    applyActive(first ? first.id : '')
  }

  async function remove(connection: FileConnection): Promise<void> {
    const result = await fileApi.deleteConnection(connection.id)
    if (!result.ok) {
      MessagePlugin.error(result.message)
      return
    }
    MessagePlugin.success(`已删除「${connection.name}」`)
    if (activeId.value === connection.id) applyActive('')
    await refresh()
  }

  /** 临时建连后立即释放；失败只回一条中文原因，不抛异常 */
  async function test(connection: FileConnection): Promise<ConnectionTestResult> {
    const result = await fileApi.testConnection(toConnectionDraft(connection))
    if (!result.ok) return { ok: false, message: result.message }
    return result.data
  }

  return {
    connections,
    loading,
    activeId,
    activeConnection,
    refresh,
    select: applyActive,
    remove,
    test
  }
}
