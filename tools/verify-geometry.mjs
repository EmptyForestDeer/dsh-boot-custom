// Geometry audit: run the REAL whale-girl / brand drawing code against an
// instrumented 2D context that records every coordinate it draws, then assert
// the character's bounding box fits inside the canvas and that nothing is
// drawn at absurd coordinates.
//
// This cannot judge whether she is pretty. It catches the two mistakes that
// make a canvas character useless: drawing far outside the viewport (clipped
// or invisible), and drawing nothing at all.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const CANVAS_W = 600
const CANVAS_H = 720

/** An instrumented 2D context that records every drawn coordinate. */
function instrumentedCtx() {
  const pts = []
  const calls = []
  let tx = 0
  let ty = 0
  let s = 1 // accumulated uniform scale (the drawing only uses uniform scale)
  const stack = []
  // Record in SCREEN space: local coordinate -> scaled -> translated. Without
  // this the audit would read the character's untransformed authoring units and
  // under-report her real on-screen size.
  const rec = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x * s + tx, y * s + ty]) }
  const ctx = {
    _pts: pts,
    _calls: calls,
    _reset() { pts.length = 0; calls.length = 0; tx = 0; ty = 0; s = 1; stack.length = 0 },
    setTransform() {},
    clearRect() {},
    save() { stack.push([tx, ty, s]) },
    restore() { const p = stack.pop(); if (p) { tx = p[0]; ty = p[1]; s = p[2] } },
    beginPath() {},
    moveTo(x, y) { rec(x, y) },
    lineTo(x, y) { rec(x, y) },
    quadraticCurveTo(cx, cy, x, y) { rec(cx, cy); rec(x, y) },
    arc(x, y, r) { rec(x - r, y - r); rec(x + r, y + r) },
    ellipse(x, y, rx, ry) { rec(x - rx, y - ry); rec(x + rx, y + ry) },
    closePath() {},
    fill() { calls.push({ type: 'fill' }) },
    stroke(path) { calls.push({ type: 'stroke', hasPath: !!path }) },
    fillRect(x, y, w, h) { rec(x, y); rec(x + w, y + h) },
    rect(x, y, w, h) { rec(x, y); rec(x + w, y + h) },
    clip() {},
    translate(x, y) { tx += x * s; ty += y * s },
    scale(x, y) { s *= x },
    rotate() {},
    transform() {},
    fillText(text, x, y) { calls.push({ type: 'text', text: String(text) }); rec(x, y) },
    measureText(t) { return { width: String(t).length * 10 } },
    setLineDash() {},
    createLinearGradient() { return { addColorStop() {} } },
    createRadialGradient() { return { addColorStop() {} } },
    set fillStyle(v) {}, get fillStyle() { return '#000' },
    set strokeStyle(v) {}, get strokeStyle() { return '#000' },
    set lineWidth(v) {}, get lineWidth() { return 1 },
    set lineCap(v) {}, set lineDashOffset(v) {}, set font(v) {},
    set textAlign(v) {}, set textBaseline(v) {},
    set shadowColor(v) {}, set shadowBlur(v) {},
    set globalAlpha(v) {}, get globalAlpha() { return 1 },
  }
  return ctx
}

function makeEnv() {
  const ctx = instrumentedCtx()
  const el = (tag) => {
    const node = {
      tagName: String(tag).toUpperCase(), children: [], parentNode: null, _attrs: {}, style: {},
      className: '', textContent: '', width: 300, height: 150,
      _cssW: CANVAS_W, _cssH: CANVAS_H,
      appendChild(c) { c.parentNode = node; node.children.push(c); return c },
      removeChild(c) { return c },
      replaceChild(n, o) { return o },
      setAttribute(k, v) { node._attrs[k] = String(v) },
      getAttribute(k) { return node._attrs[k] ?? null },
      removeAttribute(k) { delete node._attrs[k] },
      addEventListener() {}, removeEventListener() {},
      querySelector() { return null }, closest() { return null },
      getBoundingClientRect() { return { left: 0, top: 0, width: CANVAS_W, height: CANVAS_H } },
      getContext(type) { return type === '2d' ? ctx : null },
      muted: true, paused: true, ended: false, currentTime: 0, duration: NaN, volume: 1,
      readyState: 0, error: null, src: '', loop: false, playsInline: true, preload: 'auto',
      play() { return Promise.resolve() }, pause() {}, load() {},
    }
    return node
  }
  const doc = {
    body: el('body'), head: el('head'), documentElement: el('html'),
    createElement(tag) { return el(tag) },
    querySelector() { return null },
    addEventListener() {},
  }
  const g = {
    document: doc,
    location: { search: '', href: 'http://localhost/' },
    sessionStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {} },
    addEventListener() {}, devicePixelRatio: 1,
    __DSH_BOOT_CUSTOM_CFG__: {
      base: '/plugins/dsh-boot-custom',
      manifest: '/plugins/dsh-boot-custom/clips.json',
      holdMs: 15000, theme: 'nebula', fadeMs: 2000, enterMode: 'tail',
      sound: true, clickToEnter: false, showHint: true,
    },
  }
  g.window = g; g.globalThis = g; g.self = g
  // Path2D is a browser API; the audit only needs it to exist so the brand
  // sweep's stroke() call can run.
  g.Path2D = function Path2D(d) { this.d = d }
  g.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ clips: [] }) })
  return { g, doc, ctx }
}

/** Bounding box of recorded points. */
function bounds(pts) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

export function verifyGeometry() {
  const results = []
  const env = makeEnv()
  let screen = readFileSync(join(root, 'src', 'boot-screen.js'), 'utf8')

  // Expose the two drawing functions for the audit. The screen is an IIFE, so
  // the hooks are injected right after it publishes its namespace.
  screen = screen.replace(
    'globalThis.__DSH_BOOT_CUSTOM__ = namespace',
    'globalThis.__DSH_BOOT_CUSTOM__ = namespace;'
    + 'globalThis.__TEST_DRAW__ = { whale: drawWhaleFrame, brand: drawBrandFrame, card: drawCardFrame };',
  )
  const fn = new Function('window', 'document', 'globalThis', 'sessionStorage', 'fetch', 'Path2D', screen)
  fn.call(env.g, env.g, env.doc, env.g, env.g.sessionStorage, env.g.fetch, env.g.Path2D)

  const hooks = env.g.__TEST_DRAW__
  results.push({ ok: !!hooks, name: 'draw hooks exposed', detail: hooks ? 'ok' : 'missing' })
  if (!hooks) return results

  // --- whale girl at a settled pose (t = 3000ms), no bubble -------------
  env.ctx._reset()
  hooks.whale(env.ctx, CANVAS_W, CANVAS_H, 3000, 0)
  const held = env.ctx._pts.slice()
  const fills = env.ctx._calls.filter(c => c.type === 'fill').length
  // She is assembled from ~16 filled paths (tail, two back-hair panels, dress,
  // hem, apron, waist band, frill, two arms, two hands, bow, neck, face, two
  // fin ears, bangs, braid beads, eyes, brows, blush, mouth...).
  results.push({
    ok: fills >= 14,
    name: 'whale girl drew a full figure',
    detail: fills + ' filled paths, ' + held.length + ' points',
  })
  const b = bounds(held)
  const okX = b.minX > -CANVAS_W * 0.5 && b.maxX < CANVAS_W * 1.5
  const okY = b.minY > -CANVAS_H * 0.6 && b.maxY < CANVAS_H * 1.4
  results.push({
    ok: okX && okY,
    name: 'whale girl fits around the canvas',
    detail: `x ${b.minX.toFixed(0)}..${b.maxX.toFixed(0)} y ${b.minY.toFixed(0)}..${b.maxY.toFixed(0)}`,
  })
  results.push({
    ok: (b.maxY - b.minY) > CANVAS_H * 0.6,
    name: 'whale girl fills the vertical space',
    detail: `height ${(b.maxY - b.minY).toFixed(0)}px of ${CANVAS_H}`,
  })

  // --- the welcome bubble appears only when asked -----------------------
  env.ctx._reset()
  hooks.whale(env.ctx, CANVAS_W, CANVAS_H, 3000, 1)
  const bubbleText = env.ctx._calls.filter(c => c.type === 'text').map(c => c.text)
  const bubbleFills = env.ctx._calls.filter(c => c.type === 'fill').length
  env.ctx._reset()
  hooks.whale(env.ctx, CANVAS_W, CANVAS_H, 3000, 0)
  const noBubbleFills = env.ctx._calls.filter(c => c.type === 'fill').length
  results.push({
    ok: bubbleText.includes('欢迎回来') && bubbleFills > noBubbleFills,
    name: '欢迎回来 bubble drawn with the line visible',
    detail: `texts=[${bubbleText.join(',')}] fills ${noBubbleFills} -> ${bubbleFills}`,
  })

  // --- the whale girl is NOT drawn before she swims in ------------------
  env.ctx._reset()
  hooks.whale(env.ctx, CANVAS_W, CANVAS_H, 50, 0)
  results.push({
    ok: env.ctx._pts.length === 0,
    name: 'no geometry before swim-in',
    detail: env.ctx._pts.length + ' points at t=50',
  })

  // --- brand side draws the wordmark + logo sweep -----------------------
  env.ctx._reset()
  hooks.brand(env.ctx, CANVAS_W, CANVAS_H, 3000)
  const brandPts = env.ctx._pts.slice()
  const brandTexts = env.ctx._calls.filter(c => c.type === 'text').map(c => c.text)
  const brandPathStroke = env.ctx._calls.some(c => c.type === 'stroke' && c.hasPath)
  results.push({
    ok: brandTexts.includes('DeepSeek') && brandPathStroke,
    name: 'brand drew wordmark text + logo path sweep',
    detail: `texts=[${brandTexts.join(',')}] logoStroke=${brandPathStroke}`,
  })
  const bb = bounds(brandPts)
  results.push({
    ok: Number.isFinite(bb.minX) && bb.maxX < CANVAS_W * 1.2,
    name: 'brand stays within its canvas',
    detail: `x ${bb.minX.toFixed(0)}..${bb.maxX.toFixed(0)}`,
  })

  // --- end card: wordmark + sub + logo sweep, inside its own canvas -----
  // The card canvas is 60% x 38% of a 1280x720 viewport.
  const CARD_W = 768
  const CARD_H = 274
  env.ctx._reset()
  hooks.card(env.ctx, CARD_W, CARD_H, 3000)
  const cardTexts = env.ctx._calls.filter(c => c.type === 'text').map(c => c.text)
  const cardStroke = env.ctx._calls.some(c => c.type === 'stroke' && c.hasPath)
  results.push({
    ok: cardTexts.includes('DeepSeek') && cardTexts.includes('H A R N E S S') && cardStroke,
    name: 'end card drew wordmark + sub + logo sweep',
    detail: `texts=[${cardTexts.join(',')}] logoStroke=${cardStroke}`,
  })
  const cb = bounds(env.ctx._pts.slice())
  results.push({
    ok: cb.minX > -CARD_W && cb.maxX < CARD_W * 2 && cb.minY > -CARD_H && cb.maxY < CARD_H * 2,
    name: 'end card stays around its canvas',
    detail: `x ${cb.minX.toFixed(0)}..${cb.maxX.toFixed(0)} y ${cb.minY.toFixed(0)}..${cb.maxY.toFixed(0)}`,
  })

  // --- the vignette must be opaque across the observed watermark box ----
  // The reference clip's burned-in title card occupies x 10.9%-62.5%,
  // y 35.4%-62.5% of the frame. The card layer must (a) geometrically contain
  // that box and (b) keep its radial-gradient alpha >= 0.95 at every corner
  // of it, so third-party text cannot read through the cover.
  const WM = [[0.109, 0.354], [0.625, 0.354], [0.109, 0.625], [0.625, 0.625]]
  const block = /\.dshbc-card\{[^}]*\}/.exec(screen)
  let coverOk = false
  let coverDetail = 'card css block not found'
  if (block) {
    const css = block[0]
    const pct = (name) => {
      const m = new RegExp(name + ':([0-9.]+)%').exec(css)
      return m ? Number(m[1]) / 100 : NaN
    }
    // A full-frame layer is written as `inset:0`; a sized one as left/top/%.
    const fullFrame = /inset:0/.test(css)
    const left = fullFrame ? 0 : pct('left')
    const top = fullFrame ? 0 : pct('top')
    const width = fullFrame ? 1 : pct('width')
    const height = fullFrame ? 1 : pct('height')
    const ell = /ellipse ([0-9.]+)% ([0-9.]+)% at ([0-9.]+)% ([0-9.]+)%/.exec(css)
    const stops = []
    const re = /rgba\(3,8,18,([0-9.]+)\)\s+([0-9.]+)%/g
    for (let m = re.exec(css); m !== null; m = re.exec(css)) {
      stops.push([Number(m[2]), Number(m[1])])
    }
    stops.sort((a, b) => a[0] - b[0])
    const alphaAt = (pos) => {
      if (stops.length === 0) return 0
      if (pos <= stops[0][0]) return stops[0][1]
      for (let i = 1; i < stops.length; i += 1) {
        if (pos <= stops[i][0]) {
          const [p0, a0] = stops[i - 1]
          const [p1, a1] = stops[i]
          const f = p1 === p0 ? 0 : (pos - p0) / (p1 - p0)
          return a0 + (a1 - a0) * f
        }
      }
      return stops[stops.length - 1][1]
    }
    let minAlpha = 1
    let contained = true
    if (ell && Number.isFinite(left) && stops.length >= 2) {
      const rx = Number(ell[1]) / 100
      const ry = Number(ell[2]) / 100
      const cx = Number(ell[3]) / 100
      const cy = Number(ell[4]) / 100
      for (const [fx, fy] of WM) {
        if (fx < left || fx > left + width || fy < top || fy > top + height) contained = false
        const u = (fx - left) / width
        const v = (fy - top) / height
        const r = Math.hypot((u - cx) / rx, (v - cy) / ry) * 100
        minAlpha = Math.min(minAlpha, alphaAt(r))
      }
    } else {
      contained = false
      minAlpha = 0
    }
    coverOk = contained && minAlpha >= 0.95
    coverDetail = `contained=${contained} minAlpha=${minAlpha.toFixed(3)} stops=${stops.length}`
  }
  results.push({
    ok: coverOk,
    name: 'end card vignette opaque over watermark box',
    detail: coverDetail,
  })

  return results
}
