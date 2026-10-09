# 系统对话框模块（dialog 域）

## 1. 职责与边界

渲染层需要「让用户从本机挑一个文件 / 目录 / 保存位置」时，统一走这个模块，主进程只做一件事：把 Electron `dialog` 的打开框与保存框收窄后暴露成一个域。

- 只负责唤起系统框、把结果原样返回；**不理解业务语义**（不知道调用方拿这个路径去干什么）；
- 不做路径校验（是否存在、是否是目录、有没有权限）——那是文件域 `FileClient` 的职责，见 [../file/01-file-module.md](../file/01-file-module.md)；
- 不做多选（`multiple`）与名称字段标签（`nameFieldLabel`）：需要时在 `DialogOpenOptions` 加字段、在 `dialogIpc.ts` 的 `buildOpenOptions` 里透传即可（各约 2 行）；
- `dialog` 是 Electron 内置模块，不新增任何依赖。

## 2. 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/common/types/dialog.ts` | 契约类型：入参选项与结果 |
| `src/preload/src/modules/dialog/dialogChannels.ts` | 通道常量（main 与 preload 共用） |
| `src/preload/src/modules/dialog/dialog.ts` | preload 桥 `dialogApi` 与 `DialogApi` 类型 |
| `src/main/src/modules/dialog/dialogIpc.ts` | 入参收窄 + 调用 Electron `dialog` |
| `src/main/src/registerIpc.ts` | 汇总注册（`registerDialogIpc()`） |
| `src/renderer/src/api/dialog.ts` | 渲染层出口 `dialogApi` |
| `src/renderer/src/components/DirectoryPickerField.vue` | 通用「目录输入框 + 选择按钮」控件 |

## 3. IPC 通道

| 通道 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `dialog:open` | `DialogOpenOptions` | `Promise<DialogResult>` | `directory: true` 时选目录，否则选文件；`properties` 由 `directory` 推导，调用方不需要理解 Electron 的 `properties` |
| `dialog:save` | `DialogSaveOptions` | `Promise<DialogResult>` | `dialog.showSaveDialog`；Electron 返回的是单个 `filePath`，这里统一包装成 `filePaths: [filePath]`（取消时为空数组），让两个通道结果同形 |

## 4. 契约与语义

```ts
interface DialogFilter { name: string; extensions: string[] } // extensions 不带点，'*' 表示所有文件

interface DialogOpenOptions {
  title?: string
  buttonLabel?: string
  defaultPath?: string   // 初始目录；选文件时可带推荐文件名
  filters?: DialogFilter[]
  directory?: boolean    // true = 只能选目录
}

interface DialogSaveOptions {
  title?: string
  buttonLabel?: string
  defaultPath?: string   // 建议写成含文件名的完整路径
  filters?: DialogFilter[]
}

interface DialogResult { canceled: boolean; filePaths: string[] }
```

### 4.1 「用户取消」不是错误

取消时 `canceled: true`、`filePaths: []`，调用方按「什么都不做」处理（例如不覆盖输入框里的旧路径），**不提示、不报错**。真正的失败（系统框打不开等）由主进程抛错、渲染层 `try/catch` 兜底。

### 4.2 为什么不套 `PluginResult` / `FileResult` 信封

信封是为「主进程业务可预期失败」设计的（见 `src/common/types/plugin/result.ts`、`src/common/types/file/result.ts`）。dialog 域只有「成功 / 取消」两态，没有任何业务失败需要编码成错误码，套信封只会让每次调用多一次解包。这与 `appWindow` 域的处理一致（`src/main/src/modules/appWindow/appWindowIpc.ts` 直接返回原始值）。

### 4.3 入参不可信：逐字段收窄、非法即回落

渲染层传来的是 `unknown`，主进程用 `src/common/types/setting/shared.ts` 的共享工具收窄（`toSource` / `readString` / `readBoolean` / `readStringArray`；文件域与插件域早已跨域复用同一套）：

| 字段 | 收窄规则 |
| --- | --- |
| `title` / `buttonLabel` / `defaultPath` | 必须是字符串，`trim()` 后为空则**整个字段不传**，让系统用默认本地化文案与默认目录 |
| `directory` | 必须是布尔，否则按 `false`（选文件） |
| `filters` | 非数组则不传；数组内逐项转对象，`name` 为空或 `extensions` 过滤掉非字符串/空串后为空 → 丢弃该项；全部被丢弃则不传 `filters` |
| 其他字段 | 忽略 |

## 5. 主进程实现要点

- **挂窗口**：用 `BrowserWindow.fromWebContents(event.sender)` 反查发起调用的窗口，让选择框成为该窗口的模态子窗口 / macOS sheet；取不到窗口（理论上不会发生）时退化为不传窗口的调用，功能不中断。
- **不吞异常**：`ipcMain.handle` 里没有 `try/catch`，异常会如实 reject 给渲染层，避免「静默取消」把真实故障伪装成用户取消。
- **不缓存、不节流**：每次调用都现开一个系统框；重复点击由渲染层的 `loading` 态自行约束。

## 6. 渲染层用法

```ts
import { dialogApi } from '@/api'

const result = await dialogApi.open({ title: '选择根目录', directory: true })
if (result.canceled || result.filePaths.length === 0) return
form.rootPath = result.filePaths[0]
```

渲染层只能从 `@/api` 取（`src/renderer/src/api/dialog.ts`），页面不直接读 `window.preload`。

### 6.1 通用控件 `DirectoryPickerField.vue`

「输入框 + 右侧『选择』按钮」是目录类字段的固定形态，抽成通用组件放在 `src/renderer/src/components/DirectoryPickerField.vue`：

| props | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `modelValue` | `string` | — | 目录绝对路径，`v-model` 双向绑定 |
| `title` | `string` | `'选择目录'` | 系统选择框标题 |
| `placeholder` | `string` | `''` | 输入框占位文案 |

- emit `update:modelValue`；内部按钮在系统框打开期间处于 `loading`，防重复点击；
- 用户取消或 IPC 异常都**不改动原值**，异常时 `MessagePlugin.error('打开系统选择框失败，请手动输入绝对路径')`；
- 组件不感知任何业务字段，因此可以放进通用组件目录；父级传入的 `class`（如 `.form-control` 的 `flex: 1`）会落到根元素上，无需额外样式；
- 新增通用组件后**必须手工**补 `src/renderer/src/renderer/components.d.ts` 的两处列表（`declare module 'vue'` 的 `GlobalComponents` 与 `declare global`）：本仓库只跑 `typecheck`、不跑 `dev` / `build`，自动生成的 dts 不会更新，详见 [../architecture/01-project-structure.md](../architecture/01-project-structure.md)。

## 7. 已接入的消费方

| 位置 | 用法 |
| --- | --- |
| 存储 → 新建 / 编辑数据源 → 本地磁盘 → 根目录 | `<directory-picker-field v-model="form.rootPath" title="选择根目录" ... />`（`src/renderer/src/windows/main/pages/storage/modals/ConnectionDialogContent.vue`），选中后写回 `rootPath`，保存链路不变 |

## 8. 尚未接入的消费方

以下位置目前仍是占位或纯输入框，dialog 域能力已就绪，接的时候直接用 `DirectoryPickerField.vue` / `dialogApi` 即可：

| 位置 | 现状 |
| --- | --- |
| 设置 → 目录与路径（演员头像 / 剧照 / 下载目录） | `SettingPathPanel.vue` 的 `pickDirectory()` 仍是 `MessagePlugin.info('目录选择待接入，请先手动输入绝对路径')` |
| 存储 → 上传 / 下载的本机路径 | `PathDialogContent.vue` 仍是纯输入框 |
| 「保存」框 | 已有 `dialog:save` 通道，暂无消费方（可用于导出、另存为等） |

## 9. 手工验证清单

1. 存储页「新建数据源」选「本地磁盘」：根目录右侧应出现「选择」按钮；点击弹出系统目录框，选中一个目录后输入框回填该目录的绝对路径。
2. 在弹出的系统框里点「取消」：输入框保持原值，且不出现任何错误提示。
3. 编辑一个已保存的本地数据源，重新选择目录后保存成功，列表描述随之更新；「测试连接」应能通过。
4. 切到 WebDAV / SMB 协议：不出现「选择」按钮，表单其余字段与保存流程无变化（回归一次已保存的远程连接）。
5. 选择一个没有访问权限的目录后保存：「测试连接」/保存应由文件域报出中文错误，dialog 域本身不拦截。
