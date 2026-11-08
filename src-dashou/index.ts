import './core/require-shim'
import { definePluginApi } from '@dashou/core'
import { api, registerLongJobs } from './core/api'
import { initDb } from './core/db/client'
import { appendLog } from './core/db/repo/logRepo'
import { disposeFileClients } from './core/modules/file/fileClientManager'
import { disposeMediaServer, startMediaServer } from './core/modules/media/mediaServer'
import { runOfflineStartupCheck } from './core/modules/offline/offlineCheck'
import { handlePlayerWindowClosed } from './core/modules/player/playerWindow'
import { stopSession } from './core/modules/player/playerSession'
import { markInterruptedOnStartup } from './core/modules/scrape/scrapeRunner'
import { setHost } from './core/runtime/host'
import { initPaths } from './core/runtime/paths'

/**
 * 刮削插件 core 入口。
 *
 * 启动顺序（由宿主 bootstrap 掌握）：
 * 1. 注入 ctx → onReady 里初始化路径、数据库、媒体服务与长任务表；
 * 2. 上报 ready 后宿主按清单建主窗口；
 * 3. 播放窗口在用户点「播放」时才动态创建。
 *
 * 与原 Electron 版本相比去掉的东西：
 * - 托盘（宿主没有托盘 API，窗口关闭由用户显式操作）；
 * - mpv（无法把原生窗口嵌进宿主窗口，统一用内置 artplayer）；
 * - 自动更新（插件由 .dsp 安装包分发）。
 */
const plugin = definePluginApi({
  async onReady(ctx) {
    setHost(ctx)
    initPaths(ctx.paths.data, ctx.paths.pluginRoot)

    initDb()
    registerLongJobs()
    await startMediaServer()

    const interrupted = markInterruptedOnStartup()
    appendLog({ level: 'info', scope: 'app', message: '刮削插件已启动' })
    if (interrupted > 0) {
      appendLog({
        level: 'warn',
        scope: 'scrape',
        message: `应用重启，已把 ${interrupted} 个未完成的刮削任务标记为中断`
      })
    }

    // 启动时的离线数据包自动检查：距上次成功检查超过 7 天才联网，且只提示、绝不自动下载
    void runOfflineStartupCheck()
  },

  onWindowClosed(ctx, { label }) {
    if (label === 'play') {
      handlePlayerWindowClosed()
    }
    ctx.log(`窗口已关闭：${label}`, 'debug')
  },

  async onBeforeQuit(ctx) {
    await disposeMediaServer()
    await disposeFileClients()
    await stopSession()
    ctx.log('刮削插件已退出', 'info')
  },

  api
})

export default plugin
export type { Api } from './core/api'
