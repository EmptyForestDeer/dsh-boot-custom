// Installation rehearsal: prove the plugin resolves the way the real loader
// will resolve it, WITHOUT touching the live profile.
//
// This is the offline equivalent of "what happens after the user restarts":
//   - the profile's package.json declares the bundle (link:)
//   - the profile's node_modules contains the junction
//   - the bundle's cordis.patch.yml parses and inserts exactly one row with id
//     boot-custom
//   - entry.js imports (schemastery resolves through the junction's
//     node_modules)
//   - lib/client.js exists and is a __ModuleLoader__ factory
//   - the assets/videos dir exists (may be empty)
//
// It deliberately does NOT run the kernel's own loadProfileDirectory (that
// needs the full cordis stack and a live DSH_HOME); it checks the same facts
// the loader's own composition depends on, and the static suite already
// verified Config/namespace/routes against the real modules.

import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const profile = resolve(root, '..', '..', 'dsh-home', 'profiles', 'desktop')

const results = []
const check = (ok, name, detail) => results.push({ ok, name, detail })

// 1. profile declares the bundle exactly once
{
  const pkg = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  const dep = pkg.dependencies && pkg.dependencies['dsh-boot-custom']
  check(typeof dep === 'string' && dep.startsWith('link:'), 'profile dependency declared',
    dep || 'missing')
  const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
  const count = bundles.filter(b => b === 'dsh-boot-custom').length
  check(count === 1, 'profile bundles lists exactly once', String(count))
}

// 2. the junction exists in profile node_modules
{
  const link = join(profile, 'node_modules', 'dsh-boot-custom')
  const ok = existsSync(link) && (statSync(link).isSymbolicLink() || (statSync(link).isDirectory()))
  check(ok, 'profile node_modules junction', link)
}

// 3. the bundle's patch parses and inserts exactly one row with the right id
{
  const patchPath = join(root, 'cordis.patch.yml')
  const text = readFileSync(patchPath, 'utf8')
  // This package's patch is a fixed, tiny format (one `- insert:` block with
  // exactly one row); parse it by exact line matching rather than pulling in a
  // YAML dependency into the plugin tree.
  const insertBlocks = text.split(/\n(?=- insert:)/).filter(block => block.trim().startsWith('- insert:'))
  const rows = insertBlocks.flatMap((block) => block
    .split(/\n/)
    .filter(line => /^\s+- id:/.test(line))
    .map(line => line.replace(/^\s+- id:\s*/, '').trim()))
  const bootRows = rows.filter(id => id === 'boot-custom')
  // Also confirm the row's name line exists right after the id.
  const hasName = /- id: boot-custom\s*\n\s+name: dsh-boot-custom/.test(text)
  check(bootRows.length === 1 && hasName, 'patch inserts exactly one boot-custom row',
    String(bootRows.length) + (hasName ? ' (name ok)' : ' (name missing)'))
}

// 4. entry.js imports (schemastery resolves)
{
  let ok = false
  let detail = ''
  try {
    const spec = await import(pathToFileURL(join(root, 'entry.js')).href)
    ok = typeof spec.apply === 'function' && spec.Config !== undefined
    detail = 'apply+Config resolved'
  } catch (e) {
    detail = String(e && e.message ? e.message : e)
  }
  check(ok, 'entry.js resolves with schemastery', detail)
}

// 5. lib/client.js exists and is a factory
{
  const client = join(root, 'lib', 'client.js')
  const ok = existsSync(client) && readFileSync(client, 'utf8').includes('window.__ModuleLoader__.load')
  check(ok, 'client bundle is a factory', existsSync(client) ? 'present' : 'missing')
}

// 6. assets/videos exists
{
  const dir = join(root, 'assets', 'videos')
  check(existsSync(dir) && statSync(dir).isDirectory(), 'assets/videos exists', dir)
}

// 7. exports map resolves the client path the loader will ask for
{
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const clientExport = pkg.exports && pkg.exports['./client'] && pkg.exports['./client'].default
  const ok = clientExport === './lib/client.js' && existsSync(join(root, 'lib', 'client.js'))
  check(ok, 'exports["./client"] resolves', clientExport || 'missing')
}

let failed = 0
console.log('== installation rehearsal ==')
for (const r of results) {
  if (!r.ok) failed += 1
  console.log(`  [${r.ok ? 'PASS' : 'FAIL'}] ${r.name}: ${r.detail}`)
}
console.log(failed === 0 ? 'ALL PASS' : failed + ' FAILURE(S)')
process.exit(failed === 0 ? 0 : 1)
