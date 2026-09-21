export type Backend = 'vulkan' | 'cuda' | 'metal' | 'cpu'

export interface SidecarStatus {
  type: 'status'
  state: 'starting' | 'ready' | 'error'
  backend?: Backend
  model_id?: string
  model_label?: string
  verified?: 'pinned' | 'unverified'
  vram_gb?: number
  gpu_layers?: number
  total_layers?: number
  error?: string
}

export interface CatalogEntry {
  id: string
  display_name: string
  tier: 'small' | 'default' | 'large'
  license: string
  size_bytes: number
  sha256: string
  min_vram_gb?: number
  recommended?: boolean
}

export interface CatalogMessage {
  type: 'catalog'
  models: CatalogEntry[]
}

export interface DownloadProgress {
  type: 'download_progress'
  id: string
  downloaded_bytes: number
  total_bytes: number
  done?: boolean
  error?: string
}

export interface PageContext {
  origin: string
  title: string
  text: string
}

export interface ChatRequest {
  type: 'chat'
  req_id: string
  mode: 'chat' | 'summarize' | 'explain' | 'rewrite' | 'translate'
  prompt: string
  page?: PageContext
  selection?: string
  target_lang?: string
}

export interface StreamDelta {
  type: 'stream_delta'
  req_id: string
  delta: string
}

export interface DoneMessage {
  type: 'done'
  req_id: string
}

export interface ErrorMessage {
  type: 'error'
  req_id?: string
  message: string
}

export type SidecarMessage =
  | SidecarStatus
  | CatalogMessage
  | DownloadProgress
  | StreamDelta
  | DoneMessage
  | ErrorMessage

export type PanelRequest =
  | { type: 'get-status' }
  | { type: 'chat'; mode: ChatRequest['mode']; prompt: string; target_lang?: string }
  | { type: 'download-model'; id: string }

export interface ExtractedPage {
  type: 'page-extracted'
  origin: string
  title: string
  text: string
  selection: string
}
