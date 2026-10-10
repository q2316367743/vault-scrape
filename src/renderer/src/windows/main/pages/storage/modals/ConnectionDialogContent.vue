<script setup lang="ts">
/**
 * 连接弹窗的内容组件（外壳见同目录 ConnectionDialog.tsx）。
 *
 * 表单状态与提交逻辑都委托给 `useConnectionForm`，本文件只负责字段排布。
 */
import { type FileConnection } from '@common/types/file'
import { PROTOCOL_HINTS } from '../storageUtils'
import { useConnectionForm } from '../composables/useConnectionForm'
import ConnectionPolicyField from './ConnectionPolicyField.vue'

const props = defineProps<{ connection?: FileConnection }>()
const emit = defineEmits<{ close: []; success: [connection: FileConnection] }>()

const {
  protocol,
  form,
  saving,
  testing,
  protocolOptions,
  authOptions,
  showPassword,
  passwordPlaceholder,
  onTest,
  onSubmit
} = useConnectionForm({
  connection: props.connection,
  onSaved: (connection) => emit('success', connection)
})
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

    <connection-policy-field v-model:nsfw="form.nsfw" />

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
