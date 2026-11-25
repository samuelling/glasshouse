#!/usr/bin/env python3
"""Assemble the single-file pages (index.html, bowl.html, harp.html) from src/."""
import pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'


def inline(t, css, app):
    for tag, f in [('/*CSS*/', css), ('/*DSP*/', 'dsp.js'), ('/*PHYSICS*/', 'physics.js'), ('/*APP*/', app)]:
        body = (src / f).read_text()
        assert '</script' not in body, f
        t = t.replace(tag, body, 1)
    return t


def write(out, t):
    (root / out).write_text(t)
    print(out, len(t), 'bytes')


GLASS = dict(
    TITLE='GlassHouse · Glass', KIND='glass', ON_GLASS=' class="on"', ON_BOWL='',
    ARIA='A wine glass seen from above. Circle the rim to play; tap inside to flick it; slide the strip along the bottom to pour water.',
    HINT_B='Touch to wake the glass',
    HINT_SPAN='Circle the rim slowly, about a lap a second. The strip along the bottom pours water: slide your thumb to bend the pitch.',
    PRESS_LABEL='finger', PRESS_RANGE='min="0.2" max="3" step="0.05" value="1"', PRESS_OUT='1.00 N',
    SHEET_TITLE='The glass',
    TOUCH='''<div class="row"><label>Finger</label><div class="seg" id="cond"><button data-v="wet" class="on">wet &amp; clean</button><button data-v="dry">dry</button><button data-v="oily">oily</button></div></div>''',
    THICK_ROW='<div class="row"><label for="thick">Rim wall <em id="thickOut">1.20 mm</em></label><input id="thick" type="range" min="0.7" max="2.6" step="0.05" value="1.2"></div>',
    SIZE_MIN='70',
    SPLIT_ROW='<div class="row"><label for="split">Imperfection <em id="splitOut">0.030%</em></label><input id="split" type="range" min="0" max="0.2" step="0.005" value="0.03"></div>',
    FOOTER='crystal, water, a wet fingertip — and nothing else',
    HOW=(src / 'how-glass.html').read_text(),
)
BOWL = dict(
    TITLE='GlassHouse · Singing bowl', KIND='bowl', ON_GLASS='', ON_BOWL=' class="on"',
    ARIA='A singing bowl seen from above. Circle the rim with the puja; tap inside to strike; the strip along the bottom pours water.',
    HINT_B='Touch to wake the bowl',
    HINT_SPAN='Circle the outside of the rim slowly, about half a lap a second, and let it build. Tap inside to strike it.',
    PRESS_LABEL='puja', PRESS_RANGE='min="1" max="12" step="0.1" value="4"', PRESS_OUT='4.0 N',
    SHEET_TITLE='The bowl',
    TOUCH='''<div class="row"><label>Puja</label><div class="seg" id="stick"><button data-v="leather" class="on">leather-wrapped</button><button data-v="wood">bare wood</button></div></div>
    <div class="grid2">
      <div class="row"><label>Rub</label><div class="seg" id="sideSel"><button data-v="1" class="on">outside</button><button data-v="-1">inside</button></div></div>
      <div class="row"><label>Mallet</label><div class="seg" id="mallet"><button data-v="felt" class="on">felt</button><button data-v="wood">wood</button></div></div>
    </div>''',
    THICK_ROW='<div class="row"><label for="thick">Wall thickness <em id="thickOut">×1.00</em></label><input id="thick" type="range" min="0.6" max="1.6" step="0.02" value="1"></div>',
    SIZE_MIN='50',
    SPLIT_ROW='<div class="row"><label for="split">Hammering asymmetry <em id="splitOut">0.400%</em></label><input id="split" type="range" min="0" max="1.5" step="0.01" value="0.4"></div>',
    FOOTER='bronze, breath, a turning stick',
    HOW=(src / 'how-bowl.html').read_text(),
)

tpl = (src / 'page-template.html').read_text()
for out, d in [('index.html', GLASS), ('bowl.html', BOWL)]:
    t = tpl
    for k, v in d.items():
        t = t.replace('{{' + k + '}}', v)
    assert '{{' not in t, out
    write(out, inline(t, 'style.css', 'app.js'))

write('harp.html', inline((src / 'harp-template.html').read_text(), 'harp.css', 'harp.js'))
