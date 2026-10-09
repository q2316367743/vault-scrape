# vault-scrape 技术文档索引

本目录存放项目的技术文档，按领域分目录组织。功能落地后必须同步更新对应文档，并在此登记。

| 文档 | 标题 | 描述 |
| --- | --- | --- |
| [architecture/01-project-structure.md](./architecture/01-project-structure.md) | 工程结构与构建配置 | 目录划分、路径别名、tsconfig 分工、electron-vite 配置、依赖归类规则 |
| [data/01-sqlite-storage.md](./data/01-sqlite-storage.md) | SQLite 存储 | drizzle + better-sqlite3 的建库、表结构、迁移与主进程/渲染层契约 |
| [file/01-file-module.md](./file/01-file-module.md) | 文件模块 | FileClient 接口与本地 / WebDAV / SMB 三实现、连接配置与 safeStorage 加密、IPC 通道与传输进度、能力矩阵与限制 |
| [setting/01-setting-storage.md](./setting/01-setting-storage.md) | 设置存储 | 设置以单个 JSON 落盘，主进程为唯一写入口，渲染层按分组读写 |
| [setting/02-setting-items.md](./setting/02-setting-items.md) | 设置项清单 | 七组设置的全部字段、含义、默认值与命名模板占位符词表；站点账号参数由插件声明，不在设置页 |
| [ui/01-renderer-shell.md](./ui/01-renderer-shell.md) | 渲染层外壳与主题 | 应用外壳布局、侧栏菜单与折叠、页面容器（`PageLayout` 的 `#leading` 与子页面容器 `SubPageLayout`）、TDesign Token 与 Fluent 变量分层、亮/深色主题三档与切换 |
| [ui/02-window-chrome.md](./ui/02-window-chrome.md) | 窗口外观与自定义标题栏 | 亚克力系统材质、平台窗口参数、渲染层透明链路、标题栏与窗口按钮、appWindow IPC、材质跟随深色主题 |
| [page/01-base-pages.md](./page/01-base-pages.md) | 基础页面 | 概览 / 工作台 / 存储 / 插件 / 工具 / 设置 / 日志 / 关于 八个页面的职责与实现要点；插件页透明左栏与拖拽排序、导入多选与「同名只保留最新」的提示、配置区块只在声明了环境变量时出现；工具箱索引页在 `pages/tools/` 根、搜索工具子页按路径收进 `pages/tools/search/`（`/tools/search`，用 `SubPageLayout` 的标题左侧返回按钮） |
| [page/02-storage-page.md](./page/02-storage-page.md) | 存储管理页面 | 数据源（本地 / WebDAV / SMB）连接管理、文件浏览与增删改、上传下载进度与取消、命令式弹窗与组件声明补齐 |
| [plugin/01-plugin-module.md](./plugin/01-plugin-module.md) | 刮削插件模块 | JS 脚本插件契约（definePlugin 四方法、`env` 环境变量声明、下载配置型资源、ctx 与沙箱白名单）、安装即沙箱执行读取声明、批量导入多选且同名只保留最新（先比 version 再比 mtime，旧版本进 `skipped` 提示而非报错）、环境变量在各插件的配置区块填写（内置插件不显示该区块）、拖拽排序与顺序落盘、vm 沙箱与超时、存储与 safeStorage、IPC 通道、错误码、完整示例插件 |
| [plugin/02-builtin-offline-plugin.md](./plugin/02-builtin-offline-plugin.md) | 内置插件：R18 离线数据包 | r18.dev 全量转储的格式与解析、独立 `r18.db` 与系统库隔离、导入流水线（下载 / 校验 / 换库 / 取消）、离线查询与 DMM 图片规则、内置插件 `r18-offline`、自动与主动检查更新、IPC 通道与界面 |
| [dialog/01-dialog-module.md](./dialog/01-dialog-module.md) | 系统对话框模块 | dialog 域 IPC（`dialog:open` / `dialog:save` 选文件或目录）、取消与失败语义、入参收窄、通用目录选择控件 `DirectoryPickerField` |
| [http/01-http-client.md](./http/01-http-client.md) | HTTP 客户端模块 | 主进程 axios 单例与请求拦截器、代理注入规则（前缀优先 / userinfo → auth / socket5 回落直连告警）、超时兜底、环境变量代理屏蔽、日志去重 |

## 阅读顺序建议

1. 先看 `architecture/01-project-structure.md` 建立目录与别名的整体印象。
2. 涉及数据落盘时看 `data/` 与 `setting/`。
3. 涉及文件读写（本机磁盘 / WebDAV / SMB）时看 `file/`。
4. 涉及刮削站点适配（导入 / 编写插件）时看 `plugin/`；离线保底方案（r18.dev 数据包）看 `plugin/02-builtin-offline-plugin.md`。
5. 涉及界面改造时看 `ui/` 与 `page/`。
6. 涉及唤起系统文件 / 目录选择框（打开、保存、选目录）时看 `dialog/`。
