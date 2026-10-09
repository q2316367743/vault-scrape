# 刮削插件模块

站点适配逻辑（搜索、详情、封面、花絮）从主程序剥离为**本机 JS 脚本**：用户可导入、编辑、启停、测试，插件只负责「产出数据与下载配置」，真正的下载与落盘由后续调度器实现。插件声明的环境变量统一在**插件页右栏的配置区块**填写。

## 1. 为什么是 JS 脚本而不是 WASM

| 维度 | JS 脚本（采纳） | WASM（暂不采纳） |
| --- | --- | --- |
| 构建链路 | 无，直接 `new vm.Script(src)` 执行 | 需要 Rust/Go 工具链与 wasm 编译流水线，与本项目「只跑 typecheck、不引入构建步骤」冲突 |
| 性能收益 | 刮削瓶颈在网络 IO，脚本只做 HTML 解析 | 算力无实际收益 |
| 网络能力 | 复用主进程 axios，天然支持自定义 UA / Referer / Cookie | 需要在 WASM 侧重写 HTTP 或定义 ABI 桥接 |
| HTML 解析 | 宿主注入 cheerio | 需在 WASM 侧重实现选择器 |
| 调试 | 报错带真实堆栈，可直接定位插件行号 | 堆栈需额外符号映射 |
| 威胁模型 | 插件是用户本机导入的可信脚本，需要的是「稳定性隔离」（别把主进程搞崩）而非「防恶意」 | 更强的沙箱，但超出本期需要 |

结论：本期采用 JS 脚本，宿主边界收敛为「JSON 进 JSON 出」的插件契约；将来若需要更强隔离，可在同一契约下追加第二个 WASM 执行器。

> ⚠️ `node:vm` **不是安全边界**。它只做防呆（不给 `require` / `process` / `fetch`）与异常兜底；恶意脚本仍可能通过长同步循环阻塞主进程。彻底隔离（`utilityProcess` 独立子进程）列为后续项。

## 2. 插件契约

文件插件脚本是**纯 JS**（没有 `import` / `require` / TypeScript），顶层调用一次 `definePlugin(...)`（内置插件不走这条契约，见 2.4 节）：

```js
definePlugin({
  meta: { id, name, version, author?, description?, prefixes?, homepage? },
  env?: [ /* 环境变量声明，见第 7 节 */ ],
  search(keyword, env, ctx): Promise<PluginMovieCandidate[]>,
  detail(movieId, env, ctx): Promise<PluginMovieDetail>,
  covers(movieId, env, ctx): Promise<PluginAsset[]>,
  extras(movieId, env, ctx): Promise<PluginAsset[]>
})
```

- `meta.id` 必须是 kebab-case（`/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/`），同时是源码文件名 `<id>.js`；
- 四个方法缺一不可，缺失即 `invalidPlugin`，源码不会落盘；
- 脚本「以 `definePlugin(...)` 结尾」和「没有返回值但调用过 definePlugin」两种写法都支持（宿主同时记录调用槽与顶层完成值）；
- 四个方法的第二个参数都是 `env`：插件自己声明、用户在插件页配置区块填写的环境变量取值（已解密为明文，只在沙箱内），具体见第 7 节。

### 2.1 返回类型（`@common/types/plugin`）

```ts
interface PluginMovieCandidate {
  id: string
  title: string
  num?: string
  cover?: string
  date?: string
  /** 可选：搜索阶段拿得到演员就填（离线内置插件会填），拿不到时由 detail 的 actors 提供 */
  actors?: string[]
  isSeries?: boolean
  episodeCount?: number
}

interface PluginMovieDetail {
  id: string
  title: string
  num?: string
  originalTitle?: string
  plot?: string
  actors?: string[]
  maker?: string
  label?: string
  studio?: string
  series?: string
  director?: string
  releaseDate?: string
  duration?: number
  tags?: string[]
  episodes?: PluginEpisode[]
}

interface PluginEpisode {
  id?: string
  index: number
  title?: string
  duration?: number
  releaseDate?: string
}
```

字段口径与命名模板占位符一致（`num` / `maker` / `label` / `series` / `actors` / `duration` 等），方便后续直接拼装文件名。

### 2.2 资源返回「下载配置」而不是裸链接

封面与花絮常有防盗链，必须带上特定 UA / Referer / Cookie，所以每一项返回的是**链接 + 请求方法 + 请求头**：

```ts
type PluginAssetKind = 'thumb' | 'poster' | 'fanart' | 'still' | 'trailer'

interface PluginAsset {
  kind: PluginAssetKind
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  name?: string
  episode?: { id?: string; index: number; title?: string }
}
```

- `covers()` 只产出**封面类**（`poster` / `thumb` / `fanart`），`extras()` 只产出**花絮类**（`still` / `trailer`）；越界的 kind 会被宿主丢弃；
- 剧集花絮用 `episode` 标注归属（第几集），单集花絮的视频同样可以下载；
- 插件**对下载开关零感知**，宿主按 `kind` 与下载设置做过滤：

| kind | 中文 | 对应下载设置项 | 归属 |
| --- | --- | --- | --- |
| `thumb` | 横版缩略图 | `download.downloadThumb` | 封面 |
| `poster` | 海报 | `download.downloadPoster` | 封面 |
| `fanart` | 背景图 | `download.downloadFanart` | 封面 |
| `still` | 剧照 | `download.downloadStill` | 花絮 |
| `trailer` | 预告片 | `download.downloadTrailer` | 花絮 |

工具箱搜索页的影片详情抽屉会按当前下载设置给每一行标注「会下载 / 当前不下载」，便于在真正下载前核对防盗链信息是否齐全。

### 2.3 安装即执行：在沙箱里读取环境变量声明

「安装」包括**导入脚本**（`plugin:import`）与**保存源码**（`plugin:saveCode`），两者都在写盘前走同一条校验链：

1. `new vm.Script(source)` 解析语法，失败即 `evalFailed`，不落盘；
2. 在 `node:vm` 沙箱里**执行一次顶层代码**（超时 5 秒），拿到 `definePlugin(...)` 的返回值；
3. 校验 `meta` 与四个方法，缺失即 `invalidPlugin`；
4. 读取 `env` 数组并归一化（丢弃非法项、截断超量、去重），把结果缓存进 `plugins.json` 的 `envFields`；
5. 只有以上全部通过才写盘；声明表随之出现在插件页右栏的配置区块，由用户填写取值。

因此**安装插件不需要联网、也不会调用四个方法**：顶层代码里除了 `definePlugin(...)` 之外最好不要做别的事（不要在顶层发请求、不要在顶层读环境变量——那时用户还没填）。插件列表渲染直接用缓存里的 `envFields`，不重新编译；源码被外部编辑后按 mtime 自动重编译并刷新声明。

> 兼容：早期示例把声明写成 `config: [...]` 仍然可用，但会写一条 `warn` 日志提醒改名为 `env`。

**批量导入与同名去重（同名只保留最新）**

`plugin:import` 一次可选择多个 `.js` 文件；主进程按 `meta.id`（不是 `meta.name`）判定「同名」，同一批文件在落盘前先择优，全程只有一个版本会被写入：

1. 先比 `meta.version`（按 `.` 分段、逐段取前导数字比较，缺失段按 0，因此 `1.0.0-beta` 与 `1.0.0` 视为相同），版本高者胜；
2. 版本相同时比源文件 mtime，较新者胜；两者都相同则由先选中的文件胜出；
3. 批内落选的文件不落盘，进 `PluginImportResult.skipped`，提示「同批中已保留更新的版本 v…」；
4. 胜者再与本机已安装记录比较：版本更高 → 自动覆盖，且 store 保留原有的 `enabled` 与已保存的环境变量密文；版本更低 → 跳过并提示「本机已安装更新的版本 v…」；版本相同且未开启 `overwrite` → 仍以 `duplicate` 失败，由渲染层确认后重试；
5. 内置插件不参与版本比较，同名导入一律由 store 抛 `unsupported`。

`skipped` 是**非错误**语义（旧版本被有意保留），与 `failed` 分开返回：渲染层只用 `info` 提示「已跳过 N 个旧版本插件」，不计入导入失败数，也不触发覆盖确认框。

### 2.4 插件来源：文件插件与内置插件

`PluginSummary.source` 区分两种来源，插件列表 / 插件详情 / 工具箱的搜索页共用：

| `source` | 说明 | 源码文件 | 编辑 / 删除 |
| --- | --- | --- | --- |
| `file` | 用户导入或保存的 JS 脚本，落盘在 `~/.vault-scrape/plugin/<id>.js` | 有 | 允许 |
| `builtin` | 宿主内置实现（当前只有 `r18-offline`「R18 离线数据包」），`plugins.json` 里有记录但**没有源码文件** | 无 | 禁止：`plugin:readCode` → `notFound`，`plugin:saveCode` / 同名导入覆盖 / 删除 → `unsupported` |

内置插件与文件插件共用同一套入口：出现在列表里、可启停、可被工具箱的搜索工具调用、走同一个 `plugin:invoke`；区别只是宿主在命中内置 id 时**直接调用其实现**（不编译、不校验环境变量）并跳过源码读写。内置插件不声明环境变量（`env: []`），因此详情里不出现配置区块。内置插件由主进程在启动 / 列表 / 调用前幂等补齐进索引，元信息没变就不写盘。契约与细节见 [02-builtin-offline-plugin.md](./02-builtin-offline-plugin.md)。

## 3. 插件上下文 `ctx`

插件方法的完整签名是 `(入参, env, ctx)`。`env` 是环境变量取值，`ctx` 才是宿主能力：

```ts
type PluginEnvValue = Record<string, string>

interface PluginContext {
  request: (options: PluginRequestOptions) => Promise<PluginResponse>
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, detail?: string) => void
}

interface PluginRequestOptions {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeout?: number
}

interface PluginResponse {
  status: number
  headers: Record<string, string>
  data: string
}
```

- `env` 已合并敏感项明文，并且在调用前完成必填校验；插件只需直接读，例如 `const base = String(env.baseUrl || '')`；
- `ctx.request` 只接受 `http(s)` 地址，`validateStatus: () => true`——宿主只负责传输，状态码由插件自己判断；
- `ctx.log` 落到日志表的 `plugin:<id>` scope，可在「日志」页查看。

### 3.1 沙箱白名单（仅此，其他全局对象一律不存在）

`definePlugin`、`console`（转发到日志表）、`cheerio` 命名空间、`$ = cheerio.load(html)`、`setTimeout` / `clearTimeout` / `queueMicrotask`、`URL` / `URLSearchParams`、`TextEncoder` / `TextDecoder`、`atob` / `btoa`。

**不注入**：`process`、`require`、`module`、`globalThis.fetch`、`Buffer`、`__dirname`；`vm.Script` 未开启 `importModuleDynamically`，所以 `import()` 也不可用。插件想联网只能走 `ctx.request`。

### 3.2 宿主 HTTP 行为

- 超时：`max(1000, options.timeout ?? network.timeout * 1000)`；
- 重试：按网络设置的 `retryCount` 重试，间隔 300ms（`invalidArgument` 不重试）；
- 限速：两次插件请求之间至少间隔 `scrape.requestDelay` 秒（模块级串行，`concurrency` 归后续调度器）；
- 代理：已接入。请求经 `src/main/src/modules/http/httpClient.ts` 的共享实例发出，由请求拦截器按最新网络设置注入 http/https 代理；`socket5` 暂不支持，会回落直连并写一条 `warn`，详见 [../http/01-http-client.md](../http/01-http-client.md)。
- 字符集：`ctx.request` 以 `arraybuffer` 取回原始字节后自行解码，顺序为「响应头 `content-type` 的 `charset`」→「正文前 64KB 内 `<meta>` 声明的 `charset`」→「UTF-8 兜底」，因此 `euc-jp`、`shift_jis` 等站点（如 `h0930` / `h4610`）的日文不会变成乱码；字符集标签无法识别时回落 UTF-8 并继续，不会抛错。

## 4. 执行与超时

- 编译：`new vm.Script(source, { filename: '<id>.js' })`，语法错误 → `evalFailed`；
- 顶层执行：`script.runInContext(ctx, { timeout: 5000, displayErrors: true })`，超时 → `timeout`；
- 方法调用：`max(30_000, network.timeout * (retryCount + 1) * 1000 + 5000)` 毫秒，超时只让宿主立刻拿到 `timeout`，**不会中断**插件里已经跑起来的同步代码——所以插件不要写长同步循环；
- 同步抛错与异步 reject 统一收敛为 `invokeFailed`，原始 message 回渲染层，完整堆栈写入日志；
- 源码按 mtime 缓存编译结果：文件被外部改动后自动重新编译。

## 5. 存储与安全

| 内容 | 位置 |
| --- | --- |
| 插件清单 | `~/.vault-scrape/plugin/plugins.json`（`{ version: 1, plugins: StoredPlugin[] }`） |
| 插件源码 | `~/.vault-scrape/plugin/<id>.js` |

- 单个源码文件上限 1 MB；
- 同名覆盖导入（版本更高时自动触发，或确认 `overwrite: true`）只更新元信息、`envFields` 与源码文件，**保留**原有的 `enabled` 与 `envValues`（已保存的环境变量密文不丢）；
- 清单里 `plugins` 数组的顺序就是插件列表的展示顺序：插件页拖拽排序后经 `plugin:reorder` 以完整 id 列表写回 `plugins.json`，顺序未变化时不写盘；
- 内置插件在清单里以 `builtin: true` 记录（`toPluginSummary` 据此给出 `source` 与空的 `filePath`），没有 `<id>.js`，store 层同时拒绝覆盖与删除；
- 环境变量一律按敏感值处理：先 `safeStorage` 加密再写入清单（`plugins.json` 的 `envValues` 存 `safe:` 前缀密文），系统钥匙串不可用时回落 `plain:` + base64 并写 `warn` 日志。编解码统一在 `src/main/src/utils/secretCodec.ts`，与文件模块的连接密码共用；
- **环境变量明文永不跨 IPC**：`plugin:getEnv` 只返回声明表 `fields` 与「是否已填写」掩码 `filled`，不回读任何取值；
- 清单读取失败时回落空列表并写 `error` 日志，不影响应用启动；单个插件加载失败只体现在摘要的 `loadError` 上（列表标红），不阻塞其他插件。

环境变量保存约定（与文件模块的密码一致）：草稿只提交本次填写的项，缺省或空串表示「保持已保存的值」。

## 6. IPC 通道

通道常量定义在 `src/preload/src/modules/plugin/pluginChannels.ts`，preload 桥与 main handler 共用。全部返回 `PluginResult` 信封，**绝不跨 IPC 抛异常**。

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `plugin:list` | — | `PluginSummary[]` |
| `plugin:readCode` | `{ id }` | `string` |
| `plugin:saveCode` | `{ id, code }` | `PluginSummary`（先编译校验通过才落盘） |
| `plugin:import` | `{ overwrite }` | `PluginImportResult`（主进程弹出系统文件选择框，可多选 `.js`；结果为 `imported` / `skipped` / `failed` 三组，同名只保留最新，见 §2.3） |
| `plugin:remove` | `{ id }` | `boolean` |
| `plugin:setEnabled` | `{ id, enabled }` | `PluginSummary` |
| `plugin:reorder` | `{ ids }` | `PluginSummary[]`（按传入顺序重排；未出现的 id 保持原有相对顺序追加到末尾） |
| `plugin:getEnv` | `{ id }` | `PluginEnvSnapshot`（`fields` + `filled`，无明文） |
| `plugin:saveEnv` | `{ id, draft }` | `PluginSummary` |
| `plugin:invoke` | `{ id, method, keyword?, movieId? }` | `PluginMovieCandidate[]` / `PluginMovieDetail` / `PluginAsset[]` |

渲染层只通过 `@/api` 的 `pluginApi`（= `window.preload.plugin`）访问，不直接触碰 `window.preload`。

## 7. 环境变量声明

插件在这里声明「运行需要哪些参数」，安装 / 保存时宿主在沙箱里执行脚本读出这份表，并据此生成填写表单：

```ts
interface PluginEnvField {
  key: string          // /^[A-Za-z0-9_-]+$/
  label: string
  required?: boolean
  placeholder?: string
  description?: string
}
```

- 取值最终以第二个参数 `env`（`Record<string, string>`）传给插件方法；
- 最多 50 项，非法项直接丢弃（插件仍可加载，只是少了变量）；
- 没有类型概念：账号类参数（站点地址、Cookie、Token…）都是文本，统一渲染成**多行文本域**；
- 填写入口在**插件页右栏的配置区块**（`pages/plugin/components/PluginConfigPanel.vue`）：按选中插件渲染多行文本域，一个插件一个「保存」，已保存的值不回显（占位提示「已保存，留空表示保持不变」）；只有在插件声明了环境变量（`hasEnv`）时才渲染这个区块，内置插件与没写 `env` 的脚本插件都不会看到空区域；
- `required` 的项未填写时 `envReady` 为 false，界面显示「待填写变量」；此时调用直接失败：`envMissing`，提示缺失项的名称。

## 8. 错误码

| 错误码 | 含义 |
| --- | --- |
| `notFound` | 插件/文件不存在 |
| `duplicate` | 导入时 ID 已存在**且版本相同**、又未传 `overwrite: true`（版本更高的文件会自动覆盖，版本更低的进 `skipped`，都不报此错） |
| `invalidPlugin` | 没有 `definePlugin`、`meta` 不合法、缺少四个方法之一 |
| `invalidArgument` | 参数缺失或类型不合法（如非 http(s) url、空 keyword） |
| `unsupported` | 当前环境不支持的操作 |
| `evalFailed` | 源码语法错误或顶层执行抛错 |
| `timeout` | 顶层执行或方法调用超时 |
| `invokeFailed` | 插件方法抛错（含已停用、请求失败） |
| `envMissing` | 必填环境变量未填写 |
| `offlineMissing` | 尚未安装离线数据包（内置插件专用） |
| `offlineBusy` | 已有离线数据包任务在进行中 |
| `offlineCorrupt` | 离线数据包已损坏，请重新导入 |
| `offlineCheckFailed` | 检查离线数据包更新失败 |
| `io` | 插件文件读写失败 |
| `unknown` | 未归类错误 |

失败模式与处理：

- 保存被拒 → 不落盘，编辑弹窗保持打开；
- ID 重名且**版本相同** → `duplicate` → 渲染层弹确认框 → `overwrite: true` 重试；
- 导入的文件版本更旧，或同一批里不是最新 → 不落盘，进 `skipped`，渲染层以 `info` 提示「已跳过 N 个旧版本插件」；
- 数据畸形/超量 → 归一化层逐字段校验，非法项丢弃，单项上限 500 条并写 `warn` 日志。

## 9. 关键文件

| 位置 | 职责 |
| --- | --- |
| `src/common/types/plugin/` | 三端共享的纯类型与纯函数（契约、归一化、环境变量声明校验、错误码、信封） |
| `src/main/src/modules/plugin/pluginStore.ts` | `plugins.json` 落盘（含顺序重排）、源码读写、safeStorage 加解密接入 |
| `src/main/src/modules/plugin/pluginRuntime.ts` | vm 沙箱编译、方法调用与超时 |
| `src/main/src/modules/plugin/pluginHost.ts` | `ctx` 构造：共享 http 客户端请求（超时 / 重试 / 限速）、cheerio 注入、日志桥（环境变量不经 ctx） |
| `src/main/src/modules/plugin/pluginRegistry.ts` | 内存缓存（id → 编译结果 + mtime）、摘要、导入/删除/启停/排序/环境变量/调用入口 |
| `src/main/src/modules/plugin/pluginIpc.ts` | IPC 注册与信封转换（唯一转换点），系统文件选择框 |
| `src/main/src/modules/plugin/builtinPlugins.ts` | 内置插件定义与实现（当前仅 `r18-offline`，见 [02-builtin-offline-plugin.md](./02-builtin-offline-plugin.md)） |
| `src/main/src/utils/secretCodec.ts` | safeStorage 编解码，插件与文件连接配置共用 |
| `src/preload/src/modules/plugin/` | 通道常量与 `pluginApi` 桥 |
| `src/renderer/src/windows/main/pages/plugin/` | 插件页：列表（`PluginList.vue`，透明左栏，sortablejs 拖拽重排、整行可拖）、详情（`PluginDetail.vue`：概览 + 配置区块 + 启停）、配置区块（`PluginConfigPanel.vue`：环境变量，仅 `hasEnv` 时渲染）、源码编辑器弹窗（`modals/`） |
| `src/renderer/src/windows/main/pages/tools/` | 工具箱：索引页在根（`ToolsPage.vue` + `toolRegistry.ts`），子路由各自成目录——搜索工具在 `search/`（`ToolSearchPage.vue` 用 `SubPageLayout`：标题左侧返回图标 + 选插件 + 两个入口），影片详情抽屉在 `search/modals/`（`MovieDetailDrawer.tsx` + `MovieDetailDrawerContent.vue`，状态在 `search/composables/useMoviePreview.ts`） |

## 10. 完整示例插件

保存为 `~/.vault-scrape/plugin/example-site.js` 后可在插件页导入（本文件即导入源）。

```js
definePlugin({
  meta: {
    id: 'example-site',
    name: '示例站点',
    version: '1.0.0',
    author: 'you',
    description: '演示插件契约：搜索 / 详情 / 封面 / 花絮',
    prefixes: ['ABC']
  },
  env: [
    {
      key: 'baseUrl',
      label: '站点地址',
      required: true,
      placeholder: 'https://example.com',
      description: '不要带结尾斜杠'
    },
    {
      key: 'cookie',
      label: '登录 Cookie',
      required: false,
      description: '系统钥匙串加密保存在本机，界面不回显明文'
    }
  ],

  async search(keyword, env, ctx) {
    const base = String(env.baseUrl || '')
    const response = await ctx.request({
      url: `${base}/search?q=${encodeURIComponent(keyword)}`,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Cookie: String(env.cookie || '')
      }
    })
    if (response.status !== 200) {
      ctx.log('warn', `搜索返回状态码 ${response.status}`)
      return []
    }
    const $page = $(response.data)
    const items = []
    $page('.movie-item').each((_, element) => {
      const $item = $page(element)
      const id = $item.attr('data-id')
      if (!id) return
      items.push({
        id: id,
        title: $item.find('.title').text().trim(),
        num: $item.find('.num').text().trim(),
        cover: $item.find('img').attr('src') || '',
        isSeries: $item.find('.badge-series').length > 0
      })
    })
    return items
  },

  async detail(movieId, env, ctx) {
    const base = String(env.baseUrl || '')
    const response = await ctx.request({ url: `${base}/movie/${movieId}` })
    const $page = $(response.data)
    return {
      id: movieId,
      title: $page('h1.title').text().trim(),
      num: $page('.num').text().trim(),
      plot: $page('.plot').text().trim(),
      maker: $page('.maker').text().trim(),
      releaseDate: $page('.date').text().trim(),
      duration: Number($page('.duration').attr('data-minutes') || 0),
      actors: $page('.actor')
        .map((_, element) => $page(element).text().trim())
        .get(),
      episodes: $page('.episode')
        .map((index, element) => ({
          index: index + 1,
          title: $page(element).text().trim()
        }))
        .get()
    }
  },

  // 封面类：海报 + 缩略图，带上防盗链需要的 Referer
  async covers(movieId, env, ctx) {
    const base = String(env.baseUrl || '')
    const response = await ctx.request({ url: `${base}/movie/${movieId}` })
    const $page = $(response.data)
    const headers = {
      Referer: `${base}/movie/${movieId}`,
      'User-Agent': 'Mozilla/5.0'
    }
    const assets = []
    const poster = $page('.poster img').attr('src')
    if (poster) assets.push({ kind: 'poster', url: poster, headers: headers })
    const thumb = $page('.thumb img').attr('src')
    if (thumb) assets.push({ kind: 'thumb', url: thumb, headers: headers })
    return assets
  },

  // 花絮类：剧照（按集归属）+ 预告片
  async extras(movieId, env, ctx) {
    const base = String(env.baseUrl || '')
    const response = await ctx.request({ url: `${base}/movie/${movieId}/extras` })
    const $page = $(response.data)
    const headers = { Referer: `${base}/movie/${movieId}`, 'User-Agent': 'Mozilla/5.0' }
    const assets = []
    $page('.still').each((index, element) => {
      const url = $page(element).attr('src')
      if (!url) return
      assets.push({
        kind: 'still',
        url: url,
        name: `${movieId}-still-${index + 1}.jpg`,
        headers: headers,
        episode: index > 0 ? { index: index } : undefined
      })
    })
    const trailer = $page('video source').attr('src')
    if (trailer) {
      assets.push({ kind: 'trailer', url: trailer, name: `${movieId}-trailer.mp4`, headers: headers })
    }
    return assets
  }
})
```

## 11. 本期不做（后续项）

- 刮削调度器 / 真正的下载器 / 图片角标 / NFO 生成 / 命名落盘（本期只产出并展示下载配置）；
- 在线插件仓库与远程更新（只支持本机目录导入）；
- SOCKS5 代理支持（需引入 `socks-proxy-agent`；http/https 代理已接入，见 [../http/01-http-client.md](../http/01-http-client.md)）；
- 插件多文件打包、TypeScript 插件、代码编辑器语法高亮；
- 子进程级隔离（`utilityProcess`）。
