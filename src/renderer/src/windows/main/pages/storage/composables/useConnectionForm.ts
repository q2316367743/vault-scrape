/**
 * 连接弹窗的表单状态与提交逻辑。
 *
 * 从 `ConnectionDialogContent.vue` 抽出来，一是让 SFC 只留模板与样式（RL-05 行数上限），
 * 二是让「草稿怎么拼」这件事有唯一出处：新增字段只需要改这里。
 *
 * 契约：
 * - 空串密码表示清空已存密码，`undefined` 表示沿用密钥串里的旧密码；
 * - 缺省 id 即新建；协议在编辑态不可切换（由模板控制）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { fileApi } from '@/api'
import {
  FILE_PROTOCOLS,
  FILE_PROTOCOL_LABELS,
  SMB_DEFAULT_PORT,
  WEBDAV_AUTH_TYPES,
  type FileConnection,
  type FileConnectionDraft,
  type FileProtocol,
  type WebdavAuthType
} from '@common/types/file'
import { useScraperOptions } from './useScraperOptions'

const AUTH_LABELS: Record<WebdavAuthType, string> = {
  auto: '自动协商',
  basic: 'Basic',
  digest: 'Digest',
  none: '无需认证'
}

export interface ConnectionForm {
  name: string
  nsfw: boolean
  /** 该存储允许使用的刮削器；空数组表示全部已启用插件 */
  scrapers: string[]
  rootPath: string
  url: string
  username: string
  authType: WebdavAuthType
  password: string
  host: string
  port: number
  share: string
  domain: string
}

export function useConnectionForm(options: {
  connection?: FileConnection
  onSaved: (connection: FileConnection) => void
}) {
  const protocol = ref<FileProtocol>(options.connection?.protocol ?? 'local')
  const form = reactive<ConnectionForm>({
    name: '',
    nsfw: false,
    scrapers: [],
    rootPath: '',
    url: '',
    username: '',
    authType: 'auto',
    password: '',
    host: '',
    port: SMB_DEFAULT_PORT,
    share: '',
    domain: ''
  })
  const saving = ref(false)
  const testing = ref(false)
  const scrapers = useScraperOptions()

  const protocolOptions = FILE_PROTOCOLS.map((value) => ({
    value,
    label: FILE_PROTOCOL_LABELS[value]
  }))
  const authOptions = WEBDAV_AUTH_TYPES.map((value) => ({ value, label: AUTH_LABELS[value] }))

  const showPassword = computed(() => protocol.value !== 'local')
  const hasStoredPassword = computed(() => {
    const current = options.connection
    if (!current || current.protocol === 'local') return false
    return current.hasPassword
  })
  const passwordPlaceholder = computed(() =>
    hasStoredPassword.value ? '已保存密码，留空表示不修改' : '密码只写入本机密钥串，不落明文'
  )
  /** 候选项加载完成前不做失效判断，否则会把「还没加载出来」误报成失效 */
  const staleScrapers = computed(() =>
    scrapers.loading.value ? [] : scrapers.unavailable([...form.scrapers])
  )

  function initForm(connection: FileConnection | undefined): void {
    if (!connection) return
    form.name = connection.name
    form.nsfw = connection.nsfw
    form.scrapers = [...connection.scrapers]
    if (connection.protocol === 'local') {
      form.rootPath = connection.rootPath
      return
    }
    form.username = connection.username
    if (connection.protocol === 'webdav') {
      form.url = connection.url
      form.authType = connection.authType
      return
    }
    form.host = connection.host
    form.port = connection.port
    form.share = connection.share
    form.domain = connection.domain
  }

  initForm(options.connection)

  function buildDraft(): FileConnectionDraft {
    const name = form.name.trim()
    const nsfw = form.nsfw
    const identity = {
      name,
      nsfw,
      scrapers: [...form.scrapers],
      ...(options.connection ? { id: options.connection.id } : {})
    }
    if (protocol.value === 'local') {
      return { ...identity, protocol: 'local', rootPath: form.rootPath.trim() }
    }
    if (protocol.value === 'webdav') {
      return {
        ...identity,
        protocol: 'webdav',
        url: form.url.trim(),
        username: form.username.trim(),
        authType: form.authType,
        password: form.password.length > 0 ? form.password : hasStoredPassword.value ? undefined : ''
      }
    }
    return {
      ...identity,
      protocol: 'smb',
      host: form.host.trim(),
      port: form.port,
      share: form.share.trim(),
      domain: form.domain.trim(),
      username: form.username.trim(),
      password: form.password.length > 0 ? form.password : hasStoredPassword.value ? undefined : ''
    }
  }

  function warnIfInvalid(): boolean {
    if (form.name.trim().length === 0) {
      MessagePlugin.warning('请先填写连接名称')
      return true
    }
    return false
  }

  async function onTest(): Promise<void> {
    if (warnIfInvalid()) return
    testing.value = true
    try {
      const result = await fileApi.testConnection(buildDraft())
      if (!result.ok) {
        MessagePlugin.error(result.message)
        return
      }
      if (result.data.ok) MessagePlugin.success(result.data.message)
      else MessagePlugin.error(result.data.message)
    } finally {
      testing.value = false
    }
  }

  async function onSubmit(): Promise<void> {
    if (warnIfInvalid()) return
    saving.value = true
    try {
      const result = await fileApi.saveConnection(buildDraft())
      if (!result.ok) {
        MessagePlugin.error(result.message)
        return
      }
      MessagePlugin.success(options.connection ? '已保存修改' : '已创建数据源')
      options.onSaved(result.data)
    } finally {
      saving.value = false
    }
  }

  onMounted(() => {
    void scrapers.load()
  })

  return {
    protocol,
    form,
    saving,
    testing,
    protocolOptions,
    authOptions,
    showPassword,
    passwordPlaceholder,
    scraperOptions: scrapers.options,
    scraperLoading: scrapers.loading,
    staleScrapers,
    onTest,
    onSubmit
  }
}
