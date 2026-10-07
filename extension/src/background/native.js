const HOST_NAME = "dev.tobari.core";
let port = null;
const waiters = [];
let streamTarget = null;
function ensurePort() {
    if (port)
        return port;
    port = chrome.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener((msg) => {
        if (msg.type === "chunk" && streamTarget) {
            streamTarget(msg.content, msg.done);
            if (msg.done)
                streamTarget = null;
            return;
        }
        for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i](msg))
                waiters.splice(i, 1);
        }
    });
    port.onDisconnect.addListener(() => {
        port = null;
        streamTarget = null;
    });
    return port;
}
function request(req, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        try {
            ensurePort().postMessage(req);
        }
        catch (e) {
            reject(e);
            return;
        }
        const timer = setTimeout(() => {
            const i = waiters.indexOf(handler);
            if (i >= 0)
                waiters.splice(i, 1);
            reject(new Error("tobari-core did not answer. Is the sidecar installed?"));
        }, timeoutMs);
        function handler(msg) {
            if (msg.type === "chunk")
                return false;
            clearTimeout(timer);
            resolve(msg);
            return true;
        }
        waiters.push(handler);
    });
}
export async function getStatus() {
    const res = await request({ type: "status" });
    if (res.type === "error")
        throw new Error(res.message);
    return res;
}
// Downloads llama-server and the model; the host exits afterwards and the
// next request respawns it fully set up.
export async function installDeps() {
    const res = await request({ type: "install_deps" }, 60 * 60 * 1000);
    if (res.type === "error")
        throw new Error(res.message);
}
export function chat(messages, onChunk) {
    streamTarget = onChunk;
    ensurePort().postMessage({ type: "chat", messages, stream: true });
}
