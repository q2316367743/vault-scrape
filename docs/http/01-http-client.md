# HTTP 客户端模块（主进程）

## 1. 职责与边界

主进程所有「直连外网」的请求统一走这个模块，让设置里的网络配置（代理、超时）成为唯一事实来源。

- 对外只导出一个东西：`httpClient`（`axios.create()` 得到的单例实例）；
- 代理是否注入、超时兜底多少，全部在**请求拦截器**里按最新设置决定，改设置立即生效，无需重建实例；
- 不做重试、不做限速、不限制状态码：重试与失败语义归调用方（如插件域自己按 `retryCount` 重试）；
- 不覆盖调用方显式传入的 `timeout`。

## 2. 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/main/src/modules/http/httpClient.ts` | axios 单例、请求拦截器、代理地址解析与告警去重 |

无 IPC、无 preload、无渲染层改动。

## 3. 代理注入规则

拦截器每次请求都执行 `loadSetting().network`（内存缓存、同步、零磁盘 IO），把结果换算成 axios 的
`AxiosProxyConfig`（`{ protocol, host, port, auth? }`）写进 `config.proxy`。

| 设置状态 | 行为 |
| --- | --- |
| `proxyEnabled: false` | `config.proxy = false`（显式直连） |
| 启用但 `proxyHost` 为空 | 直连 + 一条 warn |
| `proxyHost` 形如 `127.0.0.1:7890` | 按 `proxyType` 补协议前缀后解析 |
| `proxyHost` 形如 `https://127.0.0.1:7890` | **前缀优先于 `proxyType`** |
| `proxyHost` 含 userinfo（`user:pass@host:port`） | 转成 `proxy.auth`，用户名/密码 `decodeURIComponent` |
| `proxyType: 'socket5'` 或前缀 `socks5://` / `socks://` | 不支持 → 直连 + 一条 warn |
| 地址无法解析、协议未知、端口缺失或不在 1–65535 | 直连 + 一条 warn |

解析用 `new URL()`：没有 `scheme://` 前缀时补 `${proxyType}://` 再解析，因此端口必须显式书写。

### 3.1 为什么 socket5 不支持

axios 的 `proxy` 配置只处理 HTTP/HTTPS 代理；SOCKS 需要 `socks-proxy-agent` 之类的 agent，仓库当前没有该依赖。
本期选择「识别到 socks 就回落直连并告警」，不新增依赖、不让请求失败；完整支持见 [../plugin/01-plugin-module.md](../plugin/01-plugin-module.md) 的后续项。

### 3.2 环境变量代理被显式屏蔽

无论「未启用代理」还是「回落直连」，都会写入 `proxy: false`，即不再隐式读取 `HTTP_PROXY` / `HTTPS_PROXY` /
`NO_PROXY`（axios 1.x 默认会读）。这样设置面板的行为可预期：关就是直连。

## 4. 超时兜底

```ts
if (config.timeout === undefined) config.timeout = Math.max(1000, network.timeout * 1000)
```

- 设置里的 `timeout` 单位是秒，换算成毫秒并下限 1000ms；
- 调用方显式传 `timeout` 时原样保留（例如插件域的 `max(1000, options.timeout)`）。

## 5. 日志与告警

- 写日志：`appendLog({ level: 'warn', scope: 'http', message })`，可在「日志」页按 scope `http` 查看；
- 去重：同一 `warningKey`（含原因与原始 `proxyHost`）每进程只写一条，避免高频请求刷屏；
- 拦截器内的解析失败**绝不抛错**——一律回落直连，否则会直接打断调用方的业务请求。

## 6. 调用方接入

```ts
import { httpClient } from '$/modules/http/httpClient'

const response = await httpClient.request<string>({ url, method: 'GET', timeout: 20_000 })
```

- 目前唯一接入方是插件域的宿主 HTTP：`src/main/src/modules/plugin/pluginHost.ts`（`ctx.request`）；
- WebDAV / SMB 文件域走各自 SDK 的连接逻辑，暂未经过本模块。

## 7. 注意事项

- 模块顶层不做任何副作用（不读 `app.getPath`、不写日志），`loadSetting()` 与 `appendLog` 都发生在请求时，
  因此 import 时机早于 `registerIpc()` 也不会踩到未初始化的数据库；
- `proxyType` 中的 `'socket5'` 是既有持久化契约的拼写，改动会破坏已落盘的 `settings.json`，不要「顺手修正」；
- 新增出网能力时优先复用 `httpClient`，不要直接使用全局 `axios` 或其他 HTTP 客户端，否则代理设置会再次失效。
