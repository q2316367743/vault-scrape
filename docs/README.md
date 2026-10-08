# vault-scrape 技术文档索引

本目录存放项目的技术文档，按领域分目录组织。功能落地后必须同步更新对应文档，并在此登记。

| 文档 | 标题 | 描述 |
| --- | --- | --- |
| [architecture/01-project-structure.md](./architecture/01-project-structure.md) | 工程结构与构建配置 | 目录划分、路径别名、tsconfig 分工、electron-vite 配置、依赖归类规则 |
| [data/01-sqlite-storage.md](./data/01-sqlite-storage.md) | SQLite 存储 | drizzle + better-sqlite3 的建库、表结构、迁移与主进程/渲染层契约 |
| [file/01-file-module.md](./file/01-file-module.md) | 文件模块 | FileClient 接口与本地 / WebDAV / SMB 三实现、连接配置与 safeStorage 加密、IPC 通道与传输进度、能力矩阵与限制 |
| [setting/01-setting-storage.md](./setting/01-setting-storage.md) | 设置存储 | 设置以单个 JSON 落盘，主进程为唯一写入口，渲染层按分组读写 |
| [setting/02-setting-items.md](./setting/02-setting-items.md) | 设置项清单 | 八组设置的全部字段、含义、默认值与命名模板占位符词表 |
| [ui/01-renderer-shell.md](./ui/01-renderer-shell.md) | 渲染层外壳与主题 | 应用外壳布局、侧栏菜单与折叠、页面容器、TDesign Token 与 Fluent 变量分层、亮/深色主题三档与切换 |
| [ui/02-window-chrome.md](./ui/02-window-chrome.md) | 窗口外观与自定义标题栏 | 亚克力系统材质、平台窗口参数、渲染层透明链路、标题栏与窗口按钮、appWindow IPC、材质跟随深色主题 |
| [page/01-base-pages.md](./page/01-base-pages.md) | 基础页面 | 概览 / 工作台 / 存储 / 插件 / 工具 / 设置 / 日志 / 关于 八个页面的职责与实现要点 |
| [page/02-storage-page.md](./page/02-storage-page.md) | 存储管理页面 | 数据源（本地 / WebDAV / SMB）连接管理、文件浏览与增删改、上传下载进度与取消、命令式弹窗与组件声明补齐 |
| [plugin/01-plugin-module.md](./plugin/01-plugin-module.md) | 刮削插件模块 | JS 脚本插件契约（definePlugin 四方法、`env` 环境变量声明、下载配置型资源、ctx 与沙箱白名单）、安装即沙箱执行读取声明、环境变量在「设置 → 账号设置」填写、vm 沙箱与超时、存储与 safeStorage、IPC 通道、错误码、完整示例插件 |

## 阅读顺序建议

1. 先看 `architecture/01-project-structure.md` 建立目录与别名的整体印象。
2. 涉及数据落盘时看 `data/` 与 `setting/`。
3. 涉及文件读写（本机磁盘 / WebDAV / SMB）时看 `file/`。
4. 涉及刮削站点适配（导入 / 编写插件）时看 `plugin/`。
5. 涉及界面改造时看 `ui/` 与 `page/`。
