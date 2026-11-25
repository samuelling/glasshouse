(() => {
  'use strict';
  const GP = window.GlassPhysics;
  const $ = id => document.getElementById(id);
  const TAU = Math.PI * 2;
  const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ALPHA = 0.37;            // orientation of the vessel's tiny asymmetry
  const BOWL = (window.GH && window.GH.kind) === 'bowl';
  const EXAG = BOWL ? 8 : 35;    // visual exaggeration of rim motion
  const OUT_PA = 0.8;            // pressure (Pa) that maps to digital full scale before volume
  const FILL_MAX = 0.95;

  const S = BOWL
    ? { shape: 'thadobati', material: 'bellBronze', tScale: 1, scale: 1, fill: 0, FN: 4.0, stick: 'leather', side: 1, mallet: 'felt', split: 4e-3, reverb: 0.35, vol: 0.8, inset: true, snap: 'free' }
    : { shape: 'bordeaux', material: 'leadCrystal', tRim: 1.2e-3, scale: 1, fill: 0, FN: 1.0, cond: 'wet', split: 3e-4, reverb: 0.35, vol: 0.8, inset: true, snap: 'free' };
  const kindOK = v => (v.kind || 'glass') === (BOWL ? 'bowl' : 'glass') || v.kind === 'both';
  let glass = null, wet = null, modeByKey = new Map(), prof = null;
  let table = null, tableJob = 0;            // wet-mode solutions at a ladder of fills, for instant pouring
  let audio = null, snap = null, started = false;

  // ------------------------------------------------------------ UI wiring
  const shapeSel = $('shape'), matSel = $('material');
  for (const [k, v] of Object.entries(GP.SHAPES)) if (kindOK(v)) shapeSel.add(new Option(v.name, k));
  for (const [k, v] of Object.entries(GP.MATERIALS)) if (kindOK(v)) matSel.add(new Option(v.name, k));
  shapeSel.value = S.shape; matSel.value = S.material;

  function paintRange(el) { const p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty('--p', p + '%'); }
  document.querySelectorAll('input[type=range]').forEach(el => { paintRange(el); el.addEventListener('input', () => paintRange(el)); });

  let rebuildT = 0;
  const scheduleRebuild = () => { clearTimeout(rebuildT); rebuildT = setTimeout(build, 220); };
  shapeSel.onchange = () => { S.shape = shapeSel.value; const sm = GP.SHAPES[S.shape].mat; if (sm) { S.material = sm; matSel.value = sm; } else if (BOWL && S.material === 'fusedQuartz') { S.material = 'bellBronze'; matSel.value = 'bellBronze'; } build(); };
  matSel.onchange = () => { S.material = matSel.value; build(); };
  $('thick').oninput = e => { if (BOWL) { S.tScale = +e.target.value; $('thickOut').textContent = '×' + S.tScale.toFixed(2); } else { S.tRim = +e.target.value * 1e-3; $('thickOut').textContent = (+e.target.value).toFixed(2) + ' mm'; } scheduleRebuild(); };
  $('size').oninput = e => { S.scale = +e.target.value / 100; $('sizeOut').textContent = e.target.value + '%'; scheduleRebuild(); };
  const setPress = v => { S.FN = v; const t = S.FN.toFixed(BOWL ? 1 : 2) + ' N'; $('pressOut').textContent = t; send({ t: 'finger', f: { FN: S.FN } }); };
  $('press').oninput = e => setPress(+e.target.value);
  $('split').oninput = e => { S.split = +e.target.value / 100; $('splitOut').textContent = (+e.target.value).toFixed(3) + '%'; sendModes(); };
  $('reverb').oninput = e => { S.reverb = +e.target.value / 100; $('reverbOut').textContent = e.target.value + '%'; applyMix(); };
  $('vol').oninput = e => { S.vol = +e.target.value / 100; $('volOut').textContent = e.target.value + '%'; applyMix(); };
  let fillRAF = 0;
  function setFill(f, fromSlider) {
    S.fill = clamp(f, 0, FILL_MAX);
    if (!fromSlider) { $('fill').value = (S.fill * 100).toFixed(1); paintRange($('fill')); }
    if (!fillRAF) fillRAF = requestAnimationFrame(() => { fillRAF = 0; if (glass) updateWet(); });
  }
  $('fill').oninput = e => setFill(+e.target.value / 100, true);
  const seg = (id, fn) => document.querySelectorAll('#' + id + ' button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#' + id + ' button').forEach(x => x.classList.toggle('on', x === b)); fn(b.dataset.v);
  });
  if (BOWL) {
    seg('stick', v => { S.stick = v; sendExciter(); });
    seg('sideSel', v => { S.side = +v; sendExciter(); });
    seg('mallet', v => { S.mallet = v; });
  } else seg('cond', v => { S.cond = v; send({ t: 'finger', f: { cond: S.cond } }); });
  seg('snapSel', v => { S.snap = v; });
  function sendExciter() { if (BOWL) send({ t: 'exciter', e: { kind: 'puja', stick: S.stick, side: S.side } }); }
  const MALLET = { felt: { force: 45, dur: 2.5e-3 }, wood: { force: 70, dur: 4e-4 } };
  // dock + sheet
  $('insetBtn').onclick = () => { S.inset = !S.inset; $('inset').classList.toggle('on', S.inset); $('insetBtn').classList.toggle('on', S.inset); resize(); };
  $('menuBtn').onclick = () => $('sheet').classList.add('on');
  $('sheetClose').onclick = () => $('sheet').classList.remove('on');
  $('sheet').addEventListener('pointerdown', e => { if (e.target.id === 'sheet') $('sheet').classList.remove('on'); });

  // ------------------------------------------------------------ physics
  function busy(on, msg) { $('busy').classList.toggle('on', on); if (msg) $('busyMsg').textContent = msg; }
  const wetOpts = () => BOWL ? { perN: 2, fmax: 9000, shapes: true, contactDepth: 0.015 * S.scale } : { perN: 2, fmax: 12000, shapes: true };
  function build() {
    busy(true, BOWL ? 'listening to the bronze…' : 'listening to the glass…');
    setTimeout(() => {
      const t0 = performance.now();
      glass = GP.buildGlass(BOWL ? { shape: S.shape, material: S.material, scale: S.scale, tScale: S.tScale, Ne: 36, nKeep: 8 } : { shape: S.shape, material: S.material, tRim: S.tRim, scale: S.scale, Ne: 36, nKeep: 8 });
      prof = GP.profile(glass, 120);
      table = null;
      updateWet();
      busy(false);
      console.log('shell solve', (performance.now() - t0).toFixed(0), 'ms');
      buildTable();
    }, 30);
  }
  // a mode's shape has an arbitrary sign per solve; keep it continuous so pouring never flips a vibrating mode
  const SIGNED = ['rimV', 'rimR', 'rimA', 'wl'];
  function alignTo(w, ref) {
    if (!ref) return w;
    const rk = new Map(ref.modes.map(m => [m.key, m]));
    for (const m of w.modes) {
      const r = rk.get(m.key); if (!r || !m.shape || !r.shape) continue;
      let d = 0; for (let i = 0; i < m.shape.length; i++) d += m.shape[i] * r.shape[i];
      if (d < 0) { for (const k of SIGNED) m[k] = -m[k]; m.shape = m.shape.map(x => -x); }
    }
    return w;
  }
  function buildTable() {
    const job = ++tableJob, g = glass, N = 44, rows = [];
    let i = 0;
    const step = () => {
      if (job !== tableJob) return;
      const t0 = performance.now();
      while (i <= N && performance.now() - t0 < 25) {
        const u = i / N, fill = FILL_MAX * (1 - Math.pow(1 - u, 1.5));   // denser near the brim, where pitch moves fastest
        const w = alignTo(GP.wetModes(g, fill, wetOpts()), rows.length ? rows[rows.length - 1] : null);
        w.f2 = (w.modes.find(m => m.n === 2 && m.m === 0) || {}).f;
        rows.push(w); i++;
      }
      if (i <= N) setTimeout(step, 0);
      else { table = rows; updateWet(); drawCurve(); }
    };
    step();
  }
  const LERP = ['f', 'omega', 'fDry', 'zeta', 'Q', 'zMat', 'zRad', 'zVis', 'zSup', 'rimV', 'rimR', 'rimA', 'wl', 'G'];
  function wetAt(fill) {
    if (!table) return alignTo(GP.wetModes(glass, fill, wetOpts()), wet);
    let i = 0; while (i < table.length - 2 && table[i + 1].fill < fill) i++;
    const A = table[i], B = table[i + 1], t = clamp((fill - A.fill) / (B.fill - A.fill), 0, 1);
    const bk = new Map(B.modes.map(m => [m.key, m]));
    const modes = A.modes.map(a => {
      const b = bk.get(a.key); if (!b) return Object.assign({}, a);
      const m = Object.assign({}, a); for (const k of LERP) m[k] = a[k] + (b[k] - a[k]) * t;
      m.shape = t < 0.5 ? a.shape : b.shape; return m;
    });
    return { modes, fill, h: A.h + (B.h - A.h) * t, volume: A.volume + (B.volume - A.volume) * t, contactS: A.contactS, f2: A.f2 + (B.f2 - A.f2) * t };
  }
  function updateWet() {
    wet = wetAt(S.fill);
    wet.rc = glass.geo.at(wet.contactS).r;
    modeByKey = new Map(wet.modes.map(m => [m.key, m]));
    $('fillOut').textContent = `${Math.round(S.fill * 100)}% · ${Math.round(wet.volume * 1e6)} mL`;
    sendModes(); renderTable(); drawCurve();
  }
  function sendModes() {
    if (!wet) return;
    const modes = wet.modes.map(({ shape, ...m }) => m);
    send({ t: 'modes', modes, opt: { split: S.split, alpha: ALPHA, Rrim: wet.rc || glass.geo.rimR } });
  }
  // pitch <-> water, read off the solved ladder (f2 falls monotonically as water rises)
  function pitchRange() { return table ? { hi: table[0].f2, lo: table[table.length - 1].f2 } : null; }
  function fillForPitch(hz) {
    if (!table) return S.fill;
    if (hz >= table[0].f2) return 0;
    for (let i = 0; i < table.length - 1; i++) {
      const a = table[i], b = table[i + 1];
      if (hz <= a.f2 && hz >= b.f2) { const t = Math.log(a.f2 / hz) / Math.log(a.f2 / b.f2); return a.fill + (b.fill - a.fill) * t; }
    }
    return FILL_MAX;
  }

  // ------------------------------------------------------------ modes table + curve (in the sheet)
  function renderTable() {
    const tb = $('modeTable').tBodies[0]; tb.innerHTML = '';
    for (const m of wet.modes) {
      const tot = m.zeta, tr = document.createElement('tr'); tr.dataset.key = m.key;
      const pc = x => (100 * x / tot).toFixed(1) + '%';
      tr.innerHTML = `<td>(${m.n},${m.m})</td><td>${fmtHz(m.f)}</td><td>${fmtHz(m.fDry)}</td><td>${Math.round(m.Q)}</td>` +
        `<td class="bar"><div class="lb"><i class="l-mat" style="width:${pc(m.zMat)}"></i><i class="l-rad" style="width:${pc(m.zRad)}"></i><i class="l-vis" style="width:${pc(m.zVis)}"></i><i class="l-sup" style="width:${pc(m.zSup)}"></i></div></td>`;
      tb.appendChild(tr);
    }
  }
  const fmtHz = f => f >= 1000 ? (f / 1000).toFixed(2) + ' k' : f.toFixed(1);
  const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const midiOf = f => 69 + 12 * Math.log2(f / 440);
  const nameOf = m => NOTES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
  function drawCurve() {
    const cv = $('curveCv'); if (!cv.width) return;
    const c = cv.getContext('2d'), w = cv.width / dpr, h = cv.height / dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    if (!table) { c.fillStyle = 'rgba(200,215,240,.4)'; c.font = 'italic 13px "Cormorant Garamond", serif'; c.fillText('tracing the curve…', 10, 22); return; }
    const pts = table.map(r => ({ f: r.fill, hz: r.f2 })), fmin = pts[pts.length - 1].hz, fmax = pts[0].hz;
    const pad = { l: 40, r: 10, t: 8, b: 20 }, X = f => pad.l + f / FILL_MAX * (w - pad.l - pad.r), Y = hz => pad.t + (1 - (hz - fmin * 0.98) / (fmax * 1.01 - fmin * 0.98)) * (h - pad.t - pad.b);
    c.strokeStyle = 'rgba(160,180,210,.10)'; c.lineWidth = 1; c.fillStyle = 'rgba(170,185,210,.5)'; c.font = '10px "IBM Plex Mono", monospace';
    for (const f of [0, 0.25, 0.5, 0.75, 0.95]) { c.beginPath(); c.moveTo(X(f), pad.t); c.lineTo(X(f), h - pad.b); c.stroke(); c.textAlign = 'center'; c.fillText(Math.round(f * 100) + '%', X(f), h - 6); }
    c.textAlign = 'right'; for (const hz of [fmin, (fmin + fmax) / 2, fmax]) c.fillText(Math.round(hz), pad.l - 6, Y(hz) + 3);
    c.strokeStyle = 'rgba(150,205,255,.8)'; c.lineWidth = 1.5; c.shadowColor = 'rgba(150,205,255,.8)'; c.shadowBlur = 6;
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(X(p.f), Y(p.hz)) : c.moveTo(X(p.f), Y(p.hz))); c.stroke(); c.shadowBlur = 0;
    if (wet && isFinite(wet.f2)) { c.fillStyle = '#eef4ff'; c.beginPath(); c.arc(X(Math.min(FILL_MAX, S.fill)), Y(wet.f2), 3.5, 0, TAU); c.fill(); }
  }

  // ------------------------------------------------------------ audio
  function send(m) { if (audio) audio.send(m); }
  const WRAP = `
class GlassProc extends AudioWorkletProcessor {
  constructor() { super(); this.v = new globalThis.GlassDSP.GlassVoice(sampleRate); this.n = 0;
    this.port.onmessage = e => { const m = e.data;
      if (m.t === 'modes') this.v.setModes(m.modes, m.opt); else if (m.t === 'finger') this.v.setFinger(m.f); else if (m.t === 'exciter') this.v.setExciter(m.e);
      else if (m.t === 'tap') this.v.tap(m.theta, m.force, m.dur); else if (m.t === 'gain') this.v.gain = m.g; }; }
  process(inp, out) { const o = out[0]; const L = o[0], R = o[1] || o[0]; this.v.process(L, R, L.length);
    if (++this.n % 5 === 0) this.port.postMessage(this.v.snapshot()); return true; }
}
registerProcessor('glass-proc', GlassProc);`;

  function makeIR(ctx, secs) {
    const sr = ctx.sampleRate, n = Math.floor(sr * secs), b = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, k = Math.min(0.93, 0.25 + t * 0.8);
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        d[i] = lp * Math.exp(-6.9 * t / secs) * (t < 0.018 ? 0 : 1) * 2.2;
      }
      for (const [dt, a] of [[0.019, 0.45], [0.029, 0.32], [0.041, 0.24], [0.057, 0.18]]) { const j = Math.floor((dt + c * 0.004) * sr); if (j < n) d[j] += a; }
    }
    return b;
  }
  async function startAudio() {
    if (audio) { if (audio.ctx.state !== 'running') audio.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    const queue = []; audio = { ctx, send: m => queue.push(m) };
    ctx.resume();
    const src = $('dsp-src').textContent;
    const master = ctx.createGain(), comp = ctx.createDynamicsCompressor(), dry = ctx.createGain(), wetG = ctx.createGain(), conv = ctx.createConvolver();
    comp.threshold.value = -8; comp.knee.value = 6; comp.ratio.value = 10; comp.attack.value = 0.002; comp.release.value = 0.2;
    conv.buffer = makeIR(ctx, 3.2);
    dry.connect(comp); conv.connect(wetG); wetG.connect(comp); comp.connect(master); master.connect(ctx.destination);
    audio.master = master; audio.dry = dry; audio.wetG = wetG;
    let node;
    try {
      const url = URL.createObjectURL(new Blob([src + '\n' + WRAP], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      node = new AudioWorkletNode(ctx, 'glass-proc', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.port.onmessage = e => { snap = e.data; };
      audio.send = m => node.port.postMessage(m);
    } catch (err) {
      console.warn('AudioWorklet unavailable, using ScriptProcessor', err);
      if (!window.GlassDSP) (new Function(src))();
      const V = new window.GlassDSP.GlassVoice(ctx.sampleRate);
      node = ctx.createScriptProcessor(512, 0, 2);
      node.onaudioprocess = e => { V.process(e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1), e.outputBuffer.length); snap = V.snapshot(); };
      audio.send = m => { if (m.t === 'modes') V.setModes(m.modes, m.opt); else if (m.t === 'finger') V.setFinger(m.f); else if (m.t === 'exciter') V.setExciter(m.e); else if (m.t === 'tap') V.tap(m.theta, m.force, m.dur); else if (m.t === 'gain') V.gain = m.g; };
    }
    node.connect(dry); node.connect(conv);
    audio.node = node;
    applyMix();
    send({ t: 'gain', g: 1 / OUT_PA });
    if (BOWL) sendExciter(); else send({ t: 'finger', f: { FN: S.FN, cond: S.cond } });
    send({ t: 'finger', f: { FN: S.FN } });
    sendModes();
    for (const m of queue) audio.send(m);
  }
  function applyMix() {
    if (!audio || !audio.master) return;
    const t = audio.ctx.currentTime;
    audio.master.gain.setTargetAtTime(S.vol * S.vol * 1.4, t, 0.03);
    audio.dry.gain.setTargetAtTime(1 - 0.5 * S.reverb, t, 0.03);
    audio.wetG.gain.setTargetAtTime(1.0 * S.reverb, t, 0.03);
  }

  // ------------------------------------------------------------ stage geometry
  const top = $('top'), tctx = top.getContext('2d');
  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, pxPerM = 1, strip = null;
  function resize() {
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const r = top.getBoundingClientRect(); W = r.width; H = r.height;
    top.width = Math.round(W * dpr); top.height = Math.round(H * dpr);
    for (const cv of [$('sideCv'), $('curveCv')]) { const b = cv.getBoundingClientRect(); cv.width = Math.round(b.width * dpr); cv.height = Math.round(b.height * dpr); }
    drawCurve();
  }
  new ResizeObserver(resize).observe(document.body);

  const FOOT_R = 0.039;
  function layout() {
    // the water strip runs along the bottom, where the thumb of the hand holding the phone rests
    const sh = clamp(H * 0.14, 62, 96), padX = clamp(W * 0.105, 40, 64);
    strip = { x: padX, w: W - 2 * padX, y: H - sh * 0.62, h: sh, top: H - sh };
    const gh = H - sh;
    cx = W / 2 + (S.inset ? W * 0.06 : 0); cy = gh / 2 + 6;
    const rMax = BOWL ? Math.max(glass.geo.rMaxOuter, glass.geo.rimR) * 1.18 : Math.max(glass.geo.rMaxOuter, FOOT_R * S.scale, glass.geo.rimR * 1.15);
    pxPerM = (S.inset ? 0.42 : 0.46) * Math.min(W, gh) / rMax;
  }
  // low (full) on the left, high (empty) on the right, like a keyboard
  const xOfHz = hz => { const r = pitchRange(); return strip.x + Math.log(hz / r.lo) / Math.log(r.hi / r.lo) * strip.w; };
  const hzOfX = x => { const r = pitchRange(); return r.lo * Math.pow(r.hi / r.lo, clamp((x - strip.x) / strip.w, 0, 1)); };

  // ------------------------------------------------------------ pointers: rim (rub / tap) and the water strip
  const P = { id: null, down: false, theta: 0, omega: 0, lastT: 0, lastTh: 0 };
  const STRIP = { id: null, x: 0, target: null };
  const capture = (el, id) => { try { el.setPointerCapture(id); } catch (_) {} };
  function local(e) { const r = top.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function polar(e) { const l = local(e), x = l.x - cx, y = l.y - cy; return { r: Math.hypot(x, y) / pxPerM, th: Math.atan2(y, x) }; }
  function stripTo(x) {
    if (!table) return;
    let hz = hzOfX(x);
    if (S.snap === 'semi') { const r = pitchRange(); hz = clamp(440 * Math.pow(2, (Math.round(midiOf(hz)) - 69) / 12), r.lo, r.hi); }
    STRIP.target = hz; setFill(fillForPitch(hz));
  }
  top.addEventListener('pointerdown', e => {
    e.preventDefault();
    startAudio();
    if (!started) { started = true; $('hint').classList.add('gone'); }
    if (!glass) return;
    const l = local(e);
    if (strip && l.y >= strip.top) {                         // the water strip
      if (STRIP.id !== null) return;
      STRIP.id = e.pointerId; capture(top, e.pointerId); STRIP.x = l.x; stripTo(l.x); return;
    }
    if (P.id !== null) return;
    const p = polar(e), R = glass.geo.rimR, tol = Math.max(0.2 * R, 22 / pxPerM);
    if (Math.abs(p.r - R) <= tol || p.r > R) {
      P.id = e.pointerId; capture(top, e.pointerId); top.classList.add('rubbing');
      P.down = true; P.theta = p.th; P.lastTh = p.th; P.lastT = e.timeStamp; P.omega = 0;
      send({ t: 'finger', f: { down: true, theta: p.th, omega: 0, FN: S.FN, cond: S.cond } });
    } else {
      if (BOWL) { const M = MALLET[S.mallet]; send({ t: 'tap', theta: p.th, force: M.force * (0.5 + 0.5 * Math.min(1, p.r / R)), dur: M.dur }); }
      else send({ t: 'tap', theta: p.th, force: 4 + 6 * Math.min(1, p.r / R) });
      flashes.push({ th: p.th, t: performance.now() });
    }
  }, { passive: false });
  top.addEventListener('pointermove', e => {
    if (e.pointerId === STRIP.id) { const l = local(e); STRIP.x = l.x; stripTo(l.x); return; }
    if (e.pointerId !== P.id || !P.down) return;
    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null; if (!evs || !evs.length) evs = [e];
    for (const ev of evs) {
      const p = polar(ev), dt = Math.max(1, ev.timeStamp - P.lastT) / 1000, d = wrap(p.th - P.lastTh);
      P.omega += (d / dt - P.omega) * (1 - Math.exp(-dt / 0.045));
      P.theta += d; P.lastTh = p.th; P.lastT = ev.timeStamp;
    }
    send({ t: 'finger', f: { theta: P.theta, omega: P.omega } });
  });
  function endPointer(e) {
    if (e.pointerId === STRIP.id) { STRIP.id = null; STRIP.target = null; return; }
    if (e.pointerId !== P.id) return;
    P.id = null; P.down = false; P.omega = 0; top.classList.remove('rubbing');
    send({ t: 'finger', f: { down: false } });
  }
  top.addEventListener('pointerup', endPointer); top.addEventListener('pointercancel', endPointer);
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === ' ' && audio) { send({ t: 'tap', theta: Math.PI / 2, force: BOWL ? 45 : 6, dur: BOWL ? 2.5e-3 : 4e-4 }); e.preventDefault(); }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && table) {   // step the water a semitone
      const cur = midiOf(wet.f2), r = pitchRange(), m = Math.round(cur) + (e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1);
      setFill(fillForPitch(clamp(440 * Math.pow(2, (m - 69) / 12), r.lo, r.hi))); e.preventDefault();
    }
  });

  // ------------------------------------------------------------ analysis of the live vibration
  const flashes = [], drops = [];
  let strobe = 0, lastFrame = performance.now(), glow = 0;
  const NTH = 240, envR = new Float64Array(NTH), dispR = new Float64Array(NTH), envW = new Float64Array(NTH);
  function analyse() {
    envR.fill(0); dispR.fill(0); envW.fill(0);
    let dom = null, domA = 0, rimMax = 0;
    if (!snap || !wet) return { dom, rimMax, pairs: new Map() };
    const pairs = new Map();
    for (let k = 0; k < snap.keys.length; k++) {
      const key = snap.keys[k], base = key.slice(0, -1), m = modeByKey.get(base); if (!m) continue;
      let p = pairs.get(base); if (!p) { p = { m, a: [0, 0], b: [0, 0] }; pairs.set(base, p); }
      const z = [snap.amps[2 * k], snap.amps[2 * k + 1]];
      if (key.endsWith('B')) p.b = z; else p.a = z;
    }
    const cs = Math.cos(strobe), sn = Math.sin(strobe);
    for (const p of pairs.values()) {
      const { m, a, b } = p, amp = Math.hypot(a[0], a[1], b[0], b[1]) * Math.abs(m.rimR);
      if (amp > domA) { domA = amp; dom = m; }
      if (amp < 1e-9) continue;
      for (let i = 0; i < NTH; i++) {
        const th = TAU * i / NTH - ALPHA, c = Math.cos(m.n * th), s = Math.sin(m.n * th);
        const re = a[0] * c + b[0] * s, im = a[1] * c + b[1] * s;
        const xr = m.rimR * re, xi = m.rimR * im;
        envR[i] += xr * xr + xi * xi;
        dispR[i] += xr * cs - xi * sn;
        const wr = m.wl * re, wi = m.wl * im; envW[i] += wr * wr + wi * wi;
      }
    }
    for (let i = 0; i < NTH; i++) { envR[i] = Math.sqrt(envR[i]); envW[i] = Math.sqrt(envW[i]); rimMax = Math.max(rimMax, envR[i]); }
    return { dom, rimMax, pairs };
  }

  // ------------------------------------------------------------ atmosphere: drifting mist and motes
  const HUE = BOWL ? [[255, 196, 128], [255, 160, 150], [240, 210, 170]] : [[150, 195, 255], [190, 170, 255], [170, 230, 240]];
  const wisps = Array.from({ length: 7 }, (_, i) => ({ x: Math.random(), y: Math.random(), r: 0.35 + 0.35 * Math.random(), sx: 0.02 + 0.04 * Math.random(), sy: 0.015 + 0.03 * Math.random(), ph: Math.random() * TAU, c: HUE[i % 3], e: 0.45 + 0.4 * Math.random() }));
  const motes = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), v: 0.004 + 0.01 * Math.random(), s: 0.4 + 1.2 * Math.random(), ph: Math.random() * TAU }));
  function drawAtmosphere(c, t, level) {
    for (const w of wisps) {
      const x = (w.x + Math.sin(t * w.sx + w.ph) * 0.18) * W, y = (w.y + Math.cos(t * w.sy + w.ph * 1.3) * 0.14) * H, r = w.r * Math.max(W, H);
      const a = 0.035 + 0.09 * level;
      c.save(); c.translate(x, y); c.rotate(w.ph + t * 0.01); c.scale(1, w.e);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, `rgba(${w.c[0]},${w.c[1]},${w.c[2]},${a})`); g.addColorStop(0.5, `rgba(${w.c[0]},${w.c[1]},${w.c[2]},${a * 0.35})`); g.addColorStop(1, `rgba(${w.c[0]},${w.c[1]},${w.c[2]},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.restore();
    }
    for (const m of motes) {
      m.y -= m.v * 0.016 * (1 + 2 * level); m.x += Math.sin(t * 0.3 + m.ph) * 0.0003;
      if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
      const a = (0.18 + 0.35 * level) * (0.5 + 0.5 * Math.sin(t * 0.8 + m.ph));
      c.fillStyle = `rgba(230,238,255,${a})`; c.beginPath(); c.arc(m.x * W, m.y * H, m.s, 0, TAU); c.fill();
    }
  }

  // ------------------------------------------------------------ the vessel
  function drawTop(an, now) {
    const c = tctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    if (!glass) return;
    layout();
    const t = now / 1000;
    const spl = snap ? 20 * Math.log10(Math.max(1e-7, snap.prms) / 2e-5) : 0;
    glow += (clamp((spl - 35) / 45, 0, 1) - glow) * 0.06;
    drawAtmosphere(c, t, glow);
    const g = glass.geo, R = g.rimR * pxPerM, tr = g.rim.t * pxPerM;
    const X = EXAG * pxPerM, lim = 0.16 * R;
    // breathing halo around the vessel when it sings
    if (glow > 0.01) {
      const hc = BOWL ? '255,205,140' : '170,215,255';
      const hg = c.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * (1.5 + 0.3 * glow));
      hg.addColorStop(0, `rgba(${hc},0)`); hg.addColorStop(0.35, `rgba(${hc},${0.16 * glow})`); hg.addColorStop(1, `rgba(${hc},0)`);
      c.fillStyle = hg; c.beginPath(); c.arc(cx, cy, R * 1.9, 0, TAU); c.fill();
    }
    if (BOWL) drawBowlBody(c, g, R);
    else {
      const fR = FOOT_R * S.scale * pxPerM;                     // foot, faint through the bowl
      c.strokeStyle = 'rgba(200,220,255,.07)'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, fR, 0, TAU); c.stroke();
      const bR = g.rMaxOuter * pxPerM;
      if (bR > R + 2) {
        const bg = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, bR);
        bg.addColorStop(0, 'rgba(210,230,255,0)'); bg.addColorStop(0.85, 'rgba(210,230,255,.05)'); bg.addColorStop(1, 'rgba(210,230,255,.12)');
        c.fillStyle = bg; c.beginPath(); c.arc(cx, cy, bR, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(220,235,255,.14)'; c.lineWidth = 0.8; c.beginPath(); c.arc(cx, cy, bR, 0, TAU); c.stroke();
      }
      const ig = c.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R);
      ig.addColorStop(0, 'rgba(230,240,255,.05)'); ig.addColorStop(0.7, 'rgba(160,190,230,.02)'); ig.addColorStop(1, 'rgba(200,220,255,.09)');
      c.fillStyle = ig; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
      const sr = Math.max(2, g.inner.r[0] * pxPerM), sg = c.createRadialGradient(cx, cy, 0, cx, cy, sr * 2);
      sg.addColorStop(0, 'rgba(230,240,255,.14)'); sg.addColorStop(1, 'rgba(230,240,255,0)'); c.fillStyle = sg; c.beginPath(); c.arc(cx, cy, sr * 2, 0, TAU); c.fill();
    }
    // water
    if (S.fill > 0.003 && wet) {
      const wR = g.innerAtZ(wet.h).r * pxPerM;
      const wg = c.createRadialGradient(cx - wR * 0.25, cy - wR * 0.3, wR * 0.1, cx, cy, wR);
      wg.addColorStop(0, 'rgba(110,180,235,.16)'); wg.addColorStop(0.8, 'rgba(60,120,190,.20)'); wg.addColorStop(1, 'rgba(150,210,250,.42)');
      c.fillStyle = wg; c.beginPath(); c.arc(cx, cy, wR, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(190,230,255,.55)'; c.lineWidth = 1; c.shadowColor = 'rgba(170,220,255,.8)'; c.shadowBlur = 8;
      c.beginPath(); c.arc(cx, cy, wR - 0.6, 0, TAU); c.stroke(); c.shadowBlur = 0;
      // caustic shimmer
      c.save(); c.beginPath(); c.arc(cx, cy, wR, 0, TAU); c.clip();
      for (let k = 0; k < 5; k++) {
        const a = t * 0.13 + k * 1.3, x = cx + Math.cos(a) * wR * 0.4, y = cy + Math.sin(a * 1.4) * wR * 0.35;
        const cg = c.createRadialGradient(x, y, 0, x, y, wR * 0.5); cg.addColorStop(0, 'rgba(200,235,255,.05)'); cg.addColorStop(1, 'rgba(200,235,255,0)');
        c.fillStyle = cg; c.fillRect(cx - wR, cy - wR, 2 * wR, 2 * wR);
      }
      c.restore();
      drawRipples(c, wR, now);
    }
    // vibration envelope: a soft aurora around the rim
    if (an.rimMax * X > 0.3) {
      c.fillStyle = BOWL ? 'rgba(255,214,150,.12)' : 'rgba(170,215,255,.10)';
      c.shadowColor = BOWL ? 'rgba(255,200,130,.6)' : 'rgba(160,210,255,.6)'; c.shadowBlur = 14;
      c.beginPath();
      for (let i = 0; i <= NTH; i++) { const k = i % NTH, th = TAU * k / NTH, r = R + tr / 2 + lim * Math.tanh(envR[k] * X / lim); i ? c.lineTo(cx + r * Math.cos(th), cy + r * Math.sin(th)) : c.moveTo(cx + r * Math.cos(th), cy + r * Math.sin(th)); }
      for (let i = NTH; i >= 0; i--) { const k = i % NTH, th = TAU * k / NTH, r = R - tr / 2 - lim * Math.tanh(envR[k] * X / lim); i === NTH ? c.moveTo(cx + r * Math.cos(th), cy + r * Math.sin(th)) : c.lineTo(cx + r * Math.cos(th), cy + r * Math.sin(th)); }
      c.fill('evenodd'); c.shadowBlur = 0;
    }
    // rim (deformed, strobed), drawn as light
    const rimPath = off => {
      c.beginPath();
      for (let i = 0; i <= NTH; i++) { const k = i % NTH, th = TAU * k / NTH, r = R + off + lim * Math.tanh(dispR[k] * X / lim); i ? c.lineTo(cx + r * Math.cos(th), cy + r * Math.sin(th)) : c.moveTo(cx + r * Math.cos(th), cy + r * Math.sin(th)); }
    };
    c.lineJoin = 'round';
    if (BOWL) {
      rimPath(0); c.strokeStyle = 'rgba(60,40,20,.85)'; c.lineWidth = Math.max(4, tr * 1.25); c.stroke();
      rimPath(0); const rg = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R); rg.addColorStop(0, '#f3d79c'); rg.addColorStop(0.45, '#b98a4a'); rg.addColorStop(0.7, '#ecca8a'); rg.addColorStop(1, '#8a6534');
      c.shadowColor = `rgba(255,210,140,${0.35 + 0.5 * glow})`; c.shadowBlur = 8 + 18 * glow;
      c.strokeStyle = rg; c.lineWidth = Math.max(3, tr * 0.95); c.stroke(); c.shadowBlur = 0;
      rimPath(-tr * 0.25); c.strokeStyle = 'rgba(255,240,205,.4)'; c.lineWidth = 0.8; c.stroke();
    } else {
      rimPath(0); c.strokeStyle = 'rgba(200,225,255,.12)'; c.lineWidth = Math.max(4, tr * 2.2); c.stroke();
      rimPath(0); c.shadowColor = `rgba(170,215,255,${0.6 + 0.4 * glow})`; c.shadowBlur = 10 + 22 * glow;
      c.strokeStyle = 'rgba(240,248,255,.88)'; c.lineWidth = Math.max(1.1, tr * 0.6); c.stroke(); c.shadowBlur = 0;
    }
    // nodes of the dominant mode: tiny points of light
    if (an.dom && an.rimMax * X > 1) {
      const dm = an.pairs.get(an.dom.key);
      if (dm) {
        const n = an.dom.n, a = dm.a, b = dm.b, tot = Math.hypot(a[0], a[1], b[0], b[1]);
        const f = j => { const th = TAU * ((j + NTH) % NTH) / NTH - ALPHA, cc = Math.cos(n * th), ss = Math.sin(n * th); return Math.hypot(a[0] * cc + b[0] * ss, a[1] * cc + b[1] * ss); };
        c.fillStyle = BOWL ? 'rgba(255,225,170,.9)' : 'rgba(225,240,255,.9)'; c.shadowColor = c.fillStyle; c.shadowBlur = 8;
        for (let i = 0; i < NTH; i++) {
          const v = f(i); if (v < f(i - 1) && v <= f(i + 1) && v < 0.35 * tot) {
            const th = TAU * i / NTH; c.beginPath(); c.arc(cx + (R + tr + 9) * Math.cos(th), cy + (R + tr + 9) * Math.sin(th), 1.6, 0, TAU); c.fill();
          }
        }
        c.shadowBlur = 0;
      }
    }
    // taps: an expanding breath of light
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i], age = (now - f.t) / 900; if (age > 1) { flashes.splice(i, 1); continue; }
      const x = cx + R * Math.cos(f.th), y = cy + R * Math.sin(f.th);
      c.strokeStyle = `rgba(230,240,255,${0.5 * (1 - age)})`; c.lineWidth = 1; c.beginPath(); c.arc(x, y, 4 + 40 * age, 0, TAU); c.stroke();
    }
    // finger / puja
    const fd = snap && snap.down ? snap.theta : (P.down ? P.theta : null);
    if (fd != null && P.down) {
      if (BOWL) drawPuja(c, fd, R, tr, X);
      else {
        const fx = cx + R * Math.cos(fd), fy = cy + R * Math.sin(fd), fr = Math.max(13, 0.0075 * pxPerM);
        const fg = c.createRadialGradient(fx, fy, 0, fx, fy, fr * 1.8);
        fg.addColorStop(0, 'rgba(255,236,222,.5)'); fg.addColorStop(0.45, 'rgba(255,214,190,.18)'); fg.addColorStop(1, 'rgba(255,214,190,0)');
        c.fillStyle = fg; c.beginPath(); c.arc(fx, fy, fr * 1.8, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(255,240,230,.35)'; c.lineWidth = 0.8; c.beginPath(); c.arc(fx, fy, fr * 0.8, 0, TAU); c.stroke();
      }
    }
    drawStrip(c, t);
  }

  // the water strip: pour by pitch, like a theremin
  function drawStrip(c, t) {
    const s = strip, r = pitchRange(), y = s.y;
    const col = BOWL ? '255,215,160' : '180,215,255';
    // a faint shelf of light marks the thumb zone
    const zg = c.createLinearGradient(0, s.top, 0, H);
    zg.addColorStop(0, `rgba(${col},0)`); zg.addColorStop(1, `rgba(${col},${STRIP.id !== null ? 0.08 : 0.04})`);
    c.fillStyle = zg; c.fillRect(0, s.top, W, H - s.top);
    const lg = c.createLinearGradient(s.x - 20, 0, s.x + s.w + 20, 0);
    lg.addColorStop(0, `rgba(${col},0)`); lg.addColorStop(0.08, `rgba(${col},.34)`); lg.addColorStop(0.92, `rgba(${col},.34)`); lg.addColorStop(1, `rgba(${col},0)`);
    c.strokeStyle = lg; c.lineWidth = 1; c.beginPath(); c.moveTo(s.x - 20, y); c.lineTo(s.x + s.w + 20, y); c.stroke();
    if (!r) {
      c.fillStyle = `rgba(${col},.4)`; c.font = 'italic 13px "Cormorant Garamond", serif'; c.textAlign = 'center';
      c.fillText('tuning the water…', W / 2, y - 10); return;
    }
    // semitone ticks, naturals named beneath
    const m0 = Math.ceil(midiOf(r.lo)), m1 = Math.floor(midiOf(r.hi));
    const pxPerSemi = s.w / Math.max(1, midiOf(r.hi) - midiOf(r.lo));
    c.textAlign = 'center'; c.font = 'italic 12px "Cormorant Garamond", serif';
    for (let m = m0; m <= m1; m++) {
      const x = xOfHz(440 * Math.pow(2, (m - 69) / 12)), pc = ((m % 12) + 12) % 12, nat = [0, 2, 4, 5, 7, 9, 11].includes(pc);
      c.strokeStyle = `rgba(${col},${nat ? 0.38 : 0.16})`; c.beginPath(); c.moveTo(x, y - (nat ? 7 : 4)); c.lineTo(x, y + (nat ? 7 : 4)); c.stroke();
      if (nat && (pxPerSemi > 11 || pc === 0)) { c.fillStyle = `rgba(${col},${pc === 0 ? 0.75 : 0.42})`; c.fillText(nameOf(m), x, y + 21); }
    }
    // the bead = where the water has put the (2,0) mode now
    if (wet && isFinite(wet.f2)) {
      const x = xOfHz(clamp(wet.f2, r.lo, r.hi)), on = STRIP.id !== null, pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
      const bg = c.createRadialGradient(x, y, 0, x, y, on ? 30 : 20);
      bg.addColorStop(0, `rgba(${col},${on ? 0.55 : 0.35 + 0.1 * pulse})`); bg.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = bg; c.beginPath(); c.arc(x, y, on ? 30 : 20, 0, TAU); c.fill();
      c.fillStyle = 'rgba(245,250,255,.95)'; c.beginPath(); c.arc(x, y, 3, 0, TAU); c.fill();
      c.textAlign = 'center'; c.font = '10px "IBM Plex Mono", monospace'; c.fillStyle = `rgba(${col},.6)`;
      c.fillText(`${Math.round(S.fill * 100)}%`, x, y - 12);
    }
    c.font = 'italic 12px "Cormorant Garamond", serif'; c.fillStyle = `rgba(${col},.45)`;
    c.textAlign = 'right'; c.fillText('full', s.x - 8, y + 4);
    c.textAlign = 'left'; c.fillText('empty', s.x + s.w + 8, y + 4);
  }

  // hand-hammered bronze, seen from above
  let hammer = null;
  function drawBowlBody(c, g, R) {
    const bR = Math.max(R, g.rMaxOuter * pxPerM);
    if (bR > R + 1) {
      const og = c.createRadialGradient(cx - bR * 0.3, cy - bR * 0.3, R * 0.6, cx, cy, bR);
      og.addColorStop(0, '#4a3418'); og.addColorStop(0.75, '#664623'); og.addColorStop(1, '#2e1f0d');
      c.fillStyle = og; c.beginPath(); c.arc(cx, cy, bR, 0, TAU); c.fill();
    }
    const ig = c.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R);
    ig.addColorStop(0, '#5b3f1e'); ig.addColorStop(0.35, '#6d4f27'); ig.addColorStop(0.8, '#94703a'); ig.addColorStop(1, '#b89356');
    c.fillStyle = ig; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
    if (!hammer || hammer.key !== S.shape + S.scale) {
      let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      hammer = { key: S.shape + S.scale, marks: Array.from({ length: 240 }, () => ({ r: Math.sqrt(rnd()) * 0.95, th: rnd() * TAU, s: 0.025 + 0.03 * rnd(), a: rnd() })) };
    }
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.clip();
    for (const m of hammer.marks) {
      const x = cx + m.r * R * Math.cos(m.th), y = cy + m.r * R * Math.sin(m.th), s = m.s * R;
      const hg = c.createRadialGradient(x - s * 0.35, y - s * 0.35, 0, x, y, s);
      hg.addColorStop(0, `rgba(255,225,160,${0.04 + 0.05 * m.a})`); hg.addColorStop(0.7, 'rgba(255,225,160,0)'); hg.addColorStop(1, `rgba(40,25,10,${0.05 + 0.05 * m.a})`);
      c.fillStyle = hg; c.beginPath(); c.ellipse(x, y, s * 1.3, s * 0.7, m.th + 1.2, 0, TAU); c.fill();
    }
    c.strokeStyle = 'rgba(255,230,170,.08)'; c.lineWidth = 1;
    for (const f of [0.93, 0.89, 0.86, 0.32, 0.28]) { c.beginPath(); c.arc(cx, cy, R * f, 0, TAU); c.stroke(); }
    const sg = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R); sg.addColorStop(0.2, 'rgba(255,240,200,0)'); sg.addColorStop(0.42, 'rgba(255,240,200,.10)'); sg.addColorStop(0.5, 'rgba(255,240,200,0)');
    c.fillStyle = sg; c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    c.restore();
  }
  function drawPuja(c, th, R, tr, X) {
    const side = S.side, rad = Math.max(10, 0.013 * pxPerM);
    const jitter = snap ? snap.y * X * side : 0;
    const rr = R + side * (tr * 0.5 + rad) + clamp(jitter, -rad, rad);
    const x = cx + rr * Math.cos(th), y = cy + rr * Math.sin(th), leather = S.stick === 'leather';
    const g2 = c.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad);
    if (leather) { g2.addColorStop(0, '#9c7558'); g2.addColorStop(1, '#583b28'); } else { g2.addColorStop(0, '#d6b689'); g2.addColorStop(1, '#86603a'); }
    c.shadowColor = 'rgba(255,210,150,.35)'; c.shadowBlur = 12;
    c.fillStyle = g2; c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill(); c.shadowBlur = 0;
    c.strokeStyle = leather ? 'rgba(240,220,190,.3)' : 'rgba(90,60,30,.35)'; c.lineWidth = 1;
    if (leather) { c.setLineDash([2, 3]); c.beginPath(); c.arc(x, y, rad * 0.78, 0, TAU); c.stroke(); c.setLineDash([]); }
    else for (let k = 1; k < 5; k++) { c.beginPath(); c.arc(x + 1, y - 1, rad * k / 5, 0, TAU); c.stroke(); }
    if (snap && snap.down && snap.contact < 0.97) {
      const a = Math.min(1, (0.97 - snap.contact) * 4);
      c.strokeStyle = `rgba(255,215,150,${0.7 * a})`; c.lineWidth = 1.2;
      for (let k = 0; k < 4; k++) { const ang = th + (Math.random() - 0.5) * 0.25, r1 = R + side * (tr + 2), r2 = r1 + side * (4 + 8 * Math.random());
        c.beginPath(); c.moveTo(cx + r1 * Math.cos(ang), cy + r1 * Math.sin(ang)); c.lineTo(cx + r2 * Math.cos(ang), cy + r2 * Math.sin(ang)); c.stroke(); }
    }
  }
  function drawRipples(c, wR, now) {
    const t = now / 1000, lam = Math.max(2.2, 0.0016 * pxPerM);
    let maxW = 0; for (let i = 0; i < NTH; i++) maxW = Math.max(maxW, envW[i]);
    if (maxW < 2e-7) return;
    const segs = 120, sprayAt = BOWL ? 1.5e-5 : 4e-5;
    for (let s = 0; s < segs; s++) {
      const i0 = Math.floor(s * NTH / segs), a = envW[i0], strength = Math.min(1, a / 6e-6);
      if (strength < 0.03) continue;
      const th0 = TAU * s / segs, th1 = TAU * (s + 1) / segs;
      for (let k = 0; k < 8; k++) {
        const r = wR - 1.5 - k * lam * 0.9; if (r < 4) break;
        const al = strength * Math.exp(-k / (1.5 + 3 * strength)) * (0.55 + 0.45 * Math.sin(TAU * (t * 9 - k * 0.5) + s * 0.7));
        c.strokeStyle = `rgba(215,240,255,${0.38 * al})`; c.lineWidth = 1;
        c.beginPath(); c.arc(cx, cy, r, th0, th1); c.stroke();
      }
      if (a > sprayAt && Math.random() < 0.04 * (a / sprayAt) && drops.length < 120)
        drops.push({ th: th0 + Math.random() * (th1 - th0), r: wR - 2, v: 20 + 50 * Math.random(), t: now, life: 400 + 500 * Math.random() });
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i], age = (now - d.t) / d.life; if (age > 1) { drops.splice(i, 1); continue; }
      const r = d.r - d.v * age * 0.6, h = Math.sin(Math.PI * age);
      c.fillStyle = `rgba(230,248,255,${0.6 * (1 - age)})`;
      c.beginPath(); c.arc(cx + r * Math.cos(d.th), cy + r * Math.sin(d.th), 0.7 + 1.6 * h, 0, TAU); c.fill();
    }
  }

  // ------------------------------------------------------------ side inset
  const side = $('sideCv'), sctx = side.getContext('2d');
  let sideMap = null, sideDrag = false;
  function drawSide(an) {
    if (!S.inset || !side.width) return;
    const c = sctx, w = side.width / dpr, h = side.height / dpr; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    if (!glass || !prof) return;
    const g = glass.geo, stemL = BOWL ? 0.018 * S.scale : 0.075 * S.scale, footR = BOWL ? g.rMaxOuter * 0.55 : FOOT_R * S.scale;
    const zTop = g.rim.z + 0.004, zBot = -stemL - 0.004, rW = Math.max(g.rMaxOuter, footR) * 1.12;
    const sc = Math.min((h - 14) / (zTop - zBot), (w - 14) / (2 * rW)), ox = w / 2, oy = h - 7 + zBot * sc;
    const X = r => ox + r * sc, Y = z => oy - z * sc;
    sideMap = { sc, oy, zf: g.zFloor, zr: g.zRimIn };
    const r0 = prof[0].r;
    if (BOWL) {
      c.fillStyle = 'rgba(120,60,80,.45)'; c.strokeStyle = 'rgba(255,200,210,.18)';
      for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(X(sx * footR * 0.62), Y(-stemL / 2), footR * 0.38 * sc, stemL / 2 * sc, 0, 0, TAU); c.fill(); c.stroke(); }
    } else {
      c.fillStyle = 'rgba(210,228,250,.07)'; c.strokeStyle = 'rgba(220,235,255,.28)'; c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(X(-r0), Y(0)); c.quadraticCurveTo(X(-r0 * 0.55), Y(-stemL * 0.5), X(-r0 * 0.7), Y(-stemL + 0.004));
      c.quadraticCurveTo(X(-footR * 0.4), Y(-stemL + 0.001), X(-footR), Y(-stemL)); c.lineTo(X(footR), Y(-stemL));
      c.quadraticCurveTo(X(footR * 0.4), Y(-stemL + 0.001), X(r0 * 0.7), Y(-stemL + 0.004));
      c.quadraticCurveTo(X(r0 * 0.55), Y(-stemL * 0.5), X(r0), Y(0)); c.closePath(); c.fill(); c.stroke();
    }
    if (S.fill > 0.003 && wet) {
      const I = g.inner, pts = [];
      for (let i = 0; i < I.z.length; i += 4) { if (I.z[i] > wet.h) break; pts.push([I.r[i], I.z[i]]); }
      const topR = g.innerAtZ(wet.h); pts.push([topR.r, wet.h]);
      c.beginPath(); c.moveTo(X(-pts[0][0]), Y(pts[0][1]));
      for (const p of pts) c.lineTo(X(-p[0]), Y(p[1]));
      for (let i = pts.length - 1; i >= 0; i--) c.lineTo(X(pts[i][0]), Y(pts[i][1]));
      c.closePath();
      const wg = c.createLinearGradient(0, Y(wet.h), 0, Y(g.zFloor)); wg.addColorStop(0, 'rgba(110,190,240,.55)'); wg.addColorStop(1, 'rgba(40,100,170,.35)');
      c.fillStyle = wg; c.fill();
      c.strokeStyle = 'rgba(200,235,255,.9)'; c.lineWidth = 1.2; c.shadowColor = 'rgba(170,220,255,.9)'; c.shadowBlur = 6;
      c.beginPath(); c.moveTo(X(-topR.r), Y(wet.h)); c.lineTo(X(topR.r), Y(wet.h)); c.stroke(); c.shadowBlur = 0;
    }
    let shape = null, n = 2, ampPx = 0;
    if (an.dom && an.dom.shape) { shape = an.dom.shape; n = an.dom.n; const rimW = shape[shape.length - 1] || 1; ampPx = 8 * Math.tanh(an.rimMax * EXAG * sc / 8) / Math.abs(rimW); }
    const wall = sign => {
      const outer = [], inner = [], sgn = sign > 0 ? 1 : (n % 2 ? -1 : 1);
      if (BOWL) { const p = prof[0]; outer.push([0, p.z - p.t / 2]); inner.push([0, p.z + p.t / 2]); }
      for (let i = 0; i < prof.length; i++) {
        const p = prof[i], u = i / (prof.length - 1);
        let d = 0; if (shape) { const j = u * (shape.length - 1), j0 = Math.floor(j), f = j - j0; d = (shape[j0] * (1 - f) + (shape[Math.min(shape.length - 1, j0 + 1)] || 0) * f) * ampPx * Math.cos(strobe) * sgn / sc; }
        outer.push([sign * (p.r + (p.t / 2 + d) * p.sn), p.z + (p.t / 2 + d) * -p.c]);
        inner.push([sign * (p.r + (-p.t / 2 + d) * p.sn), p.z + (-p.t / 2 + d) * -p.c]);
      }
      c.beginPath(); c.moveTo(X(outer[0][0]), Y(outer[0][1]));
      for (const q of outer) c.lineTo(X(q[0]), Y(q[1]));
      for (let i = inner.length - 1; i >= 0; i--) c.lineTo(X(inner[i][0]), Y(inner[i][1]));
      c.closePath(); c.fillStyle = BOWL ? 'rgba(190,140,75,.85)' : 'rgba(225,238,255,.4)'; c.fill();
      c.strokeStyle = BOWL ? 'rgba(245,210,150,.9)' : 'rgba(240,248,255,.85)'; c.lineWidth = 0.7; c.shadowColor = c.strokeStyle; c.shadowBlur = 4; c.stroke(); c.shadowBlur = 0;
    };
    wall(1); wall(-1);
    if (wet) { c.fillStyle = 'rgba(200,215,240,.55)'; c.font = '10px "IBM Plex Mono", monospace'; c.textAlign = 'right'; c.fillText(`${Math.round(wet.volume * 1e6)} mL`, w - 8, h - 8); }
  }
  function sideFill(e) {
    if (!sideMap) return; const r = side.getBoundingClientRect(), y = e.clientY - r.top;
    const z = (sideMap.oy - y) / sideMap.sc; setFill((z - sideMap.zf) / (sideMap.zr - sideMap.zf));
  }
  side.addEventListener('pointerdown', e => { e.stopPropagation(); sideDrag = true; capture(side, e.pointerId); sideFill(e); });
  side.addEventListener('pointermove', e => { if (sideDrag) sideFill(e); });
  side.addEventListener('pointerup', () => { sideDrag = false; }); side.addEventListener('pointercancel', () => { sideDrag = false; });

  // ------------------------------------------------------------ loop
  let roT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
    strobe += TAU * 0.6 * dt;
    if (P.down && now - P.lastT > 40 && Math.abs(P.omega) > 1e-3) { P.omega *= Math.exp(-dt / 0.05); send({ t: 'finger', f: { theta: P.theta, omega: P.omega } }); }
    const an = analyse();
    drawTop(an, now);
    drawSide(an);
    if (now - roT > 120 && wet) {
      roT = now;
      const sounding = an.dom && an.rimMax > 5e-7;
      const f = sounding ? an.dom.f : wet.f2;
      if (isFinite(f)) {
        const m = midiOf(f), cents = Math.round((m - Math.round(m)) * 100);
        $('roNote').textContent = nameOf(m);
        $('roHz').textContent = `${f.toFixed(1)} Hz  ${cents >= 0 ? '+' : '−'}${Math.abs(cents)}¢`;
      }
      const parts = [];
      if (snap && snap.down) {
        parts.push(`${Math.abs(snap.vb * 100).toFixed(0)} cm/s`);
        parts.push(BOWL ? `stick ${Math.round(snap.stick * 100)}% · contact ${Math.round(snap.contact * 100)}%` : `stick ${Math.round(snap.stick * 100)}%`);
      }
      const spl = snap ? 20 * Math.log10(Math.max(1e-7, snap.prms) / 2e-5) : 0;
      if (snap && spl > 12) parts.push(`${spl.toFixed(0)} dB`);
      $('roMeta').textContent = parts.join('  ·  ') || ' ';
      document.querySelectorAll('#modeTable tbody tr').forEach(tr => tr.classList.toggle('hot', !!(sounding && tr.dataset.key === an.dom.key)));
    }
    requestAnimationFrame(frame);
  }

  window.__glasshouse = { P, get center() { return { cx, cy }; }, get rimPx() { return glass ? glass.geo.rimR * pxPerM : 0; }, get strip() { return strip; }, get table() { return table; }, get snap() { return snap; }, get audio() { return audio; }, get wet() { return wet; }, S };
  $('xlabel').textContent = `rim motion ×${EXAG}`;
  resize();
  build();
  requestAnimationFrame(frame);
})();
