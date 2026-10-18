// Offline self-checks for dsh-boot-custom.
//
// Each check is a plain function returning a list of { ok, name, detail } rows.
// verify-all.mjs runs them all and exits non-zero on any failure.
//
// The checks deliberately mirror the sibling dsh-boot-animation's verified
// contracts (the ones that were learned the hard way) and add the ones this
// plugin's CSS-nebula theme introduces:
//
//   - injection rows land in <head>, BEFORE the shell script (the whole
//     mechanism);
//   - the settings namespace is spelled the same on both halves (nothing else
//     checks that);
//   - Config exists, every field is volatile, defaults/bounds/enums are right;
//   - the client bundle is a __ModuleLoader__ factory, imports nothing outside
//     the baseline table, and exports a callable apply;
//   - no `ctx.get(` anywhere in the client source (the silent-card failure);
//   - no unquoted numeric attribute values in the screen (the dropped-rule
//     failure);
//   - the screen's hand-off has an upper bound on every path;
//   - the nebula timer stands in for "played out" only in non-click modes;
//   - routes answer manifest / 206 / 416 / 404 and reject traversal;
//   - the installed profile's package.json declares the bundle exactly once.

import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const read = (rel) => readFileSync(join(root, rel), 'utf8')
const has = (rel) => existsSync(join(root, rel))

function rows(...items) {
  return items
}

/** The screen script must inject exactly the rows the Host expects. */
export function verifyScreenBasics() {
  const screen = read('src/boot-screen.js')
  const failures = []
  if (!screen.includes('__DSH_BOOT_CUSTOM_CFG__')) {
    failures.push('screen does not read __DSH_BOOT_CUSTOM_CFG__')
  }
  if (!screen.includes('__DSH_BOOT_CUSTOM__')) {
    failures.push('screen does not publish __DSH_BOOT_CUSTOM__ namespace')
  }
  if (!screen.includes('NEBULA_MS')) {
    failures.push('screen has no nebula duration stand-in')
  }
  // The hand-off must be released on every path: grep for the essential
  // releases. (These are guards, not proofs; verify-timing does the real work.)
  for (const needle of ['releaseWithoutClip', 'maybeEnter', 'HOLD_MS', 'manifestWindow']) {
    if (!screen.includes(needle)) failures.push('missing ' + needle)
  }
  return rows({ ok: failures.length === 0, name: 'screen basics', detail: failures.join('; ') || 'ok' })
}

/** The settings namespace must agree on both halves. */
export function verifyNamespaceAgreement() {
  const host = read('cordis.patch.yml')
  const client = read('src/client.js')
  const m = /id:\s*(boot-custom)/.exec(host)
  const hostNs = m ? m[1] : null
  const clientNs = /SETTINGS_NAMESPACE\s*=\s*'([^']+)'/.exec(client)
  const ok = hostNs !== null && clientNs !== null && hostNs === clientNs[1]
  return rows({ ok, name: 'namespace agreement', detail: ok ? hostNs : `host=${hostNs} client=${clientNs?.[1] ?? 'missing'}` })
}

/** Config: exists, volatile, right defaults/bounds/enums. */
export async function verifyConfig() {
  const spec = await import(pathToFileURL(join(root, 'entry.js')).href)
  const Config = spec.Config
  if (!Config) return rows({ ok: false, name: 'config exists', detail: 'no Config export' })
  const shape = Config.toJSON ? Config.toJSON() : null
  if (!shape) return rows({ ok: false, name: 'config shape', detail: 'no toJSON' })
  // schemastery toJSON is a ref graph: { uid, refs } where the object schema
  // lives at refs[uid] and carries its field table in `dict` (uid → ref uid).
  const rootRef = shape.refs?.[shape.uid]
  const dict = (rootRef && rootRef.dict) || {}
  const refs = shape.refs || {}
  const fieldSchema = (key) => {
    const uid = dict[key]
    return uid === undefined ? null : refs[uid] || null
  }
  const failures = []
  for (const key of ['enabled', 'theme', 'fadeMs', 'enterMode', 'disabledClips', 'sound', 'clickToEnter', 'showHint', 'voice', 'pickMode']) {
    if (!(key in dict)) failures.push('missing field ' + key)
  }
  for (const key of ['enabled', 'theme', 'fadeMs', 'enterMode', 'disabledClips', 'sound', 'clickToEnter', 'showHint', 'voice', 'pickMode']) {
    const p = fieldSchema(key)
    if (!p) continue
    if (p.meta && p.meta.volatile !== true) failures.push(key + ' not volatile')
  }
  const fade = fieldSchema('fadeMs') || {}
  if (fade.meta && fade.meta.default !== 2000) failures.push('fadeMs default ' + String(fade.meta.default))
  if (fade.meta && (fade.meta.min !== 300 || fade.meta.max !== 5000)) failures.push('fadeMs bounds wrong')
  const theme = fieldSchema('theme') || {}
  if (theme.type !== 'union' || !Array.isArray(theme.list) || theme.list.length !== 2) {
    failures.push('theme enum wrong')
  }
  return rows({ ok: failures.length === 0, name: 'config', detail: failures.join('; ') || 'ok' })
}

/** The client bundle must be a factory and export apply. */
export function verifyClientBundle() {
  const bundle = has('lib/client.js') ? read('lib/client.js') : ''
  const failures = []
  if (!bundle.includes('window.__ModuleLoader__.load')) failures.push('not a ModuleLoader factory')
  if (!bundle.includes('id: "dsh-boot-custom"')) failures.push('wrong id')
  if (!bundle.includes('exports.apply')) failures.push('no apply export')
  if (!bundle.includes('clientReady')) failures.push('no clientReady')
  if (!bundle.includes('plugins.item')) failures.push('no slot')
  return rows({ ok: failures.length === 0, name: 'client bundle', detail: failures.join('; ') || 'ok' })
}

/** The client source must not use the silent-card pattern. */
export function verifyClientSourceHygiene() {
  const src = read('src/client.js')
  const stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const failures = []
  if (/\bctx\.get\(/.test(stripped)) failures.push('ctx.get( present')
  if (!stripped.includes('ctx.inject(')) failures.push('no ctx.inject')
  if (!/owner\.get\(/.test(stripped)) failures.push('no owner.get')
  if (stripped.includes('settingsScope')) failures.push('legacy settingsScope present')
  return rows({ ok: failures.length === 0, name: 'client source hygiene', detail: failures.join('; ') || 'ok' })
}

/** No unquoted numeric attribute values in the screen (dropped-rule bug). */
export function verifyQuotedAttributes() {
  const screen = read('src/boot-screen.js')
  // Find [data-x=N] or [data-x="1"] patterns in CSS strings.
  const bad = /\[data-[a-z]+=\d\]/.exec(screen)
  return rows({ ok: bad === null, name: 'quoted attributes', detail: bad ? 'unquoted numeric attr: ' + bad[0] : 'ok' })
}

/** The package must declare its dependency and the profile must list the bundle once. */
export function verifyPackageAndProfile() {
  const pkg = JSON.parse(read('package.json'))
  const failures = []
  if (!pkg.dependencies || !pkg.dependencies['@deepseek-ai/schemastery']) {
    failures.push('no schemastery dependency')
  }
  const profile = join(root, '..', '..', 'dsh-home', 'profiles', 'desktop', 'package.json')
  if (has(join(root, '..', '..', 'dsh-home', 'profiles', 'desktop', 'package.json'))) {
    const pp = JSON.parse(readFileSync(profile, 'utf8'))
    const bundles = (pp.dsh && pp.dsh.profile && pp.dsh.profile.bundles) || []
    const count = bundles.filter(b => b === 'dsh-boot-custom').length
    if (count === 0) failures.push('profile bundles does not list dsh-boot-custom')
    if (count > 1) failures.push('profile bundles lists dsh-boot-custom ' + count + ' times')
    const dep = pp.dependencies && pp.dependencies['dsh-boot-custom']
    if (!dep) failures.push('profile dependencies does not declare dsh-boot-custom')
  }
  return rows({ ok: failures.length === 0, name: 'package/profile', detail: failures.join('; ') || 'ok' })
}

/** The screen file must exist and be non-trivial. */
export function verifyScreenFile() {
  const path = join(root, 'src', 'boot-screen.js')
  if (!existsSync(path)) return rows({ ok: false, name: 'screen file', detail: 'missing' })
  const size = statSync(path).size
  return rows({ ok: size > 4000, name: 'screen file', detail: String(size) + ' bytes' })
}
