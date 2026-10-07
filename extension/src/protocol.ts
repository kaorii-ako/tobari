export interface ChatMessage {
  role: string;
  content: string;
}

export interface ModelInfo {
  id: string;
  about: string;
  size_mb: number;
  downloaded: boolean;
  active: boolean;
}

export type HostRequest =
  | { type: "status" }
  | { type: "chat"; messages: ChatMessage[]; stream: boolean }
  | { type: "models" }
  | { type: "set_model"; id: string }
  | { type: "install_deps"; model?: string };

export type HostResponse =
  | { type: "status"; backend: string; model: string; port: number; healthy: boolean; missing?: string[] }
  | { type: "installed" }
  | { type: "chunk"; content: string; done: boolean }
  | { type: "models"; models: ModelInfo[] }
  | { type: "error"; message: string };
