/**
 * 连接弹窗的表单状态与提交逻辑。
 *
 * 从 `ConnectionDialogContent.vue` 抽出来，一是让 SFC 只留模板与样式（RL-05 行数上限），
 * 二是让「草稿怎么拼」这件事有唯一出处：新增字段只需要改这里。
 *
 * 契约：
 * - 空串密码表示清空已存密码，`undefined` 表示沿用密钥串里的旧密码；
 * - 插件连接的配置字段由插件声明（`useStoragePlugins.fieldsOf`）：非 secret 字段全量提交；
 *   secret 字段留空提交 `undefined`（保持已存值），与密码同约定；
 * - 缺省 id 即新建；协议在编辑态不可切换（由模板控制）；
 * - 刮削器与 NSFW 都不属于存储（Jellyfin 口径），分别归资料库与资料库的 `nsfwProtection`。
 */
import { computed, reactive, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { fileApi, pluginApi } from '@/api'
import {
  FILE_PROTOCOLS,
  FILE_PROTOCOL_LABELS,
  isBuiltinFileProtocol,
  isPluginConnection,
  SMB_DEFAULT_PORT,
  WEBDAV_AUTH_TYPES,
  type FileConnection,
  type FileConnectionDraft,
  type FileProtocol,
  type WebdavAuthType
} from '@common/types/file'
import type { PluginEnvField } from '@common/types/plugin'
import { useStoragePlugins } from './useStoragePlugins'

const AUTH_LABELS: Record<WebdavAuthType, string> = {
  auto: '自动协商',
  basic: 'Basic',
  digest: 'Digest',
  none: '无需认证'
}

export interface ConnectionForm {
  name: string
  rootPath: string
  url: string
  username: string
  authType: WebdavAuthType
  password: string
  host: string
  port: number
  share: string
  domain: string
  /** 插件连接的动态配置（含 secret 字段明文，提交前由 buildDraft 分拣） */
  pluginConfig: Record<string, string>
}

export function useConnectionForm(options: {
  connection?: FileConnection
  onSaved: (connection: FileConnection) => void
}) {
  const storagePlugins = useStoragePlugins()
  const protocol = ref<FileProtocol>(options.connection?.protocol ?? 'local')
  const form = reactive<ConnectionForm>({
    name: '',
    rootPath: '',
    url: '',
    username: '',
    authType: 'auto',
    password: '',
    host: '',
    port: SMB_DEFAULT_PORT,
    share: '',
    domain: '',
    pluginConfig: {}
  })
  const saving = ref(false)
  const testing = ref(false)

  /** 当前协议对应的插件连接字段声明（内置协议为空表） */
  const pluginFields = ref<PluginEnvField[]>([])
  const isPluginProtocol = computed(
    () => !isBuiltinFileProtocol(protocol.value as string)
  )

  const protocolOptions = computed(() => [
    ...FILE_PROTOCOLS.map((value) => ({ value, label: FILE_PROTOCOL_LABELS[value] })),
    ...storagePlugins.plugins.value.map((item) => ({ value: item.id, label: item.name }))
  ])
  const authOptions = WEBDAV_AUTH_TYPES.map((value) => ({ value, label: AUTH_LABELS[value] }))

  const showPassword = computed(() => protocol.value !== 'local' && !isPluginProtocol.value)
  const hasStoredPassword = computed(() => {
    const current = options.connection
    if (!current || current.protocol === 'local') return false
    return current.hasPassword
  })
  const passwordPlaceholder = computed(() => {
    if (protocol.value === 'openlist') {
      return hasStoredPassword.value ? '已保存令牌，留空表示不修改' : '在 OpenList 后台「设置 → 其他」页面获取'
    }
    return hasStoredPassword.value ? '已保存密码，留空表示不修改' : '密码只写入本机密钥串，不落明文'
  })

  /** 协议指向插件时拉取该插件的字段声明（编辑回显与切换协议都走这里） */
  async function loadPluginFields(pluginId: string): Promise<void> {
    const result = await pluginApi.storage.getEnv(pluginId)
    pluginFields.value = result.ok ? result.data.fields : []
  }

  watch(
    protocol,
    (value) => {
      form.pluginConfig = {}
      if (!isBuiltinFileProtocol(value as string)) void loadPluginFields(value as string)
      else pluginFields.value = []
    },
    { immediate: false }
  )

  function initForm(connection: FileConnection | undefined): void {
    if (!connection) return
    form.name = connection.name
    if (isPluginConnection(connection)) {
      // 插件连接：config 只含非敏感字段（可回显）；secret 字段不回显，留空表示保持
      form.pluginConfig = { ...connection.config }
      return
    }
    if (connection.protocol === 'local') {
      form.rootPath = connection.rootPath
      return
    }
    if (connection.protocol === 'webdav') {
      form.username = connection.username
      form.url = connection.url
      form.authType = connection.authType
      return
    }
    if (connection.protocol === 'openlist') {
      form.url = connection.url
      return
    }
    form.username = connection.username
    form.host = connection.host
    form.port = connection.port
    form.share = connection.share
    form.domain = connection.domain
  }

  initForm(options.connection)
  if (isPluginProtocol.value) void loadPluginFields(protocol.value as string)

  function buildDraft(): FileConnectionDraft {
    const name = form.name.trim()
    const identity = {
      name,
      ...(options.connection ? { id: options.connection.id } : {})
    }
    if (isPluginProtocol.value) {
      const config: Record<string, string> = {}
      for (const field of pluginFields.value) {
        const value = form.pluginConfig[field.key] ?? ''
        // secret 字段留空 = 保持已存值；非 secret 字段全量提交
        if (field.secret === true) {
          if (value.length > 0) config[field.key] = value
          continue
        }
        config[field.key] = value
      }
      return { ...identity, protocol: protocol.value as string, config }
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
    if (protocol.value === 'openlist') {
      return {
        ...identity,
        protocol: 'openlist',
        url: form.url.trim(),
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

  return {
    storagePlugins,
    protocol,
    form,
    saving,
    testing,
    protocolOptions,
    authOptions,
    pluginFields,
    isPluginProtocol,
    showPassword,
    passwordPlaceholder,
    onTest,
    onSubmit
  }
}
