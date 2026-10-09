<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
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
import { PROTOCOL_HINTS } from '../storageUtils'

const props = defineProps<{ connection?: FileConnection }>()
const emit = defineEmits<{ close: []; success: [connection: FileConnection] }>()

const AUTH_LABELS: Record<WebdavAuthType, string> = {
  auto: '自动协商',
  basic: 'Basic',
  digest: 'Digest',
  none: '无需认证'
}

interface ConnectionForm {
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
}

const protocol = ref<FileProtocol>(props.connection?.protocol ?? 'local')
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
  domain: ''
})
const saving = ref(false)
const testing = ref(false)

const protocolOptions = FILE_PROTOCOLS.map((value) => ({
  value,
  label: FILE_PROTOCOL_LABELS[value]
}))
const authOptions = WEBDAV_AUTH_TYPES.map((value) => ({ value, label: AUTH_LABELS[value] }))

const showPassword = computed(() => protocol.value !== 'local')
const hasStoredPassword = computed(() => {
  const current = props.connection
  if (!current || current.protocol === 'local') return false
  return current.hasPassword
})
const passwordPlaceholder = computed(() =>
  hasStoredPassword.value ? '已保存密码，留空表示不修改' : '密码只写入本机密钥串，不落明文'
)

function initForm(connection: FileConnection | undefined): void {
  if (!connection) return
  form.name = connection.name
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

initForm(props.connection)

/** 空串表示清空已存密码，undefined 表示沿用；缺省 id 即新建 */
function buildDraft(): FileConnectionDraft {
  const name = form.name.trim()
  const identity = props.connection ? { id: props.connection.id, name } : { name }
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
    MessagePlugin.success(props.connection ? '已保存修改' : '已创建数据源')
    emit('success', result.data)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="connection-form">
    <div class="form-row">
      <span class="form-label">协议</span>
      <t-select
        v-model="protocol"
        class="form-control"
        :options="protocolOptions"
        :disabled="connection !== undefined"
      />
    </div>
    <p class="form-hint">{{ PROTOCOL_HINTS[protocol] }}</p>

    <div class="form-row">
      <span class="form-label">名称</span>
      <t-input v-model="form.name" class="form-control" placeholder="展示在数据源列表里的名字" />
    </div>

    <template v-if="protocol === 'local'">
      <div class="form-row">
        <span class="form-label">根目录</span>
        <directory-picker-field
          v-model="form.rootPath"
          class="form-control"
          title="选择根目录"
          placeholder="本机绝对路径，例如 /Users/you/Media"
        />
      </div>
    </template>

    <template v-else-if="protocol === 'webdav'">
      <div class="form-row">
        <span class="form-label">服务地址</span>
        <t-input v-model="form.url" class="form-control" placeholder="https://host/dav" />
      </div>
      <div class="form-row">
        <span class="form-label">认证方式</span>
        <t-select v-model="form.authType" class="form-control" :options="authOptions" />
      </div>
      <div class="form-row">
        <span class="form-label">用户名</span>
        <t-input v-model="form.username" class="form-control" placeholder="可留空" />
      </div>
    </template>

    <template v-else>
      <div class="form-row">
        <span class="form-label">主机</span>
        <t-input v-model="form.host" class="form-control" placeholder="192.168.1.10 或 nas.local" />
      </div>
      <div class="form-row">
        <span class="form-label">端口</span>
        <t-input-number v-model="form.port" class="form-control" :min="1" :max="65535" />
      </div>
      <div class="form-row">
        <span class="form-label">共享名</span>
        <t-input v-model="form.share" class="form-control" placeholder="连接根即该共享根，例如 media" />
      </div>
      <div class="form-row">
        <span class="form-label">域</span>
        <t-input v-model="form.domain" class="form-control" placeholder="可留空" />
      </div>
      <div class="form-row">
        <span class="form-label">用户名</span>
        <t-input v-model="form.username" class="form-control" placeholder="可留空" />
      </div>
    </template>

    <div v-if="showPassword" class="form-row">
      <span class="form-label">密码</span>
      <t-input
        v-model="form.password"
        class="form-control"
        type="password"
        :placeholder="passwordPlaceholder"
      />
    </div>

    <footer class="form-actions">
      <t-button variant="outline" :loading="testing" @click="onTest">测试连接</t-button>
      <div class="form-actions-right">
        <t-button variant="outline" @click="emit('close')">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="onSubmit">保存</t-button>
      </div>
    </footer>
  </div>
</template>

<style scoped lang="less">
.connection-form {
  padding: 4px 0;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.form-label {
  width: 76px;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.form-control {
  flex: 1;
}

.form-hint {
  margin: 0 0 14px 88px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20px;
}

.form-actions-right {
  display: flex;
  gap: 8px;
}
</style>
