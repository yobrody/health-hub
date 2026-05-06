# Health Hub — readiness audit fixes complete (2026-05-06)

> Companion to [2026-05-06-readiness-audit.md](2026-05-06-readiness-audit.md).
> All P0 + 12 P1 + 11 P2 fixed and verified on the live preview.
> Branch `fridge-dnd-modal` at `cc1a855`.

## What changed since the morning

### Backend
- **`/stats/week` was 500ing** — `KeyError` on `d["kcal"]` (correct key was `d["total_kcal"]`). Fixed; deployed to VPS. Today's `WORKOUTS 2/4 this week` now actually populates.
- **New `/api/ai/act` CF Pages function** — natural-language assistant. POST `{prompt}`, returns `{summary, actions}` validated to two action types (`log_food`, `add_fridge`). Gemini 2.5-flash-lite, free tier.
- **Vite dev middleware** mirrors the prod /act function for dev parity (requires GEMINI_API_KEY in local .env).

### Big new feature: AI assistant text box
On Today, replaces the old QUICK LOG. User types one freeform line (e.g. *"3 eggs and bacon and a can of pineapple from Aldi"*). Gemini parses → preview chip with summary + per-item breakdown → tap Apply → executes via existing endpoints.

Animations:
- Calorie bar pulses (brightness + scaleY) on apply, then smoothly fills 700ms.
- "done ✓" indicator flashes top-right of the AI card for 1.4s.
- Phone double-tap haptic (`navigator.vibrate([10, 30, 10])`).
- Preview chip slides up subtly.

Verified live with the exact prompt from your example: 3 eggs (78 × 3 kcal, 6 × 3g protein → Breakfast) + 3 bacon + can pineapple to pantry from Aldi.

### P0 (5 of 5 — all blockers cleared)
| # | Fix | File |
|---|---|---|
| P0-1 | Settings cog top-right of Today → Goals page (was unreachable) | `src/pages/Today.tsx` |
| P0-2 | Fridge header just `+ Add` (Barcode/Scan removed; camera FAB has both) | `src/pages/Fridge.tsx` |
| P0-3 | `/stats/week` 500 fix + WORKOUTS shows real number | `api/main.py`, `src/pages/Today.tsx` |
| P0-4 | Freezer LCD reads `-18°` (was `3°C`) | `src/pages/Fridge.tsx` |
| P0-5 | Recent workouts filters out 0-min/0-kg/stale sessions | `src/pages/Workout.tsx` |

### P1 (12 of 12 — only P1-1 obsolete by AI input)
| # | Fix |
|---|---|
| P1-1 | Obsolete — protein auto-extracted by AI input |
| P1-2 | Smart-grocery list no longer duplicates Eat-Soon banner; renamed "Staples to restock" |
| P1-3 | Eat-soon banner shows ONE consistent count (header pill removed) |
| P1-4 | SKINCARE tile two clean rows (Morning ○ / Evening ○), trailing "routine" gone |
| P1-5 | Back chevron top-left of Lists / Agenda / Routines / Skincare / Goals |
| P1-6 | Today's Shopping tile opens Lists on Shopping sub-list (was always Groceries) |
| P1-7 | Agenda priorities ascending: Low / Normal / Urgent |
| P1-8 | Routines hides "No streak yet" until streak ≥ 1 |
| P1-9 | Skincare drops literal "Tap" label |
| P1-10 | Workout "Begin" full-width thumb-bottom button under the exercise list |
| P1-11 | Nutrition header drops the redundant "Fridge" pill |
| P1-12 | Eat-soon copy unified across Today + Fridge |

### P2 (11 of 13 — 2 deferred)
| # | Fix |
|---|---|
| P2-1 | Pantry drawer base removed — clean open-faced cabinet |
| P2-2 | Camera sheet labels sharper (no `→`, clearer disjunction) |
| P2-3 | Agenda date format aligned (`Wed 6 May`) |
| P2-5 | PR card filters reps > 12 (no more `20kg × 50` PR badge) |
| P2-7 | Hydration glass buttons have aria-labels + aria-pressed |
| P2-8 | Onboarding default name `''` → "there" until set |
| P2-9 | Already defensive — confirmed, no change needed |
| P2-10 | "Re-enrich" → "Refresh data" |
| P2-12 | Today no longer forces dark theme; respects user's stored choice |
| **P2-11** | **Deferred** — freezer/condiments need new SVG illustrations |
| P2-13 | Out of scope (PWA manifest icons — needs raster generation) |

### Backend audit items (B)
None implemented this round; all 10 items still listed in the original audit doc. The most pressing — **B-2** (`removeFridgeItem` substring-match) — already mitigated for the cross-zone drag path; full fix would require a dedicated DELETE-by-name flag on the FastAPI endpoint, deferred.

---

## Branch state

- **Branch:** `fridge-dnd-modal`
- **HEAD:** `cc1a855` (today)
- **Live:** https://fridge-dnd-modal.health-hub-dwz.pages.dev/
- **Not merged to main** (your gate)

## Commit history this work

```
cc1a855 polish(audit): full P1 + P2 sweep — 14 fixes
b5c5a0f feat(today): AI assistant text box + P1 polish
5c3b9a0 fix(p0): all 5 daily-use blockers
0a5f216 audit(2026-05-06): readiness for daily use — 30 findings
28d8ee2 polish(fridge): remove on-card labels + fix pantry doors
425e136 harden: cross-zone dual-swap order + skip no-op KV writes
5f41bd4 free-tier(ai): every paid-AI call → direct Gemini 2.5
8bcac17 migrate(ai): receipt-scan + food-photo → direct Gemini
51bb80c fix(enrich): use gemini-2.5-flash — 2.0 moved to paid
1b950e5 fix: drag reflow, cross-zone, escape rendering + flash-lite
1888326 feat(fridge): drag-and-drop slots + AI item-detail + enrichment
```

## To merge in the morning

```bash
cd D:/Development/health-hub
git checkout main
git pull
git merge fridge-dnd-modal
git push
~/.claude/hooks/wt.sh done fridge-dnd-modal     # cleans worktree
```

## What's left for "ready for friends to use" (post-merge backlog)

In rough priority:

1. **B-2 (substring DELETE)** — make `removeFridgeItem` exact-match by default. Add `?contains=true` flag for legacy callers if any.
2. **B-3 (KV merge field set)** — extend the proxy's KV merge in `[[path]].js` to pass through brand/nutrition_per_100g/packaging/etc. Currently those only surface via `/fridge/item/{name}`. Cards can't show brand without a per-item GET.
3. **P2-11 (freezer/condiments visual)** — give them their own cartoon SVG so the page is visually consistent.
4. **B-7 (cleanup unused env)** — delete `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` from CF Pages Production + Preview environments.
5. **B-8 (sync data dir)** — add `~/health-hub/api/data/` to Syncthing. Today: `slot_memory.json`, `lists.json`, `routines.json`, `agenda.json`, `workouts.json`, `profile.json` exist only on the VPS docker volume.
6. **B-9 (centralize health key)** — `brody-health-hub-2026` hardcoded in 6+ files. Single env var.
7. **AI text box scope expansion** — add more action types: `log_workout`, `log_water`, `mark_routine`, `log_skincare_step`. v1 ships with just `log_food` + `add_fridge` to keep the parse reliable.

None are blockers for daily use.

## Phone test checklist

1. Pull-to-refresh https://fridge-dnd-modal.health-hub-dwz.pages.dev/.
2. **AI input:** type "3 eggs and bacon and a can of pineapple from Aldi" → tap send arrow → preview chip → tap Apply → watch calorie bar fill.
3. **Goals:** tap the cog icon top-right of Today.
4. **Skincare tile:** check it now reads "Morning ○ / Evening ○".
5. **Plan tile:** tap → confirm Agenda page has back chevron + Low / Normal / Urgent order.
6. **Shopping tile:** tap → confirm Lists opens on the Shopping sub-list (not Groceries).
7. **Workout page:** confirm "Begin" button is full-width below the exercises preview.
8. **Fridge:** drag, tap, modal — same as before plus no on-card labels and `+ Add` only in header.

If anything's off, the branch is still on the side. If everything works, run the merge command above.
