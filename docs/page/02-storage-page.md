# 存储管理页面

## 1. 定位与入口

存储管理页是[文件模块](../file/01-file-module.md)的前端外壳：左边管数据源（连接），右边浏览与操作文件。它把文件模块的 **18 个 invoke + 2 个推送通道**全部接了出来，渲染层只经 `@/api` 的 `fileApi` 调用，不触碰 `window.preload`。

- 侧栏一级菜单「存储」，图标 `HardDiskStorageIcon`（`src/renderer/src/windows/main/pages/app/AppSide.vue`）。
- 路由 `/storage`，位于 `/workspace` 与 `/tools` 之间，懒加载 `StoragePage.vue`（`src/renderer/src/windows/main/router.ts`）。
- 覆盖能力：连接的新建 / 编辑 / 删除 / 测试连通，目录浏览，新建文件夹、新建文件、重命名、移动、复制、删除、读改文本，上传与下载（含进度与取消）。

## 2. 目录结构

```
src/renderer/src/windows/main/pages/storage/
├── StoragePage.vue                  # 页面骨架：PageLayout + 左面板 + 右浏览器
├── storageUtils.ts                  # 纯展示工具（无状态）
├── composables/
│   ├── useStorageConnections.ts     # 连接列表 / 选中 / 保存 / 删除 / 测试
│   ├── useStorageBrowser.ts         # 当前目录、条目、面包屑与全部写操作
│   ├── useStorageTransfers.ts       # 上传下载的进度、取消与清理
│   └── useStorageActions.ts         # 把界面点击转成「弹窗 + 调用」
├── modals/                          # 四组命令式弹窗：外壳 .tsx + 内容 .vue
│   ├── ConnectionDialog.tsx / ConnectionDialogContent.vue
│   ├── EntryNameDialog.tsx / EntryNameDialogContent.vue
│   ├── PathDialog.tsx / PathDialogContent.vue
│   └── TextEditorDialog.tsx / TextEditorDialogContent.vue
└── components/
    ├── StorageConnectionPanel.vue   # 左侧数据源列表（固定 300px）
    ├── StorageBrowser.vue           # 右侧：工具条 + 面包屑 + 表格 + 传输面板
    ├── StorageEntryTable.vue        # 条目表格 + 行内操作
    └── StorageTransferList.vue      # 传输进度面板
```

## 3. 页面骨架

- `StoragePage.vue`：`PageLayout`（title「存储」，description 说明统一管理三类数据源），`#extra` 放「刷新」（loading 绑连接列表）与「新建数据源」。
- 主体 `.storage-page` 是 `display:flex; gap:16px; height:100%`：左侧面板固定 300px，右侧 `StorageBrowser` 自适应（`min-width:0`，表格区自己滚动）。
- 消息提示统一 `MessagePlugin`，破坏性操作统一 `DialogPlugin.confirm`（删除连接用 `theme: 'warning'`）。

## 4. 连接管理

状态在 `useStorageConnections.ts` 里，页面与面板都不自己存连接：

| 导出 | 说明 |
| --- | --- |
| `connections` / `loading` | `fileApi.listConnections()` 的列表与加载态 |
| `activeId` / `activeConnection` | 选中连接，`activeId` 用 `useLocalStorage('vault-scrape:storage-active-connection')` 记住；选中项被删或列表变化后自动回落到第一条 |
| `refresh()` | 重新拉列表并纠正选中项，页面 `onMounted` 与保存后都会调 |
| `select(id)` | 切换选中 |
| `remove(connection)` | `fileApi.deleteConnection` → 提示 → 刷新 |
| `test(connection)` | 返回 `ConnectionTestResult`，页面按 `ok` 分别 `MessagePlugin.success / error` |

测试已保存的连接时不重新输入密码：内部的 `toConnectionDraft(connection)` 会把连接转成草稿且**不带 `password` 字段**，主进程 `buildConnectionFromDraft` 见到 `id` 存在且未传密码就沿用钥匙串里的已存密码（见[文件模块 5 节](../file/01-file-module.md)）。

## 5. 连接弹窗

- 外壳 `modals/ConnectionDialog.tsx` 导出 `openConnectionDialog({ connection?, onSaved? })`：`DialogPlugin({ width: 560, footer: false, destroyOnClose: true, body: () => h(ConnectionDialogContent, props) })`，内容组件通过 `emit('success', connection)` / `emit('close')` 回传，外壳负责关闭弹窗并回调 `onSaved`。
- 内容组件按协议渲染不同字段：本地磁盘填根目录；WebDAV 填地址、用户名、认证方式（`auto` 自动协商 / `basic` / `digest` / `none` 无需认证）与密码；SMB 填主机、端口（默认 445）、共享名、域、用户名与密码。
- 协议在编辑态不可切换（连接协议是身份的一部分，改协议等于换连接）。
- 密码草稿语义与主进程一致：**留空 = 沿用已存密码（`undefined`）**，填了就是新密码，显式清空才写空串；编辑时占位文案提示这一点，新建时提示「密码只写入本机钥匙串，不落明文」。
- 弹窗内自带「测试连接」，保存成功后由外壳关闭并触发列表刷新。

## 6. 文件浏览器

`useStorageBrowser(connectionId)` 持有当前目录，`watch(connectionId, { immediate: true })` 在切换数据源时把路径重置到连接根（`FILE_ROOT`）并重新拉取。

- 路径：`path` 永远是连接内 POSIX 路径，`isRoot` 决定「上级目录」是否可用；`breadcrumb` 是 `{ label, path }[]`，根段显示「根目录」，点任意一段跳转。
- 读：`load()` / `go(target)` / `goParent()` / `open(entry)`（目录进入，文件走下载）；失败时 `MessagePlugin.error` 展示信封里的中文 `message`。
- 写：`mkdir` / `createFile` / `rename` / `copy` / `move` / `remove` 都走内部 `execute(action, successText)`——成功提示 + 重拉当前目录，失败提示；`remove` 额外拦下连接根（「不能删除连接根目录」）。
- 名称校验：`nameError(name)` 只挡空名与含斜杠两种输入，其余交给主进程的落盘校验。
- 文本：`readText` / `writeText` 只对文本类条目开放（`isTextEntry` 按扩展名或 `text/` mime 判断），大文件一律走上传下载。
- 行内操作在 `StorageEntryTable.vue`：目录行点击即进入，文件行点击即下载；每行「更多」下拉给重命名 / 复制到 / 移动到 / 编辑文本 / 下载 / 删除，删除项用 `theme: 'error'`。
- 覆盖语义：复制、移动、上传、下载与文本保存都默认**不覆盖**，目标已存在会拿到 `alreadyExists`；需要覆盖时用弹窗里的覆盖开关显式打开。

## 7. 传输进度与取消

`useStorageTransfers.ts` 把两个全局推送收敛成本页的传输列表：

- 推送是全局的，所以内部用 `tracked: Set<string>` 白名单，只展示本页发起的 `transferId`。
- `upload(request)` / `download(request)` 先拿 `FileResult<FileTransferStart>`，在推送到达前就把条目录入列表，随后按 `file:transferProgress` 累加进度，按 `file:transferDone` 落终态（成功 / 失败 + 中文原因）。
- `cancel(transferId)` 调 `fileApi.cancelTransfer`；「清理已结束」只移除终态条目。
- 传输成功后若仍停留在同一连接，自动重拉当前目录（`onSettled` 回调），因此上传完能立刻看到新文件。
- 组件卸载时（`onScopeDispose`）调用两个订阅函数退订，避免离开页面后继续收推送。

## 8. 弹窗与页面约定对齐

- 四组弹窗都按项目约定拆成 `.tsx` 外壳 + `.vue` 内容，外壳只做 `DialogPlugin` 与选项声明，内容组件只用 `emit('close')` / `emit('success', 载荷)` 与外壳通信，外壳负责关闭弹窗并回调调用方；`footer: false`、`destroyOnClose: true`。
- `EntryNameDialog` 服务新建文件夹 / 新建文件 / 重命名；`PathDialog` 服务上传 / 下载 / 复制到 / 移动到（`withOverwrite` 为真时显示覆盖开关）；`TextEditorDialog` 负责读改文本。
- 上传与下载的本机路径都是**输入框**：本轮没有接入主进程 `dialog.showOpenDialog` 原生选择器（见[基础页面 待接入项](./01-base-pages.md)）。
- 本次新增的 tdesign 组件已手工补进 `src/renderer/src/renderer/components.d.ts` 的两个 block（`TBreadcrumb`、`TBreadcrumbItem`、`TProgress`、`TTextarea`）——该文件只在 `dev` / `build` 时被 unplugin-vue-components 重写，提交物需手改。

## 9. 手工验证清单

按项目约定只跑 `yarn typecheck`，运行时行为手工验证：

1. 首次进入「存储」：左侧空态 + 右侧占位；点「新建数据源」，分别建本地目录、WebDAV、SMB 三种连接，确认列表出现且协议标签正确。
2. 点某个已保存 WebDAV / SMB 连接的「测试连通」，成功时提示里应含协议与地址；再断开网络重测，应得到中文失败提示且不弹异常。编辑连接时把密码留空保存，重测应仍成功（证明沿用钥匙串密码）。
3. 文件浏览器：进入子目录、面包屑回跳、上级目录到根后置灰；新建文件夹 / 新建文件 / 重命名 / 复制到 / 移动到 / 删除各走一遍，重点确认目标已存在时不勾选覆盖会报「已存在」、删除连接根被拦住。
4. 上传：填一个真实大文件的本机绝对路径，观察进度条推进；中途「取消」，确认列表落到已取消且远端没有半成品；下载同理并检查本机落点。
5. 文本：对 `.nfo` / `.json` 走「编辑文本」，保存后重新打开确认内容已写入；对二进制大文件确认没有暴露编辑入口。
6. 切换数据源与离开页面：选中项应被记住，传输列表不残留别的连接的任务，控制台无残留推送报错。
