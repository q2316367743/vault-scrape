# 设置项清单

本文档按功能域列出全部设置项、默认值与落盘键。定义文件在 `src/common/types/setting/`，界面在 `src/renderer/src/windows/main/pages/setting/components/`。

落盘键与分组（`SettingGroupKey`）：`app` / `path` / `scrape` / `network` / `translate` / `naming` / `download` / `file`（设置页标签顺序与之一致，`app` 为第一个分组）。站点账号参数不在设置页，由插件在 `env` 里声明、在插件页的配置区块填写，见第 9 节与 [../plugin/01-plugin-module.md](../plugin/01-plugin-module.md)。

## 1. 应用设置（`app`）

| 字段 | 含义 | 默认值 | 界面 |
| --- | --- | --- | --- |
| `nsfwProtection` | NSFW 保护：开启后，标记为 NSFW 的存储会隐藏列表、搜索与详情页的敏感图片；没有存储上下文的页面（如工具搜索）只按本开关生效 | `false` | 开关 |

应用设置是设置页的第一个分组（`SettingPage.vue` 里 `<t-tab-panel value="app" label="应用设置">`，也是默认分组），面板为 `SettingAppPanel.vue`。**主题不在 `settings.json` 里**：它同样放在应用设置分组内，但由 `src/renderer/src/global/AppTheme.ts`（`themeMode` + `setThemeMode`）持久化到 localStorage，切换后立即生效，不走设置 IPC。存储侧的配合项是连接上的 `nsfw` 标记（见[存储管理页面](../page/02-storage-page.md)）：只有「总开关开启 + 该存储被标记」同时成立才隐藏内容，判定收敛在 `src/renderer/src/hooks/UseNsfwProtection.ts`。

## 2. 目录与路径（`path`）

| 字段 | 含义 | 默认值 | 界面 |
| --- | --- | --- | --- |
| `actorAvatarDir` | 演员头像目录 | `''` | 输入框 + 选择按钮（选择功能待接入） |
| `successOutputDir` | 成功输出目录 | `''` | 同上 |
| `failedOutputDir` | 失败输出目录 | `''` | 同上 |
| `fanartDirName` | 剧照目录名（刮削结果内的子目录名） | `'extrafanart'` | 输入框 |

路径为空表示使用默认位置。目录选择按钮当前为 `MessagePlugin.info` 提示占位。

## 3. 刮削设置（`scrape`）

| 字段 | 含义 | 默认值 | 界面 |
| --- | --- | --- | --- |
| `concurrency` | 并发线程数 | `3` | 数字输入，最小 1 |
| `requestDelay` | 每次请求之间的延迟（秒） | `1` | 数字输入，最小 0 |
| `restAfterCount` | 连续刮削多少条后休息，0 表示不休息 | `50` | 数字输入，最小 0 |
| `restDuration` | 休息时长（秒） | `60` | 数字输入，最小 0 |

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
| `enabled` | 是否启用翻译 | `false` | 开关 |
| `targetLanguage` | 目标语言：`zh-CN` / `zh-TW` / `en` / `ja` / `ko` | `'zh-CN'` | 下拉选择 |

翻译服务本身尚未接入，`enabled` 为 false 时目标语言禁用。

## 6. 命名规则（`naming`）

| 字段 | 含义 | 默认值 | 界面 |
| --- | --- | --- | --- |
| `folderTemplate` | 文件夹模板 | `'{num}'` | 输入框 |
| `fileTemplate` | 文件名模板 | `'{num} {title}'` | 输入框 |
| `assetNaming` | 附属文件命名：`fixed`（固定命名） / `movie`（跟随影片文件名） | `'fixed'` | 下拉选择 |
| `nfoTitleTemplate` | NFO 标题模板 | `'{num} {title}'` | 输入框 |
| `actorMaxCount` | 演员名最大数量 | `5` | 数字输入，最小 1 |
| `actorOverflowSuffix` | 演员名超出后缀，支持 `{count}` | `'等{count}人'` | 输入框 |
| `actorFallbackToMaker` | 演员为空时使用片商或卖家（`{actor}` 回退，可用 `{actorFallbackPrefix}{actor}` 显示来源） | `false` | 开关 |
| `releaseDateFormat` | 发行日期格式（dayjs 格式串） | `'YYYY-MM-DD'` | 输入框 |
| `partStyle` | 分盘样式：`origin`（保持原始后缀） / `cd`（CD1/CD2） / `part`（PART1/PART2） / `disc`（DISC1/DISC2） | `'origin'` | 下拉选择 |
| `folderMaxLength` | 文件夹名最大长度 | `120` | 数字输入，最小 1 |
| `fileNameMaxLength` | 文件名最大长度 | `120` | 数字输入，最小 1 |
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
| `generateNfo` | 生成 NFO | `true` |
| `nfoFileNaming` | NFO 文件命名：`both`（同时生成两种） / `movie`（仅 movie.nfo） / `filename`（仅文件名.nfo） | `'both'` |
| `keepNfo` | 保留已有 NFO | `true` |

角标类型与角标位置两行仅在 `posterTagBadge` 开启时显示；角标类型为可多选、可搜索、可新建的下拉框。

## 8. 文件行为（`file`）

| 字段 | 含义 | 默认值 |
| --- | --- | --- |
| `moveAfterSuccess` | 成功后移动文件 | `false` |
| `moveAfterFailure` | 失败后移动文件 | `false` |
| `renameAfterSuccess` | 成功后重命名文件 | `false` |
| `removeEmptyFolder` | 删除空文件夹 | `false` |
| `scrapeSymlinkDir` | 刮削软链接目录 | `false` |
| `saveLogToFile` | 保存日志到文件 | `false` |

## 9. 站点账号参数（不在设置页）

站点账号参数**不并入 `settings.json`**：刮削源由插件决定，账号类参数（站点地址、Cookie、API Key 等）由插件在自己的 `env` 表里声明，值落在 `~/.vault-scrape/plugin/plugins.json`；环境变量一律按敏感处理，由 `safeStorage` 加密保存且明文永不跨 IPC。

因此类型层不包含 `account` 分组，设置页也没有「账号设置」标签：填写入口是**插件页右栏的配置区块**（`pages/plugin/components/PluginConfigPanel.vue`）——选中哪个插件就填哪个插件的变量，每个变量一行**多行文本域**（`t-textarea`），已保存的值不回显（提示「已保存，留空表示保持不变」），保存以插件为单位。插件未声明 `env`（含内置插件）时详情页根本不渲染这个区块，声明了但一项都无需填时区块内显示空态。插件的环境变量声明、加密口径与完整界面说明见 [../plugin/01-plugin-module.md](../plugin/01-plugin-module.md)。

## 归一化规则

读盘与保存时统一经过归一化（`src/common/types/setting/shared.ts`）：

- 顶层或分组不是对象 → 整体回落该组默认值。
- 字符串字段非字符串 → 默认值；布尔字段非布尔 → 默认值。
- 数字字段非有限数或低于下限 → 默认值（`concurrency` / `timeout` / `actorMaxCount` / 长度类下限为 1，其余为 0）。
- 枚举字段取值不在候选内 → 默认值。
- 字符串数组字段非数组或元素非字符串 → 默认值（空数组）。
- `app.nsfwProtection` 非布尔 → 默认值 `false`。
