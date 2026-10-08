# vault-scrape

刮削工具（Electron + Vue 3 + TypeScript）。基于 electron-vite 构建，界面使用 TDesign Vue Next，数据使用 SQLite（better-sqlite3 + drizzle-orm），设置以本地 JSON 落盘。

## 技术栈

| 方向 | 选型 |
| --- | --- |
| 桌面运行时 | Electron + electron-vite |
| 界面 | Vue 3 + TDesign Vue Next + tdesign-icons-vue-next + UnoCSS + less |
| 状态与路由 | pinia + vue-router（hash 模式） |
| 数据 | better-sqlite3 + drizzle-orm（迁移由 drizzle-kit 生成） |
| 工具库 | es-toolkit、@vueuse/core、dayjs、axios |

## 目录结构

```
src/
├── common/      # 主进程与渲染进程共享的纯类型与纯函数
├── main/        # 主进程：db（schema/repo/IPC）、modules（各功能域）、registerIpc
├── preload/     # 预加载：各域 IPC 契约常量与调用封装，contextBridge 暴露面
└── renderer/    # 渲染进程：api 出口、components、windows/main（router/store/pages）
resources/       # 图标、drizzle 迁移等随包资源
docs/            # 技术文档（见下方索引）
```

## 常用命令

```bash
yarn                    # 安装依赖（postinstall 会为 Electron 重编译 better-sqlite3）
yarn dev                # 开发模式
yarn typecheck          # 类型检查（node + web），提交前唯一必需的校验
yarn db:generate        # 修改 schema 后生成迁移到 resources/drizzle
yarn build:mac          # 打包（build:win / build:linux 同理）
```

## 文档

技术文档索引见 [docs/README.md](./docs/README.md)，包含工程结构、SQLite 存储、设置存储与设置项清单、渲染层外壳与主题、基础页面六个主题。

## 注意事项

- 根目录不放业务代码。
- 渲染进程不直接访问 `window.preload`，统一走 `@/api`。
- 颜色一律使用 TDesign CSS 变量，裸色值只允许出现在 `src/renderer/src/assets/style/theme.less`。
- 弹窗与抽屉使用命令式 `DialogPlugin` / `DrawerPlugin`。
- 改表结构后执行 `yarn db:generate`，不要手写迁移 SQL。
