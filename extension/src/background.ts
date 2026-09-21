import type { PendingAction } from './types'

const MENU_EXPLAIN = 'tobari-explain'
const MENU_SUMMARIZE = 'tobari-summarize'
const MENU_TRANSLATE = 'tobari-translate'
const CONFIRM_KEY = 'confirmOnInsert'
const PANEL_FOCUS_KEY = 'tobariPendingAction'
const PANEL_FOCUS_ALARM = 'tobariPendingActionSweep'
const SWEEP_SECONDS = 20
const MAX_PAGE_CHARS = 12_000

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_EXPLAIN,
    title: 'Tobari: Explain selection',
    contexts: ['selection'],
  })
  chrome.contextMenus.create({
    id: MENU_SUMMARIZE,
    title: 'Tobari: Summarize page',
    contexts: ['page'],
  })
  chrome.contextMenus.create({
    id: MENU_TRANSLATE,
    title: 'Tobari: Translate selection',
    contexts: ['selection'],
  })
  chrome.alarms.create(PANEL_FOCUS_ALARM, { periodInMinutes: 1 })
})

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) {
    void chrome.sidePanel.open({ windowId: tab.windowId })
  }
})

interface RawExtraction {
  origin: string
  title: string
  text: string
  selection: string
}

async function extractFromTab(tabId: number): Promise<RawExtraction | undefined> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['extract.js'],
    })
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = document.documentElement
        const raw = root.getAttribute('data-tobari-extract')
        root.removeAttribute('data-tobari-extract')
        return raw === null ? null : (JSON.parse(raw) as RawExtraction)
      },
    })
    return (result?.result as RawExtraction | null) ?? undefined
  } catch {
    return undefined
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || tab.id < 0 || tab.windowId === undefined) return
  const extraction = await extractFromTab(tab.id)
  if (!extraction) return
  const mode =
    info.menuItemId === MENU_EXPLAIN
      ? 'explain'
      : info.menuItemId === MENU_SUMMARIZE
        ? 'summarize'
        : info.menuItemId === MENU_TRANSLATE
          ? 'translate'
          : undefined
  if (!mode) return
  const text =
    extraction.text.length > MAX_PAGE_CHARS
      ? `${extraction.text.slice(0, MAX_PAGE_CHARS)}…`
      : extraction.text
  const { [CONFIRM_KEY]: confirmOnInsert } = await chrome.storage.session.get({ [CONFIRM_KEY]: true })
  const pending: PendingAction = {
    mode,
    origin: extraction.origin,
    title: extraction.title,
    text,
    selection: extraction.selection,
    at: Date.now(),
    auto: !confirmOnInsert,
  }
  await chrome.storage.session.set({ [PANEL_FOCUS_KEY]: pending })
  void chrome.sidePanel.open({ windowId: tab.windowId })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== PANEL_FOCUS_ALARM) return
  void (async () => {
    const { [PANEL_FOCUS_KEY]: pending } = await chrome.storage.session.get({ [PANEL_FOCUS_KEY]: null })
    if (pending && typeof pending === 'object' && Date.now() - (pending as PendingAction).at > SWEEP_SECONDS * 1000) {
      await chrome.storage.session.remove(PANEL_FOCUS_KEY)
    }
  })()
})

