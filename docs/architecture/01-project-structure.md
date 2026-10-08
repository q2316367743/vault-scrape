# 工程结构与构建配置

## 实现思路

项目基于 electron-vite，按「主进程 / 预加载 / 公共类型 / 渲染进程」四层划分，参考项目 `mistrelle` 的目录与别名约定，让后续从参考项目迁移实现时路径心智一致。

主进程不写业务，业务实现放 `src/main/src/modules/<域>/` 与 `src/main/src/db/`；渲染进程所有页面挂在 `src/renderer/src/windows/main/` 下，为将来多窗口预留 `windows/<窗口名>` 层级。

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `tsconfig.json` | 仅做 references，指向 node / web 两个子配置 |
| `tsconfig.node.json` | 主进程 + 预加载 + 公共类型的编译范围与别名 |
| `tsconfig.web.json` | 渲染进程的编译范围、JSX 与别名 |
| `electron.vite.config.ts` | 三个构建目标的别名、插件与端口 |
| `uno.config.ts` | 原子类与 TDesign CSS 变量的桥接 |
| `electron-builder.yml` | 打包配置（原生依赖 asarUnpack） |
| `src/main/index.ts` | 主进程入口：注册 IPC、初始化数据库、建窗口 |
| `src/preload/index.ts` | contextBridge 暴露面 |
| `src/renderer/index.html` | 渲染进程 HTML 入口 |
| `src/renderer/src/windows/main/main.ts` | Vue 应用挂载入口 |

## 目录结构

```
src/
├── common/                  # 主进程与渲染进程共享的纯类型与纯函数（不含运行时依赖）
│   └── types/
│       ├── setting/         # 设置类型：shared / path / scrape / network / translate / naming / download / file / index
│       ├── log.ts           # 日志类型与查询条件
│       └── task.ts          # 任务类型与统计
├── main/
│   ├── index.ts             # 主进程入口
│   └── src/
│       ├── db/              # 数据库：schema / client / repo / IPC
│       ├── modules/appWindow/ # 窗口域：窗口控制与最大化状态推送
│       ├── modules/setting/ # 设置域：落盘实现 + IPC
│       └── registerIpc.ts   # 汇总注册各域 IPC
├── preload/
│   ├── index.ts             # contextBridge 暴露 electron 与 preload
│   ├── index.d.ts           # window 全局类型声明
│   └── src/modules/         # 各域 IPC 契约常量 + 调用薄封装（appWindow / db / setting）
└── renderer/
    ├── index.html
    └── src/
        ├── api/             # 渲染层唯一 API 出口（页面不直接读 window.preload）
        ├── assets/style/    # 全局样式：theme / tdesign-cover / customer
        ├── components/      # 跨页面通用组件（menu / PageLayout）
        ├── global/          # 全局状态
        ├── hooks/           # 通用 hooks
        └── windows/main/    # 主窗口：入口、App.vue、router、store、pages
```

## 路径别名

| 别名 | 指向 | 可用范围 |
| --- | --- | --- |
| `$/*` | `src/main/src/*` | 主进程 |
| `~/*` | `src/preload/src/*` | 预加载与主进程（复用 IPC 契约） |
| `@resources/*` | `resources/*` | 主进程 |
| `@common/*` | `src/common/*` | 主进程 / 预加载 / 渲染进程 |
| `@/*` | `src/renderer/src/*` | 渲染进程 |

注意：`tsconfig.web.json` 中没有 `~` 别名，因此 `src/preload/index.d.ts` 引用契约类型时必须使用相对路径（`./src/modules/...`）。

## 构建配置要点

- **renderer**：`base: './'`、`server.port: 7743`、插件为 `vue()` + `vueJsx()` + `UnoCSS()` + `Components()`（TDesignResolver，`dts: 'src/renderer/components.d.ts'`）。
- **不使用 unplugin-auto-import**：自动导入的声明文件只能由 dev/build 运行时生成，而本项目约定只做 typecheck，缺失声明会导致类型报错，故所有 API 与组合式函数都显式 `import`。
- **main / preload**：`externalizeDepsPlugin()` 把 `dependencies` 中的包保留为外部依赖，所以主进程实际 require 的包（如 `better-sqlite3`、`drizzle-orm`）必须放 `dependencies`。
- **UnoCSS**：`theme.colors` 把 `td-*` 映射到 `var(--td-*)`，颜色一律走 TDesign Token；顶层 `postprocess` 给每个工具类的值追加 `!important`，避免 UnoCSS 样式表先于 TDesign 样式加载时被覆盖。

## 依赖归类规则

- `dependencies`：主进程/预加载在运行时真正 require、需要随包发布的包。当前为 `@electron-toolkit/preload`、`@electron-toolkit/utils`、`axios`、`better-sqlite3`、`drizzle-orm`、`electron-updater`。
- `devDependencies`：只在渲染进程被 Vite 打包的包（`vue`、`vue-router`、`pinia`、`tdesign-vue-next`、`tdesign-icons-vue-next`、`dayjs`、`es-toolkit`、`@vueuse/core`、`unocss` 等）与全部构建/校验工具。这类包的内容会进入渲染产物，不需要作为 Electron 运行时依赖打包。
- 新增依赖时先判断「谁在运行时 require 它」，再决定归类。

## 注意事项

- 根目录禁止出现业务代码；构建配置文件除外。
- 只做 `yarn typecheck`（`typecheck:node` + `typecheck:web`），不执行 `dev` / `build` 作为验证手段。
- `src/renderer/src/renderer/components.d.ts` 由 `unplugin-vue-components` 在 dev/build 时生成，仓库中已提交。配置里的 `dts: 'src/renderer/components.d.ts'` 是相对 Vite root（`src/renderer`）解析的，所以真实路径比配置多一层 `src/renderer/`。本项目约定只跑 `typecheck`、不跑 `dev` / `build`，模板中新用到的 TDesign 组件不会被自动登记，**必须手工**补进该文件的两处列表（`declare module 'vue'` 的 `GlobalComponents` 与 `declare global`），否则 `typecheck` 会报组件未定义。
- 修改别名时必须同步四处：`tsconfig.node.json`、`tsconfig.web.json`、`electron.vite.config.ts`、本文档。
