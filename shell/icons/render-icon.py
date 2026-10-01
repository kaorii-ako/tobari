"""Renders the Tobari app icon at every hicolor size from one 1024px master.

Ink square, 帳 in Noto Serif CJK, and a single vermilion hairline above it — the
same mark as the active-tab indicator, read here as the curtain rail.
"""
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

INK = (15, 15, 18, 255)
EDGE = (43, 43, 52, 255)
FG = (242, 242, 245, 255)
SIGNAL = (255, 107, 61, 255)
MASTER = 1024
SIZES = [16, 24, 32, 48, 64, 128, 256, 512]


def font_path(family):
    out = subprocess.run(["fc-match", "-f", "%{file}", family], capture_output=True, text=True)
    return out.stdout.strip()


def render_small():
    """Hinted-for-size drawing for 16-48px: heavier sans glyph, larger, thicker rail.

    A serif hairline that reads well at 512px dissolves into grey below ~48px, so
    small sizes get their own geometry rather than a downscale of the master.
    """
    img = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    inset = 24
    d.rounded_rectangle((inset, inset, MASTER - inset, MASTER - inset), radius=200, fill=INK)
    d.rounded_rectangle((250, 150, MASTER - 250, 150 + 64), radius=32, fill=SIGNAL)
    font = ImageFont.truetype(font_path("Noto Sans CJK JP:weight=bold"), 700)
    glyph = "帳"
    l, t, r, b = d.textbbox((0, 0), glyph, font=font)
    x = (MASTER - (r - l)) / 2 - l
    y = 262 - t
    d.text((x, y), glyph, font=font, fill=FG)
    return img


def render():
    img = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    inset = 56
    radius = 176
    box = (inset, inset, MASTER - inset, MASTER - inset)
    d.rounded_rectangle(box, radius=radius, fill=INK, outline=EDGE, width=6)

    rail_y = 268
    d.rounded_rectangle((322, rail_y, MASTER - 322, rail_y + 14), radius=7, fill=SIGNAL)

    font = ImageFont.truetype(font_path("Noto Serif CJK JP:weight=600"), 520)
    glyph = "帳"
    l, t, r, b = d.textbbox((0, 0), glyph, font=font)
    x = (MASTER - (r - l)) / 2 - l
    y = 340 - t
    d.text((x, y), glyph, font=font, fill=FG)
    return img


def main(out_dir):
    master = render()
    small = render_small()
    for size in SIZES:
        path = os.path.join(out_dir, "hicolor", f"{size}x{size}", "apps")
        os.makedirs(path, exist_ok=True)
        source = small if size <= 48 else master
        source.resize((size, size), Image.LANCZOS).save(os.path.join(path, "dev.tobari.Browser.png"))
    master.resize((128, 128), Image.LANCZOS).save(os.path.join(out_dir, "tobari-128.png"))
    master.save(os.path.join(out_dir, "tobari-1024.png"))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__)))
