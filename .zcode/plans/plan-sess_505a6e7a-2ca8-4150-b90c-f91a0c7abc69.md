# 新增内置存储类型 OpenList

参考 [OpenList API 文档](https://fox.oplist.org/llms.txt) 新增内置协议 `openlist`：表单只需 **API 地址 + Token**（Token 加密落盘，复用现有密码机制），连接支持增删改查，驱动实现 `FileClient` 全部 15 个方法（含写入，供刮削等链路使用），浏览页保持只读。

已核实的关键 API 事实：所有接口 POST `{url}/api/fs/*`，信封 `{code, message, data}`（200 成功）；认证头 `Authorization: <token>`（**无 Bearer 前缀**）；`fs/get` 返回直链 `raw_url` + `sign`（官方文档漏写，已由 [OpenList issue #1549](https://github.com/OpenListTeam/OpenList/issues/1549) 确认）；上传走 `PUT /api/fs/put`（头 `File-Path` 需 URL 编码）。

## 1. 公共类型 — `src/common/types/file/connection.ts`
- `BuiltinFileProtocol` 加 `'openlist'`；`FILE_PROTOCOLS`、`FILE_PROTOCOL_LABELS`（`openlist: 'OpenList'`）同步
- 新增 `OpenlistConnection { id, name, protocol: 'openlist', hasPassword, url }`（`hasPassword` 含义为"已存 Token"）与 `OpenlistConnectionDraft { id?, protocol, name, url, password? }`（`password` 字段承载 Token，沿用现有凭证约定：缺省=保持、空串=清空），并入两个联合
- `describeConnection` 加分支 `OpenList ${url}`

## 2. 主进程落盘 — `src/main/src/modules/file/fileConnectionStore.ts`
- 新增 `StoredOpenlistConnection { id, name, protocol: 'openlist', url, secret }`
- `normalizeStored` / `toPublicConnection` / `buildStored` 各加 openlist 分支（URL 用现有 `isValidUrl` 校验，secret 编码/沿用逻辑与 webdav 一致，零新机制）

## 3. 驱动实现 — 新建 `src/main/src/modules/file/impl/openlist/`
- **`openlistApi.ts`**：base URL 归一化、node http/https 的 POST JSON 封装（信封解析、错误映射：401→authFailed「令牌无效或已过期」、403→permissionDenied、404→notFound、400→invalidArgument、其余→network）、`FsObject` 类型
- **`OpenlistFileClient.ts`** extends `AbstractFileClient`，方法到 API 的映射：
  - `init` → `fs/list '/'` 首页（一次调用同时验地址可达 + Token 有效）
  - `stat`/`exists` → `fs/get`（注意：返回的 `data.path` 是物理路径，`FileEntry.path` 一律用请求的虚拟路径）
  - `list` → `fs/list` 分页循环（per_page=100，页数/条目上限保护参照 `PluginFileClient`）
  - `mkdir` → `fs/mkdir` 逐级建（OpenList 只建最后一级）；`remove` → `fs/remove {dir, names:[name]}`（非递归时先查空目录→`notEmpty`）
  - `move` → 同目录 `fs/rename`，跨目录 `fs/move`；`copy` → `fs/copy`（overwrite=false 先查目标→`alreadyExists`）
  - `createFile`/`writeText`/`upload` → `PUT fs/put`（`File-Path` 头 URL 编码；upload 带文件流 + `withProgress`，失败清理远端半截文件，参照 WebDAV 实现）
  - `readRange`/`download`/`readText` → `fs/get` 取 `raw_url`（为空时拼 `{base}/d{路径}?sign=`）→ 复用 `impl/plugin/directLinkStream.ts` 发 Range GET；直链按 path 缓存（TTL 300s），403/404/410 视为失效强制重取一次——与 `PluginFileClient` 同一条字节通路
  - `dispose` 清空直链缓存

## 4. 驱动注册 — `fileClientManager.ts` `createClient()` 加一行 openlist 分派（凭据走 `credential.password`，即解密后的 Token）

## 5. 前端表单
- `useConnectionForm.ts`：`ConnectionForm` 零新字段（复用 `url`/`password`）；`initForm`/`buildDraft` 各加 openlist 分支
- `ConnectionDialogContent.vue`：加 `v-else-if="protocol === 'openlist'"` 分支（地址输入框）；**smb 分支从 else 兜底改成显式 `v-else-if`**；凭证行标签按协议显示「Token」/「密码」，Token 提示文案：「在 OpenList 后台『设置 → 其他』页面获取」（RL-10：只说去哪拿，不写技术路径）
- `UseFileConnections.ts` `toConnectionDraft` 加 openlist 分支
- `storageUtils.ts`：图标 `openlist: RootListIcon`（tdesign `root-list`），说明文案「通过 API 地址与令牌连接 OpenList，支持在线挂载的网盘与本地目录」
- `StoragePage.vue` 描述改为「统一管理本地磁盘、WebDAV、SMB 与 OpenList 数据源」

## 6. 无需改动
`fileChannels.ts`、preload、`api/file.ts`、18 个通用 IPC 通道、`mediaProtocol.ts`、`mediaLocator.ts`、DB schema/migration（连接存 JSON 文件）

## 7. 文档与验证
- 更新 `docs/file/01-file-module.md`（协议能力矩阵、驱动映射表加 openlist）及 `docs/README.md` 索引
- `yarn typecheck`（RL-07，类型系统会强制补齐 `Record<BuiltinFileProtocol,…>` 映射，漏改处直接编译报错；不做其他测试）