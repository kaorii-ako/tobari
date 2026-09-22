export interface ChatMessage {
  role: string;
  content: string;
}

export type HostRequest =
  | { type: "status" }
  | { type: "chat"; messages: ChatMessage[]; stream: boolean }
  | { type: "models" }
  | { type: "set_model"; id: string };

export type HostResponse =
  | { type: "status"; backend: string; model: string; port: number; healthy: boolean }
  | { type: "chunk"; content: string; done: boolean }
  | { type: "models"; models: Array<{ id: string; downloaded: boolean; active: boolean }> }
  | { type: "error"; message: string };
