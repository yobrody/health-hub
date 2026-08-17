// Detect when an API GET was served from the service-worker cache (stale) vs
// freshly from the network. Workbox's NetworkFirst falls back to cache on a slow
// or failed request and returns a 200, so the fetch layer can't otherwise tell —
// which means month-old data can be shown as if live. A cached Response keeps the
// `Date` header from when it was stored, so an old Date ⇒ served from cache.
//
// We self-calibrate for client/server clock skew: track the SMALLEST observed
// gap (clientNow − serverDate), which comes from genuinely-fresh responses and
// approximates the skew. A response whose gap exceeds that baseline by more than
// STALE_THRESHOLD_MS is stale. (generateSW can't inject a custom cache-stamping
// plugin, so this lives in the client instead of the SW.)
const STALE_THRESHOLD_MS = 90_000 // 90s beyond the freshest baseline

let _minGapMs = Infinity

/** Test seam — forget the calibrated baseline. */
export function resetStaleness(): void {
  _minGapMs = Infinity
}

export function classifyFreshness(dateHeader: string | null, clientNowMs: number): 'fresh' | 'stale' | 'unknown' {
  if (!dateHeader) return 'unknown'
  const serverMs = Date.parse(dateHeader)
  if (Number.isNaN(serverMs)) return 'unknown'
  const gap = clientNowMs - serverMs
  if (gap < _minGapMs) _minGapMs = gap // freshest gap so far ≈ clock skew
  return gap - _minGapMs > STALE_THRESHOLD_MS ? 'stale' : 'fresh'
}
