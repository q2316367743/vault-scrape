# 插件类别：影片信息 / 演员信息 / 翻译

插件按**类别（`kind`）彻底分开**：一种类别一套方法表、一套目录与索引、一套 IPC 通道、一个页面 tab。类别之间唯一的共享物是「同一份沙箱运行时与同一套环境变量机制」。

## 1. 为什么拆

拆分前只有一种「刮削插件」，把影片信息与演员资料写在同一个契约里，暴露了两个问题：

| 问题 | 具体表现 | 拆后 |
| --- | --- | --- |
| 必填项冲突 | 四个影片方法（`search` / `detail` / `covers` / `extras`）必填，于是「只能拿到演员资料、拿不到影片信息」的站点写不出插件 | 影片类与演员类各自有方法表：演员插件**不需要**实现任何影片方法，反之亦然 |
| 触发场景模糊 | 演员资料什么时候抓不清楚：影片刮削顺手抓？进演员页抓？ | 演员抓取归「演员信息插件」，四个触发场景明确（见第 5 节）；影片刮削只认「影片信息插件」 |

翻译功能尚未实现，但同样会是一种独立能力，所以本期**只预留 `translate` 类别**（方法表为空，只支持启停与环境变量配置），不实现任何翻译调用。

## 2. 三类契约一览

| `kind` | 界面标签 | 必需方法 | 可选方法 | 谁在调用 |
| --- | --- | --- | --- | --- |
| `movie` | 影片信息 | `search` / `detail` / `covers` / `extras` | — | 资料库刮削（`scrapeJobPlan.ts` / `scrapeRunner.ts`）、工具箱搜索页、资料库表单的「刮削器」候选 |
| `actor` | 演员信息 | `actor` | `actorAssets` | 演员抓取链路（`actorScrape.ts`）的四个触发场景 |
| `translate` | 翻译 | — | — | 暂无调用方（预留类别，任何调用都被 `invalidArgument` 拒绝） |

方法表是 `src/common/types/plugin/kind.ts` 里的 `PLUGIN_KIND_METHODS`：`{ required, optional, all }`。`all` 用 IPC 边界校验待测方法，`required` / `optional` 在编译期校验。**实现了别的类别的方法会被拒绝**，提示「…插件不能实现其它类别的方法：…，请拆成独立插件」——这是刻意的：一个脚本想包两份能力，就该拆成两个插件。

## 3. 目录与存储

| 内容 | 位置 |
| --- | --- |
| 类别清单 | `~/.vault-scrape/plugin/<kind>/plugins.json` |
| 类别源码 | `~/.vault-scrape/plugin/<kind>/<id>.js` |

`<kind>` 是 `movie` / `actor` / `translate` 三者之一（`pluginDir(kind)`）；索引、源码读写、缓存（id → 编译结果 + mtime）、加载错误都按类别各一份，所以**同一个 id 允许在不同类别里各存一份**，互不影响。

环境变量仍是 `safeStorage` 加密后存在该类别的 `plugins.json` 里（`safe:` / `plain:` 前缀逻辑不变），明文永不跨 IPC。

## 4. IPC 与 preload 桥

通道常量只有一份，在 `src/preload/src/modules/plugin/pluginChannels.ts`：`channelsOf(kind)` 生成 `` `plugin:${kind}:${action}` ``（`action` = `list` / `readCode` / `saveCode` / `import` / `remove` / `setEnabled` / `reorder` / `getEnv` / `saveEnv` / `invoke`），主进程 `pluginIpc.ts` 对三个类别各注册一套；另有只读的 `plugin:legacy`（旧版残留检查，见第 7 节）。

preload 桥按类别暴露：

```ts
pluginApi.movie      // PluginBridge + search / detail / covers / extras 四个 invoke 快捷方法
pluginApi.actor      // PluginBridge
pluginApi.translate  // PluginBridge
pluginApi.legacy()   // 只读：旧版平铺插件目录里的残留 .js
```

`PluginBridge` 是九项通用操作的集合（`list` / `readCode` / `saveCode` / `import` / `remove` / `setEnabled` / `reorder` / `getEnv` / `saveEnv`）。渲染层统一通过 `@/api` 的 `pluginApi` 与 `pluginBridge(kind)` 访问，不直接触碰 `window.preload`；`movie` 桥多出的四个快捷方法只有工具箱搜索页在用，`actor` / `translate` 桥不暴露无调用方的方法。

## 5. 演员抓取的四个触发场景

演员资料全部由**演员信息插件**产出（`actor` / `actorAssets`），四个入口共用同一条 `scrapeActor` 链路（只补空白字段、`locked` 只填空、`actorImageLimit` 上限、串行队列）：

| # | 场景 | 触发点 | 说明 |
| --- | --- | --- | --- |
| 1 | 影片入库后 | 刮削流水线第 7 步 `enqueueItemActorScrape`（`scrapeFileJob.ts`） | 受设置 `scrape.actorScrape` 控制，走串行队列 |
| 2 | 打开演员详情页 | `ActorDetailPage.vue` 的 `load()` 之后 | 受设置 `scrape.actorScrapeOnOpen`（默认开）控制；资料不全（没抓过 / 没头像 / 没生日）且未锁定才抓；**同一演员一次会话只试一次**（会话级 `Set` 去重），静默执行、失败不打扰 |
| 3 | 详情页「抓取资料」 | `ActorDetailPage.vue` 的 `onScrape` | 手动，立即执行 |
| 4 | 列表页「补全缺失资料」 | `scrapeMissingActors`（`actorScrape.ts`，上限 `ACTOR_SCRAPE_MISSING_LIMIT`） | 批量补全，走串行队列 |

`actorScrape.ts` 只取 actor 类别里「已启用且编译通过」的插件；插件列表由 `actorPlugins.listPluginSummaries()` 给出，调用走 `actorPlugins.invokePlugin(id, 'actor' | 'actorAssets', { actorName })`。影片刮削链路则只认 `moviePlugins`，两边不再共用一份插件列表。

## 6. 页面

侧栏仍只有**一个「插件」入口**（`/plugin`，`AppSide.vue` 里加了 `match: 'prefix'`，子页保持高亮），进入后是三个 tab 子路由：

```text
pages/plugin/
├── PluginHomePage.vue          # tab 条（值取自路由参数）+ 旧版残留提示 + <router-view>
├── components/                 # 三个类别共用
│   ├── PluginManagerView.vue   # 左列表 + 右详情（props: kind），不自带页头，导入流程与确认弹窗在这
│   ├── PluginList.vue          # 与类别无关；面板头放「刷新 / 导入」，事件上抛给管理视图
│   ├── PluginDetail.vue        # 概览 + 配置区块；`#extra` 插槽留给类别专属面板
│   ├── PluginConfigPanel.vue   # 环境变量填写
│   └── PluginLegacyAlert.vue   # 旧版平铺目录残留提示
├── composables/usePluginManager.ts   # usePluginManager(kind)：每个类别一份模块级状态
├── modals/                     # 源码编辑器弹窗（与类别无关）
├── movie/                      # 影片信息：MoviePluginPage.vue + 离线数据包面板
├── actor/                      # 演员信息：ActorPluginPage.vue
└── translate/                  # 翻译：TranslatePluginPage.vue
```

- 路由：`/plugin` 重定向到 `/plugin/movie`，子路由名分别是「影片信息插件」「演员信息插件」「翻译插件」；
- 「当前选中的插件」按类别分别持久化（`vault-scrape:plugin-active:<kind>`），工具箱搜索页与「影片信息插件」页共用同一份 movie 选择；
- 类别专属面板（当前只有内置插件的「离线数据包」）通过 `PluginDetail` 的 `#extra` 插槽注入，共用组件不感知具体类别；
- 离线数据包面板跟着「影片信息」搬到 `pages/plugin/movie/`。

## 7. 旧插件：不迁移，但会提示

类别是**必填**的，旧插件（没有 `meta.kind`）不再能加载或导入——没有自动迁移，请补上 `kind` 后重新导入。旧版把源码平铺在 `~/.vault-scrape/plugin/` 根下的那些 `.js` 不会被执行：主进程的 `legacyPluginFiles()` 只做只读探测，`plugin:legacy` 通道上报 `{ dir, files }`，插件页顶部据此显示一次警告条。

## 8. 关键文件

| 位置 | 职责 |
| --- | --- |
| `src/common/types/plugin/kind.ts` | 类别常量、标签 / 描述文案、方法表、`isPluginKind` |
| `src/common/types/plugin/define.ts` | `MoviePlugin` / `ActorPlugin` / `TranslatePlugin` 与 `PluginDefinition` 联合 |
| `src/main/src/modules/plugin/pluginStore.ts` | 按类别读写 `<kind>/plugins.json` 与 `<kind>/<id>.js`，另含旧版残留探测 |
| `src/main/src/modules/plugin/pluginRegistry.ts` | `createPluginRegistry(kind)` 工厂：每类一份缓存与加载错误 |
| `src/main/src/modules/plugin/pluginRegistries.ts` | `moviePlugins` / `actorPlugins` / `translatePlugins` 三个单例 |
| `src/main/src/modules/plugin/pluginImport.ts` | 导入预处理（编译、同批择优），按 `kind` 校验 |
| `src/main/src/modules/plugin/pluginIpc.ts` | 按类别注册三套通道 + `plugin:legacy` |
| `src/preload/src/modules/plugin/` | `channelsOf(kind)` 与 `pluginApi.{movie,actor,translate,legacy}` |
| `src/renderer/src/windows/main/pages/plugin/` | 插件页外壳与三个类别子页，见第 6 节 |
