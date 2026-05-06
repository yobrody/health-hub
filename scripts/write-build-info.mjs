// Tiny prebuild step: write src/build-info.ts with the current git sha +
// build date so the app can render "build abc1234 · 2026-05-07" inline.
// Lets the user (and the dev) confirm at a glance which version they're
// looking at — handy when iOS PWAs hold stale assets.
//
// Cross-platform (works on Windows, Linux, macOS, CF Pages workers).
// Falls back to 'dev' if git isn't available (e.g. zip-archive build).
// Uses execFileSync (not execSync) so no shell is involved — no injection
// surface even though the args here are static literals.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

let sha = 'dev'
try {
  sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString().trim()
} catch { /* not a git checkout — leave 'dev' */ }

const date = new Date().toISOString().slice(0, 10)

const out = `// Auto-generated at build time. Do not edit by hand.
export const BUILD_SHA = ${JSON.stringify(sha)}
export const BUILD_DATE = ${JSON.stringify(date)}
`

writeFileSync('src/build-info.ts', out, 'utf8')
console.log(`[build-info] sha=${sha} date=${date}`)
