# vault-scrape 技术文档索引

本目录存放项目的技术文档，按领域分目录组织。功能落地后必须同步更新对应文档，并在此登记。

| 文档 | 标题 | 描述 |
| --- | --- | --- |
| [architecture/01-project-structure.md](./architecture/01-project-structure.md) | 工程结构与构建配置 | 目录划分、路径别名、tsconfig 分工、electron-vite 配置、依赖归类规则与 `patches/` 补丁机制 |
| [data/01-sqlite-storage.md](./data/01-sqlite-storage.md) | SQLite 存储 | drizzle + better-sqlite3 的建库、8 张表（`log` / `task` / `scrape_file` + 媒体层的 `library` / `library_path` / `media_item` / `media_source` / `media_image`）、唯一索引与迁移流程、`library.type` 与 `media_item.has_nfo` 列（扫描维护的事实列，当前不参与分类）；媒体层重建后共三个迁移 `0000_heavy_hardball.sql` + `0001_smooth_micromacro.sql`（给 `library` 加 `type`）+ `0002_damp_mandarin.sql`（给 `media_item` 加 `has_nfo`），旧库只归档不迁移（归档为 `vault-scrape.db.old-20261010`，下次启动新建空库，见 media/01） |
| [media/01-media-library.md](./media/01-media-library.md) | 资料库（Jellyfin / Emby 式媒体库） | 资料库模型（类型 + 多根目录 + 库级刮削器，**空刮削器 = 不刮削**）与 `MediaLibrary` / `MediaLibrarySummary` 字段、**目录重叠规则**（同库重复 / 同库嵌套 / 跨库重叠三种报错文案与理由）、类型与后缀清单来源、`library:*` 通道与 `LibraryResult` 信封、错误码表、扫描（游标 BFS、按 `type` 取后缀、确定性 ID、`scanId` 清理、取消语义、自动刮削四种跳过原因）与刮削（候选去重、按根目录分组且一次只跑一组、条目元数据回写）两条链路、库级选项与封面拼贴 `coverUrls`、封面兜底链（按主图 → 缩略图 → 背景图 → 剧照 → 其他，同一类先条目自己再父目录条目）与**播放期路径自愈**（`mediaLocator.ts`：视频 `stat` 报不存在时按「文件名 + 字节数」在资料库范围内找回并写回 `media_source`，source id 不变）、与工作台 / 影视墙 / 存储页的关系、数据落盘位置与已知限制 |
| [file/01-file-module.md](./file/01-file-module.md) | 文件模块 | FileClient 接口与本地 / WebDAV / SMB 三实现（含区间读 `readRange` 与 SMB 补丁）、连接配置与 safeStorage 加密、IPC 通道与传输进度、能力矩阵与限制 |
| [setting/01-setting-storage.md](./setting/01-setting-storage.md) | 设置存储 | 设置以单个 JSON 落盘，主进程为唯一写入口，渲染层按分组读写；分组 store 的默认值 → 异步回填 → 300ms 防抖回写链路、加载回填不覆盖用户刚做的修改、保存成功回调 `onSaved`（用于刷新模块级缓存） |
| [setting/02-setting-items.md](./setting/02-setting-items.md) | 设置项清单 | 八组设置的全部字段、含义、默认值与命名模板占位符词表（`app` 为第一个分组：主题、NSFW 保护与演员头像目录；总开关保存成功后经 `onSaved` 刷新 `refreshNsfwProtection()`，切换即全应用生效；剧照目录名在 `scrape.fanartDirName`；`library.extensions` 为「设置 → 资料库」里按库类型维护的媒体后缀清单，扫描资料库时生效）；站点账号参数由插件声明，不在设置页；`scrape.autoScrapeAfterScan` 为「扫描后自动刮削」开关（默认开启） |
| [scrape/01-scrape-module.md](./scrape/01-scrape-module.md) | 刮削模块（主进程） | 任务单例与并发调度（并发数 / 休息节奏）、资料库候选与同目录同番号去重、子树路径校验与「每个文件按自己所在目录处理」、刮削器只认资料库绑定（含重启后继续任务按 `(connectionId, dirPath)` 回落）、跨插件顺序补全、命名与移动、条目元数据与图片回写（`updateItemMetadata` / `replaceItemImages` / `updateSourcePath`）、appdata 图片落盘、资源下载与 NFO、日志落文件、IPC 契约与错误码 |
| [ui/01-renderer-shell.md](./ui/01-renderer-shell.md) | 渲染层外壳与主题 | 应用外壳布局、侧栏菜单与折叠、页面容器（`PageLayout` 的 `#leading` 与子页面容器 `SubPageLayout`）、TDesign Token 与 Fluent 变量分层、亮/深色主题三档与切换 |
| [ui/02-window-chrome.md](./ui/02-window-chrome.md) | 窗口外观与自定义标题栏 | 亚克力系统材质、平台窗口参数、渲染层透明链路、标题栏与窗口按钮、appWindow IPC、材质跟随深色主题 |
| [ui/03-checkbox-select.md](./ui/03-checkbox-select.md) | 通用多选控件 CheckboxSelect | 通用表单控件 `src/renderer/src/components/CheckboxSelect.vue`（外框 + 顶部搜索 + 可滚动 checkbox 列表，`v-model` 是 `string[]`，选项结构同 `t-select`）、保留选项外历史值 / 搜索只过滤展示 / 点击只 toggle 一次等行为契约与 Token 样式；资料库表单「刮削器」由 `t-transfer` 穿梭框换成它，`TTransfer` 声明随之下线 |
| [page/01-base-pages.md](./page/01-base-pages.md) | 基础页面 | 概览（含 7 张任务统计卡）/ 工作台（选资料库逐级浏览后手动刮削）/ 存储 / 插件 / 工具 / 设置 / 日志 / 关于 八个基础页面的职责与实现要点（第九个一级页面「影视墙」另见 page/04-media-wall-page.md）；插件页透明左栏与拖拽排序、导入多选与「同名只保留最新」的提示、配置区块只在声明了环境变量时出现；工具箱索引页在 `pages/tools/` 根、搜索工具子页按路径收进 `pages/tools/search/`（`/tools/search`，用 `SubPageLayout` 的标题左侧返回按钮） |
| [page/02-storage-page.md](./page/02-storage-page.md) | 存储管理页面 | **只读**存储页：数据源（本地 / WebDAV / SMB）连接管理、连接内目录浏览（进入 / 面包屑 / 刷新）与媒体 / nfo 预览抽屉（`storage://` 的路径形式 + 区间播放 + NSFW 遮罩 + nfo 解析字段 / 原始 XML 双视图）；写操作（新建 / 上传 / 下载 / 重命名 / 复制 / 移动 / 删除 / 编辑文本）与传输进度面板整体下线，主进程 file 接口保留；连接上不再有刮削器（刮削器归资料库，`scraperIdsOf` / `describeScrapers` 已下线），删除连接会级联删除其名下的资料库（影片随之从墙上移除） |
| [page/03-workspace-page.md](./page/03-workspace-page.md) | 工作台页面 | 高级 / 手动刮削入口（与资料库共用同一套任务模型）：左栏选资料库 + 逐级目录浏览（面包屑 / 上一级），文件表格按 选择 · 名称 · 类型 · 大小 · 修改时间 · 状态 勾选影片排队（状态列只提示「没有播放源」），启动 / 取消 / 继续与主进程快照驱动的进度复原；不再扫盘，入库只在资料库抽屉的「扫描」 |
| [page/04-media-wall-page.md](./page/04-media-wall-page.md) | 影视墙页面 | 首页（`/media`：资料库横排 + 最近添加 / 推荐两排，`media:home` 取样规则 `MEDIA_HOME_ROW_LIMIT = 24`）与内容页（`/media/library?libraryId=…`，用 `SubPageLayout`（`fallback="/media"`）、返回图标在标题左侧，空串 = 全部影片、可选 `keyword`，搜索 / 三种排序（默认按磁盘时间）/ 摘要口径）两级，加影片详情页（`/media/detail?itemId=…`：artplayer 播放 + 磁盘事实 + NFO 元信息，视频读不出来时用封面兜底一层）；不按刮削与否分类（没有待刮削 / 已刮削角标、排序与统计）、`pages/media/` 目录分层、资料库抽屉（扫描 / 刮削 / 编辑 / 删除，「N 个目录」+「不刮削」标签）与表单（类型锁定 + 多目录编辑器 + 存储内目录选择器 `RemoteDirDialog` + 刮削器多选（`CheckboxSelect`，可留空），编辑资料库是右侧抽屉）、Range 播放链路与播放期路径自愈、NSFW 三源遮罩与手工验证清单 |
| [plugin/01-plugin-module.md](./plugin/01-plugin-module.md) | 刮削插件模块 | JS 脚本插件契约（definePlugin 四方法、`env` 环境变量声明、下载配置型资源、ctx 与沙箱白名单）、安装即沙箱执行读取声明、批量导入多选且同名只保留最新（先比 version 再比 mtime，旧版本进 `skipped` 提示而非报错）、环境变量在各插件的配置区块填写（内置插件不显示该区块）、拖拽排序与顺序落盘、vm 沙箱与超时、存储与 safeStorage、IPC 通道、错误码、完整示例插件 |
| [plugin/02-builtin-offline-plugin.md](./plugin/02-builtin-offline-plugin.md) | 内置插件：R18 离线数据包 | r18.dev 全量转储的格式与解析、独立 `r18.db` 与系统库隔离、导入流水线（下载 / 校验 / 换库 / 取消）、离线查询与 DMM 图片规则、内置插件 `r18-offline`、自动与主动检查更新、IPC 通道与界面 |
| [dialog/01-dialog-module.md](./dialog/01-dialog-module.md) | 系统对话框模块 | dialog 域 IPC（`dialog:open` / `dialog:save` 选文件或目录）、取消与失败语义、入参收窄、渲染层用法；通用目录控件 `DirectoryPickerField`（选**本机**目录，用于存储页「本地磁盘」数据源的根目录字段）；资料库的媒体目录另由 `RemoteDirDialog` 走 `fileApi.list` 列连接内目录 |
| [http/01-http-client.md](./http/01-http-client.md) | HTTP 客户端模块 | 主进程 axios 单例与请求拦截器、代理注入规则（前缀优先 / userinfo → auth / socket5 回落直连告警）、超时兜底、环境变量代理屏蔽、日志去重 |

## 阅读顺序建议

1. 先看 `architecture/01-project-structure.md` 建立目录与别名的整体印象。
2. 涉及数据落盘时看 `data/` 与 `setting/`；资料库配置与媒体索引都在 sqlite（`library` / `library_path` / `media_item` / `media_source` / `media_image`，不再是独立 JSON），看 `media/01-media-library.md`；`storage://` 私有协议与媒体源 / 图片取值也归这一层。
3. 涉及文件读写（本机磁盘 / WebDAV / SMB）时看 `file/`。
4. 涉及刮削站点适配（导入 / 编写插件）时看 `plugin/`；离线保底方案（r18.dev 数据包）看 `plugin/02-builtin-offline-plugin.md`。
5. 涉及界面改造时看 `ui/` 与 `page/`；工作台与刮削流程看 `page/03-workspace-page.md` 与 `scrape/01-scrape-module.md`；刮削成果的浏览入口（影视墙）看 `page/04-media-wall-page.md`，影视墙的归口单位与扫描 / 刮削链路看 `media/01-media-library.md`。
6. 涉及唤起系统文件 / 目录选择框（打开、保存、选目录）时看 `dialog/`。
