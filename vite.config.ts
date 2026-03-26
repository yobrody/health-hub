import { defineConfig, loadEnv } from 'vite'
import type { Connect } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import type { IncomingMessage, ServerResponse } from 'http'

// Local-dev middleware: handles AI endpoints without exposing API keys to browser
// ANTHROPIC_API_KEY must be in .env (no VITE_ prefix — never exposed to frontend)
// env is passed from defineConfig so loadEnv values are available in closures
function localAiPlugin(anthropicKey: string, healthKey: string) {
  const VPS = 'http://128.140.33.150:8080'
  return {
    name: 'local-ai-endpoints',
    configureServer(server: { middlewares: Connect.Server }) {

      // POST /api/fridge/scan — receipt scanning via Claude Vision
      server.middlewares.use('/api/fridge/scan', (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Health-Key' })
          res.end(); return
        }
        if (req.method !== 'POST') { next(); return }

        if (!anthropicKey) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Set ANTHROPIC_API_KEY in .env for receipt scanning', items_added: 0 })); return
        }

        const HEALTH_KEY = healthKey

        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', async () => {
          try {
            const { image, mimeType = 'image/jpeg' } = JSON.parse(Buffer.concat(chunks).toString())

            const prompt = `This is a grocery store receipt. Extract only edible food and drink items.

Return ONLY this JSON (no other text):
{"items":["item name 1","item name 2"],"count":<number>}

Rules:
- Short simple names (e.g. "chicken breast" not "CHKN BRST 1KG BNLS", "greek yogurt" not "GREEK YOG 10%")
- INCLUDE: fresh produce, meat, fish, dairy, eggs, bread, frozen food, snacks, drinks, condiments, coffee, tea, canned/jarred food, spices
- SKIP non-food items: foil, cling film, bags, cleaning products, batteries, toiletries, paper, packaging
- SKIP: prices, totals, store name, address, dates, barcodes, receipt numbers, VAT lines
- If an item name contains "/" it may be two items — add both separately
- Max 30 items`

            const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
              body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 600,
                messages: [{ role: 'user', content: [
                  { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } },
                  { type: 'text', text: prompt },
                ]}],
              }),
            })
            const claude = await apiRes.json() as { content?: Array<{ text: string }> }
            const text = claude.content?.[0]?.text || '{"items":[]}'
            const match = text.match(/\{[\s\S]*\}/)
            const { items = [] }: { items: string[] } = JSON.parse(match?.[0] || '{"items":[]}')

            function getZone(name: string) {
              const n = name.toLowerCase()
              if (['butter','oil','sauce','mayo','mustard','ketchup','vinegar','soy','sriracha'].some(k => n.includes(k))) return 'condiments'
              if (n.includes('frozen') || n.includes('ice cream')) return 'freezer'
              if (['flour','rice','pasta','oat','bread','cereal','nuts','canned','tin','jar','chips','crackers'].some(k => n.includes(k))) return 'pantry'
              return 'fridge'
            }

            let added = 0
            await Promise.allSettled(items.map(async (name: string) => {
              const r = await fetch(`${VPS}/fridge/item`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Health-Key': HEALTH_KEY },
                body: JSON.stringify({ name, section: getZone(name) }),
              })
              if (r.ok) added++
            }))

            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
            res.end(JSON.stringify({ items_added: added, items }))
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Receipt scan failed', items_added: 0, items: [] }))
          }
        })
      })

      // POST /api/ai/analyze-food — food photo analysis
      server.middlewares.use('/api/ai/analyze-food', (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Health-Key' })
          res.end(); return
        }
        if (req.method !== 'POST') { next(); return }

        if (!anthropicKey) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Set ANTHROPIC_API_KEY in .env for local AI features' })); return
        }

        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString())
            const { image, mimeType = 'image/jpeg', description = '' } = body

            const content: unknown[] = []
            if (image) content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: image } })
            content.push({ type: 'text', text: `Analyze this food${description ? ` (described as: "${description}")` : ''}. Return ONLY JSON: {"name":"food name","kcal":N,"protein_g":N,"carbs_g":N,"fat_g":N,"description":"brief description","confidence":"high"|"medium"|"low"}` })

            const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
              body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 300, messages: [{ role: 'user', content }] }),
            })
            const claude = await apiRes.json() as { content?: Array<{ text: string }> }
            const text = claude.content?.[0]?.text || '{}'
            const match = text.match(/\{[\s\S]*\}/)
            const result = JSON.parse(match?.[0] || '{}')
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
            res.end(JSON.stringify(result))
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ name: 'Unknown', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, description: 'Analysis failed', confidence: 'low' }))
          }
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load ALL env vars (including non-VITE_ ones) and pass them into plugins via closure
  // loadEnv returns an object but does NOT populate process.env — use the returned object directly
  const env = loadEnv(mode, process.cwd(), '')
  const anthropicKey = env.ANTHROPIC_API_KEY || ''
  const healthKey = env.VITE_API_KEY || 'brody-health-hub-2026'

  return {
    plugins: [
      react(),
      localAiPlugin(anthropicKey, healthKey),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          name: 'Health Hub',
          short_name: 'Health',
          description: "Brody's personal health tracker",
          theme_color: '#ffffff',
          background_color: '#f2f2f7',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          runtimeCaching: [
            {
              urlPattern: /\/api\/today/,
              handler: 'NetworkFirst',
              options: { cacheName: 'api-today', expiration: { maxAgeSeconds: 60 } },
            },
          ],
        },
      }),
    ],
    server: {
      port: 3000,
      proxy: {
        // All /api/* → VPS (localAiPlugin middleware intercepts /api/ai/analyze-food first)
        '/api': {
          target: 'http://128.140.33.150:8080',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('X-Health-Key', process.env.VITE_API_KEY || 'brody-health-hub-2026')
            })
            proxy.on('error', (err, _req, res) => {
              console.error('[proxy error]', err.message)
              if ('writeHead' in res) {
                (res as ServerResponse).writeHead(502, { 'Content-Type': 'application/json' })
                ;(res as ServerResponse).end(JSON.stringify({ error: 'Backend unreachable' }))
              }
            })
          },
        },
      },
    },
  }
})
