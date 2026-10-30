import { chat, getModels, getStatus, installDeps } from "../background/native.js";
import { parseCookies } from "./cookies.js";
const log = document.getElementById("log");
const form = document.getElementById("form");
const input = document.getElementById("input");
const statusEl = document.getElementById("status");
function add(role, text) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
}
async function refreshStatus() {
    try {
        const s = await getStatus();
        if (s.type === "status" && s.missing?.length) {
            void showSetup(s.missing);
            statusEl.textContent = "setup needed";
            return;
        }
        if (s.type === "status") {
            setupEl.hidden = true;
            statusEl.textContent = `${s.backend} · ${s.model} · ${s.healthy ? "ready" : "starting"}`;
        }
    }
    catch {
        statusEl.textContent = "sidecar unreachable";
    }
}
const setupEl = document.getElementById("setup");
const setupText = document.getElementById("setup-text");
const setupGo = document.getElementById("setup-go");
const setupModel = document.getElementById("setup-model");
let installing = false;
async function showSetup(missing) {
    if (installing || !setupEl.hidden)
        return;
    setupText.textContent = `Tobari needs to download: ${missing.join(", ")}. Pick a model and install:`;
    setupEl.hidden = false;
    try {
        const models = await getModels();
        setupModel.replaceChildren(...models.map((m) => {
            const label = `${m.id} · ${(m.size_mb / 1024).toFixed(1)} GB${m.downloaded ? " · downloaded" : ""} — ${m.about}`;
            return new Option(label, m.id, m.active, m.active);
        }));
    }
    catch {
        setupModel.hidden = true; // host picks its default
    }
}
setupGo.addEventListener("click", async () => {
    installing = true;
    setupGo.disabled = true;
    setupModel.disabled = true;
    setupText.textContent = "Downloading… this can take a while.";
    try {
        await installDeps(setupModel.hidden ? undefined : setupModel.value);
        setupEl.hidden = true;
    }
    catch (e) {
        setupText.textContent = `Install failed: ${e.message}`;
    }
    finally {
        installing = false;
        setupGo.disabled = false;
        setupModel.disabled = false;
        void refreshStatus();
    }
});
const cookieFile = document.getElementById("cookie-file");
document.getElementById("import-cookies")?.addEventListener("click", async () => {
    // Ask for site access only when importing; Tobari holds none otherwise.
    const ok = await chrome.permissions.request({ permissions: ["cookies"], origins: ["<all_urls>"] });
    if (ok)
        cookieFile.click();
});
cookieFile.addEventListener("change", async () => {
    const file = cookieFile.files?.[0];
    cookieFile.value = "";
    if (!file)
        return;
    let cookies;
    try {
        cookies = parseCookies(await file.text());
    }
    catch (e) {
        add("model", `Could not read ${file.name}: ${e.message}`);
        return;
    }
    let done = 0;
    for (const c of cookies) {
        try {
            if (await chrome.cookies.set(c))
                done++;
        }
        catch {
            // skip cookies Chrome rejects (expired, bad domain)
        }
    }
    add("model", `Imported ${done} of ${cookies.length} cookies from ${file.name}.`);
});
document.getElementById("import-browser")?.addEventListener("click", () => {
    // Chrome's own importer covers bookmarks, history, passwords, autofill.
    void chrome.tabs.create({ url: "chrome://settings/importData" });
});
const autogroup = document.getElementById("autogroup");
chrome.storage.local.get({ autogroup: true }).then((v) => (autogroup.checked = v.autogroup));
autogroup.addEventListener("change", () => void chrome.storage.local.set({ autogroup: autogroup.checked }));
function currentStream() {
    return add("model", "");
}
form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text)
        return;
    input.value = "";
    add("user", text);
    const bubble = currentStream();
    chat([{ role: "user", content: text }], (chunk, done) => {
        if (!done)
            bubble.textContent += chunk;
    });
});
document.getElementById("page")?.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id)
        return;
    const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement.innerText.slice(0, 12000)
    });
    const text = res[0]?.result;
    if (typeof text === "string" && text.length > 0) {
        input.value = `Here is the page text. My question follows after ---.\n\n${text}\n\n---\n`;
        input.focus();
    }
});
document.getElementById("sum")?.addEventListener("click", () => {
    input.value = "Summarize this page in five bullets or fewer. Page text follows after ---.\n\n";
    document.getElementById("page")?.dispatchEvent(new Event("click"));
});
chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.kind === "tobari-answer" && typeof msg.text === "string") {
        add("model", msg.text);
    }
});
void refreshStatus();
setInterval(() => void refreshStatus(), 10000);
