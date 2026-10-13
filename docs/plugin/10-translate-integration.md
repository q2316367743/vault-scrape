# 翻译能力接入（详情页手动翻译 / 刮削后自动翻译 / 译文回写 NFO）

翻译插件**本身**（契约定型、三个现成站点、沙箱差异）见 [09-translate-plugins.md](./09-translate-plugins.md)；本文只讲**宿主怎么用它**：入口在哪、译文存哪、什么时候自动翻、NFO 要不要跟着改。

## 1. 三条边界（先读这个）

1. **原文永远在 `media_item` 里，译文单独一张表**（`media_translation`）。译文是**派生物**：重新刮削、换目标语言、换插件，都可以直接删掉重算，原文不受影响。
2. **只翻展示层，不动关联键**。演员名在 `media_cast` 里是**按名字**的弱关联（复合主键 `(item_id, name_key)`），改名字就会断开关联，所以演员名只允许翻在详情页上。
3. **NFO 默认保持原文**。只有设置里打开「写入 NFO」（`setting.translate.writeNfo`）才会在刮削时把译文写进磁盘 NFO；文件名、目录名**永远不动**。

## 2. 数据模型

### 2.1 `media_translation` 表（迁移 `0003_lazy_mach_iv.sql`）

一行 = 一个条目的译文，`item_id` 是主键（一个条目最多一份译文，换语言整行覆盖）。同一份迁移里还给 `library` 加了 `language` 列。

| 列 | 含义 |
| --- | --- |
| `item_id` | 条目 ID（主键）；剧集的**每一集是独立条目、各占一行** |
| `library_id` | 所属资料库（`idx_media_translation_library` 索引，按库清理用） |
| `language` | 译文语言（宿主 5 种语言码之一） |
| `source_language` | 翻译时用的源语言；空串表示由插件自动检测 |
| `title` / `original_title` / `overview` / `maker` / `label` / `series` / `director` | 各字段译文，空串 = 这个字段没有译文（界面回落原文） |
| `tags` / `actors` | JSON 文本数组，**按位置对应原文**（顺序 = 读取顺序），长度不够按缺失处理 |
| `plugin_id` | 产出这份译文的插件 ID |
| `translated_at` | 翻译完成时间，0 表示未知 |

定义在 `src/main/src/db/schema/translation.ts`（`mediaTranslationTable`），仓储是 `src/main/src/db/repo/translationRepo.ts`：

- `getTranslation(itemId)` / `listTranslations(itemIds)`（**批量读**，剧集详情一次要读剧集本身 + 全部集，避免 N+1）/ `upsertTranslation(input)` / `deleteTranslation(itemId)` / `deleteTranslationsByItems(itemIds)`；
- 脏 `language`（不在宿主 5 码里）整行当作没有译文、读回 `null`：译文是纯派生物，读不回来重翻即可，不必报错；
- 条目被删除时连带清译文（见 `mediaCleanupRepo.ts`）。

读模型是 `MediaItemTranslation`（`src/common/types/translate/index.ts`），比表少一个 `studio`——**`studio` / `genre` 不翻译**。

### 2.2 资料库的「内容语言」（`MediaLibrary.language`）

- 语义是**该库内容的源语言**（本地 NFO / 文件名本来是什么语言），不是「我想要的语言」；目标语言由全局设置统一决定。
- 类型是 `TranslateLanguage | ''`，**空串 = 未指定**（非法语言码一律收敛成空串，见 `libraryIpc.ts` 的 `readLanguage`）。
- 界面上是资料库表单「类型」行下面的「内容语言」下拉，选项 = 「未指定」+ 5 种语言；空的落到 `'none'`（tdesign 把空串当未选中，所以不能用空串当选项值）。
- **未指定 = 这个库不参与自动翻译**：本机制就是「库语言与目标语言做对比」，没声明语言就无从对比。

## 3. 手动翻译（详情页「更多 → 翻译」）

### 3.1 入口与四态

`MediaDetailToolbar.vue` 的「更多」菜单里**始终**有「翻译」（详情已读出来时才出现，和「手动匹配」同一条规则），**与设置里的翻译开关无关**：`setting.translate.enabled` 只管自动翻译。

点「翻译」时页面（`MediaDetailPage.vue`）先 `loadTranslatePlugins()` 读全类别的插件列表，再按四种状态给结论：

| 状态 | 判定 | 界面结论 |
| --- | --- | --- |
| `empty` | 一个翻译插件都没有 | 「没有翻译插件，请先到插件页添加」 |
| `disabled` | 有插件，但**全都没启用** | 「翻译插件都没有启用，请先到插件页启用」 |
| `unusable` | 有已启用的，但**全都不可用**（典型是两个插件都要求必填 key） | 「翻译插件都需要先补全设置，请到插件页填写」 |
| `ready` | 至少有一个可用 | 打开弹窗选插件 |

判定与文案集中在 `src/renderer/src/windows/main/composables/useTranslatePlugins.ts`（设置页与详情页共用）：

- `plugins` = `pluginApi.translate.list()` 的**全量**结果，**不做任何过滤**（否则界面分不出上面前三种状态）；
- `usable` = `plugins.filter(isPluginUsable)`，`isPluginUsable` 来自 `src/common/types/plugin/manifest.ts`：`enabled && loadError.length === 0 && envReady`，**主进程挑插件与渲染层画弹窗共用这一份判定**；
- `translatePluginHint(plugin)` 给不可用条目的一句原因：加载失败 / 未启用 / 需要先补全插件设置。

### 3.2 弹窗（两文件契约）

- 外壳 `detail/modals/TranslateDialog.tsx`：`openTranslateDialog({ itemId, plugins, isSeries, onApplied })`，`DialogPlugin`（`destroyOnClose: true`、`width: '560px'`、`header: '翻译影视信息'`），footer 是「取消」+「开始翻译」（JSX `Button`，`loading` / `disabled` 读内容组件的 `saving` / `canSubmit`）；成功回调用 `MessageUtil.success` 报「翻译完成，译文字段 N 项」或「翻译完成，没有可翻译的内容」，然后 `dialog.hide()` + `onApplied()`。
- 内容 `detail/modals/TranslateDialogContent.vue`：用通用单选控件 `@/components/RadioSelect.vue`（见 [ui/05](../ui/05-radio-select.md)）列出**全部**翻译插件，`options` = `{ label: name, value: id, disabled: !isPluginUsable(plugin), description: translatePluginHint(plugin) }`——不可用的置灰并把原因写在选项下方，插件多时可按名称 / 原因搜索；默认选中第一个可用的（与「自动选择」同口径）；`submit()` 调 `translateApi.item({ itemId, pluginId })`，失败把 `result.message` 显示在内容里 + `MessageUtil.error`；`defineExpose({ submit, saving, canSubmit })`。
- 翻译范围写在弹窗里：影片「标题、原名、简介、标签、片商、厂牌、系列、导演与演员名」，剧集再追加「剧集还包括每集的简介」。

### 3.3 译文的读与切

详情接口 `media:detail` 的返回体（`MediaDetailResult`）多了 `translation: MediaItemTranslation | null`，剧集的 `MediaSeasonRef.episodes[]` 每集也各带一份（只填 `overview`）：

- `loadMediaDetail()` 用 `getTranslation(itemId)`，剧集分支用 `listTranslations([...])` 一次批量取；
- 渲染层的切换条是 `detail/components/MediaTranslationBar.vue`（「原文 / 译文」两个 `t-radio-button` + 「译文语言：简体中文」+ 右侧「清除译文」），状态在 `detail/composables/useTranslationView.ts`（`showTranslation` / `hasTranslation` / `showing` / `languageLabel` / `setShowTranslation`，换条目自动回落原文）；
- 真正把译文叠上读模型的是 `detail/mediaDetailCells.ts` 的**纯函数** `translatedDetail(detail, showing)`：`showing` 为假或没有译文就原样返回；否则浅拷贝一份，按「译文非空才用译文」覆盖 `item.title`、`meta.{title,originalTitle,plot,maker,label,series,director}`、`meta.tags`、`actors[].name`、`seasons[].episodes[].overview`。两个数组**按位置对应**原文，长度不够就保持原文；**原文对象不被修改**。
- 详情页把它当「视图」用：`const view = computed(() => detail.value ? translatedDetail(detail.value, showing.value) : null)`，`useDetailView` / `useEpisodeSelection` 都读 `view`，「手动匹配」仍读原文。
- 「清除译文」调 `translate:clear`，成功提示「已清除译文」/「这条影视没有译文」后重读详情。**不做二次确认**：译文是派生物，重翻一次就回来。

## 4. 刮削后自动翻译

### 4.1 触发条件（三条同时满足）

1. `setting.translate.enabled === true`；
2. 资料库 `language` 非空（声明了内容语言）；
3. `language !== setting.targetLanguage`。

不满足就什么都不做。**注意第 2 条**：没在资料库里声明内容语言的库，即使开了翻译也不会自动翻（手动翻译不受影响）。

### 4.2 落点

自动翻译是**刮削收尾的一步**，不是流水线的内联步骤（翻译失败绝不能把刮削结果变成失败）：

- 影片：`scrapeFileJob.ts` 收尾（元数据、图片、演员名单都写完之后）；
- 剧集：`scrapeSeriesJob.ts` 收尾（剧集 / 季 / 集三层都写完之后）。

两处都调 `$main/translate/autoTranslate.ts` 的 `autoTranslateItem(itemId, libraryId, log)`：

- `shouldAutoTranslate(libraryId)` 判上面三条；
- 复用 `itemTranslate.ts` 的 `translateItem({ itemId })`（不传插件 = 走 `setting.translate.pluginId`，空则按插件页顺序取第一个可用的），剧集由它自己连带每一集；
- 条目已在翻译中（`isTranslating`）就跳过；
- **任何失败只 `log.warn` 并返回 `null`**。

成功时任务结果行（`ScrapeJobOutcome.message`）追加「已翻译成简体中文」。

## 5. 译文回写 NFO

### 5.1 开关与做法

`setting.translate.writeNfo`（默认 **开**）为真，且这次 NFO 确实写成功时，把刚写下的 NFO **就地打补丁**：读回文件 → 按标签名换正文 → 写回。

**为什么不重跑 `buildNfoXml`**：NFO 里还有图片标签与「刮削前位置」还原记录（`appendRestore`），重跑要重新推导这两样有状态的东西；按标签名换正文能逐字节保留其余内容，也不会毁掉其它工具写进去的未知标签。

实现在 `$main/translate/translateNfo.ts`：

- `patchNfoXml(xml, translation)`：依次换 `<title>` / `<originaltitle>` / `<plot>`（← `overview`）/ `<maker>` / `<label>` / `<series>` / `<director>`，再按顺序换 `<tag>*`（← `tags`，按位置）与 `<actor>` 块里的 `<name>*`（← `actors`，按位置）；译文没有的字段 / 数量不够的部分**保持原文**；`<studio>` / `<genre>` 不在译文模型里，不动。
- 替换用**函数式** replace（`(_match, open, close) => open + escapeXml(text) + close`）：译文里出现 `$1` 这类片段时不能被当成反向引用。
- `writeTranslatedNfo(client, { path, translation }, log)` / `writeTranslatedNfos(client, targets, log)`：后者串行写一批（剧集是「剧集 NFO + 每集 NFO」），返回成功份数；写失败只 warn，追加到任务结果行「N 个 NFO 已写入译文」。
- 剧集侧：剧集 NFO 只换它自己的字段；**每集 NFO 只换 `<plot>`**（集标题不翻译）。

### 5.2 私有标记与读侧防护

译文 NFO 里会多一行宿主私有标签（`src/common/types/scrape/nfo.ts`）：

```xml
<vaultscrape_translated>zh-CN</vaultscrape_translated>
```

`NFO_TRANSLATED_TAG` / `nfoTranslatedLine(language)` / `isTranslatedNfo(xml)` 三个导出与写入方共用这一份。Kodi / Jellyfin 会忽略未知标签，本机靠它认出「**这份 NFO 的正文是译文，不是原文**」。没有这一层，译文会被当成原文读回来：

- `scrapeLocalMeta.ts`：`readLocalNfo` 返回的 `LocalNfo` 多一个 `translated` 字段；`readLocalMeta` 在 `translated` 为真时**不把 NFO 当元数据**（`detail: null`），照旧联网取原文——但 NFO 仍然用于读还原记录，不会被丢掉；
- `mediaNfoScan.ts`：`readNfoOfKind` 在 `isTranslatedNfo(xml)` 时直接返回 `null`（扫描不把译文写进 `media_item`）。

## 6. IPC 与桥

| 通道 | 入参 | 出参 |
| --- | --- | --- |
| `translate:item` | `TranslateItemRequest { itemId, pluginId? }` | `TranslateResult<TranslateItemResult>` |
| `translate:clear` | `TranslateClearRequest { itemId }` | `TranslateResult<TranslateClearResult>` |

- 通道常量在 `src/preload/src/modules/translate/translateChannels.ts`（主进程用 `~` 别名引用，与其它域同款）；翻译插件自身的增删改查仍走 `plugin:translate:*`，本域不重复提供。
- 桥在 `src/preload/src/modules/translate/translate.ts`（`translateApi.item` / `translateApi.clear`，**返回信封不抛异常**），渲染层出口 `src/renderer/src/api/translate.ts`。
- 错误码（`src/common/types/translate/error.ts`）：`invalidItem` / `pluginMissing` / `pluginUnusable` / `busy` / `invokeFailed`，文案都是给用户看的成品句。**没有「未启用」这个码**——开关不影响手动翻译。

## 7. 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/common/types/translate/{index,request,result,error}.ts` | 读模型 `MediaItemTranslation`、IPC 入参 / 出参、错误码与文案 |
| `src/common/types/setting/translateSetting.ts` | `SettingTranslate`（`enabled` / `targetLanguage` / `pluginId` / `writeNfo`）与 `TRANSLATE_LANGUAGE_LABELS` |
| `src/common/types/scrape/nfo.ts` | 译文 NFO 的私有标记（`NFO_TRANSLATED_TAG` / `nfoTranslatedLine` / `isTranslatedNfo`） |
| `src/main/src/db/schema/translation.ts` + `repo/translationRepo.ts` | 译文表与读写 |
| `src/main/src/modules/translate/translatePlugins.ts` | 挑插件：`pickTranslatePlugin(preferredId)`（顺序 = 插件页顺序，只认 `isPluginUsable`） |
| `src/main/src/modules/translate/translateFields.ts` | 纯函数：从 `MediaItemRow` + 演员名单 + 库语言组装待翻译字段，以及把译文合并回读模型 |
| `src/main/src/modules/translate/itemTranslate.ts` | 编排：一条目 + 剧集逐集、字段级并发 3、条目级去重、译文入库 |
| `src/main/src/modules/translate/autoTranslate.ts` | 自动翻译的触发判定与失败兜底 |
| `src/main/src/modules/translate/translateNfo.ts` | NFO 打补丁与写回 |
| `src/main/src/modules/translate/translateIpc.ts` | 两个 IPC 通道 + 信封 |
| `src/renderer/src/windows/main/composables/useTranslatePlugins.ts` | 插件列表 / 可用集合 / 四态 / 原因提示 |
| `src/renderer/src/windows/main/pages/media/detail/modals/TranslateDialog{,Content}` | 手动翻译弹窗（外壳 + 内容） |
| `src/renderer/src/windows/main/pages/media/detail/components/MediaTranslationBar.vue` | 「原文 / 译文」切换条 + 清除译文 |
| `src/renderer/src/windows/main/pages/media/detail/composables/useTranslationView.ts` | 切换状态（换条目回落原文） |
| `src/renderer/src/windows/main/pages/media/detail/mediaDetailCells.ts` | `translatedDetail()` 纯函数（把译文叠到读模型上） |

## 8. 已知限制

- **没有批量翻译入口**：只有「详情页手动翻一条」与「刮削后自动翻一条」两条路。
- **逐字段调用**：插件契约只有单段文本的 `translate({ text, from?, to })`，没有批量接口也没有译文缓存，所以一条影片大约要发十来个插件请求（字段级并发 3）。
- **演员名只翻展示层**：`media_cast` 是按名字的弱关联，不能改名，所以译文里的演员名只在详情页演员条上生效。
- **集标题不翻译**：剧集只翻剧集本身的字段 + 每集简介。
- **`studio` / `genre` 不翻译**（译文模型里没有这两个字段）。
- **译文不参与搜索与排序**：墙面、搜索都读 `media_item`（原文）。
- **`writeNfo` 打开后，本机把这份 NFO 当作「正文是译文」**：本地优先重新刮削时会绕过它去联网取原文（这是刻意的，见 §5.2）。
- 翻译结果由外部站点产出，语言码映射与站点限制见 [09-translate-plugins.md](./09-translate-plugins.md)。

## 9. 手工验收清单（按 RL-07，验证由人来做）

1. 插件页加一个翻译插件并启用：详情页「更多 → 翻译」能打开弹窗、选中插件后字段变成译文，切换条出现且「原文 / 译文」可切、演员名与标签跟着切。
2. 一个翻译插件都没有 / 都没启用 / 都缺必填 key：三种结论文案分别出现，弹窗里不可用条目置灰并有原因。
3. 「清除译文」后回到原文、切换条消失；重进详情页仍是原文。
4. 资料库「内容语言」设为 `ja`、全局目标语言设为 `zh-CN`、开关打开：刮削完成后任务结果行出现「已翻译成简体中文」，不重刮也能在详情页切到译文。
5. 内容语言留「未指定」：刮削后**不**自动翻译。
6. `writeNfo` 打开时刮削：磁盘 NFO 的正文是译文，且带 `<vaultscrape_translated>`；关掉后 NFO 保持原文。
7. 译文 NFO 存在时重扫：`media_item` 的原文列不被译文覆盖。
