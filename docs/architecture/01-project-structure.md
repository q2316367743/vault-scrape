# 工程结构与构建配置

## 实现思路

项目基于 electron-vite，按「主进程 / 预加载 / 公共类型 / 渲染进程」四层划分，参考项目 `mistrelle` 的目录与别名约定，让后续从参考项目迁移实现时路径心智一致。

主进程不写业务，业务实现放 `src/main/src/modules/<域>/` 与 `src/main/src/db/`；渲染进程所有页面挂在 `src/renderer/src/windows/main/` 下，为将来多窗口预留 `windows/<窗口名>` 层级。

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `tsconfig.json` | 仅做 references，指向 node / web 两个子配置 |
| `tsconfig.node.json` | 主进程 + 预加载 + 公共类型的编译范围与别名 |
| `tsconfig.web.json` | 渲染进程的编译范围、JSX 与别名 |
| `electron.vite.config.ts` | 三个构建目标的别名、插件与端口 |
| `uno.config.ts` | 原子类与 TDesign CSS 变量的桥接 |
| `electron-builder.yml` | 打包配置（原生依赖 asarUnpack） |
| `patches/` | `patch-package` 的包补丁（当前只有 `@awo00+smb2+1.1.1.patch` 的区间读），由 `postinstall` 自动应用 |
| `src/main/index.ts` | 主进程入口：注册 IPC、初始化数据库、注册 `storage://` 私有协议、建窗口 |
| `src/preload/index.ts` | contextBridge 暴露面 |
| `src/renderer/index.html` | 渲染进程 HTML 入口 |
| `src/renderer/src/windows/main/main.ts` | Vue 应用挂载入口 |

## 目录结构

```
src/
├── common/                  # 主进程与渲染进程共享的纯类型与纯函数（不含运行时依赖）
│   └── types/
│       ├── setting/         # 设置类型：shared / library（媒体后缀清单）/ scrape / network / translate / naming / download / file / index
│       ├── file/            # 文件类型：error / path / entry / connection / request / transfer / result / index
│       ├── media/           # 媒体类型：媒体源 / 图片类型与 storage:// 地址、墙面条目、首页两排、浏览条目、详情请求与结果、NFO 解析、错误与信封
│       ├── library/         # 资料库类型：MediaLibrary（类型 type / 多根目录 / 库级刮削器，空数组 = 不刮削）/ `LibraryType` 与标签 / 草稿 / 摘要（含 `coverUrls`）/ 扫描与任务结果 / 进度事件 / 错误码与 LibraryResult 信封
│       ├── plugin/          # 插件类型：asset / movie / manifest / env / define / builtin（`R18_OFFLINE_PLUGIN_ID`）/ normalize / error / result / index
│       ├── log.ts           # 日志类型与查询条件
│       ├── dialog.ts        # 系统文件/目录选择框（Electron dialog）的入参与结果契约
│       └── task.ts          # 任务类型与统计
├── main/
│   ├── index.ts             # 主进程入口
│   └── src/
│       ├── db/              # 数据库：schema / client / repo / IPC
│       ├── modules/appWindow/ # 窗口域：窗口控制与最大化状态推送
│       ├── modules/dialog/  # 对话框域：把 Electron dialog 的「打开 / 保存」框收窄后暴露给渲染层
│       ├── modules/file/    # 文件域：FileClient 接口 + 本地 / WebDAV / SMB 三实现 + 连接存储 + IPC
│       ├── modules/http/    # HTTP 域：axios 单例 + 请求拦截器按网络设置注入代理
│       ├── modules/media/   # 媒体域：扫描索引引擎（mediaIndexer，按传入的 extensions 判视频）+ storage:// 协议与 Range 流式（mediaProtocol）+ 播放期路径自愈（mediaLocator）+ 首页 / 整墙 / 详情 / 逐级浏览读模型（mediaWall）+ IPC
│       ├── modules/library/ # 资料库域：配置落 sqlite（类型 / 多根目录 / 空刮削器 = 不刮削 / 库级选项）+ 目录重叠校验（libraryStore.normalizePaths）+ 扫描编排与取消（libraryScan，按库类型取后缀、扫后自动刮削）+ 待刮削候选与任务启动（libraryScrape）+ 进度广播 + IPC
│       ├── modules/plugin/  # 插件域：vm 沙箱运行时 + 宿主 HTTP/cheerio 上下文 + 注册表 + 存储 + IPC（安装时执行顶层读取 env 声明）
│       ├── modules/scrape/  # 刮削域：任务编排 + 单文件流水线（产物规范 scrapeLayout / 本地 NFO 与图片 scrapeLocalMeta）+ 资料库候选入口 + IPC 与进度推送
│       ├── modules/setting/ # 设置域：落盘实现 + IPC
│       ├── utils/           # 主进程通用工具：secretCodec（safeStorage 编解码，插件与文件域共用）
│       └── registerIpc.ts   # 汇总注册各域 IPC
├── preload/
│   ├── index.ts             # contextBridge 暴露 electron 与 preload
│   ├── index.d.ts           # window 全局类型声明
│   └── src/modules/         # 各域 IPC 契约常量 + 调用薄封装（appWindow / db / dialog / setting / file / plugin / scrape / media / library）
└── renderer/
    ├── index.html
    └── src/
        ├── api/             # 渲染层唯一 API 出口（页面不直接读 window.preload）：各域一个文件，如 api/library.ts
        ├── assets/style/    # 全局样式：theme / tdesign-cover / customer
        ├── components/      # 跨页面通用组件（PageLayout/（含 PageLayout.vue 与 SubPageLayout.vue） / menu / SensitiveImage.vue / DirectoryPickerField.vue：本机目录选择字段，供存储页「本地磁盘」根目录用）
        ├── global/          # 全局状态
        ├── hooks/           # 通用 hooks
        ├── utils/           # 渲染层通用工具（format.ts：体积 / 时间格式化，影视墙与工作台共用；remotePath.ts：本机绝对路径 ↔ 连接内路径；另有 lang / modal）
        └── windows/main/    # 主窗口：入口、App.vue、router、store、pages（影视墙按 home / wall / detail / library 分层，工作台的浏览与勾选 / 任务面板，存储页的浏览器与传输，设置页八个分组）
```

### 页面目录分层（RL-09）

渲染层页面目录**不允许平铺多个页面文件**：每个页面独占一个语义化子目录，页面组件、该页私有的 `components/` 与 `composables/` 都放进这个子目录；多个页面共用的页内组件放「最近的共用层级」。影视墙是本轮的样板：

```
src/renderer/src/windows/main/pages/media/
├── components/MediaWallCard.vue          # home 与 wall 共用的影片卡片
├── home/{MediaHomePage.vue,components/LibraryCard.vue,composables/useMediaHome.ts}
├── wall/{MediaWallPage.vue,composables/useMediaWall.ts}
├── detail/{MediaDetailPage.vue,components/*,composables/useMediaDetail.ts,mediaDetailCells.ts,mediaPlayerI18n.ts}
└── library/                              # home 与 wall 共用的资料库管理
    ├── components/{LibraryDrawer.tsx,LibraryDrawerContent.vue,LibraryFormDrawer.tsx,LibraryFormContent.vue,LibraryDirectoryEditor.vue,LibraryListItem.vue,RemoteDirDialog.tsx,RemoteDirPickerContent.vue}
    └── composables/{useLibraryForm.ts,useMediaLibraries.ts}
```

`pages/media/` 下不再有平铺文件；原来的 `pages/media/mediaUtils.ts` 因工作台也在用，上移为 `src/renderer/src/utils/format.ts`，引用点统一改成 `@/utils/format`（`formatSize` / `formatTime`）。资料库的媒体目录是**连接内路径**，所以表单用 `library/components/RemoteDirDialog.tsx`（走 `fileApi.list` 列目录）而不是本机目录控件 `src/renderer/src/components/DirectoryPickerField.vue`（后者选本机绝对路径，服务于存储页「本地磁盘」的根目录字段；两者语义不同、并存，见[系统对话框模块](../dialog/01-dialog-module.md)）。

同一条分层规则也在其它页面上落地：命令式弹窗进各页的 `modals/`（`src/renderer/src/windows/main/pages/plugin/modals/`、`.../storage/modals/`、`.../tools/search/modals/`），页内列表 / 表格 / 表单组件进 `components/`，页面状态与副作用进 `composables/`，纯函数工具留在页面根（如 `storageUtils.ts`、`workspaceUtils.ts`）。

### 媒体域与资料库域的边界

- **资料库域**（`src/main/src/modules/library/`）拥有「配置 + 编排」：目录合法性与重叠校验、按库类型取后缀、扫描互斥与取消、扫后清理与自动刮削、待刮削候选去重、任务启动。**扫描的调度入口在这里。**
- **媒体域**（`src/main/src/modules/media/`）拥有「索引 + 读模型 + 取值」：BFS 遍历与条目 / 媒体源 / 图片落库、`storage://` 协议与 Range 流式（含播放期路径自愈 `mediaLocator.ts`）、首页两排 / 整墙 / 详情 / 逐级浏览。
- **刮削域**（`src/main/src/modules/scrape/`）只负责执行任务：流水线、资源下载、命名、NFO；它不决定「刮哪些、用什么刮削器」，那由资料库域传进来。

## 路径别名

| 别名 | 指向 | 可用范围 |
| --- | --- | --- |
| `$/*` | `src/main/src/*` | 主进程 |
| `~/*` | `src/preload/src/*` | 预加载与主进程（复用 IPC 契约） |
| `@resources/*` | `resources/*` | 主进程 |
| `@common/*` | `src/common/*` | 主进程 / 预加载 / 渲染进程 |
| `@/*` | `src/renderer/src/*` | 渲染进程 |

注意：`tsconfig.web.json` 中没有 `~` 别名，因此 `src/preload/index.d.ts` 引用契约类型时必须使用相对路径（`./src/modules/...`）。

## 构建配置要点

- **renderer**：`base: './'`、`server.port: 7743`、插件为 `vue()` + `vueJsx()` + `UnoCSS()` + `Components()`（TDesignResolver，`dts: 'src/renderer/components.d.ts'`）。
- **不使用 unplugin-auto-import**：自动导入的声明文件只能由 dev/build 运行时生成，而本项目约定只做 typecheck，缺失声明会导致类型报错，故所有 API 与组合式函数都显式 `import`。
- **main / preload**：`externalizeDepsPlugin()` 把 `dependencies` 中的包保留为外部依赖，所以主进程实际 require 的包（如 `better-sqlite3`、`drizzle-orm`）必须放 `dependencies`。
- **UnoCSS**：`theme.colors` 把 `td-*` 映射到 `var(--td-*)`，颜色一律走 TDesign Token；顶层 `postprocess` 给每个工具类的值追加 `!important`，避免 UnoCSS 样式表先于 TDesign 样式加载时被覆盖。

## 依赖归类规则

- `dependencies`：主进程/预加载在运行时真正 require、需要随包发布的包。当前为 `@awo00/smb2`、`@electron-toolkit/preload`、`@electron-toolkit/utils`、`axios`、`better-sqlite3`、`drizzle-orm`、`electron-updater`。其中 `@awo00/smb2` 写**精确版本 `1.1.1`（不带 `^`）**：`patches/` 的补丁按版本号命名与应用，升到其它版本补丁会静默失效，SMB 的区间读随之退化为整段顺序读。
- `devDependencies`（渲染进程）：只在渲染进程被 Vite 打包的包（`vue`、`vue-router`、`pinia`、`tdesign-vue-next`、`tdesign-icons-vue-next`、`dayjs`、`es-toolkit`、`@vueuse/core`、`unocss` 等）与全部构建/校验工具。这类包的内容会进入渲染产物，不需要作为 Electron 运行时依赖打包。
- `devDependencies`（主进程 bundle）：被 Vite 打进主进程产物的纯 JS 包也归 `devDependencies`，例如文件模块用的 `webdav`（ESM-only，`externalizeDepsPlugin` 只外部化 `dependencies`，放进 `dependencies` 反而会让主进程去 require 一个 ESM 包）与插件模块用的 `cheerio`。判断方法：这个包是「构建期被 Vite 打进去」还是「运行期由 Electron require 进来」。
- 新增依赖时先判断「谁在运行时 require 它」，再决定归类。
- `patches/`：用 `patch-package` 维护无法上游解决的包改动（当前只有 `@awo00/smb2` 的 `readRange` 区间读）。`package.json` 的 `postinstall` 串成 `electron-builder install-app-deps && patch-package`，安装依赖后自动应用；生成命令必须带 `--use-yarn`（仓库同时存在 `yarn.lock` 与 `package-lock.json`，`patch-package` 会误判为 npm 而失败）：`npx patch-package @awo00/smb2 --use-yarn`。升级该包后要重新生成并提交补丁，同时更新钉死的精确版本号。

## 注意事项

- 根目录禁止出现业务代码；构建配置文件除外。
- 页面目录遵守 RL-09 分层（见「页面目录分层」），非公共组件放页面自己的 `components/`，通用组件才进 `src/renderer/src/components/`。
- 只做 `yarn typecheck`（`typecheck:node` + `typecheck:web`），不执行 `dev` / `build` 作为验证手段。
- `src/renderer/src/renderer/components.d.ts` 由 `unplugin-vue-components` 在 dev/build 时生成，仓库中已提交。配置里的 `dts: 'src/renderer/components.d.ts'` 是相对 Vite root（`src/renderer`）解析的，所以真实路径比配置多一层 `src/renderer/`。本项目约定只跑 `typecheck`、不跑 `dev` / `build`，模板中新用到的 TDesign 组件不会被自动登记，**必须手工**补进该文件的两处列表（`declare module 'vue'` 的 `GlobalComponents` 与 `declare global`），否则 `typecheck` 会报组件未定义。
- 修改别名时必须同步四处：`tsconfig.node.json`、`tsconfig.web.json`、`electron.vite.config.ts`、本文档。
