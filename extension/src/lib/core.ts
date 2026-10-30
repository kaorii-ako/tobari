export type Destination = {
  provider: string;
  model: string;
  host: string;
  region: string;
  local: boolean;
  images: boolean;
  summary: string;
};

type Handlers = {
  onDelta?: (text: string) => void;
  onProgress?: (done: number, total: number) => void;
  onDestination?: (d: Destination) => void;
};

type Pending = Handlers & { resolve: (v: any) => void; reject: (e: Error) => void };

let port: chrome.runtime.Port | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
const listeners = new Set<(msg: any) => void>();

function ensure(): chrome.runtime.Port {
  if (port) return port;
  port = chrome.runtime.connect({ name: "core" });
  port.onMessage.addListener((msg: any) => {
    if (msg.type === "event") {
      listeners.forEach((l) => l(msg));
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === "delta") p.onDelta?.(msg.text);
    else if (msg.type === "progress") p.onProgress?.(msg.done, msg.total);
    else if (msg.type === "destination") p.onDestination?.(msg.data);
    else if (msg.type === "result") {
      pending.delete(msg.id);
      p.resolve(msg.data);
    } else if (msg.type === "error") {
      pending.delete(msg.id);
      p.reject(new Error(msg.message));
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    for (const [id, p] of pending) {
      pending.delete(id);
      p.reject(new Error("Tobari's background worker restarted. Try again."));
    }
  });
  return port;
}

export function core<T = any>(type: string, payload: Record<string, unknown> = {}, h: Handlers = {}): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { ...h, resolve, reject });
    ensure().postMessage({ id, type, ...payload });
  });
}

export function onCoreEvent(fn: (msg: any) => void): () => void {
  ensure();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isHostMissing(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e);
  return /native messaging host not found|Access to the specified native messaging host is forbidden|host has exited/i.test(m);
}

export function prettyModel(id: string): string {
  if (!id) return "No model";
  const base = id.split("/").pop()!.replace(/\.gguf$/i, "");
  const cleaned = base
    .replace(/[-_.]?(q\d(_[a-z0-9]+)*|iq\d\w*|f16|bf16|fp16|gguf)$/i, "")
    .replace(/-(\d{4})$/, "")
    .replace(/-\d{4}-/, "-");
  if (/^(claude|gpt|gemini|o\d)/i.test(cleaned)) return cleaned;
  return cleaned
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => (/^\d+(\.\d+)?[bm]$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function destinationLabel(d: Destination): string {
  const name = prettyModel(d.model);
  if (d.local) return `${name} · on this device`;
  return `${name} · ${d.host}${d.region ? ` (${d.region})` : ""}`;
}
