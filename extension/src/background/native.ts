import type { HostRequest, HostResponse } from "../protocol.js";

const HOST_NAME = "dev.tobari.core";

let port: chrome.runtime.Port | null = null;
const waiters: Array<(msg: HostResponse) => boolean> = [];
let streamTarget: ((chunk: string, done: boolean) => void) | null = null;

function ensurePort(): chrome.runtime.Port {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST_NAME);
  port.onMessage.addListener((msg: HostResponse) => {
    if (msg.type === "chunk" && streamTarget) {
      streamTarget(msg.content, msg.done);
      if (msg.done) streamTarget = null;
      return;
    }
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i](msg)) waiters.splice(i, 1);
    }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    streamTarget = null;
  });
  return port;
}

function request(req: HostRequest, timeoutMs = 120000): Promise<HostResponse> {
  return new Promise((resolve, reject) => {
    try {
      ensurePort().postMessage(req);
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      const i = waiters.indexOf(handler);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error("tobari-core did not answer. Is the sidecar installed?"));
    }, timeoutMs);
    function handler(msg: HostResponse): boolean {
      if (msg.type === "chunk") return false;
      clearTimeout(timer);
      resolve(msg);
      return true;
    }
    waiters.push(handler);
  });
}

export async function getStatus(): Promise<HostResponse> {
  const res = await request({ type: "status" });
  if (res.type === "error") throw new Error(res.message);
  return res;
}

// Downloads llama-server and the model; the host exits afterwards and the
// next request respawns it fully set up.
export async function installDeps(): Promise<void> {
  const res = await request({ type: "install_deps" }, 60 * 60 * 1000);
  if (res.type === "error") throw new Error(res.message);
}

export function chat(
  messages: Array<{ role: string; content: string }>,
  onChunk: (chunk: string, done: boolean) => void
): void {
  streamTarget = onChunk;
  ensurePort().postMessage({ type: "chat", messages, stream: true });
}
