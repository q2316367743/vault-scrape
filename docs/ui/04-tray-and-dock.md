# 托盘与 macOS Dock（已删除，仅作历史参考）

搭手插件**没有**托盘 / Dock / 自定义窗口关闭行为 API。原 Electron 版的常驻托盘、关闭隐藏到托盘、
macOS Dock 显隐等实现已整体删除，本文不再保留其契约细节，避免误导后续维护者。

## 插件版的对应行为

- **后台常驻**：`plugin.json` 的 `resident: true` 让 core 在窗口关光后继续跑长任务（刮削、演员补全、离线包下载）。
- **关闭窗口**：由宿主处理。用户点标题栏关闭按钮即走 `@dashou/api` 的 `getCurrentWindow().close()`，
  没有「隐藏到托盘」的拦截逻辑。
- **恢复入口**：用户通过搭手的命令关键词「刮削」重新打开主窗口（见 `plugin.json` 的 `commands`）。
- **通知**：需要提醒用户时用宿主的 notification 能力，不依赖托盘气泡。

播放窗口的创建与换片仍由 core 负责，见 [architecture/02-plugin-runtime.md](../architecture/02-plugin-runtime.md)。
