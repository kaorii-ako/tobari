const pinned = Number(new URLSearchParams(location.search).get("window")) || undefined;

export async function targetWindowId(): Promise<number | undefined> {
  if (pinned !== undefined) return pinned;
  return (await chrome.windows.getCurrent()).id;
}

export async function activeTab(): Promise<chrome.tabs.Tab> {
  const [t] = await chrome.tabs.query({ active: true, windowId: await targetWindowId() });
  return t;
}

export async function windowTabs(): Promise<chrome.tabs.Tab[]> {
  return chrome.tabs.query({ windowId: await targetWindowId() });
}
