// Run every offline self-check and report a combined verdict.
//
//   node tools/verify-all.mjs
//
// Exit code 0 = all green, 1 = at least one failure. Pure offline, zero system
// changes (route checks use a throwaway scratch dir under the OS temp area and
// clean it up).

import { verifyScreenBasics, verifyNamespaceAgreement, verifyConfig,
  verifyClientBundle, verifyClientSourceHygiene, verifyQuotedAttributes,
  verifyPackageAndProfile, verifyScreenFile } from './verify-static.mjs'
import { verifyTiming } from './verify-timing.mjs'
import { verifyGeometry } from './verify-geometry.mjs'
import { verifyRoutes } from './verify-routes.mjs'

const groups = [
  ['static', await (async () => {
    const results = []
    for (const fn of [verifyScreenBasics, verifyNamespaceAgreement, verifyClientBundle,
      verifyClientSourceHygiene, verifyQuotedAttributes, verifyScreenFile]) {
      results.push(...fn())
    }
    results.push(...await verifyConfig())
    results.push(...verifyPackageAndProfile())
    return results
  })()],
  ['timing', await verifyTiming()],
  ['geometry', verifyGeometry()],
  ['routes', await verifyRoutes()],
]

let failed = 0
for (const [group, results] of groups) {
  console.log('\n== ' + group + ' ==')
  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL'
    if (!r.ok) failed += 1
    console.log(`  [${mark}] ${r.name}: ${r.detail}`)
  }
}

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILURE(S)'))
process.exit(failed === 0 ? 0 : 1)
