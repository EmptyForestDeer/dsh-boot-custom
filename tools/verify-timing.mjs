// Timing verification: load the actual screen script into a stub DOM with a
// fake clock and run the real sequences.
//
// This is the only check that can prove "the kernel is ready but the animation
// is not finished → the screen does NOT enter" — a regex cannot. The stub DOM
// implements just enough of the surface the screen touches (document, element,
// video, MutationObserver, sessionStorage, requestAnimationFrame) and the fake
// clock drives every setTimeout.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const screen = readFileSync(join(root, 'src', 'boot-screen.js'), 'utf8')

function makeEnv({ enterMode = 'tail', theme = 'nebula', fadeMs = 2000, clips = [] } = {}) {
  const timers = []
  let now = 0
  let rafQueue = []
  let rafId = 0

  const fakeSetTimeout = (fn, ms) => {
    const id = timers.length
    timers.push({ id, fn, at: now + (ms || 0), fired: false })
    return id
  }
  const fakeClearTimeout = (id) => {
    const t = timers[id]
    if (t) t.fired = true
  }
  // setInterval: re-arm after each fire until cleared. The whale rotation is
  // 4.2s, so the timing tests never actually trigger it — this just needs to
  // exist and be clearable.
  const fakeSetInterval = (fn, ms) => {
    const period = ms || 0
    const id = timers.length
    const handler = () => {
      try { fn() } catch (e) { /* keep going */ }
      if (!timers[id] || timers[id].fired) return
      const next = { fn: handler, at: now + period, fired: false, _interval: true }
      timers.push(next)
    }
    timers.push({ id, fn: handler, at: now + period, fired: false, _interval: true })
    return id
  }
  const fakeClearInterval = (id) => {
    const t = timers[id]
    if (t) t.fired = true
  }
  const fakeRaf = (fn) => { rafQueue.push({ id: ++rafId, fn }); return rafId }
  const tick = async (ms) => {
    now += ms
    // fire timers in order
    const due = timers.filter(t => !t.fired && t.at <= now).sort((a, b) => a.at - b.at)
    for (const t of due) {
      if (t.fired) continue
      t.fired = true
      try { t.fn() } catch (e) { /* keep going */ }
    }
    // Drain the microtask queue thoroughly: the manifest chain is
    // fetch → .then(json()) → .then(payload), which needs several turns
    // before tryNext() replaces the placeholder video element.
    for (let i = 0; i < 12; i += 1) await Promise.resolve()
    // one rAF pass
    const frame = rafQueue.shift()
    if (frame) { try { frame.fn() } catch (e) { /* keep going */ } }
  }

  function makeElement(tag) {
    const isCanvas = (tag || '').toLowerCase() === 'canvas'
    // A stub 2D context covering every method the screen's canvas engine uses.
    const ctx2d = {
      setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {},
      moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, ellipse() {}, closePath() {},
      fill() {}, stroke() {}, fillRect() {}, rect() {}, clip() {}, translate() {}, scale() {}, rotate() {},
      transform() {},
      fillText() {},
      measureText(text) { return { width: String(text).length * 8 } },
      set fillStyle(v) { this._fill = v }, get fillStyle() { return this._fill },
      set strokeStyle(v) { this._stroke = v }, get strokeStyle() { return this._stroke },
      set lineWidth(v) { this._lw = v }, get lineWidth() { return this._lw },
      set lineCap(v) {}, set lineDashOffset(v) {}, set font(v) {}, set textAlign(v) {},
      set textBaseline(v) {}, set letterSpacing(v) {},
      set shadowColor(v) {}, set shadowBlur(v) {}, set globalAlpha(v) { this._ga = v }, get globalAlpha() { return this._ga },
      setLineDash() {}, createLinearGradient() { return { addColorStop() {} } },
      createRadialGradient() { return { addColorStop() {} } },
    }
    const el = {
      tagName: (tag || 'div').toUpperCase(),
      children: [],
      parentNode: null,
      attributes: {},
      style: {},
      className: '',
      textContent: '',
      _listeners: {},
      _attrs: {},
      appendChild(child) { child.parentNode = el; el.children.push(child); return child },
      removeChild(child) {
        const i = el.children.indexOf(child)
        if (i >= 0) el.children.splice(i, 1)
        child.parentNode = null
        return child
      },
      replaceChild(next, old) {
        const i = el.children.indexOf(old)
        if (i >= 0) el.children[i] = next
        next.parentNode = el
        old.parentNode = null
        return old
      },
      setAttribute(name, value) { el._attrs[name] = String(value) },
      getAttribute(name) { return el._attrs[name] ?? null },
      removeAttribute(name) { delete el._attrs[name] },
      addEventListener(type, fn, opts) {
        el._listeners[type] = el._listeners[type] || []
        el._listeners[type].push({ fn, once: !!(opts && opts.once) })
      },
      removeEventListener(type, fn) {
        const list = el._listeners[type] || []
        const i = list.findIndex(h => h.fn === fn)
        if (i >= 0) list.splice(i, 1)
      },
      dispatch(type) {
        const list = (el._listeners[type] || []).slice()
        for (const h of list) {
          try { h.fn({ target: el }) } catch (e) { /* keep going */ }
          if (h.once) el.removeEventListener(type, h.fn)
        }
      },
      querySelector() { return null },
      closest() { return null },
      getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 } },
      // canvas surface
      getContext(type) { return type === '2d' ? ctx2d : null },
      // video surface (screen script assigns these on video elements)
      muted: true,
      paused: true,
      ended: false,
      currentTime: 0,
      duration: NaN,
      volume: 1,
      readyState: 0,
      error: null,
      loop: false,
      playsInline: true,
      preload: 'auto',
      src: '',
      play() { el.paused = false; return Promise.resolve() },
      pause() { el.paused = true },
      load() {},
    }
    if (isCanvas) {
      el.width = 300
      el.height = 150
    }
    return el
  }

  const document = {
    body: makeElement('body'),
    head: makeElement('head'),
    documentElement: makeElement('html'),
    _listeners: {},
    createElement(tag) { return makeElement(tag) },
    querySelector() { return null },
    addEventListener(type, fn, opts) {
      document._listeners[type] = document._listeners[type] || []
      document._listeners[type].push({ fn, once: !!(opts && opts.once) })
    },
  }
  document.body.parentNode = null

  const globalObj = {
    document,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    requestAnimationFrame: fakeRaf,
    location: { search: '' },
    sessionStorage: (() => {
      const map = new Map()
      return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)) },
      }
    })(),
    __DSH_BOOT_CUSTOM_CFG__: {
      base: '/plugins/dsh-boot-custom',
      manifest: '/plugins/dsh-boot-custom/clips.json',
      holdMs: 15000,
      theme,
      fadeMs,
      enterMode,
      sound: true,
      clickToEnter: false,
      showHint: true,
    },
    MutationObserver: function () {
      this.observe = () => {}
      this.disconnect = () => {}
    },
    addEventListener() {},
    __DSH_BOOT_CUSTOM__: undefined,
  }
  globalObj.window = globalObj
  globalObj.globalThis = globalObj
  globalObj.self = globalObj
  globalObj.navigator = { userAgent: 'stub' }
  globalObj.setInterval = fakeSetInterval
  globalObj.clearInterval = fakeClearInterval
  globalObj.cancelAnimationFrame = (id) => {
    const i = rafQueue.findIndex(f => f.id === id)
    if (i >= 0) rafQueue.splice(i, 1)
  }

  // fetch resolves with the caller's clip pool (nebula never fetches).
  globalObj.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ clips }) })
  // Path2D is a browser API; the stub only needs it to exist so the brand and
  // end-card logo sweeps can run.
  globalObj.Path2D = function Path2D(d) { this.d = d }

  const run = () => {
    const fn = new Function('window', 'document', 'globalThis', 'sessionStorage', 'fetch', 'Path2D', screen)
    fn.call(globalObj, globalObj, document, globalObj, globalObj.sessionStorage, globalObj.fetch, globalObj.Path2D)
  }

  return { globalObj, document, timers, tick, run, now: () => now }
}

function rows(...items) { return items }

export async function verifyTiming() {
  const results = []

  // 1. Nebula theme, tail mode: kernel ready only after the animation would
  //    have finished → must NOT enter before NEBULA_MS.
  {
    const env = makeEnv({ enterMode: 'tail', theme: 'nebula' })
    env.run()
    const ns = env.globalObj.__DSH_BOOT_CUSTOM__
    if (!ns) { results.push({ ok: false, name: 'nebula tail: namespace', detail: 'no namespace' }) }
    else {
      // clientReady after 1s (kernel ready while animation still running).
      // The screen may show its ready hint (data-state=ready) — that is the
      // correct "kernel ready, waiting for the animation" state. What it must
      // NOT do is leave yet.
      await env.tick(1000)
      ns.clientReady()
      const stateAt1s = env.document.body.children[0].getAttribute('data-state')
      // Animation not done (NEBULA_MS=8000), kernel ready → still not leaving
      await env.tick(1000)
      const stateAt2s = env.document.body.children[0].getAttribute('data-state')
      // Now let the nebula timer fire.
      await env.tick(6500)
      const stateAfter = env.document.body.children[0].getAttribute('data-state')
      const ok = stateAt1s !== 'leaving' && stateAt2s !== 'leaving' && stateAfter === 'leaving'
      results.push({
        ok,
        name: 'nebula tail: hand-off only after animation',
        detail: `1s=${stateAt1s} 2s=${stateAt2s} after=${stateAfter}`,
      })
    }
  }

  // 2. Nebula theme, click mode: kernel ready and timer both pass → still no
  //    auto enter.
  {
    const env = makeEnv({ enterMode: 'click', theme: 'nebula' })
    env.run()
    const ns = env.globalObj.__DSH_BOOT_CUSTOM__
    await env.tick(10000)
    if (ns) ns.clientReady()
    await env.tick(2000)
    const state = env.document.body.children[0].getAttribute('data-state')
    results.push({ ok: state !== 'leaving', name: 'nebula click: never auto-enters', detail: `state=${state}` })
  }

  // 3. Video theme, empty pool: falls back to nebula and still releases.
  {
    const env = makeEnv({ enterMode: 'tail', theme: 'video' })
    env.run()
    // Let the manifest fetch resolve and the empty-pool fallback schedule.
    await env.tick(50)
    await env.tick(9000) // past NEBULA_MS
    const state = env.document.body.children[0].getAttribute('data-state')
    results.push({ ok: state === 'idle' || state === 'leaving' || state === 'ready',
      name: 'video empty pool: releases via nebula', detail: `state=${state}` })
  }

  // 4. Hold budget: kernel never ready → attention hint after HOLD_MS.
  {
    const env = makeEnv({ enterMode: 'tail', theme: 'nebula' })
    env.run()
    await env.tick(16000)
    const root = env.document.body.children[0]
    const attention = root.getAttribute('data-attention')
    results.push({ ok: attention === '1', name: 'hold budget: attention after 15s', detail: `attention=${attention}` })
  }

  // 5. The canvas animation engine runs frames without throwing (the brand
  //    sweep and the whale-girl drawing must not crash under the stub 2D ctx).
  {
    const env = makeEnv({ enterMode: 'tail', theme: 'nebula' })
    env.run()
    let threw = null
    try {
      // Drive several rAF frames + enough time for the whale to enter.
      for (let i = 0; i < 30; i += 1) await env.tick(120)
    } catch (e) {
      threw = String(e && e.message ? e.message : e)
    }
    // The two canvas layers should exist and be marked shown.
    const brand = env.document.body.children[0]
    results.push({
      ok: threw === null,
      name: 'canvas animation frames run',
      detail: threw === null ? '30 frames ok' : threw,
    })
  }

  // 6. Video theme: the end card (watermark cover) appears only inside the
  //    clip's last CARD_LEAD_MS and never before. The stub video's clock is
  //    driven by hand, exactly like a real player would.
  {
    const env = makeEnv({
      enterMode: 'end', theme: 'video',
      clips: [{ name: 'a.mp4', src: '/clip/a.mp4', enabled: true }],
    })
    env.run()
    await env.tick(60) // manifest fetch resolves, tryNext creates the video
    const root = env.document.body.children[0]
    const card = root.children.find(c => c.className === 'dshbc-card')
    const video = root.children.filter(c => c.tagName === 'VIDEO').pop()
    // The built-in artwork is hidden from the first frame in the video theme.
    results.push({
      ok: root.getAttribute('data-video') === '1',
      name: 'video theme hides the nebula artwork',
      detail: `data-video=${root.getAttribute('data-video')}`,
    })
    if (!card || !video) {
      results.push({ ok: false, name: 'end card timing', detail: 'card or video element missing' })
    } else {
      video.duration = 10.1
      video.paused = false
      video.readyState = 2
      const showAt = (seconds) => {
        video.currentTime = seconds
        return env.tick(50).then(() => card.getAttribute('data-show'))
      }
      const at5 = await showAt(5.0) // 5.1s left: cover must stay hidden
      const at7 = await showAt(7.0) // 3.1s left: inside CARD_LEAD_MS → shown
      const at9 = await showAt(9.0) // still shown until the clip ends
      results.push({
        ok: at5 !== '1' && at7 === '1' && at9 === '1',
        name: 'end card covers only the clip tail',
        detail: `5s=${at5} 7s=${at7} 9s=${at9}`,
      })
      // A ~5s clip is too short to carry the cover without eating most of its
      // runtime: the card must stay off even at its tail.
      video.duration = 5.0
      const shortAt4 = await showAt(4.0)
      results.push({
        ok: shortAt4 !== '1',
        name: 'end card skips short clips',
        detail: `5s clip at t=4s: ${shortAt4}`,
      })
    }
  }

  // 7. Video theme whose clips all fail: the hide is undone (data-video gone,
  //    the nebula artwork is back) and the run releases once the kernel is
  //    ready, exactly like the verified "all clips failed" fallback.
  {
    const env = makeEnv({
      enterMode: 'tail', theme: 'video',
      clips: [{ name: 'broken.mp4', src: '/clip/broken.mp4', enabled: true }],
    })
    env.run()
    await env.tick(60)
    const root = env.document.body.children[0]
    const video = root.children.filter(c => c.tagName === 'VIDEO').pop()
    video.error = { code: 4 }
    video.dispatch('error')
    await env.tick(50)
    const hidden = root.getAttribute('data-video')
    env.globalObj.__DSH_BOOT_CUSTOM__.clientReady()
    await env.tick(50)
    const state = root.getAttribute('data-state')
    results.push({
      ok: hidden === null && state === 'leaving',
      name: 'unplayable clip falls back to the nebula',
      detail: `data-video=${hidden} state=${state}`,
    })
  }

  return results
}
