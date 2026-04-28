type ToastType = 'ok' | 'err' | 'info'
type Handler = (msg: string, type: ToastType) => void

let _handler: Handler | null = null

export function registerToastHandler(fn: Handler) {
  _handler = fn
}

export function showToast(msg: string, type: ToastType = 'ok') {
  _handler?.(msg, type)
}
