# -*- coding: utf-8 -*-
"""封面：黑地金字，后宫宫墙飞檐的剪影 + 一支垂下的银簪 + 药草叶脉。
   没有画师稿，就用几何与排版做一张不像占位的封面。"""
import math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1024, 1434
BG   = (8, 8, 9)
GOLD = (201, 155, 63)
GOLD_HI = (236, 200, 120)
DIM  = (80, 68, 42)
JADE = (96, 130, 96)
SILV = (188, 194, 200)

F = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
def font(sz): return ImageFont.truetype(F, sz)

img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)
rnd = random.Random(1417)

# ── 背景：纵向的绢纹与颗粒 ─────────────────────────────
for x in range(0, W, 3):
    a = 8 + int(7 * math.sin(x * .017)) + rnd.randint(-3, 3)
    d.line([(x, 0), (x, H)], fill=(BG[0] + a // 3, BG[1] + a // 3, BG[2] + a // 2))
grain = Image.new('L', (W, H))
gp = grain.load()
for i in range(80000):
    gp[rnd.randrange(W), rnd.randrange(H)] = rnd.randrange(36, 100)
img = Image.composite(Image.new('RGB', (W, H), (56, 48, 30)), img,
                      grain.filter(ImageFilter.GaussianBlur(.4)))
d = ImageDraw.Draw(img)

# ── 下部：宫墙与飞檐的剪影（三重，越远越淡） ───────────────
def roof(y0, w0, lift, col):
    """一段带翘角的屋脊剪影：中间平，两端上挑。"""
    cx = W // 2
    pts = []
    for t in range(-60, 61):
        x = cx + t / 60.0 * w0 / 2
        y = y0 - lift * max(0.0, abs(t / 60.0) - .55) ** 1.7 * 3.2
        pts.append((x, y))
    pts += [(cx + w0 / 2, H), (cx - w0 / 2, H)]
    d.polygon(pts, fill=col)

roof(H - 300, 1400, 90, (16, 14, 12))
roof(H - 210, 1150, 110, (22, 18, 14))
roof(H - 120, 900, 130, (30, 24, 16))
# 脊上一排瓦当的点
for i in range(-8, 9):
    x = W // 2 + i * 52
    d.ellipse([x - 4, H - 124, x + 4, H - 116], fill=DIM)

# ── 中央：垂下来的银簪（细链 + 簪身 + 流苏） ───────────────
cx = W // 2
d.line([(cx, 0), (cx, 320)], fill=(70, 74, 80), width=3)
for y in range(0, 320, 26):                      # 链节
    d.ellipse([cx - 5, y, cx + 5, y + 10], outline=(96, 100, 108), width=2)
# 簪身：细长一根，尾端一颗玉
d.polygon([(cx - 7, 330), (cx + 7, 330), (cx + 3, 700), (cx - 3, 700)], fill=SILV)
d.polygon([(cx - 3, 700), (cx + 3, 700), (cx, 760)], fill=(210, 214, 220))
d.ellipse([cx - 16, 300, cx + 16, 336], fill=JADE, outline=(140, 170, 140), width=3)
# 流苏
for k in (-1, 0, 1):
    x0 = cx + k * 22
    d.line([(cx, 336), (x0, 336 + 150 + abs(k) * 22)], fill=(150, 60, 56), width=4)
    d.ellipse([x0 - 5, 480 + abs(k) * 22, x0 + 5, 492 + abs(k) * 22], fill=(150, 60, 56))

# 簪身的高光
d.line([(cx - 3, 340), (cx - 1, 690)], fill=(240, 244, 248), width=1)

# ── 两侧：药草叶脉（对称两株，几何叶） ─────────────────────
def herb(x0, y0, s, flip):
    ang0 = -math.pi / 2
    for i in range(7):
        t = i / 6.0
        y = y0 - t * 300 * s
        L = (1 - t * .75) * 120 * s
        a = ang0 + (.85 - t * .5) * (1 if (i % 2 == flip) else -1)
        x1, y1 = x0 + math.cos(a) * L, y + math.sin(a) * L * .45
        d.line([(x0, y), (x1, y1)], fill=DIM, width=3)
        # 叶：细长菱形
        mx, my = (x0 + x1) / 2, (y + y1) / 2
        nx, ny = -(y1 - y) * .18, (x1 - x0) * .18
        d.polygon([(x0, y), (mx + nx, my + ny), (x1, y1), (mx - nx, my - ny)],
                  outline=(110, 96, 58), width=2)
    d.line([(x0, y0), (x0, y0 - 300 * s)], fill=(110, 96, 58), width=4)

herb(150, 1120, 1.0, 0)
herb(W - 150, 1120, 1.0, 1)

# ── 匾额：双线框 ───────────────────────────────────────
d.rectangle([64, 64, W - 64, H - 64], outline=(120, 100, 58), width=3)
d.rectangle([80, 80, W - 80, H - 80], outline=(70, 58, 34), width=1)

# ── 题字：竖排「藥屋」大字 + 横排副题 ─────────────────────
def vtext(x, y, txt, sz, col, gap=14):
    f = font(sz)
    for i, ch in enumerate(txt):
        bb = d.textbbox((0, 0), ch, font=f)
        w = bb[2] - bb[0]
        d.text((x - w / 2 - bb[0], y + i * (sz + gap)), ch, font=f, fill=col)

vtext(cx + 250, 170, '藥屋', 210, GOLD_HI, 30)
vtext(cx - 250, 240, '雀斑之下', 92, GOLD, 22)

sub = '後宮 · 毒与藥 · 十二局'
f = font(40)
bb = d.textbbox((0, 0), sub, font=f)
d.text(((W - bb[2] + bb[0]) / 2, H - 236), sub, font=f, fill=(150, 126, 74))

f2 = font(26)
lat = 'APOTHECA · MONOLOGVE'
bb = d.textbbox((0, 0), lat, font=f2)
d.text(((W - bb[2] + bb[0]) / 2, H - 180), lat, font=f2, fill=(96, 82, 50))

# ── 轻微暗角 ──────────────────────────────────────────
vig = Image.new('L', (W, H), 0)
dv = ImageDraw.Draw(vig)
dv.ellipse([-W * .35, -H * .25, W * 1.35, H * 1.25], fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(180))
img = Image.composite(img, Image.new('RGB', (W, H), (2, 2, 3)), vig)

img.save('st/cover.png')
print('st/cover.png', img.size)
