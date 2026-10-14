<script setup lang="ts">
/**
 * 连接弹窗的内容组件（外壳见同目录 ConnectionDialog.tsx）。
 *
 * 表单状态与提交逻辑都委托给 `useConnectionForm`，本文件只负责字段排布；
 * 插件存储的动态字段在 `PluginConnectionFields.vue`（字段表来自插件声明）；
 * 「测试连接」「保存」两个按钮在外壳 footer，这里用 `defineExpose` 把动作与状态交出去
 * （见 `@/utils/modal/ModalContent`）。
 */
import { computed } from 'vue'
import { isBuiltinFileProtocol, type FileConnection } from '@common/types/file'
import { protocolHint } from '../storageUtils'
import { useConnectionForm } from '../composables/useConnectionForm'
import PluginConnectionFields from './PluginConnectionFields.vue'

const props = defineProps<{ connection?: FileConnection }>()
const emit = defineEmits<{ success: [connection: FileConnection] }>()

const {
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
} = useConnectionForm({
  connection: props.connection,
  onSaved: (connection) => emit('success', connection)
})

/** 提示文案：内置协议用固定说明，插件协议用插件自己的描述 */
const hint = computed(() =>
  protocolHint(
    protocol.value,
    isBuiltinFileProtocol(protocol.value as string)
      ? undefined
      : storagePlugins.descriptionOf(protocol.value as string)
  )
)

/** 交给外壳 footer：左侧「测试连接」+ 右侧「保存」，状态用于按钮 loading（契约见 ModalContentExpose） */
defineExpose({ submit: onSubmit, saving, test: onTest, testing })
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
    <p class="form-hint">{{ hint }}</p>

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

    <template v-else-if="protocol === 'openlist'">
      <div class="form-row">
        <span class="form-label">API 地址</span>
        <t-input v-model="form.url" class="form-control" placeholder="https://pan.example.com" />
      </div>
    </template>

    <template v-else-if="isPluginProtocol">
      <plugin-connection-fields v-model="form.pluginConfig" :fields="pluginFields" />
    </template>

    <template v-else-if="protocol === 'smb'">
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
      <span class="form-label">{{ protocol === 'openlist' ? '令牌' : '密码' }}</span>
      <t-input
        v-model="form.password"
        class="form-control"
        type="password"
        :placeholder="passwordPlaceholder"
      />
    </div>
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
</style>
