# 设置项清单

本文档按功能域列出全部设置项、默认值与落盘键。定义文件在 `src/common/types/setting/`，界面在 `src/renderer/src/windows/main/pages/setting/components/`。

落盘键与分组（`SettingGroupKey`）：`app` / `library` / `scrape` / `network` / `translate` / `naming` / `download` / `file`（共八组，设置页标签顺序与 `SETTING_GROUP_KEYS` 一致，`app` 为第一个分组）。站点账号参数不在设置页，由插件在 `env` 里声明、在插件页的配置区块填写，见第 9 节与 [../plugin/01-plugin-module.md](../plugin/01-plugin-module.md)。

## 1. 应用设置（`app`）

| 字段 | 含义 | 默认值 | 界面 |
| --- | --- | --- | --- |
| `nsfwProtection` | NSFW 保护总开关，也是**唯一前提**：开启后，命中「存储 `nsfw` 标记」或「资料库 `nsfwProtection`」的敏感图片一律遮罩；**关闭时一律不遮**——存储与库级标记都跟着失效（它们只表示「把这块内容划入敏感范围」，不是各自独立的隐藏开关）；没有存储上下文的页面（如工具搜索）只按本开关生效 | `false` | 开关 |
| `actorImageDir` | 演员图片根目录（头像与图集都放这里），留空使用默认位置（`~/<数据目录>/media/actor`） | `''` | `DirectoryPickerField`（输入框 + 目录选择按钮，选绝对路径） |
| `mpvEnabled` | **用 mpv 播放的总开关**。关闭时一律走内置 artplayer：不看 `mpvPath`、也不做自动探测（主进程 `locateMpv()` 开头早退返回「没找到」）；设置页的「检测」走 `detectMpv`，不受它影响。这是「想手动取消 mpv」的唯一入口 —— 只清空路径没用，留空仍会自动探测。**macOS 上不生效**：mpv 在 macOS 已停用（见[播放窗口与 mpv 播放](../media/03-mpv-playback.md)第 19 条），这一项在 macOS 上显示为「暂不支持」标签（界面只说结论，不写实现细节） | `true` | 开关（关掉后下面那项的输入框与「选择 / 检测」一并置灰；**macOS 上只有一句只读结论 + 「暂不支持」标签**） |
| `mpvPath` | mpv 可执行文件路径（**仅 Windows 会用到**，用户自备，不内置）；留空按 `PATH` 与常见安装位置自动探测。**总开关开着时才看它**：只有配到（或探测到）mpv，播放窗口才用 mpv 播放；探测不到时**静默**用内置 artplayer，播放窗口不提示，说明文案只在本设置页 | `''` | 输入框（留空 = 自动探测）+「选择文件」+「检测」（`playerApi.detect(path)`）；**macOS 上整项不显示** |
| `macEmbed` | **停用字段**：macOS 已停用 mpv，本字段当前没有任何效果、设置页也不再暴露（原先 macOS 上的「mpv 画面嵌入窗口（实验）」开关已移除），只保留在类型里以便将来恢复 macOS 方案。历史含义：把 mpv 画面嵌进播放窗口（`--wid`），默认关闭时走「mpv 无边框独立窗口贴住视频区」，嵌入路径有「只有声音没有画面」的已知风险 | `false` | 无（曾是开关） |

应用设置是设置页的第一个分组（`SettingPage.vue` 里 `<t-tab-panel value="app" label="应用设置">`，也是默认分组），面板为 `SettingAppPanel.vue`。**主题不在 `settings.json` 里**：它同样放在应用设置分组内，但由 `src/renderer/src/global/AppTheme.ts`（`themeMode` + `setThemeMode`）持久化到 localStorage，切换后立即生效，不走设置 IPC。演员图片目录留空表示使用默认位置（`~/<数据目录>/media/actor`），选择按钮由通用组件 `DirectoryPickerField.vue` 提供（走 `dialog:open` 的 `directory: true`，选完把绝对路径写回输入框）；目录在真正写入图片时才创建与校验（不可写则回落默认目录并记一条 `scope: 'actor'` 的 warn），详见[演员模块](../actor/01-actor-module.md)。存储与资料库侧的配合项是连接上的 `nsfw` 标记与库级 `nsfwProtection`（见[存储管理页面](../page/02-storage-page.md)、[资料库](../media/01-media-library.md)）：**总开关开启是前提，再命中「该存储被标记为 nsfw」或「该资料库开了 nsfwProtection」任一就遮罩；总开关关着时两者都不遮**，判定收敛在 `src/renderer/src/hooks/UseNsfwProtection.ts`（`active` = 存储上下文口径，`protect` = 再叠上库级 `nsfwProtection`；影视墙卡片与详情页用的是 `protect`，库级标记由主进程随 `MediaWallItem.nsfwProtected` / `MediaDetailResult.item.nsfwProtected` 下发）。

总开关在渲染层是模块级缓存（`protection` ref，一次读取、全应用共享），所以**它必须能被刷新**：`SettingAppStore.ts` 给 `createSettingGroupStore` 传了 `onSaved` 回调，应用分组保存成功后调用 `refreshNsfwProtection()`。刷新点只能挂在「保存成功之后」——落盘有 300ms 防抖，挂在值变化上会读到主进程里还没更新的旧值，反而把保护状态刷成旧值。效果：切换开关约 300ms 后全应用生效，不需要重启或刷新页面，影视墙的遮罩会立刻出现/消失（见[设置存储](../setting/01-setting-storage.md)的「注意事项」）。

定义在 `src/common/types/setting/appSetting.ts`，值为 `SettingApp { nsfwProtection; actorImageDir; mpvEnabled; mpvPath; macEmbed }`，落盘形状 `{ "nsfwProtection": false, "actorImageDir": "", "mpvEnabled": true, "mpvPath": "", "macEmbed": false }`。

`mpvEnabled` / `mpvPath` / `macEmbed` 只影响播放窗口，**不需要重启生效**：每次开播都由主进程重新 `locateMpv()`（macOS 在总开关与缓存判断之前就直接返回「没找到」；总开关在缓存之前判断，关掉立刻生效；探测结果缓存 30 秒，点设置页的「检测」命中时（`detectMpv`）会调 `resetMpvCache()` 清掉缓存，所以**改完路径点一次「检测」**就立刻按新值走，不点最多等 30 秒）。注意 `mpvEnabled` / `macEmbed` 会改变播放窗口的**窗口形态**（要不要透明挖洞、控制条让不让行），而形态在建窗那一刻就定死了，所以主进程保存 `app` 组时若这两个字段变了会直接关掉播放窗口（`settingIpc.ts` → `closePlayerWindow()`），下次播放按新形态重建 —— macOS 上形态已固定为「不透明 + 内置播放器」，这条逻辑只剩 Windows 会走到。三项的完整语义、后端降级规则与已知限制见 [播放窗口与 mpv 播放](../media/03-mpv-playback.md)（设置页是唯一说明「没配 mpv 就用内置播放器」的地方，播放窗口不提示）。

## 2. 资料库（`library`）

| 字段 | 含义 | 默认值 | 界面 |
| --- | --- | --- | --- |
| `extensions` | 各库类型识别媒体文件的后缀清单（`Record<LibraryType, string[]>`，按库类型分行；当前只有 `movie`） | `DEFAULT_LIBRARY_EXTENSIONS.movie = ['mp4','mkv','avi','mov','wmv','flv','webm','ts','m2ts','mpg','mpeg','rmvb']` | `t-tag-input`（每个类型一行，回车添加） |

定义在 `src/common/types/setting/librarySetting.ts`，值为 `SettingLibrary { extensions: Record<LibraryType, string[]> }`，落盘形状 `{ "extensions": { "movie": ["mp4", …] } }`。面板是 `pages/setting/components/SettingLibraryPanel.vue`，store 为 `store/setting/SettingLibraryStore.ts`（`createSettingGroupStore('setting:library', 'library')`）。

- **生效时机**：`libraryScan.ts` 的 `scanLibrary()` 用 `libraryExtensionsOf(loadSetting().library, library.type)` 取该库类型的清单，再传给 `indexLibraryPath(library, libPath, { scanId, extensions, … })`；主进程扫描器与 `mediaIndexer.ts` 里**不再有硬编码后缀**（判定是私有函数 `isVideoExtension(extensions, extname)`）。所以改完后缀要**下一次扫描**才生效，已经入库的条目不追溯。
- **清洗规则**（`normalizeExtensionList(input, fallback)`，读盘与保存都走）：去首尾空白 → 去掉前导点（`.mp4` → `mp4`）→ 转小写 → 丢掉非法（不匹配 `/^[a-z0-9]{1,12}$/`）与重复项 → 只保留前 `LIBRARY_EXTENSION_LIMIT = 64` 个 → 清洗后为空则整体回落到 `fallback`。
- **面板行为**：`t-tag-input`（`:max="LIBRARY_EXTENSION_LIMIT"`、`excess-tips`「最多 64 个后缀」）在**失焦时**清洗并写回；清空后失焦提示「至少要保留一个后缀，已回落默认值」并恢复默认清单；超过 64 个时提示「最多保留 64 个后缀，多余的已丢弃」。保存沿用设置 store 的 300ms 防抖，面板没有独立保存按钮。
- **归一化注册**在 `src/common/types/setting/index.ts` 的六处：类型导出、`SettingSchema`、`SETTING_GROUP_KEYS`、`settingNormalizers`、`buildSetting()`、`normalizeSetting()`。新增库类型时要同时补 `LIBRARY_TYPE_LABELS`（`src/common/types/library/index.ts`）与 `DEFAULT_LIBRARY_EXTENSIONS`。
- 各资料库自己的「内容语言」（`MediaLibrary.language`）**不是设置项**，是库的字段，在资料库表单里编辑，见 [../media/01-media-library.md](../media/01-media-library.md)。

## 3. 刮削设置（`scrape`）

| 字段 | 含义 | 默认值 | 界面 |
| --- | --- | --- | --- |
| `autoScrapeAfterScan` | 资料库扫描完成后，自动为尚未刮削的影片排队刮削；四种跳过原因按固定顺序回报（开关关闭 / 该库刮削器为空 / 没有待刮削影片 / 已有刮削任务在跑），扫描结果本身照常返回，见[资料库](../media/01-media-library.md) | `true` | 开关（面板顶部） |
| `concurrency` | 并发线程数 | `3` | 数字输入，最小 1 |
| `requestDelay` | 每次请求之间的延迟（秒） | `1` | 数字输入，最小 0 |
| `restAfterCount` | 连续刮削多少条后休息，0 表示不休息 | `50` | 数字输入，最小 0 |
| `restDuration` | 休息时长（秒） | `60` | 数字输入，最小 0 |
| `fanartDirName` | 剧照目录名：既是刮削结果里存放剧照（`still`）的子目录名，也是「优先读取本地图片」时查找本地剧照的目录名 | `'extrafanart'` | 输入框 |
| `actorScrape` | 影片刮削入库后，是否自动为参演演员抓取资料（需要启用**演员信息插件**即 `actor` 类插件；只补空白字段，锁定资料只填空） | `true` | 开关 |
| `actorScrapeOnOpen` | 打开演员详情页且资料不全（没抓过、没头像或没生日）时，是否自动抓一次（会话内同一演员只试一次，静默失败） | `true` | 开关 |
| `actorImageLimit` | 每位演员最多下载多少张图集图片，0 表示只抓资料、不下载图片（头像不计入这个上限） | `12` | 数字输入，最小 0 |

## 4. 网络连接（`network`）

| 字段 | 含义 | 默认值 | 界面 |
| --- | --- | --- | --- |
| `proxyEnabled` | 是否启用代理 | `false` | 开关 |
| `proxyType` | 代理协议：`http` / `https` / `socket5` | `'http'` | 下拉选择 |
| `proxyHost` | 代理地址，形如 `host:port`（可带协议前缀） | `''` | 输入框 |
| `timeout` | 请求超时时间（秒） | `30` | 数字输入，最小 1 |
| `retryCount` | 请求失败重试次数 | `3` | 数字输入，最小 0 |

代理协议与地址在 `proxyEnabled` 为 false 时禁用。`socket5` 当前不受支持：识别到会回落直连并写一条 `warn` 日志，详见 [../http/01-http-client.md](../http/01-http-client.md)。

## 5. 翻译服务（`translate`）

| 字段 | 含义 | 默认值 | 界面 |
| --- | --- | --- | --- |
| `enabled` | 是否启用翻译：**只决定刮削完成后要不要自动翻译** | `false` | 开关 |
| `targetLanguage` | 目标语言：`zh-CN` / `zh-TW` / `en` / `ja` / `ko` | `'zh-CN'` | 下拉选择 |
| `pluginId` | 自动翻译使用的翻译插件 ID；空串表示按插件页顺序取第一个可用的 | `''` | 下拉选择（选项 = 「自动选择」+ 可用翻译插件；配置已失效时补一项「<名字>（已失效）」，不静默丢弃） |
| `writeNfo` | 翻译完成后是否把译文写进磁盘 NFO（外部播放器与媒体服务器据此显示译文） | `true` | 开关 |

- **手动翻译不受 `enabled` 影响**：详情页「更多 → 翻译」永远在，所以手动路径没有「未启用」这个错误码（见 [../plugin/10-translate-integration.md](../plugin/10-translate-integration.md)）。
- **自动翻译要三条同时满足**：`enabled` 为真、资料库声明了「内容语言」（`library.language`，见 [../media/01-media-library.md](../media/01-media-library.md)）、且内容语言与 `targetLanguage` 不同。没声明内容语言的库不参与自动翻译。
- `targetLanguage` / `pluginId` 在 `enabled` 为 false 时禁用。
- `writeNfo` 打开后 NFO 是**覆盖式**的：正文变译文（并多一行私有标记 `<vaultscrape_translated>`），原文仍在 `media_item` 里，详情页照样能切回原文。
- 面板是 `pages/setting/components/SettingTranslatePanel.vue`，store 为 `store/setting/SettingTranslateStore.ts`（`createSettingGroupStore('setting:translate', 'translate')`）。

## 6. 命名规则（`naming`）

| 字段 | 含义 | 默认值 | 界面 |
| --- | --- | --- | --- |
| `fileTemplate` | 名称模板：**影片文件夹名 / 影片文件名 / NFO 文件名三者共用这一个结果** | `'{num} {title} ({year}) [{providerId}]'` | 输入框 |
| `assetNaming` | 附属文件命名：`fixed`（固定命名） / `movie`（跟随影片文件名） | `'fixed'` | 下拉选择 |
| `nfoTitleTemplate` | NFO 标题模板 | `'{num} {title}'` | 输入框 |
| `actorMaxCount` | 演员名最大数量 | `5` | 数字输入，最小 1 |
| `actorOverflowSuffix` | 演员名超出后缀，支持 `{count}` | `'等{count}人'` | 输入框 |
| `actorFallbackToMaker` | 演员为空时使用片商或卖家（`{actor}` 回退，可用 `{actorFallbackPrefix}{actor}` 显示来源） | `false` | 开关 |
| `releaseDateFormat` | 发行日期格式（dayjs 格式串） | `'YYYY-MM-DD'` | 输入框 |
| `partStyle` | 分盘样式：`origin`（保持原始后缀） / `cd`（CD1/CD2） / `part`（PART1/PART2） / `disc`（DISC1/DISC2） | `'origin'` | 下拉选择 |
| `fileNameMaxLength` | 名称最大长度（文件夹名与文件名同源，共用这一个上限） | `120` | 数字输入，最小 1 |
| `chinaSubtitleTag` | 中文字幕标记 | `'中文字幕'` | 输入框 |
| `umrTag` | UMR 标记 | `'UMR'` | 输入框 |
| `leakTag` | 流出标记 | `'流出'` | 输入框 |
| `uncensoredTag` | 无码标记 | `'无码'` | 输入框 |
| `censoredTag` | 有码标记 | `'有码'` | 输入框 |

### 模板占位符词表

设置页顶部有可点击复制的提示条（`TemplateHintBar.vue`），当前收录：

`{num}` `{title}` `{actor}` `{actorFallbackPrefix}` `{maker}` `{label}` `{series}` `{date}` `{year}` `{month}` `{day}` `{studio}` `{director}` `{duration}` `{resolution}` `{count}`

其中 `{count}` 仅用于 `actorOverflowSuffix`。该词表是与刮削实现共同演进的约定，新增占位符时需同时更新提示条与本文档。

## 7. 下载选项（`download`）

| 字段 | 含义 | 默认值 |
| --- | --- | --- |
| `downloadThumb` | 下载横版缩略图 | `true` |
| `downloadPoster` | 下载海报 | `true` |
| `posterTagBadge` | 为封面添加标签角标 | `false` |
| `posterBadgeTypes` | 角标启用的标签类型（字符串数组） | `[]` |
| `posterBadgeCorner` | 角标位置：`top-left` / `top-right` / `bottom-left` / `bottom-right` | `'top-right'` |
| `downloadFanart` | 下载背景图 | `true` |
| `downloadStill` | 下载剧照 | `true` |
| `downloadTrailer` | 下载预告片 | `true` |
| `keepThumb` | 保留已有横版缩略图 | `true` |
| `keepPoster` | 保留已有海报 | `true` |
| `keepFanart` | 保留已有背景图 | `true` |
| `keepStill` | 保留已有剧照 | `true` |
| `keepTrailer` | 保留已有预告片 | `true` |

NFO **一定会写**，因此没有「生成 NFO」/「NFO 文件命名」/「保留已有 NFO」这三项：NFO 固定写到与影片同名的 `<名称>.nfo`。

角标类型与角标位置两行仅在 `posterTagBadge` 开启时显示；角标类型为可多选、可搜索、可新建的下拉框。

## 8. 文件行为（`file`）

| 字段 | 含义 | 默认值 |
| --- | --- | --- |
| `removeEmptyFolder` | 删除空文件夹 | `false` |
| `scrapeSymlinkDir` | 刮削软链接目录 | `false` |
| `saveLogToFile` | 保存日志到文件 | `false` |

## 9. 站点账号参数（不在设置页）

站点账号参数**不并入 `settings.json`**：刮削源由插件决定，账号类参数（站点地址、Cookie、API Key 等）由插件在自己的 `env` 表里声明，值按插件类别落在 `~/.vault-scrape/plugin/<类别>/plugins.json`（如影片插件在 `plugin/movie/plugins.json`）；环境变量一律按敏感处理，由 `safeStorage` 加密保存且明文永不跨 IPC。

因此类型层不包含 `account` 分组，设置页也没有「账号设置」标签：填写入口是**插件页右栏的配置区块**（`pages/plugin/components/PluginConfigPanel.vue`）——选中哪个插件就填哪个插件的变量，每个变量一行**多行文本域**（`t-textarea`），已保存的值不回显（提示「已保存，留空表示保持不变」），保存以插件为单位。插件未声明 `env`（含内置插件）时详情页根本不渲染这个区块，声明了但一项都无需填时区块内显示空态。插件的环境变量声明、加密口径与完整界面说明见 [../plugin/01-plugin-module.md](../plugin/01-plugin-module.md)。

## 归一化规则

读盘与保存时统一经过归一化（`src/common/types/setting/shared.ts`）：

- 顶层或分组不是对象 → 整体回落该组默认值。
- 字符串字段非字符串 → 默认值；布尔字段非布尔 → 默认值。
- 数字字段非有限数或低于下限 → 默认值（`concurrency` / `timeout` / `actorMaxCount` / 长度类下限为 1，其余为 0）。
- 枚举字段取值不在候选内 → 默认值。
- 字符串数组字段非数组或元素非字符串 → 默认值（空数组）。
- `library.extensions` 比普通数组多一层清洗：合法元素也要去空白 / 去前导点 / 转小写 / 去重 / 截断到 `LIBRARY_EXTENSION_LIMIT = 64` 个，清洗后为空则回落该类型的默认清单（`libraryExtensionsOf` 与 `normalizeExtensionList`）。
- `app.nsfwProtection` 非布尔 → 默认值 `false`。
- `path` 分组与 `file.moveAfterSuccess` / `file.moveAfterFailure` / `file.renameAfterSuccess` 已移除：读盘时直接忽略这些键（不报错），保存时按 8 个已知分组的归一化器写盘。
