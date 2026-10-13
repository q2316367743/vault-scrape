# 翻译插件：契约与三个现成站点

翻译是插件体系的**第三类能力**（`kind: 'translate'`）：给一段文本与目标语言，拿回译文。它与影片信息 / 演员信息在目录、IPC 通道、方法表上完全隔离（设计说明见 [03-plugin-categories.md](./03-plugin-categories.md)），唯一共享的是同一份 vm 沙箱运行时与同一套环境变量机制。

本文记录：翻译契约（§1）、三个已经落地的站点插件（§2、§3）、语言码映射与已知限制（§4）。三个插件都在 `script/translate/` 下，而 `script/` 被 gitignore，**本文是仓库内唯一的书面记录**。宿主侧（设置项、资料库内容语言、详情页手动翻译、刮削后自动翻译、译文入库与回写 NFO）见 [10-translate-integration.md](./10-translate-integration.md)。

## 1. 契约（`kind: 'translate'`）

```js
definePlugin({
  meta: { kind: 'translate', id, name, version, author?, description?, homepage? },
  env: [ /* 环境变量声明，见 01-plugin-module.md 第 7 节 */ ],
  translate: async (request, env, ctx) => ({ text: '译文' })
})
```

| 项 | 类型 | 说明 |
| --- | --- | --- |
| 入参 `request.text` | `string` | 待翻译文本；空白字符串在宿主侧就被拒（`invalidArgument`） |
| 入参 `request.from` | `'zh-CN' \| 'zh-TW' \| 'en' \| 'ja' \| 'ko'`，可选 | 源语言；**缺省表示自动检测**。宿主只透传这 5 种码，非法值当「自动检测」处理（不报错） |
| 入参 `request.to` | 同上，必填 | 目标语言；不是这 5 种码之一即 `invalidArgument` |
| 返回 `{ text }` | `PluginTranslateResult` | `text` 必须是非空字符串，否则宿主报 `invokeFailed`「插件返回的译文不合法（text 必填）」 |
| 其它方法 | — | 翻译类**必需方法只有 `translate` 一个**，没有可选方法；实现了别类方法会被 `invalidPlugin` 拒绝（提示拆成独立插件） |

类型定义在 `src/common/types/plugin/translate.ts`：`PluginTranslateRequest` / `PluginTranslateResult` / `PLUGIN_TRANSLATE_LANGUAGES` / `isTranslateLanguage()` / `normalizeTranslateResult()`；宿主语言码本身来自 `src/common/types/setting/translateSetting.ts` 的 `TRANSLATE_LANGUAGES`（设置页「翻译」面板的 `enabled` / `targetLanguage` 用的就是它）。

**语言码口径**：插件侧只用宿主的 5 种码，站点私有码（`zh` / `zt` / `to_lang` 之类）在插件内部映射，**不要把站点码漏到 `request` / 返回值里**——调用方只有宿主的 5 种码可填。

### 1.1 逐个调用的校验链与错误码

| 场景 | 错误码 | 文案 |
| --- | --- | --- |
| 插件没有实现 `translate` | `invalidPlugin` | 翻译插件缺少必需方法：translate |
| `text` 空白，或 `to` 不是 5 种语言码之一 | `invalidArgument` | 缺少待翻译文本 text 或目标语言 to |
| 插件返回的对象里 `text` 是空串 / 缺字段 / 返回了非对象 | `invokeFailed` | 插件返回的译文不合法（text 必填） |
| 插件内部 `throw new Error('…')` | `invokeFailed` | 插件 translate 执行失败：… |
| 单次调用超过 `PLUGIN_CALL_TIMEOUT_MS` | `timeout` | 插件 `<id>` 的 translate 调用超时（… 毫秒） |

调用前宿主会先查「插件是否启用」「声明的环境变量是否都填了」（缺一个就 `envMissing` 并列出字段名），再用 `ctx` 进沙箱执行；插件拿到的 `env` 是解密后的明文。

### 1.2 沙箱里的 `ctx`

与其它类别完全一致：`ctx.request({ url, method, headers, body })` 走主进程 HTTP 客户端（代理、超时、日志去重都复用，见 [../http/01-http-client.md](../http/01-http-client.md)），`ctx.log(level, message)` 写进插件日志。**没有 cookie jar、没有跨方法缓存、没有文件系统**——每次 `translate` 都是独立调用，需要缓存的插件自己在模块作用域里存。

### 1.3 怎么调

```ts
// 主进程（内部调用）
await translatePlugins.invokePlugin(id, 'translate', { text, to, from? })

// 渲染进程（preload 桥，`pluginApi.translate` 上多出的快捷方法）
await window.preload.pluginApi.translate.translate(id, { text, to, from? })
```

`invoke` 通道（`plugin:translate:invoke`）的入参是 `{ id, method: 'translate', text, from?, to }`。

| 关键文件 | 职责 |
| --- | --- |
| `src/common/types/plugin/translate.ts` | 翻译契约类型、语言码判定与返回值归一化 |
| `src/common/types/plugin/kind.ts` | `PLUGIN_KIND_METHODS.translate = { required: ['translate'], optional: [], all: ['translate'] }` |
| `src/main/src/modules/plugin/pluginRuntime.ts` | `buildTranslatePlugin()`（编译期校验 + 返回值归一化）、`PluginTranslateHandler` |
| `src/main/src/modules/plugin/pluginRegistry.ts` | `translateRequestOf()` 收窄 IPC 入参、`describeMissingArgument()` |
| `src/main/src/modules/plugin/pluginIpc.ts` | `readInvokePayload()` 读取 `text` / `from` / `to` |
| `src/preload/src/modules/plugin/plugin.ts` | `createTranslateBridge()` 暴露 `translate(id, request)` |

## 2. 三个现成站点插件

| 文件（`script/translate/`） | `meta.id` | 插件名 | 站点接口 | 鉴权 | 目标语言 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `uapis.js` | `uapis` | UAPI 翻译 | `POST /api/v1/translate/text?to_lang=` | 无需 | 5 种全支持 | 单次 ≤ 3000 字符；源语言只能自动检测 |
| `xxapi-ai-translate.js` | `xxapi-ai-translate` | XXAPI AI 智能翻译 | `GET /api/AIAutoTranslate?text=&to=&from=` | `accessKey` 必填 | 20+ 种（简繁分立） | 可用 `from` 指定源语言，也可交给站点识别 |
| `xxapi-sgtranslate.js` | `xxapi-sgtranslate` | XXAPI 搜狗中英互译 | `GET /api/sgtranslate?text=` | `accessKey` 必填 | 只认 `zh-CN` / `zh-TW` / `en` | **接口没有目标语言参数**，方向由站点按输入自动判断 |

导入方式：把 `script/translate/<id>.js` 拖进插件页「翻译」tab（或「导入」选择文件）。导入时宿主只执行一遍顶层代码读声明，**不发请求**；两个 XXAPI 插件导入后要在右栏配置区块填「接口密钥」（存在 `~/.vault-scrape/plugin/translate/plugins.json`，safeStorage 加密），否则调用时命中 `envMissing`。

三个插件共同的写法约定（与既有影片 / 演员插件一致）：`meta.id` 必须等于文件名；错误一律 `throw new Error('中文说明')`；只在必要处 `ctx.log`；不写顶层副作用。

## 3. 逐站口径

### 3.1 `uapis.js` —— UAPI 多语言文本翻译

- 接口：`POST https://uapis.cn/api/v1/translate/text?to_lang=<码>`，请求体 `{"text":"…"}`，**无任何鉴权**；
- 返回 `{"translate":"译文","text":"原文"}`；`400` 是请求体或语言码非法、`500` 是上游翻译失败，两者都把站点的 `message` 拼进中文错误，其它状态码只报 HTTP 码；
- 本地先做长度校验：超过 `UAPIS_TEXT_LIMIT = 3000` 字符直接报错，不发请求；
- **接口没有 `from` 参数**，源语言由站点自动检测：入参带了 `from` 时只写一条 debug 日志说明被忽略；
- 环境变量只有可选的 `baseUrl`（默认 `https://uapis.cn/api/v1`）。

### 3.2 `xxapi-ai-translate.js` —— XXAPI「AI 多语言自动翻译」

- 接口：`GET https://v2.xxapi.cn/api/AIAutoTranslate?text=&to=&from=`，鉴权走请求头 `Authorization: Bearer <accessKey>`；
- `text` / `to` 必填，`from` 可选；**宿主没给 `from` 时插件不带这个参数**，交给站点自动识别；
- 返回 `{"code":200,"msg":"数据请求成功","data":"译文","request_id":"…"}`：`code !== 200` 时用 `msg` 拼中文错误；`request_id` 写进 debug 日志，向站点报障时要用；
- 环境变量：`accessKey`（必填，label「接口密钥」）+ 可选 `baseUrl`（默认 `https://v2.xxapi.cn`）。

### 3.3 `xxapi-sgtranslate.js` —— XXAPI「搜狗多语言自动翻译」

这个站点的能力**比宿主契约窄**，是三个插件里唯一需要「降级承诺」的一个：

- 接口：`GET https://v2.xxapi.cn/api/sgtranslate?text=`，鉴权同上；**只有 `text` 一个参数，没有 `to`、也没有 `from`**；
- 翻译方向由站点按输入判断（中文进 → 英文出，英文进 → 中文出），插件无法指定输出语言，因此：
  - `SOGOU_TARGETS = ['zh-CN', 'zh-TW', 'en']`，`to` 是 `ja` / `ko` 时直接 `throw`「XXAPI 搜狗互译只做中英互译，不能翻译成 …：请改用其它翻译插件。」；
  - `to === 'zh-TW'` 只写一条 `warn` 日志（「无法保证产出繁体中文」），不报错——站点给什么就用什么；
  - `from` 与 `to` 都写进 debug 日志，方便排查「方向不符预期」；
- 返回信封与 AI 版一致（`code` / `msg` / `data`），但没有 `request_id`；
- 环境变量：`accessKey`（必填）+ 可选 `baseUrl`。

### 3.4 语言码映射矩阵

| 宿主码 | uapis `to_lang` | XXAPI AI `to` | XXAPI 搜狗 |
| --- | --- | --- | --- |
| `zh-CN` | `zh` | `zh`（简体中文） | ✅ 方向自动判断 |
| `zh-TW` | `zh-TW` | `zt`（繁体中文） | ⚠️ 只 warn，不保证繁体 |
| `en` | `en` | `en` | ✅ 方向自动判断 |
| `ja` | `ja` | `ja` | ❌ 抛中文错误 |
| `ko` | `ko` | `ko` | ❌ 抛中文错误 |

XXAPI AI 版实际还支持 `ar` / `az` / `bg` / `cs` / `da` / `de` / `el` / `es` / `fa` / `fi` / `fr` / `he` / `hi` / `hu` / `id` / `it` / `lt` / `lv` / `ms` / `nl` / `pl` / `pt` / `ro` / `ru` / `sk` / `sl` / `sq` / `sv` / `th` / `tl` / `tr` / `uk` / `ur` 等，UAPI 支持 100+ 种；**但宿主契约只开放 5 种**，要放开得先扩 `TRANSLATE_LANGUAGES`。

## 4. 已知限制与未做

- **调用方已经接上**：设置页「翻译」面板（开关 / 目标语言 / 指定插件 / 写入 NFO）与资料库的「内容语言」（`MediaLibrary.language`）决定「刮削完成后要不要自动翻」，详情页「更多 → 翻译」是手动入口——宿主侧的数据流、IPC 与译文存储见 [10-translate-integration.md](./10-translate-integration.md)，**本文只管插件契约与三个站点的差异**；
- 三家站点都**不返回检测到的源语言**，无法把「实际识别到什么语言」回填给调用方；
- 插件不做任何二次加工：不修剪译文首尾空白、不拼接、不保留原文里的标记 / 换行结构；
- 没有译文缓存、没有批量翻译接口（一次 `translate` 只处理一段文本）；
- XXAPI 两个插件依赖用户的 `accessKey`（付费套餐 / 免费额度按站点策略），密钥无效或欠费会在 `code` 里体现；
- 三个插件只做过静态审查，**未跑真实网络请求**（按 RL-07 由用户验证）；站点若改响应结构，插件会在中文错误里带出原始 `msg` / `code` 方便定位。
