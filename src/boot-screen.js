// Pre-boot screen, injected as a parser-blocking head row by entry.js.
//
// This file is a script *text*, not a module: it runs before the shell module
// script and therefore before `AppWebEntry` builds the kernel boot page. That
// ordering is the entire mechanism: by the time the kernel renders its own
// "HARNESS / Loading plugins..." page, this screen already owns the viewport.
//
// It reads the screen settings from the JSON row emitted immediately before
// this script (window.__DSH_BOOT_CUSTOM_CFG__), and it reads live boot progress
// by observing the CSS custom property the kernel boot page writes on its
// spinner (`--dsh-boot-arc`: 72deg at zero active entries, 288deg at all).
//
// It deliberately does not touch React or the shell module table: it needs no
// framework and must survive the UI renderer failing.
//
// Theme: `nebula` is the built-in CSS/SVG animation — a slowly rotating set of
// radial gradients, a breathing core, drifting particles and a faint grid — so
// the screen works with zero asset files and none of the moov/caching/codec
// pitfalls a video brings. `video` plays one clip from the pool instead (the
// sibling dsh-boot-animation's whole machinery), falling back to the nebula
// when the pool is empty.
//
// A CSS animation has no `ended` event and no duration metadata, so in `tail`
// and `end` modes the hand-off is driven by a NEBULA_MS timer that stands in
// for "the clip played out". In `click` mode the nebula just keeps running and
// only a press enters, exactly like a looping clip.

/* eslint-disable */
;(function () {
  'use strict'

  var cfg = globalThis.__DSH_BOOT_CUSTOM_CFG__
  if (!cfg || typeof cfg !== 'object' || typeof cfg.manifest !== 'string') return
  if (globalThis.__DSH_BOOT_CUSTOM__) return

  var HOLD_MS = typeof cfg.holdMs === 'number' ? cfg.holdMs : 15000
  // How long the dissolve into the app takes. Clamped rather than trusted.
  var FADE_MS = typeof cfg.fadeMs === 'number' && cfg.fadeMs >= 300 && cfg.fadeMs <= 5000
    ? Math.round(cfg.fadeMs)
    : 2000
  // When the hand-off happens. `tail` dissolves over the animation's last
  // FADE_MS so both finish together; `end` plays the animation out and then
  // fades; `click` never enters on its own and waits for the user.
  var ENTER_MODE = cfg.enterMode === 'end' || cfg.enterMode === 'click' ? cfg.enterMode : 'tail'
  // `nebula` or `video`.
  var THEME = cfg.theme === 'video' ? 'video' : 'nebula'
  // Sound off is the absence of every audio path (only meaningful for video).
  var SOUND_ON = cfg.sound !== false
  var SOUND_TEXT_OFF = '🔇'
  var SOUND_TEXT_ON = '🔊'
  var SOUND_NAME = '影片声音'
  var SOUND_HINT_OFF = '点一下打开声音'
  var SOUND_HINT_ON = '点一下关闭声音'
  var SOUND_HINT_REFUSED = '浏览器拒绝了声音，点一下重试'
  var CLICK_TO_ENTER = cfg.clickToEnter === true
  var SHOW_HINT = cfg.showHint !== false
  // 片尾语音：与「欢迎回来」气泡同一时刻，用系统语音轻声说一句。
  // speechSynthesis is a renderer API, not a media element: Chromium's
  // autoplay policy does not gate it, so it can speak on a cold boot with no
  // user gesture. It still honours the global mute (SOUND_ON off = silence).
  var VOICE_ON = cfg.voice !== false
  var WELCOME_TEXT = '欢迎回来'
  // A video clip shorter than this cannot carry the dissolve.
  var TAIL_MIN_MS = FADE_MS * 2
  // A clip whose length is unknown never fires `ended`; this bounds that.
  var ENDLESS_MS = 20000
  // The CSS nebula has no end and no metadata: this is the stand-in for "the
  // animation played out" in `tail` / `end` modes. In `click` mode it never
  // fires. Chosen to read as a complete, satisfying boot loop (~8s feels like
  // one full nebula breath), and the progress bar is driven by the kernel's
  // real arc anyway, so the screen never lies about readiness.
  var NEBULA_MS = 8000
  var AUDIO_GRACE_MS = 1300
  var ARC_MIN = 72
  var ARC_SPAN = 216
  var cache = { startedAt: Date.now(), current: null, loaded: false }

  // The Windows caption (minimise / maximise / close) is painted by Electron
  // *above* the page, so no z-index here can ever cover it. The desktop preload
  // builds a hidden probe styled from two theme tokens, measures it, and
  // forwards the result over its `windowsAppearance` IPC. The caption is
  // repainted by restyling that probe — and only that probe.
  var CAPTION_CSS = 'body>span[style*="dsw-specific-sidebar-fill"]'
    + '{background-color:rgba(0,0,0,0)!important;color:#e8f2fb!important}'
  var captionStyle = null
  var captionDone = false

  var nextFrame = typeof globalThis.requestAnimationFrame === 'function'
    ? function (fn) { globalThis.requestAnimationFrame(fn) }
    : function (fn) { globalThis.setTimeout(fn, 50) }

  function shuffled(values) {
    var out = values.slice()
    for (var i = out.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1))
      var swap = out[i]
      out[i] = out[j]
      out[j] = swap
    }
    return out
  }

  function pickClip(clips) {
    var recentKey = 'dsh-boot-custom:recent'
    var recent = []
    try {
      recent = JSON.parse(sessionStorage.getItem(recentKey) || '[]')
      if (!Array.isArray(recent)) recent = []
    } catch (error) {
      recent = []
    }
    var fresh = clips.filter(function (clip) { return recent.indexOf(clip.name) < 0 })
    var pool = fresh.length > 0 ? fresh : clips
    var chosen = pool[Math.floor(Math.random() * pool.length)]
    recent.push(chosen.name)
    while (recent.length > Math.max(clips.length - 1, 1)) recent.shift()
    try {
      sessionStorage.setItem(recentKey, JSON.stringify(recent))
    } catch (error) {
      /* private mode: rotation degrades to plain random */
    }
    return chosen
  }

  // The nebula is drawn with a single stylesheet: layered radial gradients that
  // slowly rotate and breathe, a few absolutely-positioned glow blobs, drifting
  // particles, and a faint constellation grid. All CSS/SVG — no assets, no
  // network, no decoding.
  function nebulaStyle() {
    return [
      '.dshbc{position:fixed;inset:0;z-index:2147483647;overflow:hidden;',
      'background:#030812;cursor:pointer;-webkit-user-select:none;user-select:none;',
      'font-family:system-ui,-apple-system,Segoe UI,Microsoft YaHei,sans-serif;',
      'color:#dbeaf7;transition:opacity ' + (FADE_MS / 1000) + 's ease;opacity:1}',
      '.dshbc[data-state=leaving]{opacity:0;pointer-events:none}',
      // Nebula core: three radial gradients stacked, rotating slowly. The whole
      // scene breathes by scaling 1 → 1.04 → 1 over 8s (== NEBULA_MS), so the
      // dissolve can land on a "full breath" exactly.
      '.dshbc-nebula{position:absolute;inset:0;',
      'background:radial-gradient(ellipse 70% 55% at 50% 42%,#1d3a63 0%,#0c1f3a 38%,#050b18 68%,#000 100%),',
      'radial-gradient(circle 34% 30% at 62% 34%,rgba(96,165,250,.34) 0%,transparent 62%),',
      'radial-gradient(circle 28% 26% at 38% 58%,rgba(167,139,250,.24) 0%,transparent 60%);',
      'animation:dshbc-breathe 8s ease-in-out infinite;',
      'will-change:transform,opacity}',
      // The drifting particles: a handful of tiny stars on slow parallax paths.
      '.dshbc-stars{position:absolute;inset:0;overflow:hidden}',
      '.dshbc-star{position:absolute;width:2px;height:2px;border-radius:50%;',
      'background:#cfe4f6;opacity:.7;animation:dshbc-drift linear infinite}',
      '.dshbc-star:nth-child(1){left:18%;top:26%;animation-duration:14s}',
      '.dshbc-star:nth-child(2){left:72%;top:18%;animation-duration:19s;width:1.5px;height:1.5px}',
      '.dshbc-star:nth-child(3){left:84%;top:52%;animation-duration:23s}',
      '.dshbc-star:nth-child(4){left:26%;top:64%;animation-duration:17s;width:1.5px;height:1.5px}',
      '.dshbc-star:nth-child(5){left:48%;top:12%;animation-duration:21s}',
      '.dshbc-star:nth-child(6){left:64%;top:76%;animation-duration:16s;width:1.5px;height:1.5px}',
      '.dshbc-star:nth-child(7){left:12%;top:44%;animation-duration:25s}',
      '.dshbc-star:nth-child(8){left:90%;top:30%;animation-duration:18s;width:1.5px;height:1.5px}',
      // A faint constellation grid that slowly rotates.
      '.dshbc-grid{position:absolute;inset:-10%;opacity:.14;',
      'background-image:linear-gradient(rgba(143,216,255,.5) 1px,transparent 1px),',
      'linear-gradient(90deg,rgba(143,216,255,.5) 1px,transparent 1px);',
      'background-size:64px 64px;',
      '-webkit-mask-image:radial-gradient(ellipse 72% 66% at 50% 46%,#000 30%,transparent 72%);',
      'mask-image:radial-gradient(ellipse 72% 66% at 50% 46%,#000 30%,transparent 72%);',
      'animation:dshbc-spin 60s linear infinite}',
      // The bottom UI: progress bar + hint, tucked under the left brand block
      // so it never collides with the whale-girl on the right.
      '.dshbc-ui{position:absolute;left:0;right:0;bottom:0;padding:22px 30px 20px;',
      'display:flex;flex-direction:column;gap:8px;align-items:flex-start;',
      'text-shadow:0 1px 10px rgba(0,0,0,.6)}',
      '.dshbc-title{font-size:11px;letter-spacing:.3em;font-weight:600;color:#9fc4e6;',
      'text-transform:uppercase;opacity:.9}',
      '.dshbc-bar{position:relative;width:min(300px,42vw);height:2px;border-radius:2px;',
      'background:rgba(159,196,230,.22);overflow:hidden}',
      '.dshbc-fill{position:absolute;inset:0 auto 0 0;width:0%;border-radius:2px;',
      'background:linear-gradient(90deg,#4f9dd9,#8fd8ff);',
      'box-shadow:0 0 12px rgba(143,216,255,.75);transition:width .45s ease}',
      '.dshbc-hint{font-size:12px;color:#8fb3d4;letter-spacing:.12em;opacity:0;',
      'transition:opacity .5s ease}',
      '.dshbc[data-hint="0"] .dshbc-hint{display:none}',
      '.dshbc[data-state=ready] .dshbc-hint{opacity:.95}',
      '.dshbc[data-attention="1"] .dshbc-hint{opacity:1;color:#ffd79a;letter-spacing:.04em}',
      '.dshbc[data-attention="1"] .dshbc-fill{background:linear-gradient(90deg,#d99a4f,#ffd79a)}',
      '.dshbc-sound{position:absolute;right:22px;bottom:22px;z-index:2;cursor:pointer;',
      'width:38px;height:38px;display:flex;align-items:center;justify-content:center;',
      'font-size:16px;line-height:1;padding:0;border-radius:999px;',
      'color:#cfe4f6;background:rgba(12,26,42,.62);border:1px solid rgba(159,196,230,.38);',
      'backdrop-filter:blur(4px);transition:opacity .4s ease,background .2s ease}',
      '.dshbc-sound:hover{background:rgba(20,44,70,.78)}',
      '.dshbc[data-state=leaving] .dshbc-sound{opacity:0;pointer-events:none}',
      '.dshbc-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;',
      'opacity:0;transition:opacity 1.1s ease;',
      '-webkit-mask-image:radial-gradient(ellipse 88% 82% at 50% 50%,#000 62%,transparent 100%);',
      'mask-image:radial-gradient(ellipse 88% 82% at 50% 50%,#000 62%,transparent 100%)}',
      '.dshbc-video[data-shown="1"]{opacity:1}',
      // Video theme from the first frame: the built-in nebula, stars, grid and
      // the brand/whale canvases stay hidden so the screen shows ONLY the
      // clip (a dark backdrop while its first frame decodes). The attribute
      // is dropped on every fallback path (empty pool, unreadable manifest,
      // unplayable clips), which brings the nebula back as the safety net.
      '.dshbc[data-video="1"] .dshbc-nebula,',
      '.dshbc[data-video="1"] .dshbc-stars,',
      '.dshbc[data-video="1"] .dshbc-grid{display:none}',
      '.dshbc[data-video="1"] .dshbc-brand,',
      '.dshbc[data-video="1"] .dshbc-whale{opacity:0;transition:none}',
      // Left brand canvas: the DeepSeek wordmark + whale logo drawn with a
      // flowing light sweep (stroke animation) rather than a static SVG.
      '.dshbc-brand{position:absolute;left:0;top:0;bottom:0;width:52%;',
      'pointer-events:none;opacity:0;transition:opacity 1.2s ease}',
      '.dshbc-brand[data-show="1"]{opacity:1}',
      '.dshbc-brand canvas{width:100%;height:100%;display:block}',
      // Right whale-girl canvas: an anthropomorphic whale girl (blue hair, fin
      // ears, maid dress) who drifts in, breathes, blinks, waves and says
      // 欢迎回来 as the animation ends — all drawn per frame with JS.
      '.dshbc-whale{position:absolute;right:0;top:0;bottom:0;width:48%;',
      'pointer-events:none;opacity:0;transition:opacity 1.2s ease}',
      '.dshbc-whale[data-show="1"]{opacity:1}',
      '.dshbc-whale canvas{width:100%;height:100%;display:block}',
      // End brand card: pool clips may carry a burned-in AI title card (a
      // watermark) over their last seconds. This layer dissolves in slightly
      // before that card appears and covers its region — an opaque vignette
      // plus our own metal wordmark — so third-party text never reaches the
      // eye. The layer is FULL-FRAME on purpose: a sized box would clip the
      // gradient while it was still opaque and render a hard rectangle. The
      // ellipse is sized so its plateau covers the observed watermark box
      // (x 11%-63%, y 35%-63% of the frame) and its fade to transparent
      // completes before any frame edge.
      '.dshbc-card{position:absolute;inset:0;',
      'pointer-events:none;opacity:0;transition:opacity .6s ease;',
      'background:radial-gradient(ellipse 40% 38% at 37% 49%,',
      'rgba(3,8,18,1) 0%,rgba(3,8,18,.995) 76%,rgba(3,8,18,.5) 90%,rgba(3,8,18,0) 100%)}',
      '.dshbc-card[data-show="1"]{opacity:1}',
      '.dshbc-card canvas{position:absolute;left:6%;top:30%;width:60%;height:38%;display:block}',
      '@keyframes dshbc-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}',
      '@keyframes dshbc-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',
      '@keyframes dshbc-drift{0%{transform:translate(0,0);opacity:.15}',
      '50%{opacity:.85}100%{transform:translate(26px,-46px);opacity:.15}}',
    ].join('')
  }

  // The official DeepSeek whale logo path (from the harness favicon), used by
  // the brand canvas as a flowing light sweep.
  var WHALE_LOGO_PATH = 'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z'

  var whaleAnim = null

  function build() {
    var css = document.createElement('style')
    css.setAttribute('data-dsh-boot-custom', '')
    css.textContent = nebulaStyle()
    var root = document.createElement('div')
    root.className = 'dshbc'
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', 'DSH boot animation')
    root.setAttribute('data-state', 'idle')
    root.setAttribute('data-hint', SHOW_HINT ? '1' : '0')
    // Video theme: hide the built-in artwork from the first frame (see the
    // [data-video] rules in the stylesheet). Every fallback drops this.
    if (THEME === 'video') root.setAttribute('data-video', '1')

    var nebula = document.createElement('div')
    nebula.className = 'dshbc-nebula'
    var stars = document.createElement('div')
    stars.className = 'dshbc-stars'
    for (var i = 0; i < 8; i += 1) {
      var star = document.createElement('div')
      star.className = 'dshbc-star'
      stars.appendChild(star)
    }
    var grid = document.createElement('div')
    grid.className = 'dshbc-grid'

    var video = document.createElement('video')
    video.className = 'dshbc-video'
    video.muted = true
    video.loop = ENTER_MODE === 'click'
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.preload = 'auto'

    var ui = document.createElement('div')
    ui.className = 'dshbc-ui'
    var title = document.createElement('div')
    title.className = 'dshbc-title'
    title.textContent = 'DeepSeek Harness'
    var bar = document.createElement('div')
    bar.className = 'dshbc-bar'
    var fill = document.createElement('div')
    fill.className = 'dshbc-fill'
    bar.appendChild(fill)
    var hint = document.createElement('div')
    hint.className = 'dshbc-hint'
    hint.textContent = ''

    var sound = null
    if (SOUND_ON && THEME === 'video') {
      sound = document.createElement('button')
      sound.className = 'dshbc-sound'
      sound.type = 'button'
      sound.textContent = SOUND_TEXT_OFF
      sound.title = SOUND_HINT_OFF
      sound.setAttribute('aria-label', SOUND_NAME)
      sound.addEventListener('pointerdown', function (event) { event.stopPropagation() }, true)
      sound.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        toggleSound()
      })
    }

    ui.appendChild(title)
    ui.appendChild(bar)
    ui.appendChild(hint)

    // Left brand canvas: the DeepSeek wordmark + whale logo, drawn per frame
    // with a flowing light sweep (programmatic animation, not CSS keyframes).
    var brand = document.createElement('div')
    brand.className = 'dshbc-brand'
    brand.setAttribute('aria-hidden', 'true')
    var brandCanvas = document.createElement('canvas')
    brand.appendChild(brandCanvas)

    // Right whale-girl canvas: the anthropomorphic character described in
    // drawWhaleFrame — nothing here is an <img>, so nothing can fail to load.
    var whale = document.createElement('div')
    whale.className = 'dshbc-whale'
    whale.setAttribute('aria-hidden', 'true')
    var whaleCanvas = document.createElement('canvas')
    whale.appendChild(whaleCanvas)

    // End brand card: covers a clip's burned-in title card (watermark) over
    // the clip's last seconds. It is appended AFTER the video so it paints
    // over the decoded frames; pointer-events stays none so presses still
    // reach the root.
    var card = document.createElement('div')
    card.className = 'dshbc-card'
    card.setAttribute('aria-hidden', 'true')
    var cardCanvas = document.createElement('canvas')
    card.appendChild(cardCanvas)

    root.appendChild(nebula)
    root.appendChild(stars)
    root.appendChild(grid)
    root.appendChild(brand)
    root.appendChild(whale)
    root.appendChild(video)
    root.appendChild(card)
    if (sound) root.appendChild(sound)
    root.appendChild(ui)
    return {
      css: css,
      root: root,
      fill: fill,
      hint: hint,
      ui: ui,
      sound: sound,
      brand: brand,
      brandCanvas: brandCanvas,
      whale: whale,
      whaleCanvas: whaleCanvas,
      card: card,
      cardCanvas: cardCanvas,
      video: function () { return video },
      replaceVideo: function (next) { video = next },
    }
  }

  // The kernel boot page is created synchronously after this script, so every
  // observation below is attached before its first mutation.
  var parts = build()
  var namespace = {
    el: parts.root,
    bootedAt: null,
    failed: false,
    audioBlocked: SOUND_ON ? null : 'disabled',
    clientReady: function () {
      if (namespace.bootedAt === null) namespace.bootedAt = Date.now()
      if (namespace.failed) return
      setState('ready')
      parts.hint.textContent = namespace.audioBlocked === null ? HINT_SOUND : HINT_SILENT
      if (typeof nudgeTail === 'function') nudgeTail()
      maybeEnter()
    },
  }
  globalThis.__DSH_BOOT_CUSTOM__ = namespace

  function renderSound(hint) {
    if (!parts.sound) return
    var audible = !parts.video().muted && namespace.audioBlocked === null
    parts.sound.textContent = audible ? SOUND_TEXT_ON : SOUND_TEXT_OFF
    parts.sound.title = hint || (audible ? SOUND_HINT_ON : SOUND_HINT_OFF)
    parts.sound.setAttribute('aria-pressed', audible ? 'true' : 'false')
  }

  function setAudioBlocked(reason, hint) {
    namespace.audioBlocked = reason
    renderSound(hint)
  }

  var previewName = null
  var previewDone = null

  function applyPreviewSettings(options) {
    if (typeof options.fadeMs === 'number' && options.fadeMs >= 300 && options.fadeMs <= 5000) {
      FADE_MS = Math.round(options.fadeMs)
    }
    TAIL_MIN_MS = FADE_MS * 2
    if (options.enterMode === 'tail' || options.enterMode === 'end' || options.enterMode === 'click') {
      ENTER_MODE = options.enterMode
    }
    if (options.theme === 'nebula' || options.theme === 'video') THEME = options.theme
    SOUND_ON = options.sound !== false
    VOICE_ON = options.voice !== false
    CLICK_TO_ENTER = options.clickToEnter === true
    SHOW_HINT = options.showHint !== false
    computeHints()
  }

  /**
   * Run the real overlay once, now, on an already-booted page, for one named clip
   * (or the nebula when theme is `nebula`).
   */
  namespace.preview = function (options) {
    if (typeof options !== 'object' || options === null) return false
    if (typeof options.name !== 'string' || options.name === '') return false
    if (previewName !== null) return false

    applyPreviewSettings(options)
    parts = build()
    namespace.el = parts.root
    wireRoot(parts.root)
    previewName = options.name
    previewDone = typeof options.onDone === 'function' ? options.onDone : null

    entered = false
    clipDone = false
    nudgeTail = null
    audioRetry = null
    cache = { startedAt: Date.now(), current: null, loaded: false }
    namespace.failed = false
    namespace.failures = []
    namespace.audioBlocked = SOUND_ON ? null : 'disabled'
    namespace.clipEndedAt = null
    namespace.unknownLength = false
    namespace.lastStall = null
    namespace.tailEntered = false
    captionDone = false
    captionStyle = null
    // The end card is per-run state too: a preview re-arms its cover.
    cardOn = false
    // The "欢迎回来" line is per-run state too: a preview speaks it again.
    welcomeStart = null
    voiceSpoken = false
    namespace.bootedAt = Date.now()

    mount()
    return true
  }

  var HINT_ENTER, HINT_UNLOCK, HINT_DIRECT, TWO_STEP, HINT_SOUND, HINT_SILENT

  function computeHints() {
    HINT_ENTER = ENTER_MODE === 'click' ? '点击进入' : '播完自动进入 · 点一下提前进'
    HINT_UNLOCK = ENTER_MODE === 'click' ? '点一下开声音 · 再点进入' : '点一下开声音 · 播完自动进入'
    HINT_DIRECT = ENTER_MODE === 'click' ? '点击进入' : '点一下直接进入'
    TWO_STEP = SOUND_ON && !CLICK_TO_ENTER
    HINT_SOUND = CLICK_TO_ENTER ? HINT_DIRECT : HINT_ENTER
    HINT_SILENT = TWO_STEP ? HINT_UNLOCK : HINT_SOUND
  }

  computeHints()

  function setState(value) {
    parts.root.setAttribute('data-state', value)
  }

  function attention(message) {
    parts.root.setAttribute('data-attention', '1')
    setState('ready')
    parts.hint.textContent = message
  }

  /** Drive the bar from the kernel's own progress arc. */
  function observeProgress() {
    var boot = document.querySelector('[data-dsh-boot]')
    if (boot === null) return
    var spinner = boot.querySelector('[data-dsh-boot-spinner]')
    if (spinner === null) return
    var update = function () {
      var raw = parseFloat(spinner.style.getPropertyValue('--dsh-boot-arc'))
      var ratio = Number.isFinite(raw) ? Math.min(Math.max((raw - ARC_MIN) / ARC_SPAN, 0), 1) : 0
      parts.fill.style.width = (ratio * 100).toFixed(1) + '%'
    }
    update()
    new MutationObserver(update).observe(spinner, { attributes: true, attributeFilter: ['style'] })
  }

  /** Detect the kernel's failure rendering. */
  function observeFailure() {
    var boot = document.querySelector('[data-dsh-boot]')
    if (boot === null) return
    var check = function () {
      if (namespace.failed) return
      var text = boot.textContent || ''
      if (text.indexOf('Failed to load plugins') < 0 && text.indexOf('did not activate') < 0) return
      namespace.failed = true
      attention('启动失败，点击查看')
    }
    new MutationObserver(check).observe(boot, { childList: true, subtree: true, characterData: true })
    check()
  }

  var audioRetry = null
  var clipDone = false
  var nudgeTail = null

  function maybeEnter() {
    if (ENTER_MODE === 'click') return
    if (!clipDone || namespace.failed) return
    if (namespace.bootedAt === null) {
      parts.hint.textContent = '启动较慢，就绪后自动进入'
      return
    }
    enter()
  }

  function toggleSound() {
    if (!SOUND_ON) return
    var video = parts.video()
    if (!video.muted) {
      video.muted = true
      setAudioBlocked('muted-by-user')
      return
    }
    video.muted = false
    setAudioBlocked(null)
    var played = video.play()
    if (played && typeof played.catch === 'function') {
      played.catch(function (reason) {
        video.muted = true
        setAudioBlocked(reason && reason.name ? reason.name : 'refused', SOUND_HINT_REFUSED)
        var retryMuted = video.play()
        if (retryMuted && typeof retryMuted.catch === 'function') retryMuted.catch(function () {})
      })
    }
  }

  function whenFramePresents(video, done) {
    var fired = false
    var once = function () {
      if (fired) return
      fired = true
      done()
    }
    if (video.readyState >= 2) {
      once()
      return
    }
    video.addEventListener('loadeddata', once, { once: true })
    video.addEventListener('canplay', once, { once: true })
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(once)
    }
    video.addEventListener('timeupdate', function () {
      if (video.currentTime > 0) once()
    })
  }

  function fadeOutClipAudio(video, span) {
    var from = video.volume
    if (video.muted || !(from > 0)) return
    var startedAt = Date.now()
    var done = false
    var silence = function () {
      if (done) return
      done = true
      video.volume = 0
    }
    var step = function () {
      if (done) return
      var progress = (Date.now() - startedAt) / span
      if (progress >= 1) {
        silence()
        return
      }
      video.volume = from * (1 - progress)
      nextFrame(step)
    }
    step()
    globalThis.setTimeout(silence, span)
  }

  /**
   * Dissolve the overlay away and hand the app over.
   */
  function enter(fadeMs, tail) {
    if (parts.root.getAttribute('data-state') === 'leaving') return
    entered = true

    var span = typeof fadeMs === 'number' && fadeMs > 0
      ? Math.max(Math.min(fadeMs, FADE_MS), 120)
      : FADE_MS

    var video = parts.video()
    var finished = video.ended === true
    var live = !finished && !video.paused && tail !== true
    if (!CLICK_TO_ENTER && !finished && tail !== true && typeof audioRetry === 'function') audioRetry()

    var standalone = false
    if (live && video.parentNode && video.parentNode.parentNode === document.body) {
      var box = video.getBoundingClientRect()
      video.style.position = 'fixed'
      video.style.left = box.left + 'px'
      video.style.top = box.top + 'px'
      video.style.width = box.width + 'px'
      video.style.height = box.height + 'px'
      video.style.transition = 'opacity ' + (span / 2 / 1000) + 's ease'
      video.style.pointerEvents = 'none'
      document.body.appendChild(video)
      standalone = true
    }

    if (!finished) fadeOutClipAudio(video, standalone ? span + AUDIO_GRACE_MS : span)

    parts.root.style.transitionDuration = (span / 1000) + 's'
    setState('leaving')
    stopAnimation()
    globalThis.setTimeout(function () {
      if (parts.root.parentNode) parts.root.parentNode.removeChild(parts.root)
      if (previewName !== null && parts.css.parentNode) parts.css.parentNode.removeChild(parts.css)
      restoreCaptionTokens()
      if (previewName !== null) {
        previewName = null
        var announce = previewDone
        previewDone = null
        if (typeof announce === 'function') {
          try {
            announce()
          } catch (error) {
            /* the card that asked for this may already be unmounted */
          }
        }
      }
    }, span + 100)

    if (standalone) {
      globalThis.setTimeout(function () { video.style.opacity = '0' }, span / 2)
      globalThis.setTimeout(function () {
        try {
          video.pause()
        } catch (error) {
          /* already stopped */
        }
        if (video.parentNode) video.parentNode.removeChild(video)
      }, span + AUDIO_GRACE_MS)
    } else {
      globalThis.setTimeout(function () {
        try {
          video.pause()
        } catch (error) {
          /* an unplayed video needs no pause */
        }
      }, span + 150)
    }
  }

  var entered = false

  function press() {
    if (entered) return
    var finished = parts.video().ended === true
    if (!CLICK_TO_ENTER && !finished && namespace.audioBlocked !== null && typeof audioRetry === 'function') {
      setAudioBlocked(null)
      audioRetry()
      if (!namespace.failed) parts.hint.textContent = HINT_SOUND
      return
    }
    enter()
  }

  function onSoundControl(event) {
    var node = event && event.target
    return !!(node && node.closest && node.closest('.dshbc-sound'))
  }

  function wireRoot(root) {
    root.addEventListener('pointerdown', function (event) {
      if (onSoundControl(event)) return
      press()
    }, true)
  }

  wireRoot(parts.root)
  globalThis.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter') {
      entered = true
      enter()
    }
  })

  // The hold budget covers the case the kernel never settles.
  globalThis.setTimeout(function () {
    if (parts.root.getAttribute('data-state') === 'leaving') return
    if (namespace.bootedAt !== null) return
    attention('启动较慢，点击继续')
  }, HOLD_MS)

  function startDiagnostics() {
    if (globalThis.location.search.indexOf('dshbootdiag=1') < 0) return
    setInterval(function () {
      if (parts.root.getAttribute('data-state') === 'leaving') return
      var video = parts.video()
      var text = 'diag theme=' + THEME
        + ' shown=' + (video.getAttribute('data-shown') || '-')
        + ' rs=' + video.readyState
        + ' muted=' + video.muted
        + ' t=' + (video.currentTime || 0).toFixed(1)
        + ' dur=' + (Number.isFinite(video.duration) ? video.duration.toFixed(1) : '?')
        + ' paused=' + video.paused
        + ' ended=' + video.ended
        + ' done=' + (clipDone ? 1 : 0)
        + ' boot=' + (namespace.bootedAt === null ? 0 : 1)
        + ' tail=' + (namespace.tailEntered ? 1 : 0)
        + ' card=' + (parts.card.getAttribute('data-show') || '-')
        + ' clip=' + (cache.current ? cache.current.name : '-')
        + ' fail=' + (namespace.failures || '-')
        + ' fade=' + (FADE_MS / 1000) + 's'
        + ' stall=' + (namespace.lastStall ? Math.round((Date.now() - namespace.lastStall) / 1000) + 's ago' : '-')
        + ' err=' + (video.error ? video.error.code : '-')
        + ' audio=' + (namespace.audioBlocked === null ? 'ok' : namespace.audioBlocked)
      parts.hint.textContent = text
    }, 800)
  }

  function applyCaptionTokens() {
    if (captionDone || captionStyle) return
    captionStyle = document.createElement('style')
    captionStyle.setAttribute('data-dshbc-caption', '')
    captionStyle.textContent = CAPTION_CSS
    document.head.appendChild(captionStyle)
  }

  function restoreCaptionTokens() {
    captionDone = true
    if (captionStyle && captionStyle.parentNode) captionStyle.parentNode.removeChild(captionStyle)
    captionStyle = null
  }

  // ---------------------------------------------------------------
  // Canvas animation engine: the left brand and the right whale-girl are
  // drawn per frame with requestAnimationFrame — real animation, not CSS
  // keyframes and not static plugin sprites.
  // ---------------------------------------------------------------
  var animRaf = null
  var animStartedAt = 0

  function resizeCanvases() {
    var dpr = typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1
    ;[parts.brandCanvas, parts.whaleCanvas, parts.cardCanvas].forEach(function (canvas) {
      var rect = canvas.parentNode.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0)
      canvas._cssW = Math.max(1, rect.width)
      canvas._cssH = Math.max(1, rect.height)
    })
  }

  /** Left brand: "DeepSeek" wordmark + whale logo with a flowing light sweep. */
  function drawBrandFrame(ctx, w, h, t) {
    ctx.clearRect(0, 0, w, h)
    var cx = w / 2
    var cy = h / 2
    // Floating drift.
    var driftY = Math.sin(t / 1800) * 6
    // "DeepSeek" wordmark: gradient fill + a traveling highlight.
    ctx.font = '700 40px system-ui,-apple-system,Segoe UI,Microsoft YaHei,sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    var sweep = (t / 1200) % 1
    var grad = ctx.createLinearGradient(0, cy - 60 + driftY, 0, cy + 20 + driftY)
    grad.addColorStop(0, '#9fc4e6')
    grad.addColorStop(0.5, '#e8f2fb')
    grad.addColorStop(1, '#4f9dd9')
    ctx.fillStyle = grad
    ctx.fillText('DeepSeek', cx, cy - 20 + driftY)
    // Traveling light sweep across the wordmark.
    ctx.save()
    ctx.beginPath()
    ctx.rect(cx - 130, cy - 52 + driftY, 260, 64)
    ctx.clip()
    var hl = ctx.createLinearGradient(cx - 130 + sweep * 260 - 60, 0, cx - 130 + sweep * 260 + 60, 0)
    hl.addColorStop(0, 'rgba(143,216,255,0)')
    hl.addColorStop(0.5, 'rgba(143,216,255,.5)')
    hl.addColorStop(1, 'rgba(143,216,255,0)')
    ctx.fillStyle = hl
    ctx.fillRect(cx - 130, cy - 52 + driftY, 260, 64)
    ctx.restore()
    // "HARNESS" sub.
    ctx.font = '600 13px system-ui,-apple-system,Segoe UI,Microsoft YaHei,sans-serif'
    ctx.fillStyle = 'rgba(143,179,212,.85)'
    ctx.fillText('H A R N E S S', cx, cy + 34 + driftY)
    // Whale logo below, drawn with a flowing dash sweep.
    var logoS = 0.9
    ctx.save()
    ctx.translate(cx, cy + 108 + driftY)
    ctx.scale(logoS, logoS)
    var dash = 600
    var offset = ((t / 900) % 1) * dash * 2
    ctx.strokeStyle = '#8fd8ff'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.shadowColor = 'rgba(143,216,255,.6)'
    ctx.shadowBlur = 10
    ctx.setLineDash([dash, dash])
    ctx.lineDashOffset = offset
    ctx.beginPath()
    ctx.moveTo(0, 0)
    // The official whale path is in a 50x50 viewBox; draw it at 44px.
    ctx.transform(44 / 50, 0, 0, 44 / 50, -22, -22)
    ctx.stroke(new Path2D(WHALE_LOGO_PATH))
    ctx.restore()
  }

  // ---------------------------------------------------------------
  // End brand card: the watermark cover.
  //
  // Pool clips can carry a burned-in AI title card over their last seconds
  // (observed on the reference clip: a metal "DeepSeek / Professional Mast"
  // wordmark fading in ~3.2s before the end). The cover is a vignette div plus
  // this canvas wordmark, dissolving in CARD_LEAD_MS before the clip ends so
  // the third-party text is behind an opaque layer by the time it is legible.
  // The vignette is CSS (radial gradient); only the wordmark is drawn here.
  // ---------------------------------------------------------------
  var CARD_LEAD_MS = 3800
  var cardOn = false

  /** How far the cover should be in: 0 = hidden, 1 = fully on. */
  function cardProgress() {
    if (THEME !== 'video') return 0
    var video = parts.video()
    var remaining = null
    if (video && Number.isFinite(video.duration) && video.duration > 0 && !video.ended) {
      // A clip shorter than ~6s cannot carry an end card without covering most
      // of its own runtime: leave short pool entries untouched.
      if (video.duration * 1000 < CARD_LEAD_MS + 2200) return 0
      remaining = (video.duration - video.currentTime) * 1000
    }
    if (remaining === null) {
      // No usable duration (unknown length, or already ended): show the card
      // once the clip is done, so the watermark never outlives the cover.
      return clipDone ? 1 : 0
    }
    if (remaining > CARD_LEAD_MS) return 0
    return Math.min((CARD_LEAD_MS - remaining) / 600, 1)
  }

  /** End card wordmark: metal "DeepSeek" + HARNESS sub + whale logo sweep. */
  function drawCardFrame(ctx, w, h, t) {
    ctx.clearRect(0, 0, w, h)
    var cx = w / 2
    var cy = h * 0.44
    var driftY = Math.sin(t / 1600) * 4
    var size = Math.max(34, Math.min(w * 0.115, h * 0.30))
    ctx.font = '700 ' + size.toFixed(1) + 'px system-ui,-apple-system,Segoe UI,Microsoft YaHei,sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    var grad = ctx.createLinearGradient(0, cy - size * 0.7 + driftY, 0, cy + size * 0.5 + driftY)
    grad.addColorStop(0, '#b9cfe6')
    grad.addColorStop(0.45, '#f2f7fc')
    grad.addColorStop(0.75, '#8fb3d4')
    grad.addColorStop(1, '#5f8fc0')
    ctx.fillStyle = grad
    ctx.shadowColor = 'rgba(143,216,255,.45)'
    ctx.shadowBlur = 18
    ctx.fillText('DeepSeek', cx, cy + driftY)
    ctx.shadowBlur = 0
    // No traveling light band here (unlike the nebula brand): over the dark
    // vignette a static frame reads it as a gray rectangle, and the card only
    // ever appears for the last seconds of a clip. Motion comes from the logo
    // dash sweep below.
    // Sub line.
    ctx.font = '600 ' + Math.max(11, size * 0.24).toFixed(1) + 'px system-ui,-apple-system,Segoe UI,Microsoft YaHei,sans-serif'
    ctx.fillStyle = 'rgba(159,196,230,.9)'
    ctx.fillText('H A R N E S S', cx, cy + size * 0.78 + driftY)
    // Whale logo, flowing dash sweep, under the sub line.
    ctx.save()
    ctx.translate(cx, cy + size * 1.55 + driftY)
    var logoS = Math.min(size / 44, 1.15)
    ctx.scale(logoS, logoS)
    var dash = 600
    var offset = ((t / 900) % 1) * dash * 2
    ctx.strokeStyle = '#8fd8ff'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.shadowColor = 'rgba(143,216,255,.6)'
    ctx.shadowBlur = 10
    ctx.setLineDash([dash, dash])
    ctx.lineDashOffset = offset
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.transform(44 / 50, 0, 0, 44 / 50, -22, -22)
    ctx.stroke(new Path2D(WHALE_LOGO_PATH))
    ctx.restore()
  }

  /** Right whale-girl: a hand-drawn whale girl swimming, blinking, bubbling. */
  // The whale girl: an ANTHROPOMORPHIC character, not a whale. Blue long hair
  // with an ahoge and a side braid, whale-fin ears, big blue eyes, a dark-blue
  // maid dress with a white apron, waving hello — drawn per frame so she
  // breathes, drifts, blinks and talks.
  function drawWhaleFrame(ctx, w, h, t, welcome) {
    ctx.clearRect(0, 0, w, h)
    // She swims in from the right over the first ~2.2s, then settles.
    var enter = Math.min((t - 200) / 2200, 1)
    if (enter <= 0) return
    var ease = 1 - Math.pow(1 - enter, 3)
    var alpha = Math.min(ease * 1.3, 1)

    // Idle motion: a slow float, drifting hair, a waving hand, a blink, and a
    // mouth that opens and closes as if she is talking.
    var float = Math.sin(t / 1100) * 7
    var hairSway = Math.sin(t / 900) * 2.5
    var wave = Math.sin(t / 300)
    var blink = (t % 4200) < 170
    var talk = 0.6 + 0.4 * Math.abs(Math.sin(t / 700))
    var scale = (h * 0.78) / 380
    var cx = w * 0.5
    var cy = h * 0.57 + float

    var SKIN = '#fbe6d8'
    var SKIN_SHADE = '#f0cfbc'
    var HAIR = '#4a74b8'
    var HAIR_DARK = '#3a5c99'
    var DRESS = '#2f4470'
    var DRESS_LIGHT = '#3b5589'
    var APRON = '#f2f6fb'
    var FIN = '#5a8fd0'

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)

    // --- whale tail fluke behind her, swinging gently -------------------
    ctx.save()
    ctx.translate(-46, 62)
    ctx.rotate(Math.sin(t / 520) * 0.18)
    ctx.fillStyle = '#3d6bb0'
    ctx.beginPath()
    ctx.moveTo(6, 0)
    ctx.quadraticCurveTo(-34, -18, -60, -10)
    ctx.quadraticCurveTo(-40, 2, -58, 22)
    ctx.quadraticCurveTo(-34, 16, 6, 0)
    ctx.fill()
    ctx.restore()

    // --- long back hair, falling past the waist -------------------------
    var backHair = function (mirror) {
      ctx.save()
      if (mirror) ctx.scale(-1, 1)
      ctx.fillStyle = HAIR_DARK
      ctx.beginPath()
      ctx.moveTo(-26, -178)
      ctx.quadraticCurveTo(-58, -150, -56, -80)
      ctx.quadraticCurveTo(-54, -6, -44, 62)
      ctx.quadraticCurveTo(-30, 74, -14, 66)
      ctx.quadraticCurveTo(-26, -20, -20, -100)
      ctx.quadraticCurveTo(-16, -150, -14, -172)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    backHair(false)
    backHair(true)

    // --- dark-blue maid dress, flaring to the hem -----------------------
    ctx.fillStyle = DRESS
    ctx.beginPath()
    ctx.moveTo(-32, -96)
    ctx.quadraticCurveTo(-42, -50, -50, 22)
    ctx.quadraticCurveTo(-62, 72, -70, 96)
    ctx.lineTo(70, 96)
    ctx.quadraticCurveTo(62, 72, 50, 22)
    ctx.quadraticCurveTo(42, -50, 32, -96)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = DRESS_LIGHT
    ctx.beginPath()
    ctx.moveTo(-70, 96)
    ctx.quadraticCurveTo(0, 84, 70, 96)
    ctx.quadraticCurveTo(0, 104, -70, 96)
    ctx.closePath()
    ctx.fill()

    // --- white apron in front, waist band, hem frill --------------------
    ctx.fillStyle = APRON
    ctx.beginPath()
    ctx.moveTo(-20, -74)
    ctx.quadraticCurveTo(-32, -10, -38, 90)
    ctx.lineTo(38, 90)
    ctx.quadraticCurveTo(32, -10, 20, -74)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#2a3b5e'
    ctx.fillRect(-24, -34, 48, 14)
    ctx.fillStyle = '#e2eaf5'
    ctx.beginPath()
    ctx.moveTo(-38, 84)
    for (var f = -38; f < 38; f += 12) {
      ctx.quadraticCurveTo(f + 6, 100, f + 12, 84)
    }
    ctx.lineTo(38, 84)
    ctx.lineTo(-38, 84)
    ctx.closePath()
    ctx.fill()

    // --- arms: left rests, right waves ----------------------------------
    ctx.strokeStyle = DRESS
    ctx.lineWidth = 15
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(-28, -84)
    ctx.quadraticCurveTo(-44, -56, -40, -26)
    ctx.stroke()
    ctx.fillStyle = SKIN
    ctx.beginPath()
    ctx.arc(-40, -22, 8, 0, Math.PI * 2)
    ctx.fill()

    ctx.save()
    ctx.translate(30, -84)
    ctx.rotate(-0.55 + wave * 0.2)
    ctx.strokeStyle = DRESS
    ctx.lineWidth = 15
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(28, -26)
    ctx.stroke()
    ctx.fillStyle = SKIN
    ctx.beginPath()
    ctx.arc(30, -28, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = SKIN_SHADE
    ctx.lineWidth = 2.5
    for (var fg = 0; fg < 3; fg += 1) {
      ctx.beginPath()
      ctx.moveTo(33, -32 + fg * 5)
      ctx.lineTo(39, -34 + fg * 5)
      ctx.stroke()
    }
    ctx.restore()

    // --- collar bow ------------------------------------------------------
    ctx.fillStyle = '#16233d'
    ctx.beginPath()
    ctx.moveTo(0, -86)
    ctx.lineTo(-14, -94)
    ctx.lineTo(-14, -78)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(0, -86)
    ctx.lineTo(14, -94)
    ctx.lineTo(14, -78)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.arc(0, -86, 4, 0, Math.PI * 2)
    ctx.fill()

    // --- neck and face ---------------------------------------------------
    ctx.fillStyle = SKIN_SHADE
    ctx.fillRect(-9, -120, 18, 22)
    ctx.fillStyle = SKIN
    ctx.beginPath()
    ctx.ellipse(0, -148, 33, 37, 0, 0, Math.PI * 2)
    ctx.fill()

    // --- whale fin ears (her signature feature) --------------------------
    var finEar = function (mirror) {
      ctx.save()
      if (mirror) ctx.scale(-1, 1)
      ctx.fillStyle = FIN
      ctx.beginPath()
      ctx.moveTo(-28, -162)
      ctx.quadraticCurveTo(-58, -176, -70, -146)
      ctx.quadraticCurveTo(-58, -140, -30, -146)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(200,222,245,.5)'
      ctx.beginPath()
      ctx.moveTo(-34, -158)
      ctx.quadraticCurveTo(-54, -166, -62, -148)
      ctx.quadraticCurveTo(-52, -146, -36, -150)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    finEar(false)
    finEar(true)

    // --- bangs, ahoge, side braid ----------------------------------------
    ctx.fillStyle = HAIR
    ctx.beginPath()
    ctx.moveTo(-32, -152)
    ctx.quadraticCurveTo(-36, -188, 0, -190)
    ctx.quadraticCurveTo(36, -188, 32, -152)
    ctx.quadraticCurveTo(22, -170, 10, -154)
    ctx.quadraticCurveTo(2, -172, -6, -154)
    ctx.quadraticCurveTo(-20, -170, -32, -152)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = HAIR
    ctx.lineWidth = 4.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(1, -188)
    ctx.quadraticCurveTo(-8 + hairSway * 0.5, -214, -20 + hairSway, -208)
    ctx.stroke()

    ctx.fillStyle = HAIR
    for (var b = 0; b < 8; b += 1) {
      var bt = b / 7
      var bx = 34 + Math.sin(bt * 3.1) * 5 + hairSway * 0.5
      var by = -150 + bt * 116
      ctx.beginPath()
      ctx.ellipse(bx, by, 10 - bt * 2.5, 7.5, 0.25, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#16233d'
    ctx.beginPath()
    ctx.ellipse(35, -36, 7.5, 5.5, 0.25, 0, Math.PI * 2)
    ctx.fill()

    // --- face: big blue eyes, brows, blush, talking mouth -----------------
    var eyeY = -152
    var eye = function (ex) {
      if (blink) {
        ctx.strokeStyle = '#1d2b47'
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(ex, eyeY + 1, 9, 0.15 * Math.PI, 0.85 * Math.PI)
        ctx.stroke()
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.ellipse(ex, eyeY, 9.5, 11, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#2f66b8'
      ctx.beginPath()
      ctx.ellipse(ex, eyeY + 1, 8.5, 10, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#12305e'
      ctx.beginPath()
      ctx.ellipse(ex, eyeY + 2, 5, 6.5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(ex - 3, eyeY - 3, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(ex + 3, eyeY + 4, 1.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#1d2b47'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(ex, eyeY, 10, Math.PI * 1.12, Math.PI * 1.88)
      ctx.stroke()
    }
    eye(-14)
    eye(14)

    ctx.strokeStyle = '#3a5a96'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(-21, -168)
    ctx.quadraticCurveTo(-14, -172, -7, -168)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(7, -168)
    ctx.quadraticCurveTo(14, -172, 21, -168)
    ctx.stroke()

    ctx.fillStyle = 'rgba(255,150,160,.45)'
    ctx.beginPath()
    ctx.ellipse(-22, -136, 7, 4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(22, -136, 7, 4, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#8a3a48'
    ctx.beginPath()
    ctx.ellipse(0, -130, 7 * talk, 5 * talk, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#e88a95'
    ctx.beginPath()
    ctx.ellipse(0, -128.5, 4 * talk, 2.5 * talk, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()

    // --- "欢迎回来" speech bubble, in screen space above her head ---------
    if (welcome > 0) drawWelcomeBubble(ctx, cx + 74 * scale, cy - 208 * scale, welcome)
  }

  /** Rounded-rectangle path helper (ctx.roundRect is not universal). */
  function roundRectPath(ctx, x, y, rw, rh, r) {
    var rr = Math.min(r, rw / 2, rh / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.lineTo(x + rw - rr, y)
    ctx.quadraticCurveTo(x + rw, y, x + rw, y + rr)
    ctx.lineTo(x + rw, y + rh - rr)
    ctx.quadraticCurveTo(x + rw, y + rh, x + rw - rr, y + rh)
    ctx.lineTo(x + rr, y + rh)
    ctx.quadraticCurveTo(x, y + rh, x, y + rh - rr)
    ctx.lineTo(x, y + rr)
    ctx.quadraticCurveTo(x, y, x + rr, y)
    ctx.closePath()
  }

  /**
   * The "欢迎回来" bubble the whale girl says as the boot animation ends.
   * @param progress - 0..1 fade/pop progress.
   */
  function drawWelcomeBubble(ctx, bx, by, progress) {
    var p = Math.min(Math.max(progress, 0), 1)
    var text = '欢迎回来'
    ctx.save()
    ctx.globalAlpha = p
    ctx.translate(bx, by)
    var pop = 0.86 + 0.14 * p
    ctx.scale(pop, pop)
    ctx.font = '600 20px system-ui,-apple-system,Segoe UI,Microsoft YaHei,sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    var tw = ctx.measureText(text).width
    var bw = tw + 34
    var bh = 42
    ctx.fillStyle = 'rgba(240,246,255,.96)'
    ctx.strokeStyle = 'rgba(143,216,255,.9)'
    ctx.lineWidth = 2
    roundRectPath(ctx, -bw / 2, -bh / 2, bw, bh, 15)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-bw / 2 + 16, bh / 2 - 3)
    ctx.lineTo(-bw / 2 + 6, bh / 2 + 14)
    ctx.lineTo(-bw / 2 + 32, bh / 2 - 3)
    ctx.closePath()
    ctx.fillStyle = 'rgba(240,246,255,.96)'
    ctx.fill()
    ctx.fillStyle = '#1a3a6b'
    ctx.fillText(text, 0, 1)
    ctx.restore()
  }

  /**
   * How far into the "欢迎回来" line we are (0 = not yet, 1 = fully shown).
   *
   * She starts speaking shortly BEFORE the animation ends, so the line is on
   * screen as the screen dissolves into the app rather than flashing for a
   * single frame. In `click` mode nothing auto-enters, so the line simply
   * stays up until the user presses.
   */
  var welcomeStart = null
  var WELCOME_LEAD_MS = 2500
  var voiceSpoken = false

  /** One quiet spoken 欢迎回来 at the moment the bubble appears. */
  function speakWelcome() {
    if (voiceSpoken) return
    voiceSpoken = true
    if (!VOICE_ON || !SOUND_ON) return
    try {
      var synth = globalThis.speechSynthesis
      if (!synth || typeof synth.speak !== 'function'
        || typeof globalThis.SpeechSynthesisUtterance !== 'function') return
      var utter = new globalThis.SpeechSynthesisUtterance(WELCOME_TEXT)
      utter.lang = 'zh-CN'
      // Prefer an explicit Chinese voice when the engine exposes one; the
      // list can arrive asynchronously, so this is best-effort only.
      var voices = typeof synth.getVoices === 'function' ? synth.getVoices() : []
      for (var i = 0; i < voices.length; i += 1) {
        var lang = String(voices[i].lang || '').toLowerCase().replace('_', '-')
        if (lang.indexOf('zh') === 0) { utter.voice = voices[i]; break }
      }
      utter.rate = 0.95
      utter.pitch = 1.05
      utter.volume = 0.9
      synth.speak(utter)
    } catch (error) {
      // A missing or failing voice engine must never trap the boot.
    }
  }

  function welcomeProgress(t) {
    if (welcomeStart === null) {
      var nearEnd = false
      if (THEME === 'nebula') {
        nearEnd = t >= NEBULA_MS - WELCOME_LEAD_MS
      } else {
        nearEnd = clipDone
        var video = parts.video()
        if (!nearEnd && video && Number.isFinite(video.duration) && video.duration > 0) {
          nearEnd = (video.duration - video.currentTime) * 1000 <= WELCOME_LEAD_MS
        }
      }
      if (nearEnd || clipDone) {
        welcomeStart = t
        speakWelcome()
      }
    }
    if (welcomeStart === null) return 0
    return Math.min((t - welcomeStart) / 600, 1)
  }

  function animationFrame() {
    if (parts.root.getAttribute('data-state') === 'leaving') return
    var t = Date.now() - animStartedAt
    var brandCtx = parts.brandCanvas.getContext('2d')
    var whaleCtx = parts.whaleCanvas.getContext('2d')
    drawBrandFrame(brandCtx, parts.brandCanvas._cssW || parts.brandCanvas.width,
      parts.brandCanvas._cssH || parts.brandCanvas.height, t)
    drawWhaleFrame(whaleCtx, parts.whaleCanvas._cssW || parts.whaleCanvas.width,
      parts.whaleCanvas._cssH || parts.whaleCanvas.height, t, welcomeProgress(t))
    // The end card only exists in the video theme; in the nebula theme the
    // card canvas stays cleared and the layer stays hidden.
    if (THEME === 'video') {
      var progress = cardProgress()
      var show = progress > 0
      if (show !== cardOn) {
        cardOn = show
        parts.card.setAttribute('data-show', show ? '1' : '0')
      }
      if (show) {
        var cardCtx = parts.cardCanvas.getContext('2d')
        drawCardFrame(cardCtx, parts.cardCanvas._cssW || parts.cardCanvas.width,
          parts.cardCanvas._cssH || parts.cardCanvas.height, t)
      }
    }
    animRaf = globalThis.requestAnimationFrame(animationFrame)
  }

  function startAnimation() {
    if (animRaf !== null) return
    resizeCanvases()
    // The canvases start shown: the nebula theme needs them, and the video
    // theme still needs them for every fallback path (empty pool, no frame,
    // unplayable clip — all of which keep playing the nebula). Once a clip
    // actually reveals a frame, reveal() hides them: the clip carries its own
    // artwork and three overlapping wordmarks would read as a mistake.
    parts.brand.setAttribute('data-show', '1')
    parts.whale.setAttribute('data-show', '1')
    animStartedAt = Date.now()
    animRaf = globalThis.requestAnimationFrame(animationFrame)
  }

  function stopAnimation() {
    if (animRaf !== null) {
      globalThis.cancelAnimationFrame(animRaf)
      animRaf = null
    }
  }

  function mount() {
    if (!parts.css.parentNode) document.head.appendChild(parts.css)
    ;(document.body || document.documentElement).appendChild(parts.root)
    applyCaptionTokens()
    if (previewName === null) {
      observeProgress()
      observeFailure()
    } else {
      parts.fill.style.width = '100%'
    }
    startDiagnostics()
    startAnimation()

    // Everything below releases the hand-off, so every way this can stop must
    // release it too.
    //
    // showNebula undoes the video-theme hide: any path that cannot put a clip
    // on screen falls back to the built-in artwork rather than a dark screen.
    // Switching THEME too keeps the end card off (it belongs to the clip) and
    // lets the welcome bubble / nebula clock take over.
    var showNebula = function () {
      parts.root.removeAttribute('data-video')
      THEME = 'nebula'
    }
    var releaseWithoutClip = function (message) {
      if (cache.loaded || clipDone) return
      showNebula()
      cache.loaded = true
      if (message && parts.root.getAttribute('data-state') !== 'leaving') {
        parts.hint.textContent = message
      }
      clipDone = true
      maybeEnter()
    }
    var manifestWindow = globalThis.setTimeout(function () {
      releaseWithoutClip('素材清单没有回应 · 就绪后自动进入')
    }, 10000)

    // In `nebula` theme there is no video and no manifest need: the animation
    // plays out on its own clock. `NEBULA_MS` is the stand-in for "the clip
    // played out", and in `click` mode it never fires.
    if (THEME === 'nebula' && previewName === null) {
      globalThis.clearTimeout(manifestWindow)
      cache.loaded = true
      if (!namespace.failed) parts.hint.textContent = HINT_SOUND
      if (ENTER_MODE !== 'click') {
        globalThis.setTimeout(function () {
          if (parts.root.getAttribute('data-state') === 'leaving') return
          clipDone = true
          maybeEnter()
        }, NEBULA_MS)
      }
      return
    }

    // `video` theme: discover the pool, then play one clip.
    fetch(cfg.manifest, { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : { clips: [] } })
      .then(function (payload) {
        globalThis.clearTimeout(manifestWindow)
        var published = payload && Array.isArray(payload.clips) ? payload.clips : []
        var clips = published.filter(function (clip) { return clip.enabled !== false })
        if (clips.length === 0) clips = published
        if (clips.length === 0) {
          // Empty pool in `video` theme: fall back to the nebula rather than
          // holding the user on a bare gradient.
          showNebula()
          if (previewName === null) {
            parts.hint.textContent = '没有视频素材 · 星云动画照常播放'
            if (ENTER_MODE !== 'click') {
              globalThis.setTimeout(function () {
                if (parts.root.getAttribute('data-state') === 'leaving') return
                clipDone = true
                maybeEnter()
              }, NEBULA_MS)
            }
            return
          }
          releaseWithoutClip('素材池是空的 · 就绪后自动进入')
          return
        }
        cache.loaded = true

        if (!namespace.failed) parts.hint.textContent = HINT_SOUND

        var preferred
        if (previewName !== null) {
          for (var wanted = 0; wanted < published.length; wanted += 1) {
            if (published[wanted].name === previewName) { preferred = published[wanted]; break }
          }
          if (!preferred) {
            releaseWithoutClip('素材池里找不到这一段 · 点一下进入')
            return
          }
        } else {
          preferred = pickClip(clips)
        }
        var order = previewName !== null ? [preferred] : [preferred].concat(shuffled(clips).filter(function (clip) {
          return clip.name !== preferred.name
        }))

        var settled = false
        var attempt = 0
        setAudioBlocked(SOUND_ON ? null : 'disabled')

        function startClip(video, onPlaying, onBlocked) {
          var decided = false
          var settle = function (fn) { return function () { if (decided) return; decided = true; fn() } }
          var playing = settle(onPlaying)
          var blocked = settle(onBlocked)
          var attemptPlay = function (muted, onRefused) {
            video.muted = muted
            var played
            try {
              played = video.play()
            } catch (error) {
              onRefused()
              return
            }
            var started = function () {
              if (muted) renderSound()
              else setAudioBlocked(null)
              playing()
            }
            if (played && typeof played.then === 'function') {
              played.then(started, onRefused)
              return
            }
            started()
          }
          var fallback = function () {
            setAudioBlocked('refused')
            audioRetry = function () {
              attemptPlay(false, function () {
                video.muted = true
                setAudioBlocked('refused', SOUND_HINT_REFUSED)
              })
            }
            attemptPlay(true, blocked)
          }
          if (!SOUND_ON) {
            setAudioBlocked('disabled')
            audioRetry = null
            attemptPlay(true, blocked)
            return
          }
          var soundWindow = globalThis.setTimeout(fallback, 1200)
          var settleWindow = function () { globalThis.clearTimeout(soundWindow) }
          var unmutedPlaying = function () { settleWindow(); setAudioBlocked(null); playing() }
          var unmutedRefused = function () { settleWindow(); fallback() }
          video.muted = false
          var played
          try {
            played = video.play()
          } catch (error) {
            played = undefined
          }
          if (played && typeof played.then === 'function') played.then(unmutedPlaying, unmutedRefused)
          else if (played === undefined) unmutedRefused()
          else unmutedPlaying()
        }

        var failures = []
        var noteFailure = function (clip, reason) {
          failures.push(clip.name + '(' + reason + ')')
          namespace.failures = failures.join(' ')
        }

        var tryNext = function () {
          if (settled || attempt >= order.length) {
            if (!settled) showNebula()
            if (!settled && parts.root.getAttribute('data-state') !== 'leaving') {
              parts.hint.textContent = failures.length === 0
                ? '片段无法播放 · 就绪后自动进入'
                : '片段无法播放 ' + failures.join(' ') + ' · 就绪后自动进入'
            }
            clipDone = true
            maybeEnter()
            return
          }
          var clip = order[attempt]
          attempt += 1
          cache.current = clip

          var video = document.createElement('video')
          var current = parts.video()
          video.className = current.className
          video.loop = ENTER_MODE === 'click'
          video.playsInline = true
          video.setAttribute('playsinline', '')
          video.preload = 'auto'
          if (current.parentNode) current.parentNode.replaceChild(video, current)
          parts.replaceVideo(video)

          var advance = globalThis.setTimeout(function () {
            noteFailure(clip, 'no-frame')
            tryNext()
          }, 6000)
          var endless = null
          var reveal = function () {
            if (settled) return
            settled = true
            globalThis.clearTimeout(advance)
            video.style.opacity = '1'
            video.setAttribute('data-shown', '1')
            // The clip is on screen: retire the brand/whale canvases so the
            // video's own artwork stands alone (the nebula stays behind the
            // clip as the edge mask's backdrop).
            parts.brand.setAttribute('data-show', '0')
            parts.whale.setAttribute('data-show', '0')
            if (!namespace.failed && !clipDone) {
              parts.hint.textContent = namespace.audioBlocked === null
                ? HINT_SOUND
                : HINT_SILENT
            }
          }
          whenFramePresents(video, reveal)
          video.addEventListener('error', function () {
            globalThis.clearTimeout(advance)
            globalThis.clearTimeout(endless)
            var code = video.error ? video.error.code : 0
            noteFailure(clip, 'err' + String(code))
            tryNext()
          }, { once: true })

          video.addEventListener('ended', function () {
            globalThis.clearTimeout(endless)
            namespace.clipEndedAt = Date.now()
            clipDone = true
            maybeEnter()
          }, { once: true })

          video.addEventListener('loadedmetadata', function () {
            if (Number.isFinite(video.duration)) return
            namespace.unknownLength = true
            endless = globalThis.setTimeout(function () {
              clipDone = true
              maybeEnter()
            }, ENDLESS_MS)
          }, { once: true })
          video.addEventListener('stalled', function () {
            namespace.lastStall = Date.now()
          })
          video.addEventListener('waiting', function () {
            namespace.lastStall = Date.now()
          })

          video.src = clip.src

          startClip(video, function () {
            /* playback started; reveal waits for a frame */
          }, function () {
            globalThis.clearTimeout(advance)
            globalThis.clearTimeout(endless)
            tryNext()
          })

          var tailEntered = false
          namespace.tailEntered = false
          var tailCheck = function () {
            if (tailEntered || !settled) return
            if (parts.video() !== video) return
            if (parts.root.getAttribute('data-state') === 'leaving') { tailEntered = true; return }
            if (!Number.isFinite(video.duration)) return
            if (video.duration * 1000 < TAIL_MIN_MS) return
            if (video.ended || video.paused) return
            if (namespace.bootedAt === null) return
            var remaining = (video.duration - video.currentTime) * 1000
            if (remaining > FADE_MS || remaining <= 0) return
            tailEntered = true
            namespace.tailEntered = true
            enter(remaining, true)
          }
          var tailFrame = function () {
            tailCheck()
            if (!tailEntered && parts.video() === video) nextFrame(tailFrame)
          }
          if (ENTER_MODE === 'tail') {
            nudgeTail = tailCheck
            nextFrame(tailFrame)
            video.addEventListener('timeupdate', tailCheck)
          }
        }

        tryNext()
      })
      .catch(function () {
        // An unreachable pool must not leave a dark screen: bring the nebula
        // back and release on its own clock.
        releaseWithoutClip('素材清单读取失败 · 就绪后自动进入')
      })
  }

  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })
})()
