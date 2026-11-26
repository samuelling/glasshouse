#!/usr/bin/env python3
"""Caption the raw captures (AppStore/screenshots/raw/{iphone,ipad}) into App Store screenshots:
iPhone 6.9" 1320x2868 and iPad 13" 2064x2752, in AppStore/screenshots/{iphone,ipad}.

    node tools/shots.js iphone AppStore/screenshots/raw/iphone   # (with a local server on :8765)
    node tools/shots.js ipad   AppStore/screenshots/raw/ipad
    python3 AppStore/frame.py

Uses the app's own typefaces from assets/fonts."""
import glob, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'assets', 'fonts')
SIZES = {'iphone': (1320, 2868), 'ipad': (2064, 2752)}
INK, SOFT, ACCENT, BOWL = (230, 236, 246), (176, 188, 210), (188, 220, 255), (244, 212, 160)

# (headline, emphasised word(s) in italic accent, sub-line)
CAPTIONS = {
    'glass':   ('Circle the rim.', 'It sings.', 'A crystal wine glass, physically modelled. Nothing is sampled.'),
    'water':   ('Pour to', 'bend the pitch.', 'Slide your thumb along the strip. The water loads the wall and the note falls.'),
    'bowl':    ('A Tibetan', 'singing bowl.', 'Circle it with the puja. Bare wood rattles, just like the real thing.'),
    'harp':    ('A glass harp,', 'tuned by water.', 'Several glasses, several fingers. Or let the keys do the rubbing.'),
    'physics': ('Pure', 'physics.', 'Shell finite elements, potential-flow water, stick–slip friction. Live.'),
    'midi':    ('Bring a', 'keyboard.', 'USB and Bluetooth MIDI: each key pours exactly enough water for its note.'),
}


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def background(W, H, warm):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.hypot((x - W / 2) / (W * 1.2), (y) / (H * 0.7))
    top = np.array([26, 18, 11] if warm else [13, 18, 34], np.float32)
    mid = np.array([9, 7, 6] if warm else [6, 7, 13], np.float32)
    bot = np.array([4, 3, 3] if warm else [3, 4, 9], np.float32)
    a = np.clip(r / 0.55, 0, 1)[..., None]; b = np.clip((r - 0.55) / 0.45, 0, 1)[..., None]
    img = top * (1 - a) + mid * a
    img = img * (1 - b) + bot * b
    img += np.random.default_rng(1).normal(0, 0.7, img.shape)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB')


def frame(raw, device, key, out):
    W, H = SIZES[device]
    s = W / 1320 if device == 'iphone' else W / 1600
    warm = key == 'bowl'
    accent = BOWL if warm else ACCENT
    canvas = background(W, H, warm)
    head, em, sub = CAPTIONS[key]

    # headline: roman + italic accent, centred as one line (two if too wide)
    fh, fi = font('cormorant-garamond-latin-300-normal.woff2', int(118 * s)), font('cormorant-garamond-latin-300-italic.woff2', int(118 * s))
    gap = fh.getlength(' ')
    total = fh.getlength(head) + gap + fi.getlength(em)
    top = int(150 * s)
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    if total < W * 0.86:
        x0 = (W - total) / 2
        d.text((x0, top), head, font=fh, fill=INK + (255,), anchor='ls')
        d.text((x0 + fh.getlength(head) + gap, top), em, font=fi, fill=accent + (255,), anchor='ls')
        base = top
    else:
        d.text((W / 2, top), head, font=fh, fill=INK + (255,), anchor='ms')
        base = top + int(118 * s * 1.05)
        d.text((W / 2, base), em, font=fi, fill=accent + (255,), anchor='ms')
    # soft glow behind the headline
    glow = layer.filter(ImageFilter.GaussianBlur(int(22 * s)))
    canvas.paste(Image.new('RGB', (W, H), accent), (0, 0), glow.split()[3].point(lambda v: int(v * 0.35)))
    canvas.paste(layer, (0, 0), layer)
    d = ImageDraw.Draw(canvas)
    # thin rule and sub-line
    ry = base + int(52 * s)
    d.line([(W / 2 - 34 * s, ry), (W / 2 + 34 * s, ry)], fill=tuple(int(c * 0.55) for c in accent), width=max(2, int(2 * s)))
    fs = font('inter-latin-300-normal.woff2', int(38 * s))
    words, lines, cur = sub.split(), [], ''
    for w_ in words:
        t = (cur + ' ' + w_).strip()
        if fs.getlength(t) > W * 0.78 and cur: lines.append(cur); cur = w_
        else: cur = t
    lines.append(cur)
    for i, l in enumerate(lines):
        d.text((W / 2, ry + int(48 * s) + i * int(54 * s)), l, font=fs, fill=SOFT, anchor='ma')
    text_bottom = ry + int(48 * s) + len(lines) * int(54 * s)

    # the screenshot: scaled to fit below, rounded like the device, with a faint halo
    shot = Image.open(raw).convert('RGB')
    avail_h = H - text_bottom - int(90 * s)
    sw = min(int(W * (0.80 if device == 'iphone' else 0.84)), int(avail_h * shot.width / shot.height))
    sh = round(shot.height * sw / shot.width)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    x, y = (W - sw) // 2, H - sh - int(70 * s)
    rad = int((92 if device == 'iphone' else 46) * s * sw / 1056)
    halo = Image.new('L', (W, H), 0)
    ImageDraw.Draw(halo).rounded_rectangle([x - 10, y - 10, x + sw + 10, y + sh + 10], radius=rad + 10, fill=120)
    canvas.paste(Image.new('RGB', (W, H), tuple(int(c * 0.45) for c in accent)), (0, 0), halo.filter(ImageFilter.GaussianBlur(int(46 * s))))
    mask = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, sw - 1, sh - 1], radius=rad, fill=255)
    canvas.paste(shot, (x, y), mask)
    ImageDraw.Draw(canvas).rounded_rectangle([x - 2, y - 2, x + sw + 1, y + sh + 1], radius=rad + 2,
                                             outline=tuple(int(c * 0.35) for c in accent), width=max(2, int(3 * s)))
    canvas.save(out, optimize=True)
    print(out, canvas.size)


if __name__ == '__main__':
    for device in SIZES:
        raws = sorted(glob.glob(os.path.join(HERE, 'screenshots', 'raw', device, '*.png')))
        os.makedirs(os.path.join(HERE, 'screenshots', device), exist_ok=True)
        for raw in raws:
            name = os.path.splitext(os.path.basename(raw))[0]      # e.g. 2-water
            frame(raw, device, name.split('-', 1)[1], os.path.join(HERE, 'screenshots', device, name + '.png'))
