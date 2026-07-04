import { defineConfig, loadEnv } from 'vite'
import type { Connect } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import type { IncomingMessage, ServerResponse } from 'http'

// Local-dev middleware: handles AI endpoints without exposing API keys to browser.
// GEMINI_API_KEY must be in .env (no VITE_ prefix — never exposed to frontend).
// Items returned from /api/fridge/scan are NOT added to the VPS server-side here
// (matches prod Pages Function behavior); the frontend iterates /api/fridge/item
// for each item, which gives the user a confirm step.
//
// Migrated 2026-05-05 from Anthropic to Google AI Studio (gemini-2.5-flash) so
// dev parity with prod and zero Anthropic-API spend on personal use.
async function callGeminiVision(apiKey: string, prompt: string, imageBase64: string, mimeType: string, maxTokens: number) {
  if (!apiKey) return { ok: false as const, status: 503, error: 'GEMINI_API_KEY not configured' }
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
          { text: prompt },
        ]}],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: maxTokens,
          // Disable 2.5-flash hidden thinking so the budget goes to output.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    })
    if (!r.ok) return { ok: false as const, status: r.status, error: (await r.text()).slice(0, 300) }
    const data = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    if (!text) return { ok: false as const, status: 502, error: 'empty response' }
    return { ok: true as const, text }
  } catch (e) {
    return { ok: false as const, status: 502, error: String(e) }
  }
}

function localAiPlugin(geminiKey: string) {
  return {
    name: 'local-ai-endpoints',
    configureServer(server: { middlewares: Connect.Server }) {

      // POST /api/fridge/scan — receipt scanning via Gemini 2.5 Flash (free tier).
      // Dev middleware kept in sync with the prod Cloudflare Pages Function
      // (functions/api/fridge/scan.js): same JSON contract in, same shape out.
      server.middlewares.use('/api/fridge/scan', (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Health-Key' })
          res.end(); return
        }
        if (req.method !== 'POST') { next(); return }

        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', async () => {
          try {
            const { image, mimeType = 'image/jpeg' } = JSON.parse(Buffer.concat(chunks).toString())

            const prompt = `Look at this grocery store receipt. Extract the purchased food and drink items.

Return ONLY valid JSON, no markdown or explanation:
{"store":{"name":"store name","location":"address/area or null"},"items":[{"name":"readable name","unit_size_g":340,"unit_count":null,"size":"340g","cost":1.89,"section":"fridge"}]}

Rules:
- name: clean readable name (e.g. "greek yogurt" not "GREEK YOG 10%")
- unit_size_g: pack size in grams as a NUMBER ("340g" → 340, "1kg" → 1000, "1.5L" → 1500). null if not weight-based.
- unit_count: discrete count if more natural (eggs: 6/12, apples: 4). null otherwise.
- size: human-readable "340g" / "1L" / "12 eggs" — null if not shown.
- cost: number — null if not visible
- section: one of "fridge", "freezer", "pantry", "condiments"
  - fridge: dairy, fresh produce, eggs, meat/fish, yogurt, juice
  - freezer: frozen meals, ice cream, frozen veg/meat
  - pantry: canned, dry goods, snacks, coffee, tea, bread, nuts, spreads, chocolate
  - condiments: sauces, oils, vinegar, dressings, spices
- INCLUDE all food and drink items
- SKIP non-food (foil, bags, cleaning, toiletries), totals, VAT, discounts, header rows
- If a name contains "/" add both as separate items`

            const r = await callGeminiVision(geminiKey, prompt, image, mimeType, 2000)
            if (!r.ok) {
              res.writeHead(r.status === 503 ? 503 : 502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: `AI error ${r.status}: ${r.error.slice(0, 150)}`, items: [], store: null })); return
            }
            type RawScanned = { name?: string; section?: string; unit_size_g?: number; unit_count?: number; size?: string; cost?: number }
            const parsed = JSON.parse(r.text) as { items?: RawScanned[]; store?: { name?: string; location?: string | null } | null }
            const validSections = new Set(['fridge', 'freezer', 'pantry', 'condiments'])
            const items = (parsed.items ?? [])
              .filter((i) => i?.name)
              .map((i) => ({
                name: String(i.name).toLowerCase().trim(),
                size: i.size ?? (typeof i.unit_size_g === 'number' ? `${i.unit_size_g}g` : null),
                unit_size_g: typeof i.unit_size_g === 'number' && i.unit_size_g > 0 ? i.unit_size_g : null,
                unit_count: typeof i.unit_count === 'number' && Number.isInteger(i.unit_count) && i.unit_count > 0 ? i.unit_count : null,
                cost: typeof i.cost === 'number' ? i.cost : null,
                section: i.section && validSections.has(i.section) ? i.section : 'fridge',
              }))

            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
            res.end(JSON.stringify({ items, store: parsed.store ?? null }))
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Receipt scan failed: ' + String(e), items: [], store: null }))
          }
        })
      })

      // POST /api/ai/act — natural-language assistant. Mirrors the prod CF
      // function so dev gets the same parsed JSON without round-tripping
      // to the live preview deployment.
      server.middlewares.use('/api/ai/act', (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Health-Key' })
          res.end(); return
        }
        if (req.method !== 'POST') { next(); return }
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', async () => {
          try {
            const { prompt = '' } = JSON.parse(Buffer.concat(chunks).toString()) as { prompt?: string }
            const cleaned = String(prompt).trim().slice(0, 600)
            if (!cleaned) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'prompt required', actions: [], summary: '' })); return
            }
            const hour = new Date().getHours()
            const meal = hour < 11 ? 'Breakfast' : hour < 15 ? 'Lunch' : hour < 18 ? 'Snack' : 'Dinner'
            const sysPrompt = `You translate one short message about the user's day into structured actions for a personal health app.\n\nAvailable action types:\n1. log_food — { name, count?, kcal, protein_g, carbs_g, fat_g, fiber_g?, sugar_g?, sodium_mg?, meal?, date? }\n   Always include carbs_g and fat_g. Add sugar_g (grams) and sodium_mg for notably sweet/salty/processed foods.\n2. add_fridge — { name, section, store?, size?, unit_size_g?, unit_count?, cost? }\n3. log_water — { count } (glasses, 1-12)\n4. mark_routine — { name: meditate|vitamins|journal|read|stretch }\n5. add_agenda — { title, priority?: low|normal|urgent }\n6. add_list_item — { list: groceries|errands|shopping, text }\n\nReturn ONLY: {"actions": [...], "summary": "one short past-tense confirmation"}\n\nDefault meal if not stated: "${meal}".\n\nUser: "${cleaned.replace(/"/g, '\\"')}"`
            const apiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: sysPrompt }] }],
                generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } },
              }),
            })
            if (!apiRes.ok) {
              const errTxt = await apiRes.text()
              res.writeHead(502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: `AI error ${apiRes.status}`, detail: errTxt.slice(0, 150), actions: [], summary: '' })); return
            }
            const data = await apiRes.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
            let parsed: { actions?: unknown[]; summary?: string } = {}
            try { parsed = JSON.parse(text) }
            catch { res.writeHead(422, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'parse', actions: [], summary: '' })); return }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, summary: parsed.summary ?? '', actions: parsed.actions ?? [] }))
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: String(e), actions: [], summary: '' }))
          }
        })
      })

      // POST /api/ai/analyze-food — food photo analysis
      // POST /api/ai/analyze-food — multi-item food analysis with home/out modes.
      // Mirrors functions/api/ai/analyze-food.js. Home mode cross-references the
      // user's fridge inventory and returns per-item grams_used so the camera
      // flow can decrement quantity_g; Out mode returns macros only.
      server.middlewares.use('/api/ai/analyze-food', (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Health-Key' })
          res.end(); return
        }
        if (req.method !== 'POST') { next(); return }

        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', async () => {
          type FridgeShape = { fridge?: unknown[]; freezer?: unknown[]; pantry?: unknown[]; condiments?: unknown[] }
          type IncomingItem = { name?: string; [k: string]: unknown }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as {
              image?: string; mimeType?: string; description?: string;
              mode?: 'home' | 'out'; fridge?: FridgeShape | IncomingItem[] | null
            }
            const { image, mimeType = 'image/jpeg', description = '', fridge = null } = body

            // Flatten fridge for the prompt — accept both FridgeData object and flat array.
            const fridgeItems: Array<IncomingItem & { zone: string }> = []
            if (fridge && !Array.isArray(fridge)) {
              for (const zone of ['fridge', 'freezer', 'pantry', 'condiments'] as const) {
                const zoneItems = (fridge as FridgeShape)[zone]
                if (Array.isArray(zoneItems)) {
                  for (const it of zoneItems) fridgeItems.push({ ...(it as IncomingItem), zone })
                }
              }
            } else if (Array.isArray(fridge)) {
              for (const it of fridge) fridgeItems.push({ ...it, zone: 'fridge' })
            }
            const fridgeNames = fridgeItems.map(it => it.name).filter(Boolean) as string[]

            // Mode inference: explicit > fridge presence > out fallback. Same as prod.
            const effectiveMode: 'home' | 'out' =
              body.mode === 'home' || body.mode === 'out'
                ? body.mode
                : (fridgeItems.length > 0 ? 'home' : 'out')

            const homePrompt = `Analyze this home-made meal photo${description ? ` (user says: "${description}")` : ''}.
Identify ALL distinct food items. Estimate realistic nutrition AND grams for the visible portion of each item.
${fridgeNames.length ? `User's fridge/pantry contents: ${fridgeNames.join(', ')}` : 'No fridge inventory provided.'}
For each food on the plate that appears to come from the fridge list, also estimate how many grams of that fridge item were used.

Return ONLY valid JSON, no markdown:
{"foods":[{"name":"...","kcal":N,"protein_g":N,"carbs_g":N,"fat_g":N,"grams":N}],"fridge_matches":[{"name":"<exact fridge name>","grams_used":N}],"confidence":"high|medium|low"}

Rules:
- grams: visible portion weight in grams
- fridge_matches names must exactly match the fridge list (case-insensitive)
- grams_used: estimated raw/dry grams used (a 150g cooked chicken portion ≈ 200g raw)`

            const outPrompt = `Analyze this restaurant / takeaway food photo${description ? ` (user says: "${description}")` : ''}.
This was NOT made from the user's fridge — they're eating out. Identify all distinct items, estimate realistic nutrition + grams.

Return ONLY valid JSON, no markdown:
{"foods":[{"name":"...","kcal":N,"protein_g":N,"carbs_g":N,"fat_g":N,"grams":N}],"confidence":"high|medium|low"}

Rules:
- grams: total weight as served
- be realistic about restaurant portions (often larger than home)`

            const promptText = effectiveMode === 'home' ? homePrompt : outPrompt

            if (!image) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'No image provided', foods: [], fridge_matches: [], confidence: 'low' })); return
            }
            const r = await callGeminiVision(geminiKey, promptText, image, mimeType, 800)
            if (!r.ok) {
              res.writeHead(r.status === 503 ? 503 : 502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: `AI error ${r.status}: ${r.error.slice(0, 150)}`, foods: [], fridge_matches: [], confidence: 'low' })); return
            }
            type RawResult = { foods?: unknown[]; fridge_matches?: unknown[]; confidence?: string }
            const result = JSON.parse(r.text) as RawResult

            // Resolve fridge_matches names back to full item objects (home mode only)
            let fridgeMatches: Array<IncomingItem & { zone: string; grams_used: number | null }> = []
            if (effectiveMode === 'home' && Array.isArray(result.fridge_matches)) {
              fridgeMatches = (result.fridge_matches as Array<unknown>)
                .map((entry) => {
                  const nameVal = typeof entry === 'string' ? entry : (entry as { name?: string })?.name
                  const grams = typeof entry === 'object' && entry !== null && typeof (entry as { grams_used?: unknown }).grams_used === 'number'
                    ? (entry as { grams_used: number }).grams_used : null
                  if (!nameVal) return null
                  const item = fridgeItems.find(it =>
                    typeof it.name === 'string' && (
                      it.name.toLowerCase().includes(nameVal.toLowerCase()) ||
                      nameVal.toLowerCase().includes(it.name.toLowerCase())
                    )
                  )
                  if (!item) return null
                  return { ...item, grams_used: grams }
                })
                .filter((x): x is IncomingItem & { zone: string; grams_used: number | null } => x !== null)
            }

            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
            res.end(JSON.stringify({
              mode: effectiveMode,
              foods: Array.isArray(result.foods) ? result.foods : [],
              fridge_matches: fridgeMatches,
              confidence: typeof result.confidence === 'string' ? result.confidence : 'medium',
            }))
          } catch {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ mode: 'out', foods: [], fridge_matches: [], confidence: 'low' }))
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
  const geminiKey = env.GEMINI_API_KEY || ''
  const healthKey = env.VITE_API_KEY || 'brody-health-hub-2026'

  return {
    plugins: [
      react(),
      tailwindcss(),
      localAiPlugin(geminiKey),
      VitePWA({
        // 'autoUpdate' silently swaps the SW + assets. Combined with
        // skipWaiting + clientsClaim and a controllerchange listener in
        // main.tsx that reloads the page when the new SW takes control,
        // this is the closest we can get to "deploy lands instantly on
        // every open client" — including iOS PWAs which would otherwise
        // hold stale assets indefinitely. <UpdatePrompt /> stays mounted
        // as belt-and-suspenders if the auto-flow somehow misses.
        registerType: 'autoUpdate',
        // false because UpdatePrompt registers via virtual:pwa-register/react;
        // 'auto' would inject a second basic registration that races.
        injectRegister: false,
        includeAssets: ['icon.svg', 'maskable-icon.svg'],
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
            // Audit P2-13: include rasterized 192/512 PNGs alongside SVGs.
            // iOS/Android prefer raster for home-screen install quality;
            // SVG is the canonical source.
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
            { src: 'maskable-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        workbox: {
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
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
    build: {
      // Split heavy, rarely-changing vendor libs into their own cached chunk.
      // Keeps the app shell + portal transitions in the main bundle (no lazy
      // page loading), so navigation/animations are untouched while repeat
      // visits skip re-downloading vendor code. Safe perf win.
      rollupOptions: {
        output: {
          // Function form (not object) so each library is grouped WITH its
          // transitive deps — the object form left react/recharts/spring as
          // empty 0kB chunks because they share react and got hoisted.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return
            if (id.includes('@zxing')) return 'vendor-scan'           // barcode scanner — heaviest, not needed on most pages
            if (id.includes('@dnd-kit')) return 'vendor-dnd'          // drag-drop (shopping list)
            if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory')) return 'vendor-charts'
            if (id.includes('react') || id.includes('/scheduler/')) return 'vendor-react' // react, react-dom, react-spring
          },
        },
      },
    },
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
              proxyReq.setHeader('X-Health-Key', healthKey)
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
