#!/usr/bin/env python3
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "corpus")
os.makedirs(OUT, exist_ok=True)
rng = random.Random(20261030)
EN = "the browser keeps every page in its own process so memory adds up quickly when many tabs stay open and each one runs scripts layout and images".split()
JA = list("帳とばりの日本語表示テストこれはページの本文です画像と表とスクリプトを含みます")
TH = "ภาษาไทย ทดสอบ การแสดงผล หน้าเว็บ หน่วยความจำ แท็บ เบราว์เซอร์".split()


def para(words, n):
    return " ".join(rng.choice(words) for _ in range(n)).capitalize() + "."


def svg_chart(k):
    bars = "".join(f'<rect x="{i * 22}" y="{200 - h}" width="18" height="{h}" fill="hsl({(k * 37 + i * 9) % 360} 50% 50%)"/>' for i, h in enumerate(rng.randint(20, 190) for _ in range(30)))
    return f'<svg viewBox="0 0 660 200" width="660" height="200" role="img">{bars}</svg>'


for i in range(1, 26):
    blocks = []
    for s in range(12):
        blocks.append(f"<h2>Section {s + 1}</h2>")
        blocks.append(f"<p>{para(EN, 120)}</p>")
        blocks.append(f"<p lang='ja'>{''.join(rng.choice(JA) for _ in range(160))}。</p>")
        blocks.append(f"<p lang='th'>{' '.join(rng.choice(TH) for _ in range(40))}</p>")
        if s % 3 == 0:
            blocks.append(svg_chart(i * 13 + s))
        if s % 4 == 1:
            rows = "".join(f"<tr><td>{r}</td><td>{rng.randint(1, 9999)}</td><td>{rng.random():.4f}</td></tr>" for r in range(40))
            blocks.append(f"<table><tr><th>#</th><th>Value</th><th>Ratio</th></tr>{rows}</table>")
    script = ""
    if i % 3 == 0:
        script = """<canvas id="c" width="640" height="160"></canvas><script>
const c=document.getElementById('c').getContext('2d');let t=0;
setInterval(()=>{t++;c.clearRect(0,0,640,160);for(let k=0;k<60;k++){c.fillStyle=`hsl(${(k*6+t)%360} 60% 55%)`;c.fillRect(k*10,80+60*Math.sin((k+t)/8),8,8);}},250);
</script>"""
    if i % 5 == 0:
        script += "<script>window.blob=[];for(let k=0;k<200;k++)window.blob.push(new Array(5000).fill(k));</script>"
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bench page {i:02d}</title>
<style>body{{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px}}table{{border-collapse:collapse}}td,th{{border:1px solid #ccc;padding:2px 6px}}</style>
</head><body><h1>Bench page {i:02d} 帳 ภาษาไทย</h1>{''.join(blocks)}{script}</body></html>"""
    with open(os.path.join(OUT, f"page{i:02d}.html"), "w") as f:
        f.write(html)
print(f"wrote 25 pages to {OUT}")
