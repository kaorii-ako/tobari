import sys, json

def srgb(c):
    c = c/255
    return c/12.92 if c <= 0.03928 else ((c+0.055)/1.055)**2.4
def lum(h):
    h = h.lstrip('#')
    r,g,b = (int(h[i:i+2],16) for i in (0,2,4))
    return 0.2126*srgb(r)+0.7152*srgb(g)+0.0722*srgb(b)
def ratio(a,b):
    la,lb = lum(a),lum(b)
    hi,lo = max(la,lb),min(la,lb)
    return (hi+0.05)/(lo+0.05)

night = {
 'bg':'#0a0a0c','chrome':'#0f0f12','surface':'#141418','raised':'#1b1b20','hover':'#23232a',
 'fg0':'#f2f2f5','fg1':'#b9b9c4','fg2':'#8f8f9c','fg3':'#6a6a77',
 'signal':'#ff6b3d','secure':'#7fb894','warn':'#d9a441','danger':'#e0574f',
}
day = {
 'bg':'#faf9f7','chrome':'#f2f1ee','surface':'#ffffff','raised':'#eceae6','hover':'#e2e0db',
 'fg0':'#17171a','fg1':'#43434b','fg2':'#61616b','fg3':'#80808b',
 'signal':'#b23410','secure':'#2f6b4a','warn':'#8a6212','danger':'#b3302a',
}

BACKDROPS = ['bg','chrome','surface','raised']
INFO_FG = ['fg0','fg1','fg2','signal','secure','warn','danger']

def check(name, t, decorative=('fg3',)):
    print(f"\n=== {name} ===")
    worst = {}
    fails = []
    for fg in INFO_FG:
        for bg in BACKDROPS:
            r = ratio(t[fg], t[bg])
            worst[fg] = min(worst.get(fg, 99), r)
    for fg in INFO_FG:
        r = worst[fg]
        ok = 'PASS' if r >= 4.5 else ('large-only' if r >= 3.0 else 'FAIL')
        if r < 4.5: fails.append((fg, r))
        print(f"  {fg:7s} worst-case on any backdrop: {r:5.2f}:1  {ok}")
    for fg in decorative:
        r = min(ratio(t[fg], t[bg]) for bg in BACKDROPS)
        print(f"  {fg:7s} (decorative, non-informational)  {r:5.2f}:1  {'>=3 ok for borders' if r>=3 else 'below 3'}")
    # focus ring must hit 3:1 against adjacent colours
    for bg in BACKDROPS:
        r = ratio(t['signal'], t[bg])
        if r < 3.0: fails.append(('signal-ring-on-'+bg, r))
    return fails

f1 = check('night (dark)', night)
f2 = check('daybreak (light)', day)
print("\nFAILURES:", f1 + f2 if (f1 or f2) else "none — all informational tokens meet AA on every backdrop")
