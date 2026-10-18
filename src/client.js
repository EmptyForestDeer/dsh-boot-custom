// dsh-boot-custom — browser half.
//
// Two jobs, in this order and with this priority:
//
//   1. Report the browser roster's activation to the injected pre-boot screen
//      (`clientReady`). That call is part of the screen's hand-off condition, so
//      it happens first, unconditionally, and cannot be delayed or prevented by
//      anything below it.
//   2. Contribute the settings card to the Plugins settings page.
//
// Everything about job 2 is optional by construction. This package does not
// declare `inject`, because a required service would leave the fiber PENDING in
// a profile that lacks it — and then job 1 would never run. The services are
// reached with the dynamic `ctx.inject(deps, callback)` form, which waits for
// them without gating `apply`.
//
// NOT `ctx.get(name)`. That was the first attempt in the sibling plugin and it
// silently found nothing: a missing service read as "unavailable", the
// registration was skipped without a word, and the card never appeared. The
// `ctx.inject` form is what every working plugin in the profile uses.
//
// Bundle artifact contract: the shell materializes this file as a closure
// factory (`window.__ModuleLoader__.load({ id, factory })`), so `require` is a
// parameter supplied by the shell's module table. `react` is one of the baseline
// modules every dynamic bundle may request, so asking for it needs no
// declaration in package.json.

const OVERLAY = '__DSH_BOOT_CUSTOM__'

/** Settings namespace the Host half registers; also this card's slot key. */
const SETTINGS_NAMESPACE = 'boot-custom'

/** The Plugins settings page dispatches cards by slot name. */
const SLOT = 'plugins.item'

/** Client dictionary namespace this card's tab label is read from. */
const LOCALE_NAMESPACE = 'bootCustom'

/** Tab label, in the two dictionaries the locale service takes. */
const DICTIONARY_ZH = { title: '星云启动动画' }

/** English half of the same dictionary. */
const DICTIONARY_EN = { title: 'Nebula boot animation' }

/** Where the clip pool is published, relative to the page. */
const MANIFEST = '/plugins/dsh-boot-custom/clips.json'

/** Where one clip's index table is moved to the front of its file. */
const OPTIMIZE = '/plugins/dsh-boot-custom/optimize'

/** Offered dissolve lengths, in milliseconds. */
const FADE_CHOICES = [1000, 1500, 2000, 3000, 4000]

/** The three hand-off styles, with the sentence that explains each one. */
const ENTER_MODES = [
  ['tail', '片尾交叉溶解', '片尾开始溶解，动画放完时正好进界面'],
  ['end', '放完再淡', '动画完全结束，再淡出'],
  ['click', '点击才进', '动画循环播放，直到你点一下进入'],
]

/** The two themes. */
const THEMES = [
  ['nebula', '星云（内置）', '纯 CSS 星云动画，无需任何素材文件'],
  ['video', '视频素材池', '从素材池随机播放一段短片，池空时回退到星云'],
]

/**
 * The three behaviour switches, in card order.
 */
const BEHAVIOUR = [
  ['sound', '播放影片声音',
    '影片尝试带声音播放，右下角有一个开声音的按钮',
    '已彻底静音：不会尝试开声音，声音按钮也不再出现'],
  ['voice', '片尾语音「欢迎回来」',
    '动画结束时用真人声轻声说一句「欢迎回来」（与短片同源的音色，跟随上面的声音开关）',
    '不出声，「欢迎回来」仍然以气泡文字出现'],
  ['clickToEnter', '点鼠标直接进入',
    '按一下画面就直接进入界面，不再用第一下开声音',
    '按一下先开声音，再按一下才进入（默认）'],
  ['showHint', '显示底部提示文字',
    '画面底部显示「点击进入」这类操作提示',
    '底部不再显示操作提示，标题和进度条保留'],
]

/** Stable empty snapshot, so `getSnapshot` never returns a fresh object. */
const NO_SNAPSHOT = Object.freeze({
  status: 'unavailable', value: undefined, base: undefined, user: undefined,
  revision: undefined, writable: false, mode: 'host',
})

const STYLE_ID = 'dsh-boot-custom-card-style'

// No backticks in this sheet: it is a plain string, but the surrounding project
// convention is that a stray backtick in a CSS blob has already cost a plugin
// one silent build failure.
//
// The token names and the geometry are copied from the harness's own plugin card
// (ui-settings-plugins/src/client/PluginCard.module.css) so this card reads as a
// shipped one rather than a guest. Each token keeps a literal fallback for a page
// that has no theme loaded.
const CSS = [
  '.dshbc-card{list-style:none;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));',
  'border-radius:16px;background:var(--dsw-alias-bg-layer-3,transparent);',
  'transition:border-color .16s,background .16s;font-family:inherit}',
  '.dshbc-card:hover{border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.5))}',
  '.dshbc-card[data-open="1"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07));',
  'border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.5))}',
  '.dshbc-head{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;',
  'text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}',
  '.dshbc-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f9dd9);outline-offset:-2px}',
  '.dshbc-headtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
  '.dshbc-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,inherit)}',
  '.dshbc-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}',
  '.dshbc-chev{flex:none;width:7px;height:7px;margin-right:3px;',
  'border-right:1.5px solid var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));',
  'border-bottom:1.5px solid var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));',
  'transform:rotate(45deg);transition:transform .16s}',
  '.dshbc-card[data-open="1"] .dshbc-chev{transform:rotate(225deg)}',
  '.dshbc-body{border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));',
  'margin:0 16px;padding:14px 0 10px}',
  '.dshbc-sec{margin:0 0 18px}',
  '.dshbc-sec:last-child{margin-bottom:4px}',
  '.dshbc-h{font-size:13px;font-weight:600;line-height:1.5;margin:0 0 3px;',
  'color:var(--dsw-alias-label-primary,inherit)}',
  '.dshbc-p{margin:0 0 10px;font-size:12px;line-height:1.5;',
  'color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}',
  '.dshbc-row{display:flex;flex-wrap:wrap;gap:6px}',
  '.dshbc-switch{display:inline-flex;align-items:center;gap:9px;cursor:pointer}',
  '.dshbc-switch input{margin:0;flex:none}',
  '.dshbc-opt{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));background:none;',
  'color:inherit;border-radius:8px;padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer}',
  '.dshbc-opt:hover:not(:disabled){background:rgba(127,127,127,.14)}',
  '.dshbc-opt[data-on="1"]{border-color:var(--dsw-alias-brand-primary,#07974b);',
  'color:var(--dsw-alias-brand-primary,#07974b);font-weight:600;background:rgba(7,193,96,.1)}',
  '.dshbc-opt:disabled{opacity:.45;cursor:default}',
  '.dshbc-clip{display:flex;align-items:center;gap:9px;padding:6px 2px;border-radius:8px}',
  '.dshbc-clip input{margin:0;flex:none}',
  '.dshbc-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshbc-badge{font-size:11px;line-height:1.5;padding:1px 7px;border-radius:999px;white-space:nowrap;',
  'background:rgba(127,127,127,.18);color:var(--dsw-alias-label-secondary,rgba(127,127,127,.95))}',
  '.dshbc-badge.warn{background:rgba(210,120,40,.18);color:#b46214}',
  '.dshbc-badge.bad{background:rgba(210,74,67,.18);color:#d24a43}',
  '.dshbc-badge.ok{background:rgba(7,150,90,.18);color:#07974b}',
  '.dshbc-clipline{display:flex;align-items:center;gap:9px;flex:1;min-width:0;cursor:pointer}',
  '.dshbc-mini{flex:none;padding:3px 10px;font-size:11.5px}',
  '.dshbc-meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));white-space:nowrap}',
  '.dshbc-msg{margin-top:8px;font-size:11.5px;line-height:1.5;',
  'color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8))}',
  '.dshbc-msg.err{color:var(--dsw-alias-label-error,#d24a43)}',
].join('')

/** Install the card's stylesheet once per document. */
function ensureStyle() {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/** Human-readable byte count. */
function formatBytes(value) {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0) return '-'
  if (value < 1024) return String(value) + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(0) + ' KB'
  return (value / 1024 / 1024).toFixed(2) + ' MB'
}

/** Human-readable clip length, or a status word while it is unknown. */
function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds)) return '…'
  return seconds.toFixed(2) + 's'
}

/**
 * The summary answer: one line, as a string.
 */
function BootAnimationSummary() {
  return '星云动画、进入方式与素材池'
}

/**
 * The registered entry: pick the shape the page asked for.
 */
function BootAnimationEntry(props) {
  return props.view === 'summary'
    ? BootAnimationSummary()
    : BootAnimationCard(props)
}

/**
 * The page's own configuration form, as an observable the card can read.
 */
function cardForm(props) {
  const pageForm = props.form
  const scope = props.scope
  const observable = pageForm !== undefined && pageForm !== null
    && typeof pageForm.subscribe === 'function' && typeof pageForm.getSnapshot === 'function'
  const observableScope = scope !== undefined && scope !== null
    && typeof scope.subscribe === 'function' && typeof scope.getSnapshot === 'function'

  const source = observable ? pageForm : (observableScope ? scope : null)
  let fallback = NO_SNAPSHOT
  if (pageForm !== undefined && pageForm !== null && pageForm.state !== undefined) fallback = pageForm.state
  else if (scope !== undefined && scope !== null && typeof scope.getSnapshot === 'function') fallback = scope.getSnapshot()
  else if (observableScope) fallback = scope.getSnapshot()

  const mutate = (() => {
    if (pageForm !== undefined && pageForm !== null && typeof pageForm.mutate === 'function') {
      return (ops, revision) => pageForm.mutate(ops, revision)
    }
    if (scope !== undefined && scope !== null && typeof scope.mutate === 'function') {
      return (ops, revision) => scope.mutate(ops, revision)
    }
    return null
  })()

  const remoteMutate = (() => {
    const remote = props.remote
    const settings = remote !== undefined && remote !== null ? remote.settings : undefined
    if (settings !== undefined && settings !== null && typeof settings.mutate === 'function') {
      return (namespace, ops, revision) => settings.mutate(namespace, ops, revision)
    }
    return null
  })()

  return { source, fallback, mutate, remoteMutate }
}

/**
 * The card.
 */
function BootAnimationCard(props) {
  const React = props.runtime
  const [open, setOpen] = React.useState(false)
  const [pool, setPool] = React.useState(null)
  const [lengths, setLengths] = React.useState({})
  const [failure, setFailure] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [fixing, setFixing] = React.useState({})
  const [previewing, setPreviewing] = React.useState(null)

  ensureStyle()

  const form = cardForm(props)
  const source = form.source
  const subscribe = React.useCallback(
    (listener) => (source === null ? function () {} : source.subscribe(listener)),
    [source],
  )
  const readSnapshot = React.useCallback(
    () => (source === null ? form.fallback : source.getSnapshot()),
    [source, form.fallback],
  )
  const snapshot = React.useSyncExternalStore(subscribe, readSnapshot)
  const stored = (snapshot && snapshot.value) || {}
  const enabled = stored.enabled !== false
  const theme = typeof stored.theme === 'string' ? stored.theme : 'nebula'
  const fadeMs = typeof stored.fadeMs === 'number' ? stored.fadeMs : 2000
  const enterMode = typeof stored.enterMode === 'string' ? stored.enterMode : 'tail'
  const disabled = Array.isArray(stored.disabledClips) ? stored.disabledClips : []
  const sound = stored.sound !== false
  const voice = stored.voice !== false
  const clickToEnter = stored.clickToEnter === true
  const showHint = stored.showHint !== false
  const behaviour = { sound, voice, clickToEnter, showHint }

  // The pool, and each clip's real length. Gated on `open` so a collapsed card
  // costs nothing.
  React.useEffect(() => {
    if (!open || pool !== null) return undefined
    let live = true
    fetch(MANIFEST, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { clips: [] }))
      .then((payload) => { if (live) setPool(Array.isArray(payload.clips) ? payload.clips : []) })
      .catch((error) => { if (live) setFailure('读取素材池失败：' + String(error)) })
    return () => { live = false }
  }, [open, pool])

  React.useEffect(() => {
    if (!open || pool === null) return undefined
    const probes = pool.map((clip) => {
      const element = document.createElement('video')
      element.muted = true
      element.preload = 'auto'
      const settle = (patch) => setLengths((current) => Object.assign({}, current, { [clip.name]: patch }))

      let decided = false
      let timer = null
      const finish = (patch) => {
        if (decided) return
        decided = true
        if (timer !== null) clearTimeout(timer)
        settle(patch)
        try {
          if (typeof element.pause === 'function') element.pause()
        } catch (error) {
          /* already stopped */
        }
      }
      const onRefused = () => finish({ refused: true })
      const onPlayed = () => finish({ played: true })
      const onMeta = () => settle({ seconds: element.duration })

      element.addEventListener('error', onRefused)
      element.addEventListener('loadedmetadata', onMeta)
      timer = setTimeout(() => finish({ noFrame: true }), 8000)

      if (typeof element.requestVideoFrameCallback === 'function') {
        element.requestVideoFrameCallback(onPlayed)
      } else {
        element.addEventListener('timeupdate', () => {
          if (element.currentTime > 0) onPlayed()
        })
      }

      element.src = clip.src
      try {
        const attempt = element.play()
        if (attempt !== undefined && typeof attempt.catch === 'function') attempt.catch(onRefused)
      } catch (error) {
        onRefused()
      }

      return () => {
        decided = true
        if (timer !== null) clearTimeout(timer)
        element.removeEventListener('error', onRefused)
        try {
          if (typeof element.pause === 'function') element.pause()
        } catch (error) {
          /* already stopped */
        }
        element.removeAttribute('src')
      }
    })
    return () => { for (const dispose of probes) dispose() }
  }, [open, pool])

  /**
   * Stage one field write.
   */
  const write = (field, value) => {
    if (form.mutate === null) {
      setFailure('这一页没有连上设置文档，改动不会保存。')
      return
    }
    setBusy(true)
    setFailure(null)
    const revision = snapshot === undefined || snapshot === null ? undefined : snapshot.revision
    const ops = [{ op: 'set', path: [field], value }]
    Promise.resolve(form.mutate(ops, revision))
      .then(async (accepted) => {
        if (accepted !== false) return
        if (form.remoteMutate === null) {
          setFailure('保存失败：本部署没有接受这次修改。')
          return
        }
        try {
          const answer = await form.remoteMutate(SETTINGS_NAMESPACE, ops, undefined)
          if (answer !== null && typeof answer === 'object' && answer.ok === false) {
            const reason = answer.error === undefined || answer.error === null
              ? '未说明原因'
              : String(answer.error.message ?? answer.error)
            setFailure('保存失败：' + reason)
          } else {
            setFailure('保存失败：本部署没有接受这次修改。')
          }
        } catch (error) {
          setFailure('保存失败：' + String(error))
        }
      })
      .catch((error) => setFailure('保存失败：' + String(error)))
      .then(() => setBusy(false))
  }

  const toggleClip = (name, enabled) => {
    const next = enabled ? disabled.filter(entry => entry !== name) : disabled.concat([name])
    if (pool !== null && next.length >= pool.length) {
      setFailure('至少要留一条素材参与随机。')
      return
    }
    write('disabledClips', next)
  }

  /**
   * Ask the Host to move one clip's index table to the front of its file.
   */
  const optimize = (name) => {
    setFailure(null)
    setFixing((current) => Object.assign({}, current, { [name]: 'busy' }))
    fetch(OPTIMIZE + '?name=' + encodeURIComponent(name), { method: 'POST', cache: 'no-store' })
      .then((response) => response.json()
        .catch(() => ({ ok: false, error: 'Host 回答了 HTTP ' + String(response.status) })))
      .then((answer) => {
        if (answer !== null && typeof answer === 'object' && answer.ok === true) {
          setFixing((current) => Object.assign({}, current, { [name]: 'done' }))
          setPool((current) => (current === null ? current : current.map((clip) => (
            clip.name === name ? Object.assign({}, clip, { faststart: true }) : clip
          ))))
          return
        }
        setFixing((current) => Object.assign({}, current, { [name]: 'error' }))
        const why = answer !== null && typeof answer === 'object' && answer.error !== undefined
          ? String(answer.error)
          : 'Host 没有说明原因'
        setFailure('优化 ' + name + ' 失败：' + why)
      })
      .catch((error) => {
        setFixing((current) => Object.assign({}, current, { [name]: 'error' }))
        setFailure('优化 ' + name + ' 失败：' + String(error))
      })
  }

  /**
   * Play this screen as the real boot animation, full screen, right now.
   */
  const preview = (name) => {
    const overlay = globalThis[OVERLAY]
    if (overlay === null || overlay === undefined || typeof overlay.preview !== 'function') {
      setFailure('这一页的入场层还没有预览接口（页面是在这次改动之前加载的）：刷新页面后再点。')
      return
    }
    setFailure(null)
    setPreviewing(name)
    let started = false
    try {
      started = overlay.preview({
        name,
        theme,
        fadeMs,
        enterMode,
        sound,
        voice,
        clickToEnter,
        showHint,
        onDone: () => setPreviewing(null),
      }) === true
    } catch (error) {
      setPreviewing(null)
      setFailure('预览没能启动：' + String(error))
      return
    }
    if (!started) {
      setPreviewing(null)
      setFailure('已经有一个预览在跑了，等它结束再点。')
    }
  }

  const switchRow = (field, label, onNote, offNote) => React.createElement('div', {
    className: 'dshbc-sec',
    key: field,
  },
  React.createElement('label', { className: 'dshbc-switch' },
    React.createElement('input', {
      type: 'checkbox',
      checked: behaviour[field],
      disabled: busy,
      onChange: (event) => write(field, event.target.checked),
    }),
    React.createElement('span', { className: 'dshbc-h', style: { margin: '0' } }, label)),
  React.createElement('div', { className: 'dshbc-p', style: { marginTop: '6px', marginBottom: '0' } },
    behaviour[field] ? onNote : offNote))

  const header = React.createElement('button', {
    type: 'button',
    className: 'dshbc-head',
    'aria-expanded': open,
    'aria-label': (open ? '收起' : '展开') + '：星云启动动画',
    onClick: () => { setOpen(!open) },
  },
  React.createElement('span', { className: 'dshbc-headtext' },
    React.createElement('span', { className: 'dshbc-name' }, '星云启动动画'),
    React.createElement('span', { className: 'dshbc-desc' }, '星云动画、进入方式与素材池')),
  React.createElement('span', { className: 'dshbc-chev' }))

  try {
    if (!open) {
      return React.createElement('li', { className: 'dshbc-card', 'data-open': '0' }, header)
    }

    const sections = []

    // The switch comes first because it is the only setting that changes whether
    // any of the others run at all.
    sections.push(React.createElement('div', { className: 'dshbc-sec', key: 'enabled' },
      React.createElement('label', { className: 'dshbc-switch' },
        React.createElement('input', {
          type: 'checkbox',
          checked: enabled,
          disabled: busy,
          onChange: (event) => write('enabled', event.target.checked),
        }),
        React.createElement('span', { className: 'dshbc-h', style: { margin: '0' } }, '开启启动动画')),
      React.createElement('div', { className: 'dshbc-p', style: { marginTop: '6px', marginBottom: '0' } },
        enabled
          ? '关掉并刷新页面，就会回到 DSH 原生启动页'
          : '已关闭：刷新页面后就是 DSH 原生启动页，下面的设置暂时不生效')))

    sections.push(React.createElement('div', { className: 'dshbc-sec', key: 'theme' },
      React.createElement('div', { className: 'dshbc-h' }, '动画主题'),
      React.createElement('div', { className: 'dshbc-row' },
        THEMES.map(entry => React.createElement('button', {
          key: entry[0],
          type: 'button',
          className: 'dshbc-opt',
          'data-on': entry[0] === theme ? 1 : 0,
          disabled: busy,
          onClick: () => write('theme', entry[0]),
        }, entry[1]))),
      React.createElement('div', { className: 'dshbc-p', style: { marginTop: '8px', marginBottom: '0' } },
        (THEMES.filter(entry => entry[0] === theme)[0] || ['', '', ''])[2])))

    sections.push(React.createElement('div', { className: 'dshbc-sec', key: 'behaviour-head' },
      React.createElement('div', { className: 'dshbc-h' }, '交互与声音'),
      React.createElement('div', { className: 'dshbc-p', style: { marginBottom: '0' } },
        '三项都在下次刷新页面时生效')))
    for (const entry of BEHAVIOUR) {
      sections.push(switchRow(entry[0], entry[1], entry[2], entry[3]))
    }

    sections.push(React.createElement('div', { className: 'dshbc-sec', key: 'fade' },
      React.createElement('div', { className: 'dshbc-h' }, '淡入时长'),
      React.createElement('div', { className: 'dshbc-row' },
        FADE_CHOICES.map(choice => React.createElement('button', {
          key: choice,
          type: 'button',
          className: 'dshbc-opt',
          'data-on': choice === fadeMs ? 1 : 0,
          disabled: busy,
          onClick: () => write('fadeMs', choice),
        }, (choice / 1000) + ' 秒'))),
      React.createElement('div', { className: 'dshbc-p', style: { marginTop: '8px', marginBottom: '0' } },
        enterMode === 'tail'
          ? '动画会在结束前 ' + (fadeMs / 1000) + ' 秒开始溶解，结束正好进界面'
          : '改动在下次刷新页面时生效')))

    sections.push(React.createElement('div', { className: 'dshbc-sec', key: 'mode' },
      React.createElement('div', { className: 'dshbc-h' }, '进入方式'),
      React.createElement('div', { className: 'dshbc-row' },
        ENTER_MODES.map(entry => React.createElement('button', {
          key: entry[0],
          type: 'button',
          className: 'dshbc-opt',
          'data-on': entry[0] === enterMode ? 1 : 0,
          disabled: busy,
          onClick: () => write('enterMode', entry[0]),
        }, entry[1]))),
      React.createElement('div', { className: 'dshbc-p', style: { marginTop: '8px', marginBottom: '0' } },
        (ENTER_MODES.filter(entry => entry[0] === enterMode)[0] || ['', '', ''])[2])))

    const clipNodes = []
    if (theme !== 'video') {
      clipNodes.push(React.createElement('div', { className: 'dshbc-msg', key: 'nebula-note' },
        '当前是内置星云主题，无需素材。切到「视频素材池」后，把 mp4 放进 assets/videos/ 再刷新这一页。'))
    } else if (pool === null) {
      clipNodes.push(React.createElement('div', { className: 'dshbc-msg', key: 'loading' }, '正在读取…'))
    } else if (pool.length === 0) {
      clipNodes.push(React.createElement('div', { className: 'dshbc-msg', key: 'empty' },
        '素材池是空的。把 mp4 放进 assets/videos/ 再刷新这一页；池空时开屏自动回退到星云动画。'))
    } else {
      for (const clip of pool) {
        const known = lengths[clip.name] || {}
        const state = fixing[clip.name]
        const badges = [React.createElement('span', { className: 'dshbc-badge', key: 'len' },
          formatDuration(known.seconds))]
        if (known.refused === true) {
          badges.push(React.createElement('span', {
            className: 'dshbc-badge bad',
            key: 'refused',
            title: '浏览器拒绝解码这一段：可能是编码档次不被支持，或文件不完整。',
          }, '浏览器播不了'))
        } else if (known.noFrame === true) {
          badges.push(React.createElement('span', {
            className: 'dshbc-badge warn',
            key: 'noframe',
            title: '在这台浏览器里能开始播放，但 8 秒内一帧画面都没出来。',
          }, '一直没有画面'))
        }
        if (clip.faststart === false) {
          badges.push(React.createElement('span', {
            className: 'dshbc-badge warn',
            key: 'moov',
            title: '索引表(moov)在文件末尾：浏览器要整段下载完才出画面。点「优化」可以无损前移。',
          }, '未优化'))
        }
        if (state === 'done') {
          badges.push(React.createElement('span', { className: 'dshbc-badge ok', key: 'fixed' }, '已重排'))
        }
        clipNodes.push(React.createElement('div', { className: 'dshbc-clip', key: clip.name },
          React.createElement('label', { className: 'dshbc-clipline', title: clip.name },
            React.createElement('input', {
              type: 'checkbox',
              checked: !disabled.includes(clip.name),
              disabled: busy,
              onChange: (event) => toggleClip(clip.name, event.target.checked),
            }),
            React.createElement('span', { className: 'dshbc-nm' }, clip.name),
            badges),
          React.createElement('button', {
            type: 'button',
            className: 'dshbc-opt dshbc-mini',
            disabled: previewing !== null,
            title: '现在就把这一段当作启动动画满屏跑一遍：按当前设置演一遍真实的入场过渡。',
            onClick: () => preview(clip.name),
          }, previewing === clip.name ? '预览中…' : '预览'),
          clip.faststart === false
            ? React.createElement('button', {
              type: 'button',
              className: 'dshbc-opt dshbc-mini',
              disabled: busy || state === 'busy' || previewing !== null,
              title: '把这一段的索引表(moov)移到文件最前：无损、长度不变，原片留在 assets/videos/originals/ 里。',
              onClick: () => optimize(clip.name),
            }, state === 'busy' ? '处理中…' : '优化')
            : null,
          React.createElement('span', { className: 'dshbc-meta' }, formatBytes(clip.bytes))))
      }
    }

    sections.push(React.createElement('div', { className: 'dshbc-sec', key: 'pool' },
      React.createElement('div', { className: 'dshbc-h' }, '素材池'),
      React.createElement('div', { className: 'dshbc-p' }, '勾选的素材参与随机轮播；取消勾选的只留在文件夹里，不再被抽中。'),
      clipNodes))

    if (failure !== null) {
      sections.push(React.createElement('div', { className: 'dshbc-msg err', key: 'failure' }, failure))
    }
    if (snapshot && snapshot.status === 'unavailable') {
      sections.push(React.createElement('div', { className: 'dshbc-msg', key: 'unavailable' },
        '这一页连不上设置文档，改动不会保存。'))
    }
    if (snapshot && snapshot.writable === false) {
      sections.push(React.createElement('div', { className: 'dshbc-msg', key: 'readonly' },
        '当前页面不允许写入设置文档。'))
    }

    return React.createElement('li', { className: 'dshbc-card', 'data-open': '1' },
      header,
      React.createElement('div', { className: 'dshbc-body' }, sections))
  } catch (error) {
    return React.createElement('li', { className: 'dshbc-card', 'data-open': '1' },
      header,
      React.createElement('div', { className: 'dshbc-body' },
        '启动动画设置面板渲染失败：' + String(error && error.message ? error.message : error)))
  }
}

/**
 * Read one awaited service from the injected owner context.
 */
function serviceAt(owner, name) {
  try {
    if (owner !== null && owner !== undefined && typeof owner.get === 'function') {
      const value = owner.get(name)
      if (value !== undefined && value !== null) return value
    }
  } catch (error) {
    /* a global-store miss is the expected miss */
  }
  try {
    return owner === null || owner === undefined ? undefined : owner[name]
  } catch (error) {
    return undefined
  }
}

/**
 * Report activation, then contribute the settings card if the shell is willing.
 */
exports.apply = function apply(ctx) {
  // 1. Priority one, and it must not be able to fail for any other reason.
  try {
    const overlay = globalThis[OVERLAY]
    if (overlay !== undefined && typeof overlay.clientReady === 'function') {
      overlay.clientReady()
    }
  } catch (error) {
    console.warn('boot-custom: client half failed', error)
  }

  // 2. Optional, and reached with the dynamic `ctx.inject`.
  try {
    let React = null
    try {
      React = require('react')
    } catch (error) {
      React = null
    }
    if (React === null || typeof React.createElement !== 'function') return
    if (ctx === undefined || ctx === null || typeof ctx.inject !== 'function') return

    ctx.inject(['slots', 'locale', 'configForms'], (owner) => {
      try {
        const slots = serviceAt(owner, 'slots')
        const locale = serviceAt(owner, 'locale')
        const forms = serviceAt(owner, 'configForms')
        if (slots === undefined || slots === null || typeof slots.inject !== 'function') return
        if (forms === undefined || forms === null || typeof forms.get !== 'function') return
        if (typeof forms.whileServed !== 'function') return

        if (locale !== undefined && locale !== null && typeof locale.register === 'function') {
          const dictionaries = () => locale.register(LOCALE_NAMESPACE, {
            zh: DICTIONARY_ZH,
            en: DICTIONARY_EN,
          })
          if (typeof owner.effect === 'function') owner.effect(dictionaries, 'boot-custom: dictionaries')
          else dictionaries()
        }
        const t = locale !== undefined && locale !== null && typeof locale.bind === 'function'
          ? locale.bind(LOCALE_NAMESPACE)
          : function (key) { return DICTIONARY_ZH[key] === undefined ? key : DICTIONARY_ZH[key] }

        let registration = null
        const contribute = function () {
          if (registration !== null) return
          try {
            registration = slots.inject(SLOT, () => slots.register(
              {
                name: SLOT,
                id: SETTINGS_NAMESPACE,
                order: 60,
                label: () => t('title'),
                locale: LOCALE_NAMESPACE,
                inject: () => ({ runtime: React, scope: forms.get(SETTINGS_NAMESPACE) }),
              },
              BootAnimationEntry,
            ))
          } catch (error) {
            registration = null
            console.warn('boot-custom: settings card not registered', error)
          }
        }
        const withdraw = function () {
          if (registration === null) return
          const dispose = registration
          registration = null
          try {
            if (typeof dispose === 'function') dispose()
          } catch (error) {
            console.warn('boot-custom: settings card not withdrawn', error)
          }
        }
        const serve = function () {
          return forms.whileServed([SETTINGS_NAMESPACE], function () {
            contribute()
            return withdraw
          })
        }
        if (typeof owner.effect === 'function') owner.effect(serve, 'boot-custom: settings page')
        else serve()

        if (typeof location !== 'undefined' && String(location.search).indexOf('dshbootdiag=1') >= 0) {
          console.info('[boot-custom] settings card registered into ' + SLOT)
        }
      } catch (error) {
        console.warn('boot-custom: settings card not registered', error)
      }
    })
  } catch (error) {
    console.warn('boot-custom: settings card wiring failed', error)
  }
}
