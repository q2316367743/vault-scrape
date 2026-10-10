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
│   ├── useStorageBrowser.ts         # 当前目录、条目、面包屑与全部写操作
│   ├── useStorageTransfers.ts       # 上传下载的进度、取消与清理
│   ├── useStorageActions.ts         # 把界面点击转成「弹窗 + 调用」
│   ├── useConnectionForm.ts         # 连接弹窗的表单状态、草稿拼装与保存 / 测试
│   └── useScraperOptions.ts         # 插件候选项（已启用且编译通过的插件）：连接弹窗已不用，只被资料库表单复用
├── modals/                          # 四组命令式弹窗：外壳 .tsx + 内容 .vue
│   ├── ConnectionDialog.tsx / ConnectionDialogContent.vue
│   ├── ConnectionPolicyField.vue    # 弹窗内的策略字段：现在只剩 NSFW 开关（刮削器已随连接字段下线）
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

状态在通用 hook `@/hooks/UseFileConnections.ts`（`useFileConnections()`）里，页面与面板都不自己存连接；`pages/storage/composables/` 只留浏览器、传输与动作三个 hook：

| 导出 | 说明 |
| --- | --- |
| `connections` / `loading` | `fileApi.listConnections()` 的列表与加载态 |
| `activeId` / `activeConnection` | 选中连接，`activeId` 用 `useLocalStorage('vault-scrape:storage-active-connection')` 记住；选中项被删或列表变化后自动回落到第一条 |
| `refresh()` | 重新拉列表并纠正选中项，页面 `onMounted` 与保存后都会调 |
| `select(id)` | 切换选中 |
| `remove(connection)` | `fileApi.deleteConnection` → 提示 → 刷新 |
| `test(connection)` | 返回 `ConnectionTestResult`，页面按 `ok` 分别 `MessagePlugin.success / error` |

左栏列表项是**两行式**（`StorageConnectionPanel.vue`）：第一行协议图标 + 名称（`font-weight: 500`，超出省略，`title` 兜底），测试连通 / 编辑 / 删除按钮只在悬停或选中时出现；第二行是连接描述（`describeConnection`，超出省略，同样带 `title`）与标签组（协议标签、`nsfw` 的 `NSFW` 标签）。名称与标签**必须分行**：标签与操作按钮都是 `flex-shrink: 0`，一旦和名称挤在同一个 flex 行里，`flex: 1; min-width: 0` 的名称会被压成零宽，在界面上直接「消失」。

连接上的 `nsfw` 标记（连接弹窗里「NSFW」开关，`ConnectionDialogContent.vue`）表示该数据源是敏感内容：列表里的连接会带一个 `NSFW` 标签（`StorageConnectionPanel.vue`，`theme="danger"`，`variant="light"`），并在应用设置开启「NSFW 保护」后让该数据源的页面隐藏敏感图片（见[设置项清单 · 应用设置](../setting/02-setting-items.md)）。转换草稿时 `nsfw` 原样带上（`toConnectionDraft` 已包含该字段）。

连接上**不再有 `scrapers` 字段**：刮削器是资料库自己的配置（见[资料库](../media/01-media-library.md)），一个存储可以被多个资料库复用、各自选不同的刮削器。因此存储页没有刮削器标签，连接弹窗里也没有刮削器多选；`FileConnection` / `FileConnectionDraft` 只保留 `nsfw` 这一个策略字段，`scraperIdsOf` / `describeScrapers` 随之下线。

**删除连接会级联删除它名下的资料库**：`deleteConnection` 除了释放缓存的客户端，还会按连接级联删掉媒体条目、媒体源与图片，以及这个连接上所有资料库（`deleteLibrariesByConnection`），影视墙首页的资料库横排与资料库抽屉里随之消失、库内影片也从墙上移除（每个影片都归属于某个资料库，没有「未归入资料库」这一档）；磁盘文件与历史刮削任务记录都不受影响。

测试已保存的连接时不重新输入密码：内部的 `toConnectionDraft(connection)` 会把连接转成草稿且**不带 `password` 字段**，主进程 `buildConnectionFromDraft` 见到 `id` 存在且未传密码就沿用钥匙串里的已存密码（见[文件模块 5 节](../file/01-file-module.md)）。

## 5. 连接弹窗

- 外壳 `modals/ConnectionDialog.tsx` 导出 `openConnectionDialog({ connection?, onSaved? })`：`DialogPlugin({ width: 560, destroyOnClose: true, body: () => <ConnectionDialogContent … /> })`（`.tsx` 里用 JSX，不用 `h()`）；底部 `footer` 由外壳渲染「测试连接 / 取消 / 保存」三个按钮，动作与加载状态由内容组件 `defineExpose` 暴露（`test` / `testing` / `submit` / `saving`）给外壳的模板 ref 读。内容组件只用 `emit('success', connection)` 回传结果，外壳负责关闭弹窗并回调 `onSaved`。
- 内容组件按协议渲染不同字段：本地磁盘填根目录；WebDAV 填地址、用户名、认证方式（`auto` 自动协商 / `basic` / `digest` / `none` 无需认证）与密码；SMB 填主机、端口（默认 445）、共享名、域、用户名与密码。
- 表单状态与提交逻辑抽在 `composables/useConnectionForm.ts`（`ConnectionDialogContent.vue` 只留模板与样式，避免 SFC 超过 300 行的上限）：`protocol` / `form` / `saving` / `testing` / 校验 / `buildDraft()` / 测试连接 / 保存都在里面，新增字段只改这一个文件。
- 协议无关的策略字段抽在 `modals/ConnectionPolicyField.vue`：现在只剩一个 NSFW 开关（props `{ nsfw }`，emit `update:nsfw`）。刮削器选择已随连接字段一起下线——要限制刮削器请到资料库表单里配置（`useScraperOptions` 仍被资料库表单复用，见[影视墙页面 · 资料库表单](./04-media-wall-page.md)）。
- 本地磁盘的根目录字段由 `src/renderer/src/components/DirectoryPickerField.vue` 提供：输入框 + 「选择」按钮，按钮走 `dialogApi.open({ title, directory: true })` 选**本机绝对路径**（取消或失败都不改动原值），`ConnectionDialogContent.vue:53` 在 `protocol === 'local'` 分支里渲染它。资料库的媒体目录**不**走它——那里必须是连接内路径，改用资料库自己的 `RemoteDirDialog`（见[影视墙页面 · 表单](./04-media-wall-page.md)）。详见[系统对话框模块 §6.1](../dialog/01-dialog-module.md)。
- 协议在编辑态不可切换（连接协议是身份的一部分，改协议等于换连接）。
- 密码草稿语义与主进程一致：**留空 = 沿用已存密码（`undefined`）**，填了就是新密码，显式清空才写空串；编辑时占位文案提示这一点，新建时提示「密码只写入本机钥匙串，不落明文」。
- footer 左侧是「测试连接」，保存成功后由外壳关闭并触发列表刷新。

## 6. 文件浏览器

`useStorageBrowser(connectionId)` 持有当前目录，`watch(connectionId, { immediate: true })` 在切换数据源时把路径重置到连接根（`FILE_ROOT`）并重新拉取。

- 路径：`path` 永远是连接内 POSIX 路径，`isRoot` 决定「上级目录」是否可用；`breadcrumb` 是 `{ label, path }[]`，根段显示「根目录」，点任意一段跳转。
- 面包屑渲染约束：`t-breadcrumb` 会拿子项的 props 重建每一项，插槽里的元素连同 `@click` 会被替换成纯文本。所以跳转必须写在 `<t-breadcrumb-item @click>`（组件自身声明的 `onClick` prop）上，样式只能从容器用 `:deep(.t-breadcrumb__item)` 命中；当前目录段不响应点击。
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

- 四组弹窗都按项目约定拆成 `.tsx` 外壳 + `.vue` 内容：外壳只做 `DialogPlugin`、选项声明与 `footer` 按钮（用 JSX 渲染 `Button`，`destroyOnClose: true`）；内容组件只承载字段 / 编辑器与提交状态，用 `emit('success', 载荷)` 回传结果、`emit('close')` 表达「内容自己要求关闭」（编辑器加载失败、保存成功），并用 `defineExpose` 把 `submit` / `saving` / `canSubmit` 交给外壳的模板 ref 读（契约见 `src/renderer/src/utils/modal/ModalContent.ts`）。
- `EntryNameDialog` 服务新建文件夹 / 新建文件 / 重命名；`PathDialog` 服务上传 / 下载 / 复制到 / 移动到（`withOverwrite` 为真时显示覆盖开关）；`TextEditorDialog` 负责读改文本。
- 上传与下载的本机路径都是**输入框**：本轮没有接入主进程 `dialog.showOpenDialog` 原生选择器（见[基础页面 待接入项](./01-base-pages.md)）。dialog 域 IPC 现已就绪（见[系统对话框模块](../dialog/01-dialog-module.md)），接入时把输入框换成「只读输入框 + 选择按钮」（按钮里调 `dialogApi.open({ directory: true })` / `{ file: true }` 并回填路径）即可，也可以直接复用 §5 的 `DirectoryPickerField.vue`（它做的是本机目录，同理适用于上传 / 下载这类本机路径字段）。
- 本次新增的 tdesign 组件已手工补进 `src/renderer/src/renderer/components.d.ts` 的两个 block（`TBreadcrumb`、`TBreadcrumbItem`、`TProgress`、`TTextarea`）；该文件只在 `dev` / `build` 时被 unplugin-vue-components 重写，提交物需手改。通用目录控件 `DirectoryPickerField` 的两行声明同样在该文件里（`GlobalComponents` 与 `declare global` 各一行）且仍然有效，不要删。

## 9. 手工验证清单

按项目约定只跑 `yarn typecheck`，运行时行为手工验证：

1. 首次进入「存储」：左侧空态 + 右侧占位；点「新建数据源」，分别建本地目录、WebDAV、SMB 三种连接，确认列表出现且协议标签正确。
2. 点某个已保存 WebDAV / SMB 连接的「测试连通」，成功时提示里应含协议与地址；再断开网络重测，应得到中文失败提示且不弹异常。编辑连接时把密码留空保存，重测应仍成功（证明沿用钥匙串密码）。
3. 文件浏览器：进入子目录、面包屑回跳、上级目录到根后置灰；新建文件夹 / 新建文件 / 重命名 / 复制到 / 移动到 / 删除各走一遍，重点确认目标已存在时不勾选覆盖会报「已存在」、删除连接根被拦住。
4. 上传：填一个真实大文件的本机绝对路径，观察进度条推进；中途「取消」，确认列表落到已取消且远端没有半成品；下载同理并检查本机落点。
5. 文本：对 `.nfo` / `.json` 走「编辑文本」，保存后重新打开确认内容已写入；对二进制大文件确认没有暴露编辑入口。
6. 切换数据源与离开页面：选中项应被记住，传输列表不残留别的连接的任务，控制台无残留推送报错。
7. 本地数据源根目录字段：点「选择」弹出系统目录框、选中后回填本机绝对路径到该字段的输入框；在系统框里点「取消」不改动原值、也不报错。切到 WebDAV / SMB 时该控件不出现，表单其余字段与保存流程无变化。
8. 连接弹窗里应**只有 NSFW 开关**、没有刮削器多选；开关保存后列表项出现 `NSFW` 标签，关掉即消失。（刮削器改在影视墙的资料库表单里选，见[影视墙页面 · 资料库表单](./04-media-wall-page.md)。）
9. 级联删除：先在这个存储上建一个资料库（影视墙首页 →「资料库」→ 新建），确认它出现在首页的资料库横排里；回到本页删除该存储，再去影视墙刷新——该资料库应从横排与抽屉里消失、库内影片也从墙上移除，磁盘文件与刮削记录都还在。
