import { Button, NotifyPlugin } from 'tdesign-vue-next'

export default {
  success(content: string, title?: string): void {
    NotifyPlugin.success({
      default: content,
      title,
      closeBtn: true,
      duration: 1000
    })
  },
  info(content: string, title?: string): void {
    NotifyPlugin.info({
      default: content,
      title,
      closeBtn: true
    })
  },
  warning(content: string, title?: string): void {
    NotifyPlugin.warning({
      default: content,
      title,
      closeBtn: true
    })
  },
  error(content: string, title?: string): void {
    NotifyPlugin.error({
      default: content,
      title,
      closeBtn: true
    })
  },

  confirm(
    content: string,
    title: string,
    config: {
      confirmButtonText: string
      cancelButtonText: string
      duration?: number
    }
  ): Promise<void> {
    return new Promise<void>( (resolve, reject) => {
      let flag = true
      const notificationReturn =  NotifyPlugin.info({
        default: content,
        title,
        closeBtn: true,
        duration: config.duration,
        footer: () => (
          <div>
            <Button
              theme={'primary'}
              variant={'text'}
              onClick={() => {
                reject()
                flag = false
                notificationReturn.then((notification) => notification.close())
              }}
            >
              {config.cancelButtonText}
            </Button>
            <Button
              theme={'primary'}
              onClick={() => {
                resolve()
                flag = false
                notificationReturn.then((notification) => notification.close())
              }}
            ></Button>
          </div>
        ),
        onCloseBtnClick() {
          if (flag) {
            reject()
          }
        }
      })
    })
  },

  alert(
    content: string,
    title: string,
    config: {
      confirmButtonText: string
      duration?: number
    }
  ): Promise<void> {
    const { confirmButtonText, duration } = config
    return new Promise<void>( (resolve) => {
      function onConfirm() : void{
        resolve()
        notificationReturn.then((notification) => notification.close())
      }

      const notificationReturn = NotifyPlugin.info({
        default: content,
        title,
        closeBtn: true,
        duration: duration,
        footer: () => (
          <div style={{ textAlign: 'right' }}>
            <Button theme={'primary'} onClick={onConfirm}>
              {confirmButtonText}
            </Button>
          </div>
        )
      })
    })
  }
}
