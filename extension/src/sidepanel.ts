import { NativeBridge } from './native'
import type { PendingAction, SidecarMessage } from './types'

const bridge = new NativeBridge()

const ui = {
  messages: document.getElementById('messages') as HTMLDivElement,
  input: document.getElementById('input') as HTMLTextAreaElement,
  send: document.getElementById('send') as HTMLButtonElement,
  status: document.getElementById('status') as HTMLDivElement,
  modelSelect: document.getElementById('model') as HTMLSelectElement,
  download: document.getElementById('download') as HTMLButtonElement,
  context: document.getElementById('context') as HTMLDivElement,
  contextOrigin: document.getElementById('context-origin') as HTMLSpanElement,
  contextTitle: document.getElementById('context-title') as HTMLSpanElement,
  confirmInsert: document.getElementById('confirm-insert') as HTMLInputElement,
  usePage: document.getElementById('use-page') as HTMLButtonElement,
}

function addMessage(text: string, role: 'user' | 'assistant'): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `msg ${role}`
  el.textContent = text
  ui.messages.appendChild(el)
  ui.messages.scrollTop = ui.messages.scrollHeight
  return el
}

let streaming: HTMLDivElement | undefined

function onEvent(msg: SidecarMessage): void {
  if (msg.type === 'status') {
    ui.status.classList.toggle('warn', Boolean(msg.warning))
    if (msg.state === 'ready') {
      const layers =
        msg.total_layers && msg.total_layers > 0
          ? `${msg.gpu_layers ?? 0}/${msg.total_layers} layers on ${msg.device_name ?? 'GPU'}`
          : 'GPU offload not active'
      ui.status.textContent = msg.warning
        ? `${msg.warning} · ${msg.backend}`
        : `ready · ${msg.backend} · ${msg.model_label} (${msg.verified}) · ${layers}`
    } else if (msg.state === 'error') {
      ui.status.textContent = `error: ${msg.error}`
    } else {
      ui.status.textContent = msg.warning ?? 'starting…'
    }
  } else if (msg.type === 'catalog') {
    ui.modelSelect.replaceChildren()
    for (const entry of msg.models) {
      const option = document.createElement('option')
      option.value = entry.id
      option.textContent = `${entry.display_name} — ${(entry.size_bytes / 1e9).toFixed(2)} GB${entry.recommended ? ' (recommended)' : ''}`
      ui.modelSelect.appendChild(option)
    }
  } else if (msg.type === 'download_progress') {
    if (msg.error) {
      ui.status.textContent = `download failed: ${msg.error}`
    } else {
      const pct = msg.total_bytes > 0 ? ((msg.downloaded_bytes / msg.total_bytes) * 100).toFixed(1) : '?'
      ui.status.textContent = msg.done ? 'download complete' : `downloading… ${pct}%`
    }
  } else if (msg.type === 'stream_delta' && streaming) {
    streaming.textContent += msg.delta
    ui.messages.scrollTop = ui.messages.scrollHeight
  } else if (msg.type === 'done') {
    streaming = undefined
  } else if (msg.type === 'error') {
    addMessage(`error: ${msg.message}`, 'assistant')
    streaming = undefined
  }
}

bridge.onEvent(onEvent)

ui.download.addEventListener('click', () => {
  const id = ui.modelSelect.value
  if (id) bridge.send({ type: 'download_model', id })
})

let pending: PendingAction | undefined

function showPending(value: PendingAction): void {
  pending = value
  ui.contextOrigin.textContent = value.origin
  ui.contextTitle.textContent = value.title
  ui.context.classList.add('visible')
  if (value.auto) firePending()
}

function hidePending(): void {
  pending = undefined
  ui.context.classList.remove('visible')
}

function firePending(): void {
  if (!pending) return
  const action = pending
  hidePending()
  addMessage(`${action.mode}: ${action.title}`, 'user')
  streaming = addMessage('', 'assistant')
  const req = {
    req_id: crypto.randomUUID(),
    mode: action.mode,
    prompt: '',
    page: { origin: action.origin, title: action.title, text: action.text },
    selection: action.selection || undefined,
  }
  bridge.chat(req, () => {}).catch((err: Error) => {
    addMessage(`error: ${err.message}`, 'assistant')
    streaming = undefined
  })
}

async function pollPending(): Promise<void> {
  const { tobariPendingAction } = await chrome.storage.session.get({ tobariPendingAction: null })
  if (tobariPendingAction && typeof tobariPendingAction === 'object') {
    await chrome.storage.session.remove('tobariPendingAction')
    showPending(tobariPendingAction as PendingAction)
  }
}

void pollPending()
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.tobariPendingAction?.newValue) {
    void pollPending()
  }
})

ui.confirmInsert.addEventListener('change', () => {
  void chrome.storage.session.set({ confirmOnInsert: ui.confirmInsert.checked })
})

ui.usePage.addEventListener('click', () => {
  if (pending) {
    pending.auto = true
    firePending()
  }
})

async function sendPrompt(): Promise<void> {
  const prompt = ui.input.value.trim()
  if (!prompt) return
  ui.input.value = ''
  addMessage(prompt, 'user')
  streaming = addMessage('', 'assistant')
  try {
    await bridge.chat({ req_id: crypto.randomUUID(), mode: 'chat', prompt }, () => {})
  } catch (err) {
    addMessage(`error: ${(err as Error).message}`, 'assistant')
    streaming = undefined
  }
}

ui.send.addEventListener('click', () => void sendPrompt())
ui.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void sendPrompt()
  }
})

bridge.send({ type: 'get_status' })
bridge.send({ type: 'get_catalog' })
void chrome.storage.session.get({ confirmOnInsert: true }, (items) => {
  ui.confirmInsert.checked = items.confirmOnInsert as boolean
})

