# Fridge — drag-and-drop, item-detail modal, AI enrichment-on-add

> Branch: `fridge-dnd-modal` · Worktree: `D:\Development\health-hub-fridge-dnd-modal`
> Designed: 2026-05-05.
> Builds on `try-c-today-preview` (cartoon SVG appliance).

## Goal

Turn the current cartoon-appliance Fridge into a real product page:

1. **Items move.** Drag within a shelf, between shelves, between fridge↔pantry.
2. **Positions persist.** Every device sees the same slot layout, and an item that was removed and re-added returns to its old slot.
3. **Tap = full detail.** A real product modal — photo, brand, nutrition, pricing history, position, inline actions — instead of today's bare "Remove?" sheet.
4. **AI enriches on add.** Every add path (receipt, barcode, manual) runs the same background enrichment so the modal always has something to show.

## Non-goals

- Moving freezer/condiments away from the legacy grid (they stay as `ZoneSection`).
- Editing item names from the modal (read-only for v1).
- A separate "shop history" page — price history surfaces only in the detail modal.

---

## Architecture

### Storage

| Data | Location | Owner |
|---|---|---|
| Item identity (name, added) | `~/health-hub/api/data/fridge.md` (markdown) | VPS FastAPI |
| Slot positions | `~/health-hub/api/data/slot_memory.json` *(new)* | VPS FastAPI |
| Item metadata (cost, store, photo_url, nutrition, brand, allergens, packaging, shelf_life…) | `FRIDGE_META` KV `meta:{name}` | CF Pages function |
| Price history per item | `FRIDGE_META` KV `prices:{name}` *(new)* | CF Pages function |
| Photo cache | `FRIDGE_META` KV `photo:{name}` (already exists) | CF Pages function |

**Naming key:** `name.toLowerCase().trim()` (matches existing convention).

### Slot model

```jsonc
// slot_memory.json
{
  "Greek Yogurt": { "zone": "fridge",  "shelf": 1, "col": 0 },
  "Chicken Thighs": { "zone": "fridge",  "shelf": 0, "col": 2 },
  "Olive Oil":  { "zone": "pantry",  "shelf": 2, "col": 1 }
}
```

- Keyed by item name (case-preserved). `zone ∈ {fridge,pantry,freezer,condiments}`.
- `shelf ∈ {0..2}`, `col ∈ {0..2}` — 3 × 3 grid per appliance.
- `freezer` and `condiments` keep flat lists; their slot entries are tolerated but unused.
- **Render rule.** `Appliance` reads `slot_memory` and places items at their explicit slot. New items (no slot yet) get the first free `(shelf, col)` in their zone, scanning left→right top→bottom.
- **Stale entries.** When an item is removed via `DELETE /fridge/item/{name}`, its `slot_memory` entry is also dropped. When an item is renamed (future), the slot is migrated to the new name.

### Per-item KV record (`meta:{name}`)

```jsonc
{
  "name": "Greek Yogurt",
  "brand": "Yeo Valley Organic",
  "photo_url": "https://images.openfoodfacts.org/…",
  "barcode": "5012345678901",
  "nutrition_per_100g": { "kcal": 60, "protein_g": 4.5, "carbs_g": 5, "fat_g": 3, "fiber_g": 0, "sugar_g": 5 },
  "typical_size_g": 500,
  "typical_unit_count": 1,
  "packaging": "tub",
  "shelf_life_days_sealed": 28,
  "shelf_life_days_opened": 7,
  "allergens": ["milk"],
  "categories": ["dairy", "yogurt"],
  // existing fields preserved (cost/store/size/unit_size_g/quantity_g/quantity_count)
  "size": "500g",
  "cost": 1.20,
  "store": "Tesco",
  "unit_size_g": 500,
  "quantity_g": 250,
  "unit_count": 1,
  "quantity_count": 0.5,
  "source": "off+gemini",
  "confidence": "high",
  "enriched_at": 1714783200
}
```

### Price history (`prices:{name}`)

```jsonc
[
  { "date": "2026-05-01", "store": "Tesco",        "cost": 1.20, "size": "500g" },
  { "date": "2026-04-22", "store": "Sainsbury's",  "cost": 1.45, "size": "500g" },
  { "date": "2026-04-18", "store": "Asda",         "cost": 1.10, "size": "500g" }
]
```

Capped at last 20 entries. Append-only on each receipt-scan add.

---

## Endpoints

### Slots — VPS FastAPI

```
GET  /api/fridge/slots
  → 200 { "Greek Yogurt": {"zone":"fridge","shelf":1,"col":0}, … }

PUT  /api/fridge/slots
  body: full map (write-through replace).
  → 200 { ok: true }
```

Map persists to `~/health-hub/api/data/slot_memory.json`. Keep it small and write atomically (write tmp → rename).

### Enrichment — CF Pages functions

```
POST /api/fridge/enrich
  body: { name, barcode?, photo_data_url?, hints?: { store, cost, size } }
  → 200 enriched record
  side effects: write meta:{name}; if hints.cost present, append prices:{name}.

POST /api/fridge/enrich-batch
  body: { items: [{name, barcode?, hints?}], force?: bool }
  → 200 { results: { name → enriched record } }
  Used by receipt scan to enrich all items in parallel (rate-limited to 3 concurrent).

POST /api/fridge/enrich-backfill
  walks every item from /fridge, enriches any with confidence < 'high' or
  enriched_at older than 30 days. Analogous to existing photo-backfill.

GET  /api/fridge/item/{name}
  → 200 { ...FridgeItem, ...meta, recent_prices: [...] }
  Modal calls this on open. Cached in component state.
```

### Cascade inside `/enrich`

1. **Barcode** (if provided): `https://world.openfoodfacts.org/api/v0/product/{barcode}.json` — extracts brand, image, nutriments per 100g, packaging, allergens, categories. **High** confidence.
2. **OFF text search** (else): re-uses photo-lookup logic, extended to capture nutriments + brand + allergens. **Medium** confidence.
3. **Gemini Flash fallback** (still missing fields): direct call to Google AI Studio (`gemini-2.0-flash`).
   - With `photo_data_url` → vision identify: "Identify this UK food. Return JSON: {name, brand, nutrition_per_100g, typical_size_g, packaging}".
   - Without → grounded text: "For UK supermarket {name}, return typical nutrition per 100g + packaging type + sealed/opened shelf life. JSON only."
   - **Medium** confidence; only fills fields OFF didn't.
4. **Merge with priority** OFF > Gemini > existing KV. Never overwrite a `confidence:high` field with a lower-confidence one.

Gemini key: reuses Google AI Studio key already in `intel-watcher` env. Add to CF Pages secrets as `GEMINI_API_KEY` (Brody-gated: requires CF dashboard click).

---

## Frontend changes

### New components

- **`<FridgeDnd>`** — wraps `<DndContext>` around both appliances + freezer/condiments, owns `onDragEnd` swap logic.
- **`<DroppableSlot zone shelf col>`** — `useDroppable({id: 'slot:zone:shelf:col'})`. Renders item or empty placeholder. Empty slots are still drop targets.
- **`<DraggableApplianceItem>`** — wraps existing `ApplianceItem`, calls `useDraggable({id: 'item:name'})`, passes `transform` + listeners.
- **`<ItemDetailModal>`** — replaces today's `removeModal` sheet. Loads from `GET /fridge/item/{name}` on open, shows photo + brand + position + freshness + nutrition + inventory + price-history + actions.

### Drag-and-drop rules

- **Sensor:** `PointerSensor` with `activationConstraint: { distance: 8 }` so a tap (<8px) opens the modal and only a real drag triggers DnD. Phone-friendly.
- **Drop semantics — swap, never insert.** 9 slots are fixed; there's no "make room."

| Drop target | Source | Action |
|---|---|---|
| Empty slot, same zone | Item | Move item to that slot |
| Occupied slot, same zone | Item | Swap the two items' slots |
| Empty slot, different zone | Item | Move + change zone (server: `addFridgeItem` re-write, slot_memory update) |
| Occupied slot, different zone | Item | Swap + each item gets new zone |

- **Persistence.** On drop, build the new `slot_memory` map locally, optimistic-update state, fire `PUT /fridge/slots` in background. Revert on error with toast.
- **Drag overlay.** `<DragOverlay>` carries the item with rotation preserved.
- **Cross-appliance feedback.** When dragging from fridge, pantry shelves get a soft accent ring on their slot droppables.

### Tap → modal flow

`onPointerUp` only triggers tap if pointer didn't move ≥ 8px. dnd-kit's `PointerSensor` with `activationConstraint` is the canonical way. Tap calls `setActiveItem({name, zone})`; modal fetches `/fridge/item/{name}` and renders.

### Add-path enrichment integration

| Path | Today | After |
|---|---|---|
| Receipt scan | `addFridgeItem` per item, parallel `lookupPhoto` background | `addFridgeItem` per item, then **single** `enrich-batch` with all names + receipt store/cost/size as hints |
| Barcode | `lookupBarcode` returns `image_url` only — nutrition discarded | `lookupBarcode` returns full payload; pass **everything** through to `addFridgeItem` and to `enrich` (which writes KV) |
| Manual add | Background `lookupPhoto(name)` | Background `enrich(name)` (richer payload, same fire-and-forget) |
| Photo identify (future, optional) | n/a | New camera flow: capture image → `enrich({photo_data_url})` → Gemini Vision identifies → user confirms → `addFridgeItem` |

---

## Build order

1. **Baseline commit** — cartoon-appliance SVG + Iconify Noto + dnd-kit packages on `fridge-dnd-modal`.
2. **VPS FastAPI:** add `slot_memory.json` + `GET/PUT /fridge/slots`. Drop slot entry on remove.
3. **CF Pages function:** add `/fridge/item/{name}` GET (merge `/fridge` data with `meta:{name}` KV + `prices:{name}` KV).
4. **CF Pages function:** add `/fridge/enrich` + `/fridge/enrich-batch` + `/fridge/enrich-backfill` with OFF + Gemini cascade.
5. **API client:** `getSlots, putSlots, getFridgeItem, enrichItem, enrichBatch, enrichBackfill`.
6. **Appliance render** switch from index-as-slot to `slot_memory`-driven placement, with first-free fallback for new items.
7. **DnD wiring** at Fridge.tsx page level. Optimistic state + `PUT /slots`.
8. **ItemDetailModal** replaces removeModal. Skeleton while loading; nutrition/prices fall back gracefully when KV is empty.
9. **Wire enrichment into add paths** (receipt batch hints, barcode passthrough, manual replacement of `lookupPhoto`).
10. **Verify in dev:** drag within / between shelves / between appliances; tap shows modal with enriched data; receipt scan triggers enrich-batch in network tab.
11. **Commit on `fridge-dnd-modal`. Do not merge to main** — Brody reviews the live preview deploy first.

## Risks / open

- **Gemini key on CF Pages.** Adding `GEMINI_API_KEY` secret needs Brody to click in the CF dashboard. Until done, cascade falls back gracefully (skips step 3, returns whatever OFF gave).
- **Slot migration on rename.** Out of scope for v1 — items can't be renamed from the modal yet.
- **OFF outage handling.** Already battle-tested by `photo-lookup.js` distinguishing transient vs genuine miss; reused here.
- **Drag latency.** PointerSensor with `distance:8` is fine on mobile but iOS Safari sometimes consumes touch events for scroll. Mitigation: `touch-action: none` on draggable handle.
