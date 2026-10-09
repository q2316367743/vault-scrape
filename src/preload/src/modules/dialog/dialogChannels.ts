/** dialog 域 IPC 通道常量：main 与 preload 共用，避免通道名写错 */
export const DialogChannels = {
  open: 'dialog:open',
  save: 'dialog:save'
} as const
