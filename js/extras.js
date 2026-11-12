(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * Interactive bits on top of the zine (js/zine.js does the paging):
   *  - Speakers: click a polaroid -> the camera moves in and a vinyl-letter
   *    name rises onto it.
   *  - Round Table: click the table -> the stickers jump, then the two
   *    questions rise in vinyl letters.
   * Coordinates are pixels of the zine crop (1560 x 1260), traced from the
   * source photos.
   * ------------------------------------------------------------------ */
  const CW = 1560;
  const CH = 1260;

  const PHOTOS = [
    { id: 'topofmind', label: 'Top of Mind', box: [170, 318, 690, 945],
      quad: [[200, 333], [670, 342], [660, 928], [185, 885]] },
    { id: 'yohannes', label: 'Yohannes Hailu', sub: 'Sciens AI GFGB PoC', box: [1050, 28, 1482, 532],
      quad: [[1065, 47], [1465, 40], [1467, 512], [1080, 517]] },
    { id: 'heveliz', label: 'Heveliz “Heve”\nFeldmann', sub: 'HOW TO BE CRAZY WITHOUT GETTING CRAZY?', box: [776, 536, 1222, 1054],
      quad: [[830, 550], [1207, 588], [1182, 1042], [790, 1003]] },
  ];

  // Cut out of spread-1 (percent of the zine: left, top, width, height), bottom to top.
  const STICKERS = {
    king: [63.269, 25.635, 9.167, 22.778],
    bowie: [66.859, 11.508, 10.256, 19.286],
    cat: [79.231, 20.476, 13.846, 20.317],
    l1: [6.731, 44.841, 10.769, 15.238],
    l2: [16.474, 45.238, 5.962, 11.825],
    l3: [21.282, 49.603, 7.564, 9.762],
    l4: [28.077, 43.968, 13.974, 20.238],
  };
  const JUMP_ORDER = ['king', 'bowie', 'cat', 'l4', 'l3', 'l2', 'l1'];
  const WHEEL = [717, 337, 1416, 1048]; // bounding box of the round table

  const QUESTIONS = [
    'What do you feel proudest about your engagement?',
    'What was the most surprising thing you noticed in the GfGb?',
  ];

  const ZOOM_MS = 950;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const zine = $('zine');
  const scene = $('scene');
  const current = $('current');
  const vinyl = $('vinyl');
  const catcher = $('catcher');
  const hint = $('hint');

  const pct = (v, total) => `${((v / total) * 100).toFixed(3)}%`;
  const place = (el, [x0, y0, x1, y1]) => {
    el.style.left = pct(x0, CW);
    el.style.top = pct(y0, CH);
    el.style.width = pct(x1 - x0, CW);
    el.style.height = pct(y1 - y0, CH);
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  let mode = null;     // null | 'photo' | 'table'
  let token = 0;       // bumps on every close, so stale timers do nothing
  let calmUntil = 0;   // don't start a new zoom while the camera is still pulling back
  const used = new Set();

  /* ---------- build the layers ---------- */

  const after = (ref, el) => ref.parentNode.insertBefore(el, ref.nextSibling);
  let anchor = current;

  for (const p of PHOTOS) {
    const hi = document.createElement('div');
    hi.className = 'photo-hi';
    hi.style.backgroundImage = `url("assets/photo-${p.id}.webp")`;
    place(hi, p.box);
    after(anchor, hi);
    anchor = hi;
    p.hi = hi;

    const xs = p.quad.map((q) => q[0]);
    const ys = p.quad.map((q) => q[1]);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hot hot-photo';
    btn.setAttribute('aria-label', `Zoom in: ${p.label.replace('\n', ' ')}`);
    place(btn, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    btn.addEventListener('click', (e) => { e.stopPropagation(); focusPhoto(p); });
    zine.appendChild(btn);
  }

  const stickerBox = document.createElement('div');
  stickerBox.className = 'stickers';
  after(anchor, stickerBox);
  const sprites = {};
  for (const [name, [x, y, w, h]] of Object.entries(STICKERS)) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = `assets/sticker-${name}.webp`;
    Object.assign(img.style, { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` });
    stickerBox.appendChild(img);
    sprites[name] = img;
  }

  const wheelBtn = document.createElement('button');
  wheelBtn.type = 'button';
  wheelBtn.className = 'hot hot-wheel';
  wheelBtn.setAttribute('aria-label', 'Start the round table: show the questions');
  place(wheelBtn, WHEEL);
  wheelBtn.addEventListener('click', (e) => { e.stopPropagation(); roundTable(); });
  zine.appendChild(wheelBtn);

  /* ---------- vinyl letters ---------- */

  // Small seeded PRNG so each word is "stuck on" the same way every time.
  function rng(seed) {
    let s = 0;
    for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) | 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function vinylText(text, className, fontPx) {
    const el = document.createElement('div');
    el.className = `vinyl ${className}`;
    el.style.fontSize = `${fontPx}px`;
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = text.replace('\n', ' ');
    el.appendChild(sr);

    const rand = rng(text);
    const letters = [];
    for (const line of text.split('\n')) {
      const row = document.createElement('div');
      row.className = 'vinyl-line';
      row.setAttribute('aria-hidden', 'true');
      line.split(' ').forEach((word, wi) => {
        if (wi) row.appendChild(document.createTextNode(' '));
        const w = document.createElement('span');
        w.className = 'vw';
        for (const ch of word) {
          const l = document.createElement('span');
          l.className = 'vl';
          l.textContent = ch;
          l.dataset.c = ch;
          l._r = (rand() - 0.5) * 7;
          l._y = (rand() - 0.5) * 0.09 * fontPx;
          l.style.transform = `translateY(${l._y.toFixed(1)}px) rotate(${l._r.toFixed(1)}deg)`;
          w.appendChild(l);
          letters.push(l);
        }
        row.appendChild(w);
      });
      el.appendChild(row);
    }
    return { el, letters, fontPx };
  }

  // Letters rise one by one and get pressed on with a little overshoot.
  function rise({ letters, fontPx }, stagger, startDelay = 0) {
    return Promise.all(letters.map((l, i) => {
      const end = l.style.transform;
      const keys = reduceMotion
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: `translateY(${(l._y + fontPx * 0.9).toFixed(1)}px) rotate(${(l._r + 16).toFixed(1)}deg) scale(0.35)` },
            { opacity: 1, offset: 0.55, transform: `translateY(${(l._y - fontPx * 0.14).toFixed(1)}px) rotate(${(l._r - 3).toFixed(1)}deg) scale(1.12)` },
            { opacity: 1, transform: end },
          ];
      return l.animate(keys, {
        duration: reduceMotion ? 200 : 540,
        delay: startDelay + i * stagger,
        easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
        fill: 'backwards',
      }).finished;
    })).catch(() => {});
  }

  function clearVinyl() {
    for (const el of [...vinyl.children]) {
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' })
        .finished.then(() => el.remove(), () => el.remove());
    }
  }

  /* ---------- photo zoom ---------- */

  function focusPhoto(p) {
    if (mode || performance.now() < calmUntil) return;
    mode = 'photo';
    const my = ++token;
    markUsed('photo');

    // Where the polaroid is right now, in screen pixels.
    const zr = zine.getBoundingClientRect();
    const sr = scene.getBoundingClientRect();
    const q = p.quad.map(([x, y]) => [zr.left + (x / CW) * zr.width, zr.top + (y / CH) * zr.height]);
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const cx = q.reduce((s, v) => s + v[0], 0) / 4;
    const cy = q.reduce((s, v) => s + v[1], 0) / 4;
    const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
    const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
    const tilt = (Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]) * 180) / Math.PI;

    // Camera: centre the polaroid, straighten it, fill most of the height,
    // keeping room under it for the name (and subtitle) above the controls.
    const vw = innerWidth;
    const vh = innerHeight;
    const RESERVE = 118;  // controls + hint at the bottom
    const MIN_TOP = 56;
    const lines = p.label.split('\n').length;
    const fontFor = (W) => Math.max(28, Math.min(66, W * 0.105));
    const subFontFor = (f) => Math.max(18, f * 0.5);
    const overhang = (s) => {
      const f = fontFor(w * s);
      return lines * 1.08 * f * 0.38 + (p.sub ? subFontFor(f) * 1.25 : 0);
    };
    const tx = vw / 2;
    let s = Math.min((vh * 0.7) / h, (vw * 0.56) / w);
    let ty = Math.min(vh * 0.45, vh - RESERVE - overhang(s) - (h * s) / 2);
    if (ty - (h * s) / 2 < MIN_TOP) {
      s = (vh - RESERVE - MIN_TOP - overhang(s)) / h;
      ty = MIN_TOP + (h * s) / 2;
    }
    scene.style.transformOrigin = `${(cx - sr.left).toFixed(1)}px ${(cy - sr.top).toFixed(1)}px`;
    scene.style.transform = `translate(${(tx - cx).toFixed(1)}px, ${(ty - cy).toFixed(1)}px) rotate(${(-tilt).toFixed(2)}deg) scale(${s.toFixed(3)})`;
    p.hi.classList.add('is-on');
    body.classList.add('is-focused');

    // Then the name rises onto the bottom-left of the photo.
    setTimeout(() => {
      if (my !== token) return;
      const W = w * s;
      const H = h * s;
      const font = fontFor(W);
      const group = document.createElement('div');
      group.className = 'vinyl-group';
      group.style.left = `${(tx - W / 2 - W * 0.07).toFixed(1)}px`;
      group.style.top = `${(ty + H / 2).toFixed(1)}px`;
      const label = vinylText(p.label, 'vinyl-name', font);
      group.appendChild(label.el);
      const sub = p.sub ? vinylText(p.sub, 'vinyl-sub', subFontFor(font)) : null;
      if (sub) group.appendChild(sub.el);
      vinyl.appendChild(group);
      // Lift the name so it overlaps the bottom edge of the polaroid; the subtitle hangs below.
      group.style.transform = `translateY(${(-label.el.offsetHeight * 0.62).toFixed(1)}px) rotate(-4deg)`;
      rise(label, 42);
      if (sub) rise(sub, 22, label.letters.length * 42 * 0.6 + 200);
    }, reduceMotion ? 0 : ZOOM_MS * 0.8);
  }

  /* ---------- round table ---------- */

  function jumpKeys(i) {
    const r = (i % 2 ? 1 : -1) * (6 + ((i * 3) % 5));
    const sh = (x, y, b, a) => `drop-shadow(${x}vw ${y}vw ${b}vw rgba(0,0,0,${a}))`;
    return [
      { transform: 'none', filter: sh(0, 0, 0, 0) },
      { offset: 0.22, transform: `translateY(-9%) rotate(${r}deg) scale(1.17)`, filter: sh(0.35, 1, 0.7, 0.45) },
      { offset: 0.45, transform: `translateY(-6%) rotate(${-r * 0.8}deg) scale(1.13)`, filter: sh(0.3, 0.8, 0.6, 0.42) },
      { offset: 0.68, transform: `translateY(-2.5%) rotate(${r * 0.35}deg) scale(1.06)`, filter: sh(0.15, 0.4, 0.35, 0.35) },
      { offset: 0.86, transform: 'translateY(0) rotate(0deg) scale(0.98)', filter: sh(0.04, 0.08, 0.08, 0.25) },
      { transform: 'none', filter: sh(0, 0, 0, 0) },
    ];
  }

  async function roundTable() {
    if (mode) return;
    mode = 'table';
    const my = ++token;
    markUsed('table');

    if (!reduceMotion) {
      stickerBox.classList.add('is-on');
      const jumps = JUMP_ORDER.map((name, i) =>
        sprites[name].animate(jumpKeys(i), { duration: 980, delay: i * 110, easing: 'ease-in-out' }).finished
      );
      // Questions come in while the last stickers are still landing.
      await Promise.race([Promise.all(jumps).catch(() => {}), wait(JUMP_ORDER.length * 110 + 650)]);
      Promise.all(jumps).catch(() => {}).then(() => { if (my === token) stickerBox.classList.remove('is-on'); });
    }
    if (my !== token) return;

    body.classList.add('is-asking');
    const font = Math.max(22, Math.min(46, innerHeight * 0.05, innerWidth * 0.032));
    const wrap = document.createElement('div');
    wrap.className = 'questions';
    vinyl.appendChild(wrap);
    const blocks = QUESTIONS.map((q, i) => {
      const t = vinylText(q, `vinyl-q vinyl-q${i + 1}`, font);
      wrap.appendChild(t.el);
      t.el.style.visibility = 'hidden';
      return t;
    });
    for (const b of blocks) {
      if (my !== token) return;
      b.el.style.visibility = '';
      await rise(b, 16);
      await wait(120);
    }
  }

  /* ---------- closing ---------- */

  function close() {
    if (!mode) return;
    token++;
    if (mode === 'photo') {
      calmUntil = performance.now() + ZOOM_MS;
      scene.style.transform = '';
      for (const p of PHOTOS) p.hi.classList.remove('is-on');
      body.classList.remove('is-focused');
    } else {
      for (const img of Object.values(sprites)) img.getAnimations().forEach((a) => a.cancel());
      stickerBox.classList.remove('is-on');
      body.classList.remove('is-asking');
    }
    clearVinyl();
    mode = null;
  }

  catcher.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.addEventListener('zine:leave', () => { close(); hint.classList.add('is-gone'); });
  addEventListener('resize', close);

  /* ---------- hints ---------- */

  const TIPS = {
    photo: 'click a photo to zoom in',
    table: 'click the round table',
  };
  function markUsed(kind) {
    used.add(kind);
    hint.classList.add('is-gone');
  }
  document.addEventListener('zine:settled', (e) => {
    const { spread, flyer } = e.detail;
    const kind = spread === 2 ? 'photo' : spread === 1 && !flyer ? 'table' : null;
    if (!kind || used.has(kind)) return;
    hint.textContent = TIPS[kind];
    hint.classList.remove('is-gone');
  });

  // Fetch the zoom/sticker images once the zine itself is up.
  document.addEventListener('zine:settled', () => {
    for (const p of PHOTOS) new Image().src = `assets/photo-${p.id}.webp`;
  }, { once: true });
})();
