const KEY = "tobari.prefs.v1";

const DEFAULTS = {
  theme: "system",
  newtabMotion: false,
  smoothScroll: false,
};

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePref(key, value) {
  try {
    const current = loadPrefs();
    current[key] = value;
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable; preference applies for this session only */
  }
}
