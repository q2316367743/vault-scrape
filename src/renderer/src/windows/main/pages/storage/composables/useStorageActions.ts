/**
 * 存储管理页的交互入口：把表格 / 工具栏上的操作接到弹窗与浏览器状态上。
 *
 * 单独成 composable 是为了让 StorageBrowser.vue 保持纯展示，同时守住 vue 文件 300 行上限。
 */
import type { Ref } from 'vue'
import { DialogPlugin, MessagePlugin } from 'tdesign-vue-next'
import { joinRemotePath, type FileEntry } from '@common/types/file'
import { openEntryNameDialog } from '../modals/EntryNameDialog'
import { openPathDialog } from '../modals/PathDialog'
import { openTextEditorDialog } from '../modals/TextEditorDialog'
import { localFileName } from '../storageUtils'
import type { useStorageBrowser } from './useStorageBrowser'
import type { useStorageTransfers } from './useStorageTransfers'

type StorageBrowserState = ReturnType<typeof useStorageBrowser>
type StorageTransferState = ReturnType<typeof useStorageTransfers>

export function useStorageActions(
  connectionId: Ref<string>,
  browser: StorageBrowserState,
  transfers: StorageTransferState
) {
  function onCreateFolder(): void {
    openEntryNameDialog({
      title: '新建文件夹',
      label: '文件夹名称',
      placeholder: '例如 Season 1',
      confirmText: '创建',
      onConfirm: (name) => void browser.mkdir(name)
    })
  }

  function onCreateFile(): void {
    openEntryNameDialog({
      title: '新建文件',
      label: '文件名称',
      placeholder: '例如 movie.nfo',
      confirmText: '创建',
      onConfirm: (name) => void browser.createFile(name)
    })
  }

  function onUpload(): void {
    openPathDialog({
      title: '上传文件',
      label: '本机文件绝对路径',
      placeholder: '/Users/you/Downloads/movie.nfo',
      hint: `上传到「${browser.path.value}」，文件名沿用本机文件名`,
      confirmText: '上传',
      withOverwrite: true,
      onConfirm: (localPath, overwrite) => {
        const name = localFileName(localPath)
        if (name.length === 0) {
          MessagePlugin.warning('路径需要包含文件名')
          return
        }
        void transfers.upload({
          connectionId: connectionId.value,
          localPath,
          remotePath: joinRemotePath(browser.path.value, name),
          overwrite
        })
      }
    })
  }

  function onDownload(entry: FileEntry): void {
    openPathDialog({
      title: `下载「${entry.name}」`,
      label: '保存到的本机绝对路径',
      defaultValue: `/Users/you/Downloads/${entry.name}`,
      hint: '该路径的父目录必须已存在，文件本身不存在或允许覆盖',
      confirmText: '下载',
      withOverwrite: true,
      onConfirm: (localPath, overwrite) => {
        void transfers.download({
          connectionId: connectionId.value,
          remotePath: entry.path,
          localPath,
          overwrite
        })
      }
    })
  }

  function onRename(entry: FileEntry): void {
    openEntryNameDialog({
      title: `重命名「${entry.name}」`,
      label: '新名称',
      defaultValue: entry.name,
      confirmText: '重命名',
      onConfirm: (name) => void browser.rename(entry, name)
    })
  }

  function onCopy(entry: FileEntry): void {
    openPathDialog({
      title: `复制「${entry.name}」到`,
      label: '目标路径',
      defaultValue: entry.path,
      hint: '连接内路径，以 / 为连接根；目标已存在时需勾选覆盖',
      confirmText: '复制',
      withOverwrite: true,
      onConfirm: (target, overwrite) => void browser.copy(entry, target, overwrite)
    })
  }

  function onMove(entry: FileEntry): void {
    openPathDialog({
      title: `移动「${entry.name}」到`,
      label: '目标路径',
      defaultValue: entry.path,
      hint: '连接内路径，以 / 为连接根；目标已存在时需勾选覆盖',
      confirmText: '移动',
      withOverwrite: true,
      onConfirm: (target, overwrite) => void browser.move(entry, target, overwrite)
    })
  }

  function onRemove(entry: FileEntry): void {
    const dialog = DialogPlugin.confirm({
      header: '删除',
      body:
        entry.type === 'directory'
          ? `将删除目录「${entry.name}」及其中的全部内容，不可恢复。`
          : `将删除文件「${entry.name}」，不可恢复。`,
      theme: 'warning',
      onConfirm: async () => {
        dialog.hide()
        await browser.remove(entry)
      }
    })
  }

  function onEditText(entry: FileEntry): void {
    openTextEditorDialog({
      name: entry.name,
      load: () => browser.readText(entry),
      save: (content) => browser.writeText(entry, content)
    })
  }

  return {
    onCreateFolder,
    onCreateFile,
    onUpload,
    onDownload,
    onRename,
    onCopy,
    onMove,
    onRemove,
    onEditText
  }
}
