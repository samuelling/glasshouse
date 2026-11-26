"""GlassHouse app icon: a glass seen from above — a luminous rim with a standing-wave glow,
pale water inside, wisps of mist — on the app's near-black blue. Opaque 1024x1024 PNG."""
import sys
import numpy as np
from PIL import Image, ImageFilter

N = 1024
out = sys.argv[1] if len(sys.argv) > 1 else 'AppIcon.png'
y, x = np.mgrid[0:N, 0:N].astype(np.float64)
cx, cy = N / 2, N / 2 + 6
dx, dy = x - cx, y - cy
r = np.hypot(dx, dy)
th = np.arctan2(dy, dx)

# background: deep blue-black with a faint central bloom
bg = np.array([4, 5, 10], float)
img = np.zeros((N, N, 3)) + bg
bloom = np.exp(-(r / 430) ** 2)
img += bloom[..., None] * np.array([14, 22, 42])

def add(layer, color, k=1.0):
    global img
    img += k * layer[..., None] * np.array(color, float)

R = 300.0
# water disc: soft, slightly brighter toward the rim
water = np.clip(1 - r / (R * 0.93), 0, 1) ** 0.4 * (r < R * 0.93)
water_img = Image.fromarray((water * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))
water = np.asarray(water_img, float) / 255
add(water, [14, 24, 46], 1.0)
# faint concentric ripples in the water
rip = (0.5 + 0.5 * np.cos(r / R * 2 * np.pi * 5.5)) * water * np.clip(r / R, 0, 1) ** 2
add(rip, [18, 30, 52], 0.6)

# the rim: a thin bright ring, brightness modulated by the n=2 standing wave (4 antinodes),
# rotated so a node sits where the finger is
mode = 0.25 + 0.75 * np.cos(2 * (th - 0.6)) ** 2
ring = np.exp(-((r - R) / 4.5) ** 2)
halo = np.exp(-((r - R) / 26) ** 2)
far = np.exp(-((r - R) / 80) ** 2)
add(ring * (0.75 + 0.25 * mode), [230, 240, 255], 1.0)
add(halo * mode, [150, 200, 255], 0.55)
add(far * mode, [70, 110, 200], 0.35)
# inner lip reflection
add(np.exp(-((r - (R - 14)) / 3.0) ** 2) * (0.3 + 0.7 * np.cos(th + 2.2) ** 8), [200, 225, 255], 0.5)

# the finger: a soft bright point on the rim
fth = 0.6 + np.pi / 4 + np.pi / 2  # at a node
fx, fy = cx + R * np.cos(fth), cy + R * np.sin(fth)
fd = np.hypot(x - fx, y - fy)
add(np.exp(-(fd / 9) ** 2), [255, 255, 255], 0.9)
add(np.exp(-(fd / 40) ** 2), [170, 210, 255], 0.45)

# wisps of mist: a few curved, blurred strokes drifting around the rim
rng = np.random.default_rng(7)
mist = np.zeros((N, N))
for k in range(7):
    a0 = rng.uniform(0, 2 * np.pi); span = rng.uniform(0.8, 1.8)
    rr = R + rng.uniform(40, 150); w = rng.uniform(6, 14)
    dth = np.angle(np.exp(1j * (th - a0)))
    env = np.exp(-(dth / span) ** 2 * 3) * (np.abs(dth) < span)
    rad = rr + 18 * np.sin(dth * 3 + k)
    mist += env * np.exp(-((r - rad) / w) ** 2) * rng.uniform(0.3, 0.7)
mist = np.asarray(Image.fromarray((np.clip(mist, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(9)), float) / 255
add(mist, [120, 150, 210], 0.5)

# gentle tone map
img = 255 * (1 - np.exp(-img / 255 * 1.25)) / (1 - np.exp(-1.25))
img = np.clip(img + rng.normal(0, 0.8, img.shape), 0, 255)
Image.fromarray(img.astype(np.uint8), 'RGB').save(out, optimize=True)
print('wrote', out)
