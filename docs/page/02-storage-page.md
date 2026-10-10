# 存储管理页面

## 1. 定位与入口

存储管理页是[文件模块](../file/01-file-module.md)的前端外壳，但**渲染层只读**：左边管数据源（连接），右边浏览目录与预览文件。它把连接 CRUD、列目录、`stat` 与读文本接出来，渲染层只经 `@/api` 的 `fileApi` 调用，不触碰 `window.preload`。

- 侧栏一级菜单「存储」，图标 `HardDiskStorageIcon`（`src/renderer/src/windows/main/pages/app/AppSide.vue`）。
- 路由 `/storage`，位于 `/workspace` 与 `/tools` 之间，懒加载 `StoragePage.vue`（`src/renderer/src/windows/main/router.ts`）。
- 覆盖能力：连接的新建 / 编辑 / 删除 / 测试连通，目录浏览（进入目录、面包屑回跳、刷新），以及**媒体文件与 nfo 的预览**。
- **写操作整体下线**：新建文件夹 / 新建文件 / 上传 / 下载 / 重命名 / 复制 / 移动 / 删除 / 编辑文本，以及传输进度面板（`file:transferProgress` / `file:transferDone` 两个推送不再被订阅）。主进程 [file 模块](../file/01-file-module.md)的 18 个 invoke + 2 个推送**接口本身没有删除**——它是三协议通用能力且有独立文档，只是渲染层不再有任何入口。

## 2. 目录结构

```
src/renderer/src/windows/main/pages/storage/
├── StoragePage.vue                  # 页面骨架：PageLayout + 左面板 + 右浏览器
├── storageUtils.ts                  # 纯展示工具（图标映射、尺寸 / 时间格式化、可预览判定）
├── composables/
│   ├── useStorageBrowser.ts         # 只读：当前目录、条目、面包屑（没有写操作）
│   ├── useConnectionForm.ts         # 连接弹窗的表单状态、草稿拼装与保存 / 测试
│   └── useScraperOptions.ts         # 插件候选项（已启用且编译通过的插件）：连接弹窗已不用，只被资料库表单复用
├── modals/                          # 命令式弹窗：外壳 .tsx + 内容 .vue
│   ├── ConnectionDialog.tsx / ConnectionDialogContent.vue
│   ├── ConnectionPolicyField.vue    # 弹窗内的策略字段：现在只剩 NSFW 开关（刮削器已随连接字段下线）
│   └── StoragePreviewDrawer.tsx / StoragePreviewContent.vue   # 只读预览抽屉
└── components/
    ├── StorageConnectionPanel.vue   # 左侧数据源列表（固定 300px）
    ├── StorageBrowser.vue           # 右侧：工具条 + 面包屑 + 表格
    ├── StorageEntryTable.vue        # 条目表格 + 行内「打开 / 预览」
    └── StorageNfoPreview.vue        # nfo 预览：解析字段 / 原始 XML 两视图
```

## 3. 页面骨架

- `StoragePage.vue`：`PageLayout`（title「存储」，description 说明统一管理三类数据源），`#extra` 放「刷新」（loading 绑连接列表）与「新建数据源」。
- 主体 `.storage-page` 是 `display:flex; gap:16px; height:100%`：左侧面板固定 300px，右侧 `StorageBrowser` 自适应（`min-width:0`，表格区自己滚动）。
- 消息提示统一 `MessagePlugin`，破坏性操作统一 `DialogPlugin.confirm`（删除连接用 `theme: 'warning'`）。

## 4. 连接管理

状态在通用 hook `@/hooks/UseFileConnections.ts`（`useFileConnections()`）里，页面与面板都不自己存连接；`pages/storage/composables/` 只留浏览器与连接表单两个 hook：

| 导出 | 说明 |
| --- | --- |
| `connections` / `loading` | `fileApi.listConnections()` 的列表与加载态 |
| `activeId` / `activeConnection` | 选中连接，`activeId` 用 `useLocalStorage('vault-scrape:storage-active-connection')` 记住；选中项被删或列表变化后自动回落到第一条 |
| `refresh()` | 重新拉列表并纠正选中项，页面 `onMounted` 与保存后都会调 |
| `select(id)` | 切换选中 |
| `remove(connection)` | `fileApi.deleteConnection` → 提示 → 刷新 |
| `test(connection)` | 返回 `ConnectionTestResult`，页面按 `ok` 分别 `MessagePlugin.success / error` |

左栏列表项是**两行式**（`StorageConnectionPanel.vue`）：第一行协议图标 + 名称（`font-weight: 500`，超出省略，`title` 兜底），测试连通 / 编辑 / 删除按钮只在悬停或选中时出现；第二行是连接描述（`describeConnection`，超出省略，同样带 `title`）与标签组（协议标签、`nsfw` 的 `NSFW` 标签）。名称与标签**必须分行**：标签与操作按钮都是 `flex-shrink: 0`，一旦和名称挤在同一个 flex 行里，`flex: 1; min-width: 0` 的名称会被压成零宽，在界面上直接「消失」。

连接上的 `nsfw` 标记（连接弹窗里「NSFW」开关，`ConnectionDialogContent.vue`）表示该数据源是敏感内容：列表里的连接会带一个 `NSFW` 标签（`StorageConnectionPanel.vue`，`theme="danger"`，`variant="light"`），并在应用设置开启「NSFW 保护」后让该数据源的页面隐藏敏感图片与视频（见[设置项清单 · 应用设置](../setting/02-setting-items.md)），预览抽屉同样受它约束（见 §7）。转换草稿时 `nsfw` 原样带上（`toConnectionDraft` 已包含该字段）。

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

## 6. 只读文件浏览器

`useStorageBrowser(connectionId)` 持有当前目录，`watch(connectionId, { immediate: true })` 在切换数据源时把路径重置到连接根（`FILE_ROOT`）并重新拉取。返回 `{ entries, loading, isRoot, breadcrumb, load, go, goParent, open }`——**没有** `mkdir` / `createFile` / `rename` / `copy` / `move` / `remove` / `readText` / `writeText`。

- 路径：`path` 永远是连接内 POSIX 路径，`isRoot` 决定「上级目录」是否可用；`breadcrumb` 是 `{ label, path }[]`，根段显示「根目录」，点任意一段跳转。
- 面包屑渲染约束：`t-breadcrumb` 会拿子项的 props 重建每一项，插槽里的元素连同 `@click` 会被替换成纯文本。所以跳转必须写在 `<t-breadcrumb-item @click>`（组件自身声明的 `onClick` prop）上，样式只能从容器用 `:deep(.t-breadcrumb__item)` 命中；当前目录段不响应点击。
- 读：`load()` / `go(target)` / `goParent()` 失败时 `MessagePlugin.error` 展示信封里的中文 `message`；`open(entry)` **只处理目录**，文件一律交给预览抽屉。
- 工具条只剩「上级目录」（`isRoot` 时置灰）与「刷新」。
- 行内操作在 `StorageEntryTable.vue`：目录行 → 「打开」，名称可点；可预览文件 → 「预览」，名称可点；其余类型没有主操作（显示 `—`）。判定用 `storageUtils.isPreviewable(entry)`：必须是 `type === 'file'` 且 `filePreviewKindOf(entry.mime, entry.extname) !== 'other'`。
- 已下线的能力：新建文件夹 / 新建文件 / 上传 / 下载 / 重命名 / 复制到 / 移动到 / 删除 / 编辑文本，以及对应的三组弹窗（`EntryNameDialog` / `PathDialog` / `TextEditorDialog` 连同 `useStorageActions`、`StorageTransferList`、`useStorageTransfers` 已整体删除）。主进程接口仍在，未来要恢复只需重写渲染层入口。

## 7. 预览抽屉（媒体与 nfo）

入口：点击文件行的名称或右侧「预览」按钮 → `StorageBrowser.onPreview(entry)` → `openStoragePreviewDrawer({ connection, entry, protect })`。

- 外壳 `modals/StoragePreviewDrawer.tsx`：`DrawerPlugin({ header: entry.name, size: '860px', footer: false, destroyOnClose: true, body: () => <StoragePreviewContent … /> })`。抽屉是只读的、没有弹窗级按钮，因此 `footer: false`（该选项仅用于这种场景）。
- 内容 `modals/StoragePreviewContent.vue` 按类型分派（`filePreviewKindOf(entry.mime, entry.extname)`）：

  | 类型 | 渲染 |
  | --- | --- |
  | `video` / `audio` | `@/components/media/MediaPlayer.vue`（artplayer），`fallback-text` 由存储页给一套「可以先用本机播放器打开它」的文案 |
  | `image` | `SensitiveImage.vue`（`fit="contain"`，高度撑满抽屉剩余空间） |
  | `nfo` | 先 `fileApi.readText({ connectionId, path })` 拿原文，再交给 `StorageNfoPreview.vue` |
  | 其它 | `t-empty`「该类型不支持预览」（表格本来就没有入口，这里兜底） |

  抽屉顶部固定一行元信息：文件大小（`formatFileSize`）、修改时间（`formatEntryTime`）与完整连接内路径。

### 7.1 预览地址：`storage://` 的路径形式

媒体 ID 形式的 `storage://{连接ID}/{媒体ID}/{文件名}` 只覆盖**已入库**的影片，存储页要预览的是任意磁盘文件，因此 `storage://` 增加了路径形式（公共纯函数在 `src/common/types/file/preview.ts`，主进程复核在 `src/main/src/modules/media/mediaProtocol.ts`）：

```
storage://{连接ID}/path/{encodeURIComponent(连接内路径)}[?v=modifiedAt]
```

- `buildFilePreviewUrl(connectionId, path, modifiedAt)` 构造（`modifiedAt > 0` 时带 `?v=` 破浏览器缓存），`parseFilePreviewUrl(url)` 解析回 `{ connectionId, path }`；`FILE_PREVIEW_SEGMENT = 'path'` 是路径形式的固定段，用来与 `[0-9a-f]{32}` 的媒体 ID 区分开。
- `parseFilePreviewUrl` 内部走 `normalizeRemotePath`（越界抛 `invalidPath`），解析不出或指向连接根都返回 `null`。
- 主进程 `handleMediaRequest()` 开头先试路径形式：命中即 `handleFilePreviewRequest(target, request)`——校验连接 ID → 取连接与客户端 → `client.stat(path)`（不是文件或空文件 → 404）→ 按 kind 分派：
  - `video` / `audio`：走 `handleRangeRequest()`，即媒体源那条**区间流式**通道（`Range` 解析、206 / 416、拖动进度条），因此大视频不需要整文件下载；
  - `local`：`resolveInsideRoot(connection.rootPath, path)` 后 `net.fetch`，并强制按 `guessMimeType` 补 `Content-Type`（`file://` 拿不到可靠的 MIME）；
  - 远端（WebDAV / SMB）：按 `sha1(connectionId + '\n' + path)` 作缓存键 `ensureCached` 到 `~/.vault-scrape/cache/media/` 再 `net.fetch`，沿用 512MB 上限与按 mtime 剪枝。
- **安全边界**：路径永远由渲染层按「连接 ID + 连接内路径」构造，主进程只允许它落在该连接的根目录内（`resolveInsideRoot` / `normalizeRemotePath` 越界即失败），因此这个形式**不能**被用来读任意本机文件；`appdata` 伪连接那条绝对路径分支只对内部伪连接生效。
- 读取失败只记一条去重 warn 并返回 404，播放器因此落到 `fallbackText` 兜底层。

### 7.2 NSFW 与 nfo

- **NSFW**：`StorageBrowser.vue` 用 `useNsfwProtection(toRef(props, 'connection')).active`（应用总开关 + 该连接的 `nsfw` 标记同时成立）算出 `protect`，打开抽屉时定格并透传。视频由 `MediaPlayer` 的遮罩挡住，点击后才起播；图片走 `SensitiveImage` 的遮罩，点击后本实例放行。nfo 与其它文本不受影响。
- **nfo**：`StorageNfoPreview.vue` 用 `t-tabs` 提供「解析字段 / 原始 XML」两个视图。解析视图用原生 `<dl>/<dt>/<dd>` 事实格，字段标签与影视墙详情页 `nfoCells`（`pages/media/detail/mediaDetailCells.ts`）同一套口径（标题 / 番号 / 原名 / 发行日期 / 时长 / 片商 / 厂牌 / 系列 / 导演 / 演员 / 标签），但**空字段直接不渲染**（详情页是 `—` 占位），`studio` 只在与片商不同的时候单列「制作」；剧情用只读 `t-textarea` 展示。`parseNfoXml` 只认带 `<movie>` 的 nfo，解析不出时提示「不是标准的 movie nfo」并引导切到原始 XML；原文读取失败用 `t-alert` 展示文件域的中文原因。
- **播放器搬家**：`MediaPlayer.vue` 与 `mediaPlayerI18n.ts` 已从 `pages/media/detail/`（原来在 `detail/components/` 下）移到共用目录 `src/renderer/src/components/media/`，影视墙详情页与存储页预览共用同一个组件；搬家时新增 `fallbackText` prop（默认值仍是影视墙那套「……也可以在影视墙里对资料库重新扫描一次」的文案），封面 `alt` 从「影片封面」改成通用的「封面」。

## 8. 弹窗与页面约定对齐

- 本页两组命令式弹窗都按项目约定拆成 `.tsx` 外壳 + `.vue` 内容，外壳只做 `DialogPlugin` / `DrawerPlugin`、选项声明与 `footer`：`ConnectionDialog` 的 footer 用 JSX 渲染「测试连接 / 取消 / 保存」三个 `Button`；`StoragePreviewDrawer` 是只读预览，用 `footer: false`。
- `ConnectionDialogContent.vue` 用 `emit('success', 载荷)` 回传结果、`emit('close')` 表达「内容自己要求关闭」，并用 `defineExpose` 把 `submit` / `saving` / `canSubmit` 交给外壳的模板 ref 读（契约见 `src/renderer/src/utils/modal/ModalContent.ts`）。
- 组件声明由 `unplugin-vue-components` 在 `dev` / `build` 时重写进 **`src/renderer/components.d.ts`**（被 git 跟踪、也被 `tsconfig.web.json` 的 `include` 覆盖），本页用到的 `TBreadcrumb` / `TBreadcrumbItem` / `TTextarea` / `TEmpty` / `TAlert` / `TTabs` / `TTabPanel` / `TTooltip` 等都在里面。注意：`src/renderer/src/renderer/components.d.ts` 是一份带 `@ts-nocheck` 的**过期副本**，不要再往它里面手工补声明。

## 9. 手工验证清单

按项目约定只跑 `yarn typecheck`，运行时行为手工验证：

1. 首次进入「存储」：左侧空态 + 右侧占位；点「新建数据源」，分别建本地目录、WebDAV、SMB 三种连接，确认列表出现且协议标签正确。
2. 点某个已保存 WebDAV / SMB 连接的「测试连通」，成功时提示里应含协议与地址；再断开网络重测，应得到中文失败提示且不弹异常。编辑连接时把密码留空保存，重测应仍成功（证明沿用钥匙串密码）。
3. 只读浏览：进入子目录、面包屑回跳、上级目录到根后置灰；确认工具条只剩「上级目录 / 刷新」，页面上**找不到**任何新建 / 上传 / 下载 / 重命名 / 复制 / 移动 / 删除 / 编辑文本入口，也没有传输进度面板。
4. 视频预览：点一个 `.mp4` 的名称或「预览」，抽屉标题是文件名、顶部有大小 / 修改时间 / 完整路径；起播后拖动进度条应能立刻跳转（区间请求）；把文件在文件管理器里改名或移走后刷新目录再预览，应落到「视频读不出来……」兜底层而不是黑屏。
5. 图片 / 音频预览：点 `.jpg` / `.mp3`，图片在抽屉里等比完整显示、音频能起播；对不支持的类型（例如 `.zip`），行上应显示 `—`、点名称无反应。
6. nfo 预览：点一个 `.nfo`，默认「解析字段」应出现中文标签与剧情；切到「原始 XML」应显示原文；拿一个非 movie 的 nfo（或随便一个 `.nfo` 文本）确认提示「不是标准的 movie nfo」而不是报错。
7. NSFW：打开应用设置的「NSFW 保护」，选一个带 `NSFW` 标签的连接，预览图片应先显示遮罩、点击后放行，预览视频应显示「内容已隐藏，点击播放」；关掉总开关后两者直接可见。
8. 切换数据源与离开页面：选中项应被记住；抽屉不残留上一个文件的播放（关掉抽屉后再开另一个文件，标题与内容都应是新的）。
9. 本地数据源根目录字段：点「选择」弹出系统目录框、选中后回填本机绝对路径到该字段的输入框；在系统框里点「取消」不改动原值、也不报错。切到 WebDAV / SMB 时该控件不出现，表单其余字段与保存流程无变化。
10. 连接弹窗里应**只有 NSFW 开关**、没有刮削器多选；开关保存后列表项出现 `NSFW` 标签，关掉即消失。（刮削器改在影视墙的资料库表单里选，见[影视墙页面 · 资料库表单](./04-media-wall-page.md)。）
11. 级联删除：先在这个存储上建一个资料库（影视墙首页 →「资料库」→ 新建），确认它出现在首页的资料库横排里；回到本页删除该存储，再去影视墙刷新——该资料库应从横排与抽屉里消失、库内影片也从墙上移除，磁盘文件与刮削记录都还在。
