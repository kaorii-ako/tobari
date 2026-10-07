import { chat, getStatus } from "./native.js";
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "tobari-explain",
        title: "Explain with Tobari",
        contexts: ["selection"]
    });
    chrome.contextMenus.create({
        id: "tobari-summarize",
        title: "Summarize this page with Tobari",
        contexts: ["page"]
    });
    chrome.contextMenus.create({
        id: "tobari-translate",
        title: "Translate selection with Tobari",
        contexts: ["selection"]
    });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "tobari-explain" && info.selectionText) {
        await openPanel();
        const reply = await ask(`Explain this text in plain language:\n\n${info.selectionText}`);
        void reply;
    }
    if (info.menuItemId === "tobari-translate" && info.selectionText) {
        await openPanel();
        await ask(`Translate this text to English. Return only the translation:\n\n${info.selectionText}`);
    }
    if (info.menuItemId === "tobari-summarize" && tab?.id) {
        await openPanel();
        const page = await extractPage(tab.id);
        await ask(`Summarize this page in five bullets or fewer:\n\n${page.slice(0, 12000)}`);
    }
});
chrome.action.onClicked.addListener(async () => {
    await openPanel();
});
async function openPanel() {
    const win = await chrome.windows.getCurrent();
    if (win.id !== undefined) {
        await chrome.sidePanel.open({ windowId: win.id });
    }
}
async function extractPage(tabId) {
    const res = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.documentElement.innerText.slice(0, 20000)
    });
    const first = res[0];
    if (first && typeof first.result === "string")
        return first.result;
    return "";
}
async function ask(prompt) {
    const status = await getStatus();
    if (status.type !== "status" || !status.healthy) {
        throw new Error("tobari-core is not healthy");
    }
    let full = "";
    chat([{ role: "user", content: prompt }], (chunk, done) => {
        full += chunk;
        if (done)
            chrome.runtime.sendMessage({ kind: "tobari-answer", text: full }).catch(() => { });
    });
    return full;
}
// Auto tab islands: once two ungrouped tabs in a window share a site, put
// them in a group named after it. Tabs the user grouped or pinned are left alone.
const COLORS = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
function siteOf(url) {
    if (!url || !/^https?:/.test(url))
        return null;
    return new URL(url).hostname.replace(/^www\./, "");
}
function colorFor(site) {
    let h = 0;
    for (const ch of site)
        h = (h * 31 + ch.charCodeAt(0)) | 0;
    return COLORS[Math.abs(h) % COLORS.length];
}
async function island(tab) {
    const { autogroup } = await chrome.storage.local.get({ autogroup: true });
    const site = siteOf(tab.url);
    if (!autogroup || !site || tab.pinned || tab.id === undefined || tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
        return;
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId, title: site });
    if (groups.length > 0) {
        await chrome.tabs.group({ groupId: groups[0].id, tabIds: tab.id });
        return;
    }
    const peers = (await chrome.tabs.query({ windowId: tab.windowId, pinned: false }))
        .filter((t) => t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE && siteOf(t.url) === site)
        .map((t) => t.id);
    if (peers.length < 2)
        return;
    const groupId = await chrome.tabs.group({ tabIds: peers, createProperties: { windowId: tab.windowId } });
    await chrome.tabGroups.update(groupId, { title: site, color: colorFor(site), collapsed: false });
}
// Serialized so two tabs loading at once don't each create a group.
let islandQueue = Promise.resolve();
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
    if (change.status !== "complete")
        return;
    islandQueue = islandQueue.then(() => island(tab)).catch(() => { });
});
