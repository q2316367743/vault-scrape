<script setup lang="ts">
import { onMounted } from 'vue'
import { DialogPlugin, MessagePlugin } from 'tdesign-vue-next'
import { AddIcon, RefreshIcon } from 'tdesign-icons-vue-next'
import PageLayout from '@/components/PageLayout/PageLayout.vue'
import type { FileConnection } from '@common/types/file'
import { useStorageConnections } from './composables/useStorageConnections'
import { openConnectionDialog } from './modals/ConnectionDialog'
import StorageBrowser from './components/StorageBrowser.vue'
import StorageConnectionPanel from './components/StorageConnectionPanel.vue'

const { connections, loading, activeId, activeConnection, refresh, select, remove, test } =
  useStorageConnections()

function onCreate(): void {
  openConnectionDialog({ onSaved: () => void refresh() })
}

function onEdit(connection: FileConnection): void {
  openConnectionDialog({ connection, onSaved: () => void refresh() })
}

function onRemove(connection: FileConnection): void {
  const dialog = DialogPlugin.confirm({
    header: '删除数据源',
    body: `将删除「${connection.name}」及其保存的密码，磁盘上的文件不受影响。`,
    theme: 'warning',
    onConfirm: async () => {
      dialog.hide()
      await remove(connection)
    }
  })
}

/** test 内部永不出错，成功与失败都只回一条中文提示 */
async function onTest(connection: FileConnection): Promise<void> {
  const result = await test(connection)
  if (result.ok) MessagePlugin.success(result.message)
  else MessagePlugin.error(result.message)
}

onMounted(refresh)
</script>

<template>
  <page-layout title="存储" description="统一管理本地磁盘、WebDAV 与 SMB 数据源" :padded="false">
    <template #extra>
      <t-button size="small" variant="outline" :loading="loading" @click="refresh">
        <template #icon><refresh-icon /></template>
        刷新
      </t-button>
      <t-button size="small" theme="primary" @click="onCreate">
        <template #icon><add-icon /></template>
        新建数据源
      </t-button>
    </template>

    <div class="storage-page">
      <storage-connection-panel
        :connections="connections"
        :active-id="activeId"
        @select="select"
        @create="onCreate"
        @edit="onEdit"
        @remove="onRemove"
        @test="onTest"
      />
      <storage-browser :connection="activeConnection" />
    </div>
  </page-layout>
</template>

<style scoped lang="less">
// 左栏自带分隔线，主从两栏之间不再留缝
.storage-page {
  display: flex;
  height: 100%;
  min-height: 0;
}
</style>
