<template>
  <div class="library-form">
    <div class="form-row">
      <span class="form-label">名称</span>
      <t-input v-model="name" class="form-control" placeholder="例如：电影、剧集" />
    </div>

    <div class="form-row form-row-top">
      <span class="form-label">类型</span>
      <div class="form-control">
        <t-select v-model="type" class="type-select" :options="typeOptions" :disabled="typeLocked" />
        <p class="form-note">
          {{
            typeLocked
              ? '类型创建后不可修改'
              : '决定这个资料库按哪些后缀识别媒体文件（在「设置 → 资料库」里调整）'
          }}
        </p>
      </div>
    </div>

    <div class="form-row form-row-top">
      <span class="form-label">媒体目录</span>
      <div class="form-control">
        <library-directory-editor
          :rows="rows"
          :connection-options="connectionOptions"
          @add="addPath"
          @pick="pickDirectory"
          @remove="removePath"
          @change="onRowConnectionChange"
        />
      </div>
    </div>

    <div class="form-row form-row-top">
      <span class="form-label">刮削器</span>
      <div class="form-control">
        <t-select
          v-model="scrapers"
          :options="scraperOptions"
          :loading="scraperLoading"
          multiple
          clearable
          placeholder="可留空"
        />
        <p class="form-note">
          不选择刮削器表示这个资料库不刮削，扫描后不会自动刮削；不同资料库可能存放不同厂商的内容，这里只勾选覆盖该库范围的刮削器
        </p>
        <div v-if="staleScrapers.length > 0" class="stale-row">
          <span class="form-note">已失效：</span>
          <t-tag
            v-for="id in staleScrapers"
            :key="id"
            size="small"
            theme="warning"
            variant="light-outline"
          >
            {{ id }}
          </t-tag>
        </div>
      </div>
    </div>

    <div class="form-row">
      <span class="form-label">NSFW 保护</span>
      <div class="form-control form-control-inline">
        <t-switch v-model="nsfwProtection" />
        <span class="form-note">开启后，库内影片的图片默认隐藏，需要点击才显示（存储的 nsfw 标记同样生效）</span>
      </div>
    </div>

    <div class="form-row">
      <span class="form-label">写入 NFO</span>
      <div class="form-control form-control-inline">
        <t-switch v-model="writeNfo" />
        <span class="form-note">刮削完成后把元数据写成影片同目录的 movie.nfo</span>
      </div>
    </div>

    <div class="form-row">
      <span class="form-label">重命名文件</span>
      <div class="form-control form-control-inline">
        <t-switch v-model="renameEnabled" />
        <span class="form-note">刮削完成后按插件给出的标题重命名视频文件</span>
      </div>
    </div>

    <div class="form-row">
      <span class="form-label">移动文件</span>
      <div class="form-control form-control-inline">
        <t-switch v-model="moveEnabled" />
        <span class="form-note">刮削完成后把影片移动到指定目录</span>
      </div>
    </div>

    <div v-if="moveEnabled" class="form-row">
      <span class="form-label">目标目录</span>
      <div class="form-control">
        <t-input v-model="moveDirectory" placeholder="连接内路径，例如 /电影/已整理" />
        <p class="form-note">库内存在多个存储时，按目标目录所属的连接解释</p>
      </div>
    </div>

    <div class="form-row">
      <span class="form-label">图片保存</span>
      <t-select v-model="imageSaveMode" class="form-control" :options="imageSaveOptions" />
    </div>

    <p v-if="connections.length === 0" class="form-hint form-hint-warn">
      还没有存储，请先到「存储」页新建数据源
    </p>

    <footer class="form-actions">
      <div class="form-actions-right">
        <t-button variant="outline" @click="emit('close')">取消</t-button>
        <t-button theme="primary" :loading="saving" @click="onSubmit">保存</t-button>
      </div>
    </footer>
  </div>
</template>
<script setup lang="ts">
/**
 * 资料库表单（外壳见同目录 LibraryFormDialog.tsx）。
 *
 * 契约：状态与提交都在 `useLibraryForm`，本组件只负责布局与绑定；
 * 每个媒体目录一行（存储 + 选择目录 + 已选路径 + 删除），目录只能通过远程目录弹窗挑。
 */
import LibraryDirectoryEditor from './LibraryDirectoryEditor.vue'
import type { FileConnection } from '@common/types/file'
import type { MediaLibrary } from '@common/types/library'
import { useLibraryForm, type LibraryPathRow } from '../composables/useLibraryForm'

const props = defineProps<{
  /** 传入表示编辑已有资料库 */
  library?: MediaLibrary
  /** 可选存储列表，由抽屉传入 */
  connections: FileConnection[]
}>()

const emit = defineEmits<{ close: []; success: [library: MediaLibrary] }>()

const {
  name,
  type,
  typeOptions,
  typeLocked,
  scrapers,
  rows,
  nsfwProtection,
  writeNfo,
  renameEnabled,
  moveEnabled,
  moveDirectory,
  imageSaveMode,
  saving,
  scraperOptions,
  scraperLoading,
  staleScrapers,
  connectionOptions,
  imageSaveOptions,
  addPath,
  removePath,
  onConnectionChange,
  pickDirectory,
  onSubmit
} = useLibraryForm({
  library: props.library,
  connections: props.connections,
  onSaved: (library) => emit('success', library)
})

/** 换存储时把该行的目录清掉（路径只对原来那个存储有意义） */
function onRowConnectionChange(row: LibraryPathRow, value: string): void {
  row.connectionId = value
  onConnectionChange(row)
}
</script>
<style scoped lang="less">
.library-form {
  padding: 4px 0;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.form-row-top {
  align-items: flex-start;
}

.form-label {
  width: 76px;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--td-text-color-secondary);
}

.form-control {
  flex: 1;
  min-width: 0;
}

.form-control-inline {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.form-note {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
}

.type-select {
  width: 240px;
}

.form-control-inline .form-note {
  margin: 0;
}

.form-hint {
  margin: 0 0 14px 88px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
}

.form-hint-warn {
  color: var(--td-warning-color);
}

.stale-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.stale-row .form-note {
  margin: 0;
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 20px;
}

.form-actions-right {
  display: flex;
  gap: 8px;
}
</style>
