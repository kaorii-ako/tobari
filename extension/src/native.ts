import type { ChatRequest, SidecarMessage } from './types'

const NATIVE_HOST = 'dev.tobari.core'

interface Pending {
  onDelta: (delta: string) => void
  resolve: () => void
  reject: (err: Error) => void
}

export class NativeBridge {
  private port: chrome.runtime.Port
  private pending = new Map<string, Pending>()
  private statusListeners = new Set<(msg: SidecarMessage) => void>()

  constructor() {
    this.port = chrome.runtime.connectNative(NATIVE_HOST)
    this.port.onMessage.addListener((msg: SidecarMessage) => this.dispatch(msg))
    this.port.onDisconnect.addListener(() => {
      const err = new Error(chrome.runtime.lastError?.message ?? 'native host disconnected')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    })
  }

  private dispatch(msg: SidecarMessage): void {
    if (msg.type === 'status' || msg.type === 'catalog' || msg.type === 'download_progress') {
      for (const listener of this.statusListeners) listener(msg)
      return
    }
    const reqId: string | undefined = 'req_id' in msg ? msg.req_id : undefined
    const pending = reqId !== undefined ? this.pending.get(reqId) : undefined
    if (!pending || reqId === undefined) return
    if (msg.type === 'stream_delta') {
      pending.onDelta(msg.delta)
    } else if (msg.type === 'done') {
      this.pending.delete(reqId)
      pending.resolve()
    } else if (msg.type === 'error') {
      this.pending.delete(reqId)
      pending.reject(new Error(msg.message))
    }
  }

  onEvent(listener: (msg: SidecarMessage) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  chat(request: Omit<ChatRequest, 'type'>, onDelta: (delta: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.req_id, { onDelta, resolve, reject })
      this.port.postMessage({ type: 'chat', ...request })
    })
  }

  send(msg: { type: 'download_model'; id: string } | { type: 'get_status' } | { type: 'get_catalog' }): void {
    this.port.postMessage(msg)
  }
}
