// Heuristic: does this food name look like a *packaged, branded* supermarket
// product rather than a generic plated/whole food?
//
// Why it exists: the photo scanner confidently guessed macros for a Tesco "The
// Chicken Club" box it could only see from the front (no readable label) —
// 200 kcal / 5g carbs for a bread sandwich, which is impossible. For packaged
// products the honest move is NOT to guess: look the branded name up in the
// real food database (Open Food Facts), and if that misses, ask for the label
// or barcode. This flag decides which foods get that treatment.
//
// It's a belt-and-braces signal used ALONGSIDE the backend's `needs_label`
// flag — either one triggers the branded-name lookup — so packaged foods are
// caught even when the model forgets to flag them. Deliberately conservative:
// a false negative just means we treat it as a normal estimate (status quo); a
// false positive would waste a DB lookup, so we only match confident brand/
// retailer tokens as whole words, never loose substrings.

// UK grocery retailers + their own-brand sub-brands, and well-known packaged
// food/drink brands. Whole-word matched, case-insensitive.
const BRAND_TOKENS: readonly string[] = [
  // Supermarkets / retailers
  'tesco', 'sainsbury', "sainsbury's", 'sainsburys', 'asda', 'morrisons',
  'waitrose', 'aldi', 'lidl', 'iceland', 'ocado', 'co-op', 'co op',
  'marks & spencer', 'm&s', 'boots', 'greggs', 'pret', 'nisa', 'spar',
  // Supermarket own-brand ranges
  'brooklea', 'hearty food', 'by sainsbury', 'nutmeg', 'the collection',
  // Packaged food / drink / supplement brands
  'for goodness shakes', 'grenade', 'carb killa', 'huel', 'myprotein',
  'optimum nutrition', 'quest', 'weetabix', 'kelloggs', "kellogg's",
  'graham', "graham's", 'alpro', 'yeo valley', 'muller', 'müller', 'arla',
  'walkers', 'cadbury', 'nakd', 'trek', 'eat natural', 'belvita', 'warburtons',
  'hovis', 'kingsmill', 'heinz', 'birds eye', 'quorn', 'linda mccartney',
]

// Escape a token for use in a RegExp.
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Build one alternation regex with word-ish boundaries. We can't use plain \b
// on tokens containing spaces / punctuation (& , - '), so we anchor on a
// non-letter (or string edge) either side of the token.
const TOKEN_RE = new RegExp(
  `(^|[^a-z])(${BRAND_TOKENS.map(esc).join('|')})([^a-z]|$)`,
  'i',
)

export function isLikelyPackaged(name: unknown): boolean {
  if (typeof name !== 'string') return false
  const n = name.trim().toLowerCase()
  if (!n) return false
  return TOKEN_RE.test(n)
}

// Which known brand/retailer tokens appear (as whole words) in a string.
export function brandTokensIn(name: unknown): string[] {
  if (typeof name !== 'string') return []
  const n = name.trim().toLowerCase()
  if (!n) return []
  return BRAND_TOKENS.filter(tok => new RegExp(`(^|[^a-z])(${esc(tok)})([^a-z]|$)`, 'i').test(n))
}

// Parse a gram weight out of an Open Food Facts serving/quantity string
// ("30 g", "250g", "serving 45.5 g"). Returns null for non-gram units
// ("1 cup") or implausible portions, so callers fall back honestly rather than
// scaling by a bogus number.
export function parseServingGrams(serving?: string | null): number | null {
  if (!serving) return null
  // Grams first (authoritative). `\bg\b`-style: a digit then optional space then
  // "g" not immediately followed by another letter, so "30 g" matches but the
  // "g" inside a word doesn't. Handles "30 g", "250g", "serving 45.5 g".
  const gm = serving.match(/(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/i)
  if (gm) { const g = parseFloat(gm[1]); return g > 0 && g < 2000 ? g : null }
  // Fall back to ml for liquids (a 330 ml can). Treat ml as grams-equivalent
  // (water density ~1 g/ml) so drinks scale to their serving instead of the
  // disclosed per-100g. Good enough for logging; exact density is rarely known.
  const mm = serving.match(/(\d+(?:\.\d+)?)\s*ml\b/i)
  if (mm) { const ml = parseFloat(mm[1]); return ml > 0 && ml < 2000 ? ml : null }
  return null
}

// A database hit only counts if it plausibly IS the queried product — the query
// and the matched product must share a real word (≥4 letters) or a known brand.
// Without this, "Tesco chicken club" could silently adopt some unrelated
// "chicken" product's real-but-wrong numbers — a subtler dishonesty than an open
// guess. The brand check rescues short brands ("Pret", "M&S", "Co-op") the
// ≥4-letter keyword filter drops.
export function isRelevantMatch(query: string, name: string, brand: string): boolean {
  const hay = `${name} ${brand}`
  const words = query.toLowerCase().match(/[a-z]{4,}/g) ?? []
  if (words.some(w => hay.toLowerCase().includes(w))) return true
  return sharedBrandToken(query, hay)
}

// Do two strings share a known brand/retailer? Used to confirm a database match
// really is the SAME product for short brands ("Pret", "M&S", "Co-op") that the
// generic ≥4-letter keyword check would drop.
export function sharedBrandToken(a: unknown, b: unknown): boolean {
  const ta = brandTokensIn(a)
  if (!ta.length) return false
  const tb = new Set(brandTokensIn(b))
  return ta.some(t => tb.has(t))
}
