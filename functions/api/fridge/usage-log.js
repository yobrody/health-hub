/**
 * Cloudflare Pages Function - POST /api/fridge/usage-log
 * Body: { item_name, zone, date_added }
 * Logs fridge item consumption to Airtable and updates KV shelf-life history.
 * Returns: { ok: true, avg_days, sample_count }
 */
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Health-Key',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS })
}

const ZONE_DEFAULTS = { fridge: 7, freezer: 90, pantry: 180, condiments: 365 }

export async function onRequestPost(context) {
  const kv = context.env.FRIDGE_META
  const atKey = context.env.AIRTABLE_API_KEY
  const atBase = context.env.AIRTABLE_BASE_ID
  const atTable = context.env.AIRTABLE_TABLE_ID

  let body
  try { body = await context.request.json() }
  catch { return json({ error: 'Invalid body' }, 400) }

  const { item_name, zone = 'fridge', date_added = null } = body
  if (!item_name) return json({ error: 'item_name required' }, 400)

  const now = new Date()
  const dateConsumed = now.toISOString().slice(0, 10)
  const zoneDefault = ZONE_DEFAULTS[zone] || 7

  let daysInFridge = 0
  if (date_added) {
    try {
      // date_added may be "MMM D" or ISO format — try both
      const added = new Date(date_added)
      if (!isNaN(added.getTime())) {
        daysInFridge = Math.round((now - added) / 86400000)
      }
    } catch {}
  }

  const variance = daysInFridge - zoneDefault

  // 1. Write to Airtable (non-fatal if missing)
  if (atKey && atBase && atTable) {
    try {
      await fetch(`https://api.airtable.com/v0/${atBase}/${atTable}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${atKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          records: [{
            fields: {
              'Date Consumed': dateConsumed,
              'Item': item_name,
              'Zone': zone,
              'Days in Fridge': daysInFridge,
              'Zone Default': zoneDefault,
              'Variance': variance,
            },
          }],
        }),
      })
    } catch (e) {
      console.error('Airtable write failed:', e)
    }
  }

  // 2. Update KV usage history for dynamic shelf-life learning
  let avgDays = zoneDefault
  let sampleCount = 0

  if (kv && daysInFridge > 0) {
    try {
      const kvKey = `usage:${item_name.toLowerCase().trim()}`
      const existing = await kv.get(kvKey)
      const history = existing ? JSON.parse(existing) : []
      history.push({ days: daysInFridge, date: dateConsumed })
      const kept = history.slice(-50) // rolling 50 entries
      avgDays = Math.round(kept.reduce((a, e) => a + e.days, 0) / kept.length)
      sampleCount = kept.length
      await kv.put(kvKey, JSON.stringify(kept))
    } catch (e) {
      console.error('KV usage update failed:', e)
    }
  }

  return json({ ok: true, avg_days: avgDays, sample_count: sampleCount })
}
