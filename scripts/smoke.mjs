#!/usr/bin/env node
// Dependency-free headless smoke test. Drives the locally-installed Edge over
// the Chrome DevTools Protocol (raw WebSocket — no puppeteer) to verify the
// production build actually boots in a real browser:
//   • React mounted        (#root has children)
//   • page rendered text    (body isn't blank)
//   • no console errors / uncaught exceptions
//   • writes a screenshot   (scripts/.smoke/<name>.png) to eyeball
//
// Usage:  node scripts/smoke.mjs <url> [screenshotName] [waitMs]
// Example: node scripts/smoke.mjs http://localhost:4173/ boot 4000
//
// Exit code 0 = healthy, 1 = a check failed (so it can gate CI / merges).
// Requires Node 18+ (global fetch) and Node 22+ (global WebSocket); Node 24 ok.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import os from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '.smoke')

const url = process.argv[2] || 'http://localhost:4173/'
const name = process.argv[3] || 'smoke'
const waitMs = Number(process.argv[4] || 4000)
const PORT = 9222 + Math.floor(Math.random() * 500)
const VIEWPORT = { width: 390, height: 844 } // iPhone-ish, matches the PWA's target

function findEdge() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/microsoft-edge',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]
  return candidates.find(p => existsSync(p))
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function getJson(path) {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`)
  return r.json()
}

// Minimal CDP client over a single page target's WebSocket.
function cdp(ws) {
  let id = 0
  const pending = new Map()
  const listeners = []
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    } else if (msg.method) {
      for (const fn of listeners) fn(msg)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = ++id
      pending.set(myId, { resolve, reject })
      ws.send(JSON.stringify({ id: myId, method, params }))
    })
  const on = fn => listeners.push(fn)
  return { send, on }
}

async function main() {
  const edge = findEdge()
  if (!edge) {
    console.error(JSON.stringify({ ok: false, error: 'Microsoft Edge not found' }))
    process.exit(1)
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const profile = join(os.tmpdir(), `hh-smoke-${Date.now()}`)

  const proc = spawn(edge, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-extensions', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    'about:blank',
  ], { stdio: 'ignore' })

  const cleanup = () => { try { proc.kill() } catch { /* ignore */ } }
  process.on('exit', cleanup)

  // Wait for the debugging endpoint to come up.
  let version = null
  for (let i = 0; i < 40; i++) {
    try { version = await getJson('/json/version'); break } catch { await sleep(250) }
  }
  if (!version) { console.error(JSON.stringify({ ok: false, error: 'Edge devtools endpoint never came up' })); cleanup(); process.exit(1) }

  const targets = await getJson('/json/list')
  const page = targets.find(t => t.type === 'page')
  if (!page) { console.error(JSON.stringify({ ok: false, error: 'no page target' })); cleanup(); process.exit(1) }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  const { send, on } = cdp(ws)

  const consoleErrors = []
  on(msg => {
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params?.exceptionDetails?.exception?.description || 'uncaught exception')
    } else if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
      consoleErrors.push(msg.params.entry.text)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      consoleErrors.push((msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' '))
    }
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 2, mobile: true })

  const loaded = new Promise(res => on(m => { if (m.method === 'Page.loadEventFired') res() }))
  await send('Page.navigate', { url })
  await Promise.race([loaded, sleep(8000)])
  await sleep(waitMs) // let React mount + first data paint

  const mount = await send('Runtime.evaluate', {
    expression: `(() => {
      const root = document.getElementById('root')
      return JSON.stringify({
        rootChildren: root ? root.childElementCount : -1,
        bodyTextLen: (document.body.innerText || '').trim().length,
        title: document.title,
      })
    })()`,
    returnByValue: true,
  })
  const info = JSON.parse(mount.result.value)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const shotPath = join(OUT_DIR, `${name}.png`)
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))

  // Ignore noisy non-fatal errors (favicon, manifest, blocked /api in preview).
  const fatal = consoleErrors.filter(e =>
    !/favicon|manifest|404|Failed to load resource|net::ERR|api\//i.test(e))

  const mounted = info.rootChildren > 0 && info.bodyTextLen > 0
  const ok = mounted && fatal.length === 0

  console.log(JSON.stringify({
    ok, url, mounted, ...info,
    screenshot: shotPath,
    consoleErrorCount: consoleErrors.length,
    fatalErrors: fatal.slice(0, 8),
  }, null, 2))

  cleanup()
  process.exit(ok ? 0 : 1)
}

main().catch(e => { console.error(JSON.stringify({ ok: false, error: String(e) })); process.exit(1) })
