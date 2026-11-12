(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * Content
   * Each step is one "view". Steps that share a spread don't flip a page;
   * the last one drops the flyer on top of the final spread.
   * ------------------------------------------------------------------ */
  const STEPS = [
    { spread: 0, title: 'Welcome' },
    { spread: 2, title: 'Speakers' },
    { spread: 1, title: 'Round Table' },
    { spread: 1, flyer: true, title: 'The GfGb Method' },
  ];
  const SPREADS = ['assets/spread-0.webp?v=2', 'assets/spread-1.webp', 'assets/spread-2.webp?v=2'];
  const PRELOAD = [...SPREADS, 'assets/bg.webp', 'assets/hands.webp', 'assets/flyer.webp'];

  /* ------------------------------------------------------------------
   * Geometry, traced from the source photos (percent of the zine crop).
   * ------------------------------------------------------------------ */
  const CLIP_L = [[48.25, 98.81], [37.69, 99.37], [4.56, 98.97], [3.17, 98.74], [2.6, 98.47], [1.73, 97.6], [1.42, 97.0], [1.19, 96.3], [1.01, 94.57], [0.9, 86.19], [0.45, 5.56], [0.58, 5.0], [1.09, 3.97], [1.73, 3.33], [2.95, 2.62], [7.95, 0.87], [44.23, 1.43], [49.14, 1.98]];
  const CLIP_R = [[97.99, 97.3], [96.78, 97.77], [69.94, 98.73], [57.24, 98.73], [48.25, 98.41], [49.14, 2.46], [59.87, 0.95], [65.45, 0.63], [78.91, 0.56], [94.04, 1.03], [94.87, 1.43], [97.24, 3.33], [98.01, 4.37], [98.21, 5.24], [99.5, 93.38], [99.35, 95.11], [99.14, 95.82], [98.85, 96.42]];
  const AXIS = 0.487;        // spine position (fraction of zine width, mid-height)
  const TILT = -0.01139;     // spine is a hair off vertical; rotate around it exactly
  const PERSP_X = 0.5013;    // camera centre, in zine coordinates
  const LEFT_EDGE = 0.0045;
  const RIGHT_EDGE = 0.995;

  const FLIP_MS = 1150;
  const FLIP_FAST_MS = 620;
  const DROP_MS = 1750;
  const LIFT_MS = 750;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------ */

  const $ = (id) => document.getElementById(id);
  const zine = $('zine');
  const scene = $('scene');
  const under = $('under');
  const stay = $('stay');
  const current = $('current');
  const flipper = $('flipper');
  const frontImg = $('frontImg');
  const backImg = $('backImg');
  const shadowL = $('shadowL');
  const shadowR = $('shadowR');
  const tints = [...flipper.querySelectorAll('.tint')];
  const flyerWrap = $('flyerWrap');
  const flyer = $('flyer');
  const flyerShadow = $('flyerShadow');
  const prevBtn = $('prev');
  const nextBtn = $('next');
  const LAST = STEPS.length - 1;

  let index = 0;   // what is on screen
  let target = 0;  // where we're heading (clicks can queue several steps)
  let busy = false;

  const poly = (pts) => `polygon(${pts.map(([x, y]) => `${x}% ${y}%`).join(', ')})`;
  zine.style.setProperty('--clip-l', poly(CLIP_L));
  zine.style.setProperty('--clip-r', poly(CLIP_R));

  function setSpread(el, i) {
    if (el._spread === i) return;
    el._spread = i;
    el.style.backgroundImage = `url("${SPREADS[i]}")`;
  }

  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

  /* ------------------------------------------------------------------
   * Page flip
   * ------------------------------------------------------------------ */

  // deg: 0 = page lying on the right, -180 = page lying on the left.
  function renderFlip(deg, m) {
    flipper.style.transform = `rotate3d(${TILT}, 1, 0, ${deg}deg)`;

    const th = (deg * Math.PI) / 180;
    const s = Math.abs(Math.sin(th));
    const c = Math.cos(th);

    // Darken the turning sheet as it tilts away from the camera.
    const shade = 0.42 * (1 - Math.abs(c));
    for (const t of tints) {
      t.style.setProperty('--ta', (shade + 0.14 * s).toFixed(3));
      t.style.setProperty('--tb', (shade * 0.6).toFixed(3));
    }

    // Project the sheet's outer edge to place the cast shadow next to it.
    const w = c >= 0 ? m.wr : m.wl;
    const edge = m.ox + (m.axis + w * c - m.ox) * (m.p / (m.p + w * Math.sin(th)));

    const right = c >= 0
      ? { x: edge, sa: 0.55 * s }
      : { x: m.axis, sa: 0.55 * s * (1 + c) };
    const left = c < 0
      ? { x: edge, sa: 0.55 * s }
      : { x: m.axis, sa: 0.55 * s * (1 - c) };

    shadowR.style.setProperty('--x', `${right.x.toFixed(1)}px`);
    shadowR.style.setProperty('--sw', `${(6 + m.wr * 0.45 * s).toFixed(1)}px`);
    shadowR.style.setProperty('--sa', right.sa.toFixed(3));
    shadowL.style.setProperty('--x', `${left.x.toFixed(1)}px`);
    shadowL.style.setProperty('--sw', `${(6 + m.wl * 0.45 * s).toFixed(1)}px`);
    shadowL.style.setProperty('--sa', left.sa.toFixed(3));
  }

  function measure() {
    const w = zine.clientWidth;
    return {
      axis: AXIS * w,
      ox: PERSP_X * w,
      wr: (RIGHT_EDGE - AXIS) * w,
      wl: (AXIS - LEFT_EDGE) * w,
      p: parseFloat(getComputedStyle(zine).perspective) || w * 3,
    };
  }

  function flip(from, to, dir, duration) {
    if (reduceMotion) return crossfade(to);

    // Forward: the right page of `from` turns over and shows the left page of `to`.
    // Backward: the left page of `from` turns back and shows the right page of `to`.
    setSpread(under, to);
    setSpread(stay, from);
    stay.classList.toggle('clip-l', dir > 0);
    stay.classList.toggle('clip-r', dir < 0);
    setSpread(frontImg, dir > 0 ? from : to);
    setSpread(backImg, dir > 0 ? to : from);

    const m = measure();
    const a0 = dir > 0 ? 0 : -180;
    const a1 = dir > 0 ? -180 : 0;
    const ease = duration < FLIP_MS ? easeInOutSine : easeInOutCubic;
    renderFlip(a0, m);
    zine.classList.add('is-flipping');

    return new Promise((resolve) => {
      const t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / duration);
        renderFlip(a0 + (a1 - a0) * ease(t), m);
        if (t < 1) return requestAnimationFrame(frame);
        setSpread(current, to);
        zine.classList.remove('is-flipping');
        resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  function crossfade(to) {
    setSpread(under, to);
    under.style.visibility = 'visible';
    const anim = current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease' });
    return anim.finished.then(() => {
      setSpread(current, to);
      under.style.visibility = '';
    });
  }

  /* ------------------------------------------------------------------
   * Flyer drop
   * Seen from above: a sheet falling toward the zine starts big (close to
   * the camera), sways and flutters, then settles with a tiny slide.
   * ------------------------------------------------------------------ */
  const T = (x, y, r, rx, ry, sc) =>
    `translate(${x}%, ${y}%) rotate(${r}deg) rotateX(${rx}deg) rotateY(${ry}deg) scale(${sc})`;
  const S = (x, y, r, sc) => `translate(${x}%, ${y}%) rotate(${r}deg) scale(${sc})`;

  const FLYER_KEYS = [
    { offset: 0, opacity: 0, transform: T(-18, -46, -28, 30, -20, 1.8), easing: 'ease-in-out' },
    { offset: 0.1, opacity: 1 },
    { offset: 0.34, transform: T(12, -21, 9, -16, 14, 1.42), easing: 'ease-in-out' },
    { offset: 0.6, transform: T(-7, -7, -6, 10, -8, 1.16), easing: 'ease-in' },
    { offset: 0.82, transform: T(1.6, 0.6, 1.8, 0, 0, 1), easing: 'ease-out' },
    { offset: 1, opacity: 1, transform: T(0, 0, 0, 0, 0, 1) },
  ];
  const SHADOW_KEYS = [
    { offset: 0, opacity: 0, filter: 'brightness(0) blur(34px)', transform: S(-8, -16, -28, 1.3), easing: 'ease-in-out' },
    { offset: 0.34, opacity: 0.1, filter: 'brightness(0) blur(24px)', transform: S(14, -5, 9, 1.18), easing: 'ease-in-out' },
    { offset: 0.6, opacity: 0.22, filter: 'brightness(0) blur(14px)', transform: S(-3, 1, -6, 1.07), easing: 'ease-in' },
    { offset: 0.82, opacity: 0.44, filter: 'brightness(0) blur(6px)', transform: S(2.3, 1.6, 1.8, 1), easing: 'ease-out' },
    { offset: 1, opacity: 0.38, filter: 'brightness(0) blur(5px)', transform: S(0.6, 0.9, 0, 1) },
  ];

  function dropFlyer(fast) {
    flyerWrap.classList.add('is-visible');
    if (reduceMotion) {
      return flyerWrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 }).finished;
    }
    const duration = fast ? DROP_MS * 0.6 : DROP_MS;
    const a = flyer.animate(FLYER_KEYS, { duration, fill: 'both' });
    const b = flyerShadow.animate(SHADOW_KEYS, { duration, fill: 'both' });
    // A small "thud" when it touches down.
    scene.animate(
      [{ transform: 'none' }, { transform: 'translateY(0.22%) scale(0.9985)' }, { transform: 'none' }],
      { duration: 280, delay: duration * 0.82, easing: 'ease-out' }
    );
    return Promise.all([a.finished, b.finished]).then(() => { a.cancel(); b.cancel(); });
  }

  function liftFlyer(fast) {
    const done = () => flyerWrap.classList.remove('is-visible');
    if (reduceMotion) {
      return flyerWrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250 }).finished.then(done);
    }
    const opts = { duration: fast ? LIFT_MS * 0.6 : LIFT_MS, direction: 'reverse', easing: 'ease-in', fill: 'both' };
    const a = flyer.animate(FLYER_KEYS, opts);
    const b = flyerShadow.animate(SHADOW_KEYS, opts);
    return Promise.all([a.finished, b.finished]).then(() => { done(); a.cancel(); b.cancel(); });
  }

  /* ------------------------------------------------------------------
   * Navigation
   * ------------------------------------------------------------------ */

  function transition(a, b, fast) {
    const A = STEPS[a];
    const B = STEPS[b];
    if (A.spread !== B.spread) return flip(A.spread, B.spread, Math.sign(b - a), fast ? FLIP_FAST_MS : FLIP_MS);
    if (B.flyer && !A.flyer) return dropFlyer(fast);
    if (A.flyer && !B.flyer) return liftFlyer(fast);
    return Promise.resolve();
  }

  async function pump() {
    if (busy) return;
    busy = true;
    while (index !== target) {
      const dir = Math.sign(target - index);
      const fast = Math.abs(target - index) > 1;
      await transition(index, index + dir, fast);
      index += dir;
    }
    busy = false;
    settle();
  }

  // Tell js/extras.js which spread is resting on screen (photo zoom, round table…).
  function settle() {
    const step = STEPS[index];
    zine.dataset.spread = step.spread;
    zine.dataset.flyer = step.flyer ? '1' : '0';
    zine.classList.add('is-settled');
    document.dispatchEvent(new CustomEvent('zine:settled', { detail: { spread: step.spread, flyer: !!step.flyer } }));
  }

  function goTo(i) {
    const t = Math.max(0, Math.min(LAST, i));
    if (t === target) return;
    target = t;
    $('hint').classList.add('is-gone');
    zine.classList.remove('is-settled');
    document.dispatchEvent(new CustomEvent('zine:leave'));
    updateUI();
    pump();
  }

  const next = () => (target === LAST ? goTo(0) : goTo(target + 1));
  const prev = () => goTo(target - 1);

  function updateUI() {
    const step = STEPS[target];
    $('count').textContent = String(target + 1).padStart(2, '0');
    $('title').textContent = step.title;
    prevBtn.disabled = target === 0;

    const atEnd = target === LAST;
    $('nextLabel').textContent = atEnd ? 'Again' : 'Next';
    nextBtn.setAttribute('aria-label', atEnd ? 'Back to the cover' : 'Next page');
    $('nextIcon').innerHTML = atEnd
      ? '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 3v5h5"/>'
      : '<path d="M9 4l9 8-9 8"/>';

    $('hitPrev').classList.toggle('is-off', target === 0);
    $('hitNext').classList.toggle('is-off', atEnd);
    zine.setAttribute('aria-label', `Page ${target + 1} of ${STEPS.length}: ${step.title}`);
  }

  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);
  $('hitPrev').addEventListener('click', prev);
  $('hitNext').addEventListener('click', () => { if (target < LAST) goTo(target + 1); });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onButton = e.target instanceof HTMLButtonElement;
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
        if (target < LAST) goTo(target + 1);
        break;
      case ' ':
        if (onButton) return;
        if (target < LAST) goTo(target + 1);
        break;
      case 'ArrowLeft':
      case 'PageUp':
        prev();
        break;
      case 'Home':
        goTo(0);
        break;
      case 'End':
        goTo(LAST);
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  /* ------------------------------------------------------------------
   * Boot: preload + decode everything so the first flip doesn't stutter.
   * ------------------------------------------------------------------ */
  const cache = [];
  const load = (src) =>
    new Promise((resolve) => {
      const img = new Image();
      cache.push(img);
      img.onload = () => (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(resolve);
      img.onerror = resolve;
      img.src = src;
    });

  $('total').textContent = String(STEPS.length).padStart(2, '0');
  setSpread(current, 0);
  for (const el of [under, stay, frontImg, backImg]) setSpread(el, 1);
  updateUI();

  Promise.all(PRELOAD.map(load)).then(() => {
    requestAnimationFrame(() => {
      document.body.classList.add('is-ready');
      settle();
    });
  });
})();
