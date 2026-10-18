// dsh-boot-custom — Host half.
//
// Two contributions, both required for the overlay to exist at all:
//
//  1. a webserver route serving the clip pool (bytes from ./assets/videos), a
//     same-origin manifest naming them, and one on-demand route that moves a
//     clip's index table to the front of its file (the card's 优化 button), and
//  2. an index injection whose head row installs the screen before the shell
//     boots.
//
// The head row is the whole reason this is a plugin rather than a client
// component: the kernel constructs its own boot page synchronously in
// `AppWebEntry`'s constructor, which runs from the shell module script, so only a
// parser-blocking index row executes early enough to pre-empt it.
//
// This plugin is the "nebula" sibling of dsh-boot-animation: same verified
// mechanism, different artwork. The screen can run a pure CSS/SVG nebula
// (zero asset files, no moov/caching/codec pitfalls) or fall back to the video
// pool when the user drops clips into assets/videos/. The hand-off, the hold
// budget and every "cannot go on" case have an upper bound, exactly like the
// sibling — a decorative screen must never trap the user.
//
// Settings are the third contribution: under DSH 0.2.0-rc.2 a settings
// namespace IS a plugin entry. The Host `settings` service derives namespaces
// from every running entry whose resolved export carries a `Config` schema,
// keyed by the entry id in the profile patch — here `boot-custom`. The browser
// half pairs with that same string through the client `configForms` service.
// Two consequences are load-bearing:
//
//   * `Config` must be a property of the module namespace object, so the schema
//     package has to resolve at module-evaluation time. A declared dependency
//     is versioned and deterministic; `@deepseek-ai/schemastery` is pinned at
//     `^3.18.4` so `.volatile()` exists.
//   * `describe()` projects only `.volatile()` fields; a schema with no live
//     field is invisible to the settings page. Every field below is volatile.
//
// The patch id is therefore part of the contract: renaming the `- insert:` id
// in cordis.patch.yml moves the namespace and silently orphans the browser
// card, whose key is the same string.

import { readdir, stat, open } from 'node:fs/promises'
import { createReadStream, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, extname, join, resolve, sep } from 'node:path'
import { optimizeInPlace } from './src/remux.js'
import z from '@deepseek-ai/schemastery'

/**
 * Absolute path of the pre-boot screen source.
 *
 * The script is read per index render rather than once at module load. Reading it
 * at load time would pin the served script to whatever the file held when the
 * process started, so editing a label or the exit fade would require restarting
 * dsh — the one operation this plugin's whole design tries to avoid asking for.
 */
const BOOT_SCREEN_PATH = fileURLToPath(new URL('./src/boot-screen.js', import.meta.url))

/** Video container extensions the pool accepts, in discovery order. */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.m4v', '.mov'])

/** Route prefix both the manifest and the clip bytes live under. */
const ROUTE = '/plugins/dsh-boot-custom'

/**
 * The values the screen runs with when the applied config does not carry one.
 *
 * With a `Config` schema present these are unreachable in practice: Cordis
 * validates the raw profile row against the schema before `apply` runs, so every
 * field arrives already defaulted. They are kept anyway, because the fallback
 * must not depend on the schema having been resolvable.
 */
const DEFAULT_SETTINGS = {
  /** Whether the screen is injected at all. Off restores DSH's own boot page. */
  enabled: true,
  /**
   * How the screen is drawn: `nebula` is the built-in CSS/SVG animation with no
   * asset files; `video` plays one clip from the pool (falling back to the
   * nebula when the pool is empty). Defaults to `video` because the shipped
   * pool carries the reference clip; an empty pool still falls back cleanly.
   */
  theme: 'video',
  /** How long the dissolve into the app takes. */
  fadeMs: 2000,
  /** When the hand-off happens: see ENTER_MODES. */
  enterMode: 'tail',
  /** Clip file names excluded from the pool by the user. */
  disabledClips: [],
  /** Whether the clip may make a sound at all. */
  sound: true,
  /** Whether a pointer press enters immediately. */
  clickToEnter: false,
  /** Whether the bottom hint line is drawn. */
  showHint: true,
  /** Whether the screen says 欢迎回来 aloud at the end (the shipped human
   * voice, lifted from the sibling animation's own audio track). */
  voice: true,
}

/** The accepted `enterMode` values, in the order the browser card presents them. */
const ENTER_MODES = ['tail', 'end', 'click']

/** The accepted `theme` values. */
const THEMES = ['nebula', 'video']

/**
 * Whether the resolved schemastery can mark a Config field live-editable.
 *
 * `.volatile()` exists from schemastery 3.18.4, which this package declares as
 * a dependency, so the normal resolution has it. The probe guards against a
 * resolution that ignores that declaration, so the schema degrades to
 * non-volatile instead of throwing while this module is being evaluated.
 */
const LIVE_CAPABLE = typeof z.boolean().volatile === 'function'

/** Mark one Config field live-editable, where the schema library allows it. */
function live(schema) {
  return LIVE_CAPABLE ? schema.volatile() : schema
}

/**
 * The well-known key cosmokit puts on a live config reference.
 */
const VOLATILE_REF = Symbol.for('cosmokit.volatile.write')

/** Whether a config value is a live reference rather than a plain snapshot. */
function isLive(value) {
  return typeof value === 'object' && value !== null && VOLATILE_REF in value
}

/**
 * Read one applied-config field.
 *
 * The field is a live reference when `Config` declared it volatile — the normal
 * case — and a plain value when the config arrived without schema resolution.
 * @param config - the applied config, possibly undefined.
 * @param key - field name.
 * @returns the current value, or undefined when the field is absent.
 */
function readField(config, key) {
  const value = config?.[key]
  return isLive(value) && typeof value.get === 'function' ? value.get() : value
}

/**
 * This entry's Host configuration schema.
 *
 * The namespace is not named here: it is the entry id the profile patch mounts
 * this row under, `- insert: id: boot-custom`. `src/client.js` spells that same
 * string in `SETTINGS_NAMESPACE`.
 *
 * Every field is volatile, because that is the only class the settings service
 * serves.
 */
export const Config = z.object({
  enabled: live(z.boolean().default(DEFAULT_SETTINGS.enabled)),
  theme: live(z.union([...THEMES]).default(DEFAULT_SETTINGS.theme)),
  fadeMs: live(z.number().min(300).max(5000).default(DEFAULT_SETTINGS.fadeMs)),
  enterMode: live(z.union([...ENTER_MODES]).default(DEFAULT_SETTINGS.enterMode)),
  disabledClips: live(z.array(z.string()).default([])),
  sound: live(z.boolean().default(DEFAULT_SETTINGS.sound)),
  clickToEnter: live(z.boolean().default(DEFAULT_SETTINGS.clickToEnter)),
  showHint: live(z.boolean().default(DEFAULT_SETTINGS.showHint)),
  voice: live(z.boolean().default(DEFAULT_SETTINGS.voice)),
})

/** Package name the loader mounts this row as. */
export const name = 'dsh-boot-custom'

/** Services this half consumes. */
export const inject = ['webServer']

/** The clip directory, resolved from this module rather than the process cwd. */
const assetDir = fileURLToPath(new URL('./assets/videos', import.meta.url))

/** The spoken-line directory (the 欢迎回来 clip that ships with the plugin). */
const audioDir = fileURLToPath(new URL('./assets/audio', import.meta.url))

/** The one spoken clip the end-of-animation voice plays, if present. */
const WELCOME_AUDIO = join(audioDir, 'welcome.m4a')

/** MIME type served for one clip. */
function contentType(file) {
  switch (extname(file).toLowerCase()) {
    case '.webm': return 'video/webm'
    case '.mov': return 'video/quicktime'
    case '.m4a': return 'audio/mp4'
    case '.mp3': return 'audio/mpeg'
    default: return 'video/mp4'
  }
}

/**
 * Whether the movie box precedes the media data.
 *
 * A player cannot decode a frame until it has read `moov`, so a file whose
 * `moov` sits at the end must be fetched almost in full before anything appears.
 * The header window is 64 KiB because the order of the first two boxes is NOT
 * the answer: clips can carry a `uuid` metadata box before the media data.
 * @param absolute - resolved clip path.
 * @returns true when `moov` comes first, false when `mdat` does, undefined when
 *   neither box is found within the header window.
 */
async function readFaststart(absolute) {
  let handle
  try {
    handle = await open(absolute, 'r')
    const head = Buffer.alloc(65536)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    let offset = 0
    while (offset + 8 <= bytesRead) {
      const type = head.toString('latin1', offset + 4, offset + 8)
      if (type === 'moov') return true
      if (type === 'mdat') return false
      const size = head.readUInt32BE(offset)
      if (size < 8) break
      offset += size
    }
    return undefined
  } catch {
    return undefined
  } finally {
    await handle?.close()
  }
}

/**
 * List the clip files currently on disk, newest first.
 *
 * The modification time travels with each path because the manifest publishes it
 * as the clip's revision: the bytes route caches immutably under a filename that
 * carries no revision of its own, so a clip replaced in place must be requested
 * under a new URL or the browser keeps serving the old copy.
 */
async function listClips() {
  let entries
  try {
    entries = await readdir(assetDir, { withFileTypes: true })
  } catch (error) {
    // A missing directory is an empty pool, not a failure.
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const files = entries
    .filter(entry => entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map(entry => join(assetDir, entry.name))
  const stamped = await Promise.all(files.map(async (file) => {
    const info = await stat(file)
    return {
      file,
      mtime: info.mtimeMs,
      revision: Math.round(info.mtimeMs),
      bytes: info.size,
      faststart: await readFaststart(file),
    }
  }))
  return stamped.sort((left, right) => right.mtime - left.mtime)
}

/** Answer one JSON response. */
function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Parse one `Range` header against a known length.
 * @param header - raw header value, if present.
 * @param size - complete resource length.
 * @returns inclusive byte range, or undefined for a full response.
 */
function parseRange(header, size) {
  if (typeof header !== 'string') return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return undefined
  if (rawStart === '') {
    const length = Number(rawEnd)
    if (!Number.isFinite(length) || length <= 0) return undefined
    return { start: Math.max(size - length, 0), end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return { unsatisfiable: true }
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isFinite(end) || end < start) return { unsatisfiable: true }
  return { start, end }
}

/**
 * Stream one clip, honouring range requests so the browser can seek and so a
 * repeated load does not re-download bytes it already holds.
 */
async function serveClip(absolute, req, res) {
  const info = await stat(absolute)
  const type = contentType(absolute)
  const range = parseRange(req.headers.range, info.size)
  if (range?.unsatisfiable === true) {
    res.writeHead(416, { 'content-range': `bytes */${String(info.size)}` })
    res.end()
    return
  }

  // Nothing about a clip response may be stored, complete or not.
  //
  // The overlay replaces the media element when it hands over or skips on, which
  // aborts the in-flight request; whatever arrived is a TRUNCATED body. Any
  // directive that lets the browser keep it turns that into a poisoned cache
  // entry. The cost is that each page load streams the chosen clip again — local
  // files over loopback, a few tens of milliseconds — and it buys the only
  // guarantee that matters: what the player decodes is always the whole file.
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  }

  const from = range === undefined ? 0 : range.start
  const to = range === undefined ? info.size - 1 : range.end
  res.writeHead(range === undefined ? 200 : 206, {
    ...headers,
    'content-length': String(to - from + 1),
    ...(range === undefined ? {} : {
      'content-range': `bytes ${String(from)}-${String(to)}/${String(info.size)}`,
    }),
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(absolute, { start: from, end: to })
  stream.on('error', () => { res.destroy() })
  res.on('close', () => { stream.destroy() })
  stream.pipe(res)
}

/**
 * Resolve a requested pool path to a file inside the clip directory.
 * @param url - request URL.
 * @returns the absolute path, or undefined when the request is not a pool clip.
 */
function resolveClip(url) {
  const pathname = decodeURIComponent(url.split('?')[0])
  if (!pathname.startsWith(`${ROUTE}/clip/`)) return undefined
  const requested = basename(pathname.slice(`${ROUTE}/clip/`.length))
  if (!VIDEO_EXTENSIONS.has(extname(requested).toLowerCase())) return undefined
  const absolute = resolve(assetDir, requested)
  // Containment: a traversal attempt must not escape the clip directory.
  if (!absolute.startsWith(assetDir + sep)) return undefined
  return absolute
}

/**
 * Mount the clip route and the pre-boot index injection.
 */
export function apply(ctx, config) {
  const server = ctx.webServer

  if (!LIVE_CAPABLE) {
    ctx.logger?.warn?.(
      'boot-custom: the resolved @deepseek-ai/schemastery has no .volatile(), so DSH '
      + 'will not serve this entry as a settings namespace and the settings card stays '
      + 'hidden. Reinstall the plugin so pnpm resolves the declared version.',
    )
  }

  /**
   * The settings the screen should run with right now.
   *
   * Read per index render rather than cached, because the boot screen is rebuilt
   * from this on the next page load.
   */
  function currentSettings() {
    try {
      const enabled = readField(config, 'enabled')
      const theme = readField(config, 'theme')
      const fadeMs = readField(config, 'fadeMs')
      const enterMode = readField(config, 'enterMode')
      const disabledClips = readField(config, 'disabledClips')
      const sound = readField(config, 'sound')
      const clickToEnter = readField(config, 'clickToEnter')
      const showHint = readField(config, 'showHint')
      const voice = readField(config, 'voice')
      return {
        enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_SETTINGS.enabled,
        theme: THEMES.includes(theme) ? theme : DEFAULT_SETTINGS.theme,
        fadeMs: typeof fadeMs === 'number' ? fadeMs : DEFAULT_SETTINGS.fadeMs,
        enterMode: ENTER_MODES.includes(enterMode) ? enterMode : DEFAULT_SETTINGS.enterMode,
        disabledClips: Array.isArray(disabledClips) ? disabledClips : [],
        sound: typeof sound === 'boolean' ? sound : DEFAULT_SETTINGS.sound,
        clickToEnter: typeof clickToEnter === 'boolean' ? clickToEnter : DEFAULT_SETTINGS.clickToEnter,
        showHint: typeof showHint === 'boolean' ? showHint : DEFAULT_SETTINGS.showHint,
        voice: typeof voice === 'boolean' ? voice : DEFAULT_SETTINGS.voice,
      }
    } catch (error) {
      ctx.logger?.warn?.('boot-custom: settings unreadable, using defaults', error)
      return DEFAULT_SETTINGS
    }
  }

  // Two routes rather than one prefix over ROUTE. The web server resolves
  // prefixes longest-first, so a prefix on ROUTE also claims `<ROUTE>/client.js`
  // — the URL the browser fetches for this package's own client bundle. An exact
  // manifest route plus a `/clip` prefix leaves every other path under ROUTE to
  // its owner.
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${ROUTE}/clips.json`,
    handler: (req, res) => {
      void (async () => {
        const clips = await listClips()
        const disabled = new Set(currentSettings().disabledClips)
        sendJson(res, 200, {
          clips: clips.map(clip => ({
            src: `${ROUTE}/clip/${encodeURIComponent(basename(clip.file))}`
              + `?v=${String(clip.revision)}-${String(clip.bytes)}`,
            name: basename(clip.file),
            enabled: !disabled.has(basename(clip.file)),
            bytes: clip.bytes,
            faststart: clip.faststart,
          })),
        })
      })().catch((error) => {
        ctx.logger?.error?.('boot-custom: manifest route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-custom: manifest route')

  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${ROUTE}/clip`,
    handler: (req, res) => {
      void (async () => {
        const absolute = resolveClip(req.url ?? '')
        if (absolute === undefined) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        try {
          await serveClip(absolute, req, res)
        } catch (error) {
          if (error?.code === 'ENOENT') {
            sendJson(res, 404, { error: 'not found' })
            return
          }
          throw error
        }
      })().catch((error) => {
        ctx.logger?.error?.('boot-custom: clip route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-custom: clip route')

  /**
   * One clip's index table moved to the front, on request — the card's 优化 button.
   */
  const optimising = new Set()
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${ROUTE}/optimize`,
    handler: (req, res) => {
      void (async () => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: '这个地址只接受 POST。' })
          return
        }
        const requested = new URL(req.url ?? '/', 'http://localhost').searchParams.get('name') ?? ''
        const name = basename(requested)
        const absolute = resolve(assetDir, name)
        if (name === '' || name !== requested
          || !VIDEO_EXTENSIONS.has(extname(name).toLowerCase())
          || !absolute.startsWith(assetDir + sep)) {
          sendJson(res, 400, { ok: false, error: '素材名不合法。' })
          return
        }
        if (optimising.has(name)) {
          sendJson(res, 409, { ok: false, error: '这一条正在处理，稍等一下再点。' })
          return
        }
        optimising.add(name)
        try {
          const result = await optimizeInPlace({
            file: absolute,
            backupDir: join(assetDir, 'originals'),
            scratchDir: join(assetDir, '.faststart-work'),
          })
          sendJson(res, 200, result)
        } finally {
          optimising.delete(name)
        }
      })().catch((error) => {
        if (res.headersSent) {
          res.end()
          return
        }
        if (error?.code === 'ENOENT') {
          sendJson(res, 404, { ok: false, error: '素材不在了。' })
          return
        }
        if (typeof error?.code === 'string' && error.code.startsWith('E_')) {
          sendJson(res, 422, { ok: false, error: error.message })
          return
        }
        ctx.logger?.error?.('boot-custom: optimize route failed', error)
        sendJson(res, 500, { ok: false, error: 'internal' })
      })
    },
  }), 'boot-custom: optimize route')

  // The one spoken line the end card says, served from a fixed path so there is
  // no traversal surface: the screen asks for `<base>/audio/welcome.m4a` and
  // gets exactly the shipped file, or a 404 that makes the screen fall back to
  // the system TTS voice. Range is honoured so the audio element can seek.
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${ROUTE}/audio/welcome.m4a`,
    handler: (req, res) => {
      void (async () => {
        try {
          await serveClip(WELCOME_AUDIO, req, res)
        } catch (error) {
          if (error?.code === 'ENOENT') {
            sendJson(res, 404, { error: 'not found' })
            return
          }
          throw error
        }
      })().catch((error) => {
        ctx.logger?.error?.('boot-custom: audio route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-custom: welcome audio route')

  // `ctx.on` already returns a disposer the fiber tracks, so it is registered
  // directly rather than wrapped in an effect — matching the other subscribers
  // of this event (ui-theme, client-modules, client-connection).
  ctx.on('webserver/index-inject', (table) => {
    const settings = currentSettings()

    // Switched off means switched off: no configuration row, no screen script,
    // no overlay, and not one request for a clip.
    if (!settings.enabled) return

    // The row reads a plain global the script fills in, so the injection stays
    // JSON-serializable data and the script itself stays a static asset.
    table.push({
      kind: 'script',
      placement: 'head',
      text: `globalThis.__DSH_BOOT_CUSTOM_CFG__=${JSON.stringify({
        base: ROUTE,
        manifest: `${ROUTE}/clips.json`,
        holdMs: 15000,
        theme: settings.theme,
        fadeMs: settings.fadeMs,
        enterMode: settings.enterMode,
        sound: settings.sound,
        clickToEnter: settings.clickToEnter,
        showHint: settings.showHint,
        voice: settings.voice,
      })}`,
    })
    table.push({ kind: 'script', placement: 'head', text: bootScreenSource() })
  })
}

/**
 * The pre-boot screen source, re-read on every index render.
 *
 * Synchronous because the injection table is collected synchronously; the file is
 * a few kilobytes and read once per page load. A missing or unreadable file must
 * not blank the boot page: the caller then serves the kernel page alone.
 * @returns the script text, or an empty string when the source cannot be read.
 */
function bootScreenSource() {
  try {
    return readFileSync(BOOT_SCREEN_PATH, 'utf8')
  } catch (error) {
    process.emitWarning(`boot-custom: cannot read ${BOOT_SCREEN_PATH}: ${String(error)}`)
    return ''
  }
}
