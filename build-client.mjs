// Build the client bundle artifact.
//
// The shell materializes every client bundle as a closure factory:
//
//   window.__ModuleLoader__.load({ id, factory })
//
// where `factory` is a function taking `require` and returning the module's
// `exports`. This script wraps src/client.js in that factory and writes
// lib/client.js, the file the profile's client-modules service actually loads.
//
// The shell's module table supplies `react` (and other baseline modules), so
// the wrapped source may `require('react')` without declaring it in
// package.json. Everything else must stay inside the factory.
//
// Run this after changing src/client.js. The Host side and the boot screen do
// not need rebuilding.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'src', 'client.js'), 'utf8')

const bundle = `window.__ModuleLoader__.load({ id: "dsh-boot-custom", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
${source}
return module.exports;
} });
`

writeFileSync(join(here, 'lib', 'client.js'), bundle)
console.log('lib/client.js written (' + Buffer.byteLength(bundle) + ' bytes)')
