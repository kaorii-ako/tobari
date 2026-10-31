#!/usr/bin/env python3
"""WCAG AA check of the token pairs in ui/tokens.css, in light and dark. Exit 1 on any failure."""
import re
import sys
from pathlib import Path

TEXT, UI = 4.5, 3.0
# (foreground, background, minimum ratio): text on every surface it appears on, plus focus and accent UI.
PAIRS = [(fg, bg, TEXT) for fg in ("text", "text-2", "text-3") for bg in ("bg", "surface", "surface-2", "surface-3")]
PAIRS += [
    ("accent", "bg", TEXT), ("accent", "surface", TEXT), ("accent", "accent-soft", TEXT),
    ("on-accent", "accent", TEXT), ("danger", "surface", TEXT), ("danger", "surface-2", TEXT),
    ("text", "accent-soft", TEXT), ("focus", "bg", UI), ("focus", "surface", UI), ("focus", "surface-2", UI),
]


def luminance(hex_):
    def ch(c):
        c = int(c, 16) / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(hex_[i:i + 2]) for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def main():
    css = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent.parent / "ui/tokens.css").read_text()
    tokens = dict((n, (l, d)) for n, l, d in re.findall(r"--([\w-]+):\s*light-dark\((#[0-9A-Fa-f]{6}),\s*(#[0-9A-Fa-f]{6})\)", css))
    failed = 0
    for theme, i in (("light", 0), ("dark", 1)):
        for fg, bg, need in PAIRS:
            r = ratio(tokens[fg][i], tokens[bg][i])
            ok = r >= need
            failed += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {theme:5} {fg:9} on {bg:11} {r:5.2f} (needs {need})")
    print(f"contrast: {len(PAIRS) * 2 - failed}/{len(PAIRS) * 2} pairs pass WCAG AA")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
