// App Store raw screenshots from the app's own pages (the iOS variants, with the native bridge stubbed),
// captured mid-play at exact device sizes. Usage: node shots.js iphone|ipad outdir
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const dev = process.argv[2] || 'iphone', outDir = process.argv[3] || '/tmp/raw-' + dev;
const VP = dev === 'iphone' ? { width: 440, height: 956, deviceScaleFactor: 3 } : { width: 1032, height: 1376, deviceScaleFactor: 2 };
fs.mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = 'http://localhost:8765/ios/GlassHouse/Web/';

(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'] });
  async function open(pg) {
    const p = await b.newPage();
    await p.setViewport({ ...VP, isMobile: true, hasTouch: true });
    p.on('pageerror', e => console.log('PAGEERR', e.message));
    await p.evaluateOnNewDocument(() => { window.webkit = { messageHandlers: { gh: { postMessage: () => {} } } }; });
    await p.goto(BASE + pg); await sleep(2500);
    return p;
  }
  // circle the rim with touches (one per glass), capture while still touching
  async function rub(p, circles, secs, rps, shotName, before) {
    if (circles.length === 1) {
      const c = circles[0], at = t => [c.cx + c.R * Math.cos(2 * Math.PI * rps * t), c.cy + c.R * Math.sin(2 * Math.PI * rps * t)];
      await p.mouse.move(...at(0)); await p.mouse.down();
      const t0 = Date.now();
      const db = () => p.evaluate(() => { const s = window.__glasshouse.snap; return s ? 20 * Math.log10(Math.max(1e-7, s.prms) / 2e-5) : 0; });
      let lastCheck = 0;
      while (true) {
        const t = (Date.now() - t0) / 1000;
        await p.mouse.move(...at(t));
        if (t > secs && t - lastCheck > 0.15) { lastCheck = t; if ((await db()) > 68 || t > secs + 10) break; }
      }
      let going = true;
      const keep = (async () => { while (going) await p.mouse.move(...at((Date.now() - t0) / 1000)).catch(() => {}); })();
      await p.screenshot({ path: `${outDir}/${shotName}.png` });
      going = false; await keep; await p.mouse.up();
      console.log('shot', shotName, await p.evaluate(() => { const s = window.__glasshouse.snap; return s ? (20 * Math.log10(Math.max(1e-7, s.prms) / 2e-5)).toFixed(0) + ' dB' : ''; }));
      return;
    }
    const cdp = await p.target().createCDPSession();
    const pts = t => circles.map((c, i) => { const th = 2 * Math.PI * rps * t + c.ph; return { x: c.cx + c.R * Math.cos(th), y: c.cy + c.R * Math.sin(th), id: i, radiusX: 6, radiusY: 6, force: 1 }; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
    const t0 = Date.now();
    while (Date.now() - t0 < secs * 1000) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts((Date.now() - t0) / 1000) }); await sleep(12); }
    if (before) await before();
    // keep moving through the capture so the finger glow and wave stay live
    let going = true;
    const keep = (async () => { while (going) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts((Date.now() - t0) / 1000) }).catch(() => {}); await sleep(12); } })();
    await sleep(60);
    await p.screenshot({ path: `${outDir}/${shotName}.png` });
    going = false; await keep;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    console.log('shot', shotName, await p.evaluate(() => { const s = window.__glasshouse && window.__glasshouse.snap; return s ? (20 * Math.log10(Math.max(1e-7, s.prms) / 2e-5)).toFixed(0) + ' dB' : ''; }));
  }
  async function glassCircle(p, extra = 0) {
    return p.evaluate(extra => { const c = document.getElementById('top').getBoundingClientRect(), g = window.__glasshouse;
      return { cx: c.left + g.center.cx, cy: c.top + g.center.cy, R: g.rimPx + extra, ph: 0 }; }, extra);
  }
  const setFill = (p, f) => p.evaluate(f => { const e = document.getElementById('fill'); e.value = f * 100; e.dispatchEvent(new Event('input')); }, f);
  const n = { i: 1 };
  const name = s => `${n.i++}-${s}`;

  // 1. the glass singing
  let p = await open('index.html');
  await setFill(p, 0.18); await sleep(1500);
  await rub(p, [await glassCircle(p)], 3.5, 1, name('glass'));
  // 2. water: side view on, glass partly full, still singing
  await p.evaluate(() => { if (!document.querySelector('.inset.on')) document.getElementById('insetBtn').click(); }); await sleep(600);
  await setFill(p, 0.62); await sleep(1800);
  await rub(p, [await glassCircle(p)], 3.5, 0.9, name('water'));
  await p.close();

  // 3. the bowl
  p = await open('bowl.html'); await sleep(1500);
  await rub(p, [await glassCircle(p, 6)], 6, 0.5, name('bowl'));
  await p.close();

  // 4. the harp: several glasses at once
  p = await open('harp.html');
  if (dev === 'ipad') await p.evaluate(() => { const b = [...document.querySelectorAll('#count button')].find(x => x.dataset.v === '6'); if (b) b.click(); });
  await p.waitForFunction(() => window.__harp.glasses.length && window.__harp.glasses.every(g => isFinite(g.f)), { timeout: 90000 });
  await sleep(1500);
  await p.evaluate(dev => { const cb = document.getElementById('autorub'); if (!cb.checked) cb.click();
    const gs = window.__harp.glasses, pick = dev === 'ipad' ? [0, 2, 4] : [1, 3, 4];
    pick.filter(i => gs[i]).forEach(i => window.__harp.noteOn(Math.round(69 + 12 * Math.log2(gs[i].f / 440)), 100)); }, dev);
  await sleep(5000);
  await p.screenshot({ path: `${outDir}/${name('harp')}.png` }); console.log('shot harp', await p.evaluate(() => window.__harp.glasses.map(g => g.keyRub ? '*' : '.').join('')));

  await p.close();

  // 5. the physics: the "How it's modeled" sheet
  p = await open('index.html');
  await p.evaluate(() => document.getElementById('physicsBtn').click()); await sleep(1500);
  await p.screenshot({ path: `${outDir}/${name('physics')}.png` }); console.log('shot physics');
  await p.close();

  // 6. MIDI + settings: the sheet from the top, with a keyboard "connected"
  p = await open('index.html');
  await p.evaluate(() => { GHNative.devices(['Arturia KeyStep 37']); document.getElementById('menuBtn').click(); }); await sleep(1200);
  await p.screenshot({ path: `${outDir}/${name('midi')}.png` }); console.log('shot midi');
  await p.close();
  await b.close();
})();
