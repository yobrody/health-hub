# Health Hub — "Alive & Interconnected" Redesign

_Date: 2026-08-21. From Brody's feedback after first using R1: "feels boring, like any other app — in reality it interconnects everything, it should feel more alive."_

## The thesis
The app isn't missing features — it's hiding the **interconnection**. Make cause-and-effect **visible and physical**: you **eat** → the fridge visibly **depletes** → "**restock soon**" surfaces on Home → flows into your **Cart** → you check out → the fridge **refills**. That loop, shown with motion and a real kitchen you can touch, is what makes it feel alive. Every change below serves that loop.

## Locked decisions (2026-08-21)
1. **AI photo → pantry: build now.** Snap fridge/freezer/pantry/spices → AI vision identifies items → auto-populate the kitchen. (Gemini vision + backend endpoint.)
2. **Cart = realistic hand-off** (no faked auto-checkout — Amazon/Instacart have no public add-to-cart API): grocery-list notepad → copy/share + deep-links that open Amazon Fresh / Instacart **pre-searched** for the list + (location on) nearby delivery services as set-up links.
3. **Restructure first** — ship the visible shape immediately, then the deep parts.

## Structure
- **Bottom nav → Home · Food · Gym · Cart.** Settings LEAVES the bar → a profile/gear button **top-LEFT of Home** (the **rift seam stays top-RIGHT**, reserved for the R2 game — no collision).
- **Home:** the training card is **removed** → replaced by **"Restock soon"** (pantry items low / expiring / reorder-due, from real data — honest, omit when nothing).
- **Food:** a real **interactive kitchen** — a visual kitchen where you tap **fridge / pantry / freezer / spices**, see items by where they're stored, tap any item for its facts (nutrition/expiry/price/store), and toggle **single⇄double** fridge · pantry · freezer. First-run **gated** by "**upload photos of your fridge/freezer/pantry/spices**" → AI populates it.
- **Gym:** gated by "**create or upload a workout to begin**" (a saved workout/program, not only ad-hoc). "Create" leads into the existing session flow; "upload" imports (photo/file → later).
- **Cart:** grocery-list notepad (auto-filled from "restock soon" + manual) → copy/share + Amazon Fresh / Instacart deep-links + location-based nearby delivery services.

## Aliveness moves (the through-line)
- **Visible cause-effect:** logging a home meal visibly deducts from the kitchen; that surfaces on Home's "restock soon"; which fills the Cart. Show the chain, don't hide it.
- **Motion:** tasteful transitions, a kitchen that reacts, restock/cart counts that animate. (Not noise — earned, calm, premium.)
- **A living Home** that reflects the real state of your day/kitchen, not a static dashboard.
- (The full living-avatar aliveness is the separate R2 game app — this is R1's honest, physical version.)

## Phases
- **R-1 — Restructure (SHIP FIRST):** nav (Home/Food/Gym/Cart + Settings→top-left menu), Home training→"Restock soon", Food + Gym first-run **gates** (non-blocking — a way through stays so the app is usable), a **Cart** tab with a working grocery-list notepad shell.
- **R-2 — AI photo → pantry:** upload flow + a Gemini-vision backend endpoint that returns recognized items (honest confidence; user confirms) → populate the kitchen. Wire the Food gate to it.
- **R-3 — Interactive kitchen visual:** the tappable kitchen (zones, items-by-location, item-facts, single/double appliance toggles).
- **R-4 — Cart hand-off:** copy/share, Amazon Fresh / Instacart pre-searched deep-links, location-based nearby delivery services.
- **R-5 — Aliveness polish:** make the eat→deplete→restock→cart loop visible + motion pass.

## Honesty (unchanged spine)
Restock/kitchen from REAL pantry data only (never fabricated stock/urgency). AI recognition shows honest confidence and the user confirms before it's saved as real. Cart hand-off never claims an order was placed. Gates never fabricate progress. `—` over guesses everywhere.
