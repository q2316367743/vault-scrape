import { MessagePlugin } from 'tdesign-vue-next'

function render(message: string, e?: Error | unknown): string {
  if (e) {
    if (e instanceof Error) {
      return `${message}, ${e.message}`
    }
    return `${message}, ${e}`
  }
  return message
}

function success(message: Error | string | unknown): void
function success(message: Error | string | unknown, callback: () => void): void
function success(message: Error | string | unknown, callback?: () => void): void {
  MessagePlugin.success({
    closeBtn: true,
    content: typeof message === 'string' ? message : JSON.stringify(message)
  })
  callback && callback()
}

function warning(message: string, e?: Error | unknown): void {
  MessagePlugin.warning({
    closeBtn: true,
    content: render(message, e)
  })
  console.error(message, e)
}

function error(message: string): void
function error(message: string, e: Error | unknown): void
function error(message: string, e: Error | unknown, callback: () => void): void
function error(message: string, e?: Error | unknown, callback?: () => void): void {
  MessagePlugin.error({
    closeBtn: true,
    content: render(message, e)
  })
  console.error(message, e)
  callback && callback()
}

export default {
  success,
  info(message: string) {
    MessagePlugin.info({
      closeBtn: true,
      content: typeof message === 'string' ? message : JSON.stringify(message)
    })
  },
  warning,
  error
}
