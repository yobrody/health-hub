"""
Health Hub API — FastAPI backend for Brody's PWA
Reads/writes shared markdown files that Lucky also uses.
"""
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
import os, json, re, base64
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

API_KEY = os.getenv("HEALTH_API_KEY", "change-me")
GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
WORKSPACE = Path("/home/lucky/.openclaw/workspace/health")
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Health Hub", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

from collections import defaultdict, deque
import time

# ── RATE LIMIT ────────────────────────────────────────────────────────
# In-memory per-key+IP token bucket. 120 req/min is ~10x normal app usage
# (Today refreshes pull ~5 endpoints, 14 fetches per page-load tops) so a
# legit user never hits it; a key leak / scraper does. Resets on restart.
RATE_LIMIT = 120
RATE_WINDOW = 60.0
RATE_BUCKETS: dict[str, deque] = defaultdict(deque)

def rate_check(bucket_key: str):
    now = time.time()
    b = RATE_BUCKETS[bucket_key]
    while b and b[0] < now - RATE_WINDOW:
        b.popleft()
    if len(b) >= RATE_LIMIT:
        raise HTTPException(status_code=429, detail="rate limit exceeded; try again in a minute")
    b.append(now)

@app.middleware("http")
async def rate_limit_middleware(request, call_next):
    # Skip OPTIONS (CORS preflight) — no auth header, often unreachable IP.
    if request.method == "OPTIONS":
        return await call_next(request)
    key = request.headers.get("X-Health-Key", "anon")
    ip = request.client.host if request.client else "unknown"
    try:
        rate_check(f"{key}:{ip}")
    except HTTPException as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=e.status_code, content={"detail": e.detail})
    return await call_next(request)


api_key_header = APIKeyHeader(name="X-Health-Key", auto_error=False)

def require_key(key: str = Depends(api_key_header)):
    if key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return key

def today() -> str:
    return date.today().isoformat()

# ── GEMINI HELPER ─────────────────────────────────────────────────────
# Direct Google AI Studio (free tier). gemini-2.0-flash got moved to paid
# in 2026-05; gemini-2.5-flash is the current free-tier flagship.
_GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash-lite:generateContent"
)

def gemini_call(prompt: str, image_b64: str = None, mime_type: str = "image/jpeg",
                max_tokens: int = 800, temperature: float = 0.4) -> dict:
    """Call Gemini Flash with optional vision. Returns parsed JSON dict.
    Raises HTTPException on failure so callers don't need to error-handle."""
    if not GEMINI_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    import urllib.request, urllib.error
    parts = []
    if image_b64:
        parts.append({"inline_data": {"mime_type": mime_type, "data": image_b64}})
    parts.append({"text": prompt})
    body = json.dumps({
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            # Disable 2.5-flash hidden thinking — these are structured
            # extractions, not reasoning. Without this, thinking eats the
            # token budget before any output is emitted.
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }).encode()
    req = urllib.request.Request(
        f"{_GEMINI_ENDPOINT}?key={GEMINI_KEY}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode()[:300]
        raise HTTPException(status_code=502, detail=f"Gemini error {e.code}: {body_txt}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini fetch failed: {e}")
    text = (data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", ""))
    if not text:
        raise HTTPException(status_code=502, detail="empty response from Gemini")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"Invalid JSON from model: {e}")

def food_file(d: str = None) -> Path:
    d = d or today()
    p = WORKSPACE / "food" / f"{d}.md"
    return p

def read_food_file(d: str = None) -> str:
    p = food_file(d)
    return p.read_text() if p.exists() else ""

def parse_entries(content: str) -> list:
    entries = []
    for block in re.findall(r"### (\d{2}:\d{2}) — (.+?)\n((?:- .+\n)+)", content):
        time, meal, items = block
        kcal_match = re.search(r"~(\d+) kcal", items)
        protein_match = re.search(r"~(\d+) g protein", items)
        entries.append({
            "time": time,
            "meal": meal,
            "items": items.strip(),
            "kcal": int(kcal_match.group(1)) if kcal_match else 0,
            "protein_g": int(protein_match.group(1)) if protein_match else 0
        })
    return entries

def read_goals() -> dict:
    p = WORKSPACE / "goals.md"
    if not p.exists():
        return {"calories": 2200, "protein": 160, "gym_days": 4}
    content = p.read_text()
    goals = {}
    m = re.search(r"Daily calories: ~?(\d+)", content)
    goals["calories"] = int(m.group(1)) if m else 2200
    m = re.search(r"Protein.*?: ~?(\d+)g", content)
    goals["protein"] = int(m.group(1)) if m else 160
    m = re.search(r"Gym.*?: (\d+)x", content)
    goals["gym_days"] = int(m.group(1)) if m else 4
    return goals

def _fridge_meta_path() -> Path:
    """Sidecar JSON keyed by lowercase item name carrying structured metadata
    (unit_size_g, quantity_g, unit_count, quantity_count) that doesn't fit the
    human-editable fridge.md format. Lives alongside fridge.md so Lucky's
    markdown view stays unchanged."""
    return WORKSPACE / "fridge_meta.json"

def _read_fridge_meta() -> dict:
    p = _fridge_meta_path()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return {}

def _write_fridge_meta(meta: dict):
    _fridge_meta_path().write_text(json.dumps(meta, indent=2))

def _meta_key(name: str) -> str:
    return name.strip().lower()

def read_fridge() -> dict:
    p = WORKSPACE / "fridge.md"
    if not p.exists():
        return {"fridge": [], "pantry": [], "condiments": [], "freezer": []}
    content = p.read_text()
    result = {"fridge": [], "pantry": [], "condiments": [], "freezer": []}
    section_map = {"Fridge": "fridge", "Pantry": "pantry", "Condiments": "condiments", "Freezer": "freezer"}
    current = None
    meta = _read_fridge_meta()
    for line in content.splitlines():
        for sec, key in section_map.items():
            if line.startswith(f"## {sec}"):
                current = key
                break
        if current and line.startswith("- ") and "empty" not in line.lower():
            item_text = line[2:].strip()
            name_match = re.match(r"^(.*?)(?:\s*\(added (.+?)\))?$", item_text)
            name = name_match.group(1).strip() if name_match else item_text
            added = name_match.group(2) if name_match and name_match.group(2) else None
            entry = {"name": name, "added": added}
            extra = meta.get(_meta_key(name))
            if extra:
                for field in ("unit_size_g", "quantity_g", "unit_count", "quantity_count"):
                    if field in extra and extra[field] is not None:
                        entry[field] = extra[field]
            result[current].append(entry)
    return result

def write_fridge(data: dict):
    """Write the human-readable fridge.md AND the sidecar fridge_meta.json.
    The markdown is the canonical inventory list (so Lucky can still edit it).
    The JSON sidecar carries quantity_g / unit_size_g / etc. keyed by name."""
    p = WORKSPACE / "fridge.md"
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [f"# Fridge & Pantry", f"_Last updated: {now}_", ""]
    section_labels = [
        ("fridge", "Fridge"),
        ("pantry", "Pantry"),
        ("condiments", "Condiments & Sauces"),
        ("freezer", "Freezer")
    ]
    new_meta: dict = {}
    for key, label in section_labels:
        lines.append(f"## {label}")
        items = data.get(key, [])
        if items:
            for item in items:
                added = item.get("added", "")
                lines.append(f"- {item['name']}" + (f" (added {added})" if added else ""))
                # Capture structured fields for the sidecar
                fields = {
                    f: item[f]
                    for f in ("unit_size_g", "quantity_g", "unit_count", "quantity_count")
                    if f in item and item[f] is not None
                }
                if fields:
                    new_meta[_meta_key(item["name"])] = fields
        else:
            lines.append("_(empty)_")
        lines.append("")
    p.write_text("\n".join(lines))
    if new_meta:
        _write_fridge_meta(new_meta)
    elif _fridge_meta_path().exists():
        # All structured fields removed (or all items deleted) — empty out the sidecar
        # so the file doesn't drift away from reality.
        _write_fridge_meta({})

# ── FOOD ──────────────────────────────────────────────────────────────
class FoodEntry(BaseModel):
    meal: str
    description: str
    kcal: int
    time: Optional[str] = None
    protein_g: Optional[int] = None
    # ISO date YYYY-MM-DD. Defaults to today; let callers (e.g. the AI
    # assistant translating "yesterday I ate…") log to a different day.
    # Server clamps to a sensible window so the UI can never time-travel.
    date: Optional[str] = None

@app.get("/today")
def get_today(key=Depends(require_key)):
    content = read_food_file()
    entries = parse_entries(content)
    total = sum(e["kcal"] for e in entries)
    goals = read_goals()
    return {"date": today(), "entries": entries, "total_kcal": total, "goals": goals}

@app.post("/food")
def add_food(entry: FoodEntry, key=Depends(require_key)):
    t = entry.time or datetime.now().strftime("%H:%M")
    # Resolve target date. Accept ISO YYYY-MM-DD only; clamp to last 7 days
    # through tomorrow so we can't accidentally log to 2019 from a typo.
    target_date = today()
    if entry.date:
        try:
            d = date.fromisoformat(entry.date)
            today_d = date.today()
            if (today_d - d).days <= 7 and (d - today_d).days <= 1:
                target_date = entry.date
        except ValueError:
            pass
    p = food_file(target_date)
    if not p.exists():
        p.write_text(f"# Food Log — {target_date}\n\n")
    content = p.read_text()
    protein_str = f", ~{entry.protein_g} g protein" if entry.protein_g else ""
    block = "\n### " + t + " — " + entry.meal + "\n- " + entry.description + " (~" + str(entry.kcal) + " kcal" + protein_str + ")\n**Subtotal: ~" + str(entry.kcal) + " kcal**\n"
    content = re.sub(r"\n---\n\*\*Daily Total.*", "", content)
    content += block
    total = sum(e["kcal"] for e in parse_entries(content))
    content += "\n---\n**Daily Total: ~" + str(total) + " kcal**\n"
    p.write_text(content)
    return {"ok": True, "total_kcal": total, "entry": {"time": t, "meal": entry.meal, "description": entry.description, "kcal": entry.kcal, "protein_g": entry.protein_g or 0}}


class FoodDelete(BaseModel):
    time: str           # HH:MM
    meal: str           # case-insensitive
    date: Optional[str] = None  # YYYY-MM-DD; defaults to today

@app.post("/food/delete")
def delete_food(payload: FoodDelete, key=Depends(require_key)):
    """Remove a food entry from a day's log file. Match is on the
    (time, meal) pair which together uniquely identify a single
    "### HH:MM -- Meal" block. If two entries share both time and meal
    (vanishingly unlikely -- two photos in the same minute, same meal
    label), drop only the first match -- no silent batch deletes.
    Recomputes Daily Total after the strip."""
    if not re.match(r"^\d{2}:\d{2}$", payload.time or ""):
        raise HTTPException(status_code=400, detail="time must be HH:MM")
    target_date = today()
    if payload.date:
        try:
            d = date.fromisoformat(payload.date)
            today_d = date.today()
            if (today_d - d).days <= 7 and (d - today_d).days <= 1:
                target_date = payload.date
        except ValueError:
            pass
    fp = food_file(target_date)
    if not fp.exists():
        raise HTTPException(status_code=404, detail="no log file for that day")
    content = fp.read_text()
    # Match block "### HH:MM -- Meal\n(items)\n**Subtotal: ...**\n".
    # Meal matched case-insensitively. Stops at the next "###" or "---".
    pattern = (
        r"### " + re.escape(payload.time) + r" — " +
        re.escape(payload.meal) + r"\n(?:- .+\n)+(?:\*\*Subtotal[^\n]*\n)?"
    )
    new_content, n = re.subn(pattern, "", content, count=1, flags=re.IGNORECASE)
    if n == 0:
        raise HTTPException(status_code=404, detail="entry not found")
    # Recompute Daily Total from what's left.
    new_content = re.sub(r"\n---\n\*\*Daily Total.*", "", new_content)
    total = sum(e["kcal"] for e in parse_entries(new_content))
    new_content += "\n---\n**Daily Total: ~" + str(total) + " kcal**\n"
    fp.write_text(new_content)
    return {"ok": True, "date": target_date, "total_kcal": total}

@app.get("/food/history")
def food_history(days: int = 7, key=Depends(require_key)):
    result = []
    for i in range(days):
        d = (date.today() - timedelta(days=i)).isoformat()
        content = read_food_file(d)
        total = sum(e["kcal"] for e in parse_entries(content))
        result.append({"date": d, "total_kcal": total, "logged": bool(content.strip())})
    return result

# ── FRIDGE ────────────────────────────────────────────────────────────
SLOT_FILE = DATA_DIR / "slot_memory.json"

def read_slots() -> dict:
    if not SLOT_FILE.exists():
        return {}
    try:
        return json.loads(SLOT_FILE.read_text() or "{}")
    except json.JSONDecodeError:
        return {}

def write_slots(slots: dict):
    # Atomic write: tmp file then rename, so a crash mid-write can't corrupt.
    tmp = SLOT_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(slots, indent=2, sort_keys=True))
    tmp.replace(SLOT_FILE)

def drop_slot_for(name: str):
    """Drop the slot_memory entry for an item being removed.
    Audit B-2: was substring match — now exact (case-insensitive). If the
    caller used ?contains=true on the delete, this still only drops the
    exact slot key; that's fine — orphan slot entries are harmless and
    get GC'd by the next PUT /fridge/slots."""
    slots = read_slots()
    name_lower = name.lower()
    changed = [k for k in slots if k.lower() == name_lower]
    if changed:
        for k in changed:
            del slots[k]
        write_slots(slots)

@app.get("/fridge")
def get_fridge(key=Depends(require_key)):
    return read_fridge()

@app.get("/fridge/slots")
def get_slots(key=Depends(require_key)):
    return read_slots()

@app.put("/fridge/slots")
def put_slots(slots: dict, key=Depends(require_key)):
    valid_zones = {"fridge", "pantry", "freezer", "condiments"}
    cleaned: dict = {}
    for name, pos in slots.items():
        if not isinstance(pos, dict):
            continue
        zone = pos.get("zone")
        shelf = pos.get("shelf")
        col = pos.get("col")
        if zone not in valid_zones:
            continue
        if not (isinstance(shelf, int) and 0 <= shelf <= 2):
            continue
        if not (isinstance(col, int) and 0 <= col <= 2):
            continue
        cleaned[name] = {"zone": zone, "shelf": shelf, "col": col}
    write_slots(cleaned)
    return {"ok": True, "count": len(cleaned)}

class FridgeItem(BaseModel):
    name: str
    section: str = "fridge"
    # Optional pack size in grams when the item is added (e.g. "1kg chicken" → 1000).
    # When set with quantity_g unset, quantity_g defaults to unit_size_g.
    unit_size_g: Optional[float] = None
    # Current remaining grams. Decremented by /fridge/item/{name}/consume when meals
    # are logged via the camera Home flow.
    quantity_g: Optional[float] = None
    # Discrete-unit support for things like eggs/apples (eggs: 12 → eat 2 → 10).
    unit_count: Optional[int] = None
    quantity_count: Optional[int] = None

@app.post("/fridge/item")
def add_fridge_item(item: FridgeItem, key=Depends(require_key)):
    """Add an item to a fridge section.

    Dedup behaviour: if an item with the same name (case-insensitive) already
    exists in the same section, MERGE rather than appending a new row. This
    stops receipt scans from creating duplicate cards every time the user
    re-shops the same staples.

    Merge rules:
      • unit_count: sum existing + new (so 2 then 3 eggs = 5)
      • quantity_count: sum existing + new (so we don't reset what was eaten)
      • unit_size_g: take the new value if provided, else keep existing
      • quantity_g: sum existing + new (e.g. opened 500g pack + new 500g pack)
      • added: bumped to today (latest restock wins)

    A user who really wants two separate rows can rename the second one.
    """
    data = read_fridge()
    added = date.today().strftime("%d %b")
    name_lower = item.name.lower().strip()
    section = data.setdefault(item.section, [])

    # Find existing duplicate in the same zone.
    existing_idx = None
    for idx, row in enumerate(section):
        if row.get("name", "").lower().strip() == name_lower:
            existing_idx = idx
            break

    if existing_idx is not None:
        # Merge into the existing row.
        row = section[existing_idx]
        row["added"] = added  # latest restock
        if item.unit_size_g is not None:
            # New pack takes precedence for unit_size_g (might be a different size pack)
            row["unit_size_g"] = item.unit_size_g
        # Sum quantities so post-consume amounts aren't lost.
        new_qty_g = item.quantity_g if item.quantity_g is not None else item.unit_size_g
        if new_qty_g is not None:
            row["quantity_g"] = (row.get("quantity_g") or 0) + new_qty_g
        if item.unit_count is not None:
            row["unit_count"] = (row.get("unit_count") or 0) + item.unit_count
        new_qty_c = item.quantity_count if item.quantity_count is not None else item.unit_count
        if new_qty_c is not None:
            row["quantity_count"] = (row.get("quantity_count") or 0) + new_qty_c
        write_fridge(data)
        return {"ok": True, "merged": True, "name": row["name"]}

    # No existing row — append fresh.
    record = {"name": item.name, "added": added}
    if item.unit_size_g is not None:
        record["unit_size_g"] = item.unit_size_g
        record["quantity_g"] = (
            item.quantity_g if item.quantity_g is not None else item.unit_size_g
        )
    elif item.quantity_g is not None:
        record["quantity_g"] = item.quantity_g
    if item.unit_count is not None:
        record["unit_count"] = item.unit_count
        record["quantity_count"] = (
            item.quantity_count if item.quantity_count is not None else item.unit_count
        )
    elif item.quantity_count is not None:
        record["quantity_count"] = item.quantity_count
    section.append(record)
    write_fridge(data)
    return {"ok": True, "merged": False}

@app.delete("/fridge/item/{name}")
def remove_fridge_item(name: str, contains: bool = False, key=Depends(require_key)):
    """Delete ONE item by name. Default match is EXACT (case-insensitive);
    pass ?contains=true to fall back to substring match.

    Behaviour:
      • Default (contains=false): removes the FIRST occurrence with an exact
        case-insensitive name match. Duplicates from receipt scans (e.g. two
        'tenderstem broccoli' rows) are removed one tap at a time, matching
        the user's mental model of "I'm getting rid of this one tile".
      • contains=true: removes ALL substring-matching items across every
        zone — only safe when the caller is sure (e.g. cross-zone drag
        intermediate state).

    Audit B-2 history: this used to substring-match by default, which made
    'salt' nuke 'salted butter'. The exact-match-by-default fix was right;
    deleting only one row at a time is the further refinement after a user
    report that 'remove doesn't work' on duplicated rows (it was working —
    it was deleting all duplicates in one shot, looking like nothing else
    happened on the next tap).
    """
    data = read_fridge()
    name_lower = name.lower()
    removed = False
    for section in data:
        # Both paths now remove only the FIRST matching row, then break.
        # Was: contains=true would nuke every substring match across every
        # zone in one call — too dangerous (a typo could clear the fridge).
        # If you genuinely want to bulk-delete, send N separate DELETE calls.
        for idx, item in enumerate(data[section]):
            existing = item["name"].lower()
            match = (name_lower in existing) if contains else (existing == name_lower)
            if match:
                del data[section][idx]
                removed = True
                break
        if removed:
            break
    if not removed:
        raise HTTPException(status_code=404, detail=f"Item not found")
    write_fridge(data)
    # Slot entry is keyed by name, so we only drop it when no row remains.
    if not any(i["name"].lower() == name_lower for sec in data.values() for i in sec):
        drop_slot_for(name)
    return {"ok": True}

class ConsumeInput(BaseModel):
    grams: Optional[float] = None
    count: Optional[int] = None

@app.post("/fridge/item/{name}/consume")
def consume_fridge_item(name: str, input: ConsumeInput, key=Depends(require_key)):
    """Decrement quantity_g and/or quantity_count for the named item.

    Match is case-insensitive substring across all sections. If multiple items match,
    the first one is consumed. When quantity hits 0 the item stays in the fridge
    (so the user sees it's empty and can either remove or restock); the next add
    of the same name resets quantity_g to unit_size_g.
    """
    if input.grams is None and input.count is None:
        raise HTTPException(status_code=400, detail="Provide grams or count")
    data = read_fridge()
    name_lower = name.lower()
    consumed = None
    for section in data:
        for item in data[section]:
            if name_lower in item["name"].lower():
                if input.grams is not None and "quantity_g" in item:
                    item["quantity_g"] = max(0.0, item["quantity_g"] - input.grams)
                if input.count is not None and "quantity_count" in item:
                    item["quantity_count"] = max(0, item["quantity_count"] - input.count)
                consumed = {
                    "name": item["name"],
                    "section": section,
                    "quantity_g": item.get("quantity_g"),
                    "quantity_count": item.get("quantity_count"),
                }
                break
        if consumed:
            break
    if not consumed:
        raise HTTPException(status_code=404, detail=f"Item not found")
    write_fridge(data)
    return {"ok": True, **consumed}

class ScanInput(BaseModel):
    image: str  # base64 (no data: prefix)
    mimeType: Optional[str] = "image/jpeg"

@app.post("/fridge/scan")
async def scan_receipt(input: ScanInput, key=Depends(require_key)):
    """Receipt scan — JSON contract matching the Cloudflare Pages Function shadow
    at functions/api/fridge/scan.js so dev/prod/fallback all behave the same.

    Returns {items: [...], store: {...}} — does NOT add to fridge automatically;
    the client iterates and calls /fridge/item per item so that user-side
    confirmation/edits can happen first.
    """
    media_type = input.mimeType or "image/jpeg"
    prompt = (
        "Look at this grocery store receipt. Extract the purchased food and drink items.\n\n"
        "Return ONLY valid JSON, no markdown or explanation:\n"
        '{"store":{"name":"store name","location":"address/area or null"},'
        '"items":[{"name":"readable name","unit_size_g":340,"unit_count":null,"cost":1.89,"section":"fridge"}]}\n\n'
        "Rules:\n"
        '- name: clean readable name (e.g. "greek yogurt" not "GREEK YOG 10%")\n'
        "- unit_size_g: pack size in grams if visible (parse '340g' → 340, '1kg' → 1000, '1.5L water' → 1500)\n"
        "  null if not shown or not weight-based\n"
        "- unit_count: discrete count if applicable (eggs: 6/12, apples: 4) — null otherwise\n"
        "- cost: item price as a number — null if not visible\n"
        '- section: "fridge"|"freezer"|"pantry"|"condiments"\n'
        "  fridge: dairy, fresh produce, eggs, meat/fish, yogurt, juice, deli\n"
        "  freezer: frozen meals, ice cream, frozen veg/meat\n"
        "  pantry: canned, dry goods, snacks, coffee, tea, bread, nuts, spreads, chocolate\n"
        "  condiments: sauces, oils, vinegar, dressings, spices\n"
        "- INCLUDE all food and drink items\n"
        "- SKIP non-food (foil, bags, cleaning, toiletries), totals, VAT, discounts, header rows\n"
        '- If a name contains "/" add both as separate items'
    )
    parsed = gemini_call(prompt, image_b64=input.image, mime_type=media_type, max_tokens=2000, temperature=0.2)
    raw_items = parsed.get("items") or []
    valid_sections = {"fridge", "freezer", "pantry", "condiments"}
    items = [
        {
            "name": (i.get("name") or "").strip().lower(),
            "section": i["section"] if i.get("section") in valid_sections else "fridge",
            "unit_size_g": i.get("unit_size_g") if isinstance(i.get("unit_size_g"), (int, float)) else None,
            "unit_count": i.get("unit_count") if isinstance(i.get("unit_count"), int) else None,
            "cost": i.get("cost") if isinstance(i.get("cost"), (int, float)) else None,
            # Legacy `size` string kept so the pre-units client path still works.
            "size": (
                f"{int(i['unit_size_g'])}g" if isinstance(i.get("unit_size_g"), (int, float))
                else None
            ),
        }
        for i in raw_items
        if isinstance(i, dict) and i.get("name")
    ]
    return {"items": items, "store": parsed.get("store")}

# ── SMART SCAN (unified barcode / receipt / food) ────────────────────
@app.post("/scan/smart")
async def smart_scan(input: ScanInput, key=Depends(require_key)):
    """Unified scanner — auto-detects barcode, receipt, or food photo.

    Returns one of:
      {"type": "barcode", "code": "1234567890"}
      {"type": "receipt", "items": [...], "store": {...}}
      {"type": "food", "foods": [...], "confidence": "high"}
    """
    media_type = input.mimeType or "image/jpeg"
    prompt = (
        "Look at this image and classify it as exactly ONE of these three categories:\n\n"
        '1. "barcode" — you see a barcode, QR code, or product packaging with a visible barcode/EAN number\n'
        '2. "receipt" — you see a grocery store receipt, shopping bill, or till printout\n'
        '3. "food" — you see actual food, a meal, a drink, ingredients, or a plate of food\n\n'
        "Respond as JSON based on the category:\n\n"
        'For barcode: {"type": "barcode", "code": "<the barcode number>"}\n'
        "  Extract the EAN/UPC number visible in the image. If you can see the barcode lines but\n"
        "  cannot read the number, set code to null.\n\n"
        'For receipt: {"type": "receipt", "store": {"name": "store name", "location": null},\n'
        '  "items": [{"name": "readable item name", "unit_size_g": 340, "unit_count": null, "cost": 1.89, "section": "fridge"}]}\n'
        "  Rules for receipt items:\n"
        '  - name: clean readable name (e.g. "greek yogurt" not "GREEK YOG 10%")\n'
        "  - unit_size_g: pack size in grams if visible (parse '340g' -> 340, '1kg' -> 1000, '1.5L' -> 1500), null if not shown\n"
        "  - unit_count: discrete count if applicable (eggs: 6/12), null otherwise\n"
        "  - cost: item price as a number, null if not visible\n"
        '  - section: "fridge"|"freezer"|"pantry"|"condiments"\n'
        "  SKIP non-food items (bags, cleaning products, toiletries)\n\n"
        'For food: {"type": "food", "foods": [\n'
        '  {"name": "item name", "kcal": 300, "protein_g": 20, "carbs_g": 40, "fat_g": 10, "grams": 200}\n'
        "], \"confidence\": \"high\"}\n"
        "  Estimate calories and macros for each distinct food item visible.\n"
        '  confidence: "high" if clearly identifiable, "medium" if somewhat ambiguous, "low" if very uncertain\n'
    )
    parsed = gemini_call(prompt, image_b64=input.image, mime_type=media_type, max_tokens=2000, temperature=0.2)
    scan_type = parsed.get("type", "food")

    if scan_type == "barcode":
        return {"type": "barcode", "code": parsed.get("code")}

    if scan_type == "receipt":
        raw_items = parsed.get("items") or []
        valid_sections = {"fridge", "freezer", "pantry", "condiments"}
        items = [
            {
                "name": (i.get("name") or "").strip().lower(),
                "section": i["section"] if i.get("section") in valid_sections else "fridge",
                "unit_size_g": i.get("unit_size_g") if isinstance(i.get("unit_size_g"), (int, float)) else None,
                "unit_count": i.get("unit_count") if isinstance(i.get("unit_count"), int) else None,
                "cost": i.get("cost") if isinstance(i.get("cost"), (int, float)) else None,
                "size": (
                    f"{int(i['unit_size_g'])}g" if isinstance(i.get("unit_size_g"), (int, float))
                    else None
                ),
            }
            for i in raw_items
            if isinstance(i, dict) and i.get("name")
        ]
        return {"type": "receipt", "items": items, "store": parsed.get("store")}

    # Default: food
    raw_foods = parsed.get("foods") or []
    foods = [
        {
            "name": (f.get("name") or "unknown").strip(),
            "kcal": int(f.get("kcal") or 0),
            "protein_g": round(float(f.get("protein_g") or 0)),
            "carbs_g": round(float(f.get("carbs_g") or 0)),
            "fat_g": round(float(f.get("fat_g") or 0)),
            "grams": int(f.get("grams") or 0) if f.get("grams") else None,
        }
        for f in raw_foods
        if isinstance(f, dict) and f.get("name")
    ]
    confidence = parsed.get("confidence", "medium")
    if confidence not in ("high", "medium", "low"):
        confidence = "medium"
    return {"type": "food", "foods": foods, "confidence": confidence}

# ── MEALS AI ──────────────────────────────────────────────────────────
@app.post("/ai/meals")
def suggest_meals(key=Depends(require_key)):
    fridge = read_fridge()
    goals = read_goals()
    all_items = [i["name"] for sec in fridge.values() for i in sec]
    if not all_items:
        return {"meals": [{"name": "Fridge is empty", "ingredients": [], "kcal_estimate": 0}]}

    # Calculate today's remaining budget for smarter suggestions
    today_content = read_food_file()
    today_entries = parse_entries(today_content)
    eaten_kcal = sum(e["kcal"] for e in today_entries)
    eaten_protein = sum(e.get("protein_g", 0) for e in today_entries)
    remaining_kcal = max(0, goals.get("calories", 2200) - eaten_kcal)
    remaining_protein = max(0, goals.get("protein", 160) - eaten_protein)

    # Time-of-day context
    hour = datetime.now().hour
    if hour < 11:
        time_context = "It's morning — suggest breakfast/brunch options."
    elif hour < 15:
        time_context = "It's lunchtime — suggest lunch options."
    elif hour < 18:
        time_context = "It's afternoon — suggest a snack or early dinner."
    else:
        time_context = "It's evening — suggest dinner options."

    prompt = (
        f"Fridge contents: {', '.join(all_items)}. "
        f"Daily calorie goal: ~{goals.get('calories', 2200)} kcal, protein: ~{goals.get('protein', 160)}g. "
        f"User has eaten {eaten_kcal} kcal today, needs ~{remaining_kcal} more kcal, "
        f"with ~{remaining_protein}g protein remaining. "
        f"{time_context} "
        "Suggest exactly 3 practical meals using these ingredients that fit within the remaining budget. "
        'Return ONLY this JSON (no markdown): {"meals":[{"name":"Meal Name","ingredients":["item1"],"kcal_estimate":600,"protein_g_estimate":30}]}'
    )
    parsed = gemini_call(prompt, max_tokens=600, temperature=0.6)
    meals = parsed.get("meals") if isinstance(parsed, dict) else parsed
    return {"meals": meals if isinstance(meals, list) else []}

class MealDetailInput(BaseModel):
    name: str
    ingredients: list[str] = []

@app.post("/ai/meal-detail")
def meal_detail(input: MealDetailInput, key=Depends(require_key)):
    """Recipe + full macros for a single meal idea. The frontend calls this on
    tap-to-expand so the cheap /ai/meals listing stays cheap (just names +
    kcal estimates) and the expensive recipe generation only fires when the
    user actually picks one."""
    prompt = (
        f"Recipe for: {input.name}\n"
        f"Ingredients available: {', '.join(input.ingredients) if input.ingredients else '(none specified)'}\n\n"
        "Return ONLY this JSON (no markdown, no commentary):\n"
        '{"prep_minutes": 15, "cook_minutes": 20, "servings": 1, '
        '"steps": ["Step 1...", "Step 2...", "..."], '
        '"kcal": 620, "protein_g": 42, "carbs_g": 60, "fat_g": 22}\n\n'
        "Rules:\n"
        "- 4-8 short cooking steps (one sentence each, action-first)\n"
        "- Macros are per serving\n"
        "- Be realistic about portions (one serving for an active adult)"
    )
    return gemini_call(prompt, max_tokens=800, temperature=0.5)

# ── WORKOUTS ──────────────────────────────────────────────────────────
WORKOUTS_FILE = DATA_DIR / "workouts.json"

def load_workouts() -> list:
    if WORKOUTS_FILE.exists():
        return json.loads(WORKOUTS_FILE.read_text())
    return []

def save_workouts(workouts: list):
    WORKOUTS_FILE.write_text(json.dumps(workouts, indent=2))

class ExerciseSet(BaseModel):
    weight_kg: Optional[float] = None
    reps: Optional[int] = None
    duration_seconds: Optional[int] = None

class Exercise(BaseModel):
    name: str
    sets: list[ExerciseSet]

class Workout(BaseModel):
    title: str
    start_time: str
    end_time: str
    exercises: list[Exercise]

@app.get("/workouts")
def get_workouts(limit: int = 30, key=Depends(require_key)):
    workouts = load_workouts()
    return workouts[-limit:]

@app.post("/workouts")
def save_workout(workout: Workout, key=Depends(require_key)):
    workouts = load_workouts()
    w = workout.dict()
    w["id"] = f"{today()}-{len(workouts)}"
    workouts.append(w)
    save_workouts(workouts)
    return {"ok": True, "id": w["id"]}

@app.patch("/workouts/{workout_id}")
def update_workout(workout_id: str, workout: Workout, key=Depends(require_key)):
    """Replace a finished workout in place. Used when the user opens a saved
    workout to fix sets, change weight, etc. — the id stays stable so PRs
    derived from the workout don't lose their lineage."""
    workouts = load_workouts()
    for i, w in enumerate(workouts):
        if w.get("id") == workout_id:
            updated = workout.dict()
            updated["id"] = workout_id
            workouts[i] = updated
            save_workouts(workouts)
            return {"ok": True, "id": workout_id}
    raise HTTPException(status_code=404, detail="Workout not found")

@app.delete("/workouts/{workout_id}")
def delete_workout(workout_id: str, key=Depends(require_key)):
    workouts = load_workouts()
    next_workouts = [w for w in workouts if w.get("id") != workout_id]
    if len(next_workouts) == len(workouts):
        raise HTTPException(status_code=404, detail="Workout not found")
    save_workouts(next_workouts)
    return {"ok": True}

@app.get("/workouts/prs")
def get_prs(key=Depends(require_key)):
    workouts = load_workouts()
    prs = {}
    for w in workouts:
        for ex in w.get("exercises", []):
            name = ex["name"]
            for s in ex.get("sets", []):
                if s.get("weight_kg") and s.get("reps"):
                    if name not in prs or s["weight_kg"] > prs[name]["weight_kg"]:
                        prs[name] = {"weight_kg": s["weight_kg"], "reps": s["reps"], "date": w["start_time"][:10]}
    return prs

# ── GOALS ─────────────────────────────────────────────────────────────
@app.get("/goals")
def get_goals(key=Depends(require_key)):
    p = WORKSPACE / "goals.md"
    return {"content": p.read_text() if p.exists() else "", "parsed": read_goals()}

class GoalsUpdate(BaseModel):
    calories: Optional[int] = None
    protein: Optional[int] = None
    gym_days: Optional[int] = None
    notes: Optional[str] = None

@app.put("/goals")
def update_goals(update: GoalsUpdate, key=Depends(require_key)):
    p = WORKSPACE / "goals.md"
    now = date.today().isoformat()
    goals = read_goals()
    if update.calories:
        goals["calories"] = update.calories
    if update.protein:
        goals["protein"] = update.protein
    if update.gym_days:
        goals["gym_days"] = update.gym_days
    content = f"""# Health Goals
_Last updated: {now}_

## Nutrition
- Daily calories: ~{goals["calories"]} kcal
- Protein: ~{goals["protein"]}g/day

## Fitness
- Gym: {goals["gym_days"]}x per week minimum

## Notes
{update.notes or "(not set)"}
"""
    p.write_text(content)
    return {"ok": True, "goals": goals}

# ── STATS ─────────────────────────────────────────────────────────────
@app.get("/stats/week")
def week_stats(key=Depends(require_key)):
    goals = read_goals()
    food_data = []
    for i in range(7):
        d = (date.today() - timedelta(days=i)).isoformat()
        content = read_food_file(d)
        total = sum(e["kcal"] for e in parse_entries(content))
        food_data.append({"date": d, "total_kcal": total, "logged": bool(content.strip())})
    workouts = load_workouts()
    week_start = (date.today() - timedelta(days=6)).isoformat()
    week_workouts = [w for w in workouts if w.get("start_time", "") >= week_start]
    logged_days = sum(1 for d in food_data if d["logged"])
    avg_kcal = sum(d["total_kcal"] for d in food_data if d["logged"]) // max(logged_days, 1)
    return {
        "food_by_day": food_data,
        "logged_days": logged_days,
        "avg_kcal": avg_kcal,
        "goal_kcal": goals["calories"],
        "workout_count": len(week_workouts),
        "goal_gym_days": goals["gym_days"],
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=False)

# ── USER PROFILE ──────────────────────────────────────────────────────
PROFILE_FILE = DATA_DIR / "profile.json"

class UserProfileIn(BaseModel):
    name: str
    calories: Optional[int] = None
    protein: Optional[int] = None

@app.get("/users/profile")
def get_profile(key=Depends(require_key)):
    goals = read_goals()
    name = "Brody"
    if PROFILE_FILE.exists():
        try:
            data = json.loads(PROFILE_FILE.read_text())
            name = data.get("name", name)
        except Exception:
            pass
    return {"name": name, "calories": goals["calories"], "protein": goals["protein"]}

@app.post("/users/profile")
def save_profile(profile: UserProfileIn, key=Depends(require_key)):
    # Persist name
    existing = {}
    if PROFILE_FILE.exists():
        try:
            existing = json.loads(PROFILE_FILE.read_text())
        except Exception:
            pass
    existing["name"] = profile.name.strip() or "Brody"
    PROFILE_FILE.write_text(json.dumps(existing))

    # If calories/protein provided, also update goals.md
    if profile.calories or profile.protein:
        goals = read_goals()
        if profile.calories:
            goals["calories"] = profile.calories
        if profile.protein:
            goals["protein"] = profile.protein
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        p = WORKSPACE / "goals.md"
        p.write_text(f"""# Health Goals\n_Last updated: {now}_\n\n## Nutrition\n- Daily calories: ~{goals['calories']} kcal\n- Protein: ~{goals['protein']}g/day\n\n## Fitness\n- Gym: {goals['gym_days']}x per week minimum\n""")

    return {"ok": True, "name": existing["name"]}


# ── LISTS (groceries, todos, custom) ─────────────────────────────────
LISTS_FILE = DATA_DIR / "lists.json"

def load_lists() -> dict:
    if LISTS_FILE.exists():
        return json.loads(LISTS_FILE.read_text())
    return {}

def save_lists(data: dict):
    LISTS_FILE.write_text(json.dumps(data, indent=2))

class ListItem(BaseModel):
    text: str
    checked: Optional[bool] = False

@app.get("/lists/{name}")
def get_list(name: str, key=Depends(require_key)):
    data = load_lists()
    return {"name": name, "items": data.get(name, [])}

@app.post("/lists/{name}/items")
def add_list_item(name: str, item: ListItem, key=Depends(require_key)):
    data = load_lists()
    items = data.setdefault(name, [])
    new_item = {"id": f"{int(datetime.now().timestamp()*1000)}", "text": item.text, "checked": item.checked or False, "added": datetime.now().isoformat()}
    items.append(new_item)
    save_lists(data)
    return {"ok": True, "item": new_item}

@app.patch("/lists/{name}/items/{item_id}")
def toggle_list_item(name: str, item_id: str, key=Depends(require_key)):
    data = load_lists()
    items = data.get(name, [])
    for item in items:
        if item["id"] == item_id:
            item["checked"] = not item.get("checked", False)
            save_lists(data)
            return {"ok": True, "item": item}
    raise HTTPException(status_code=404, detail="Item not found")

@app.delete("/lists/{name}/items/{item_id}")
def delete_list_item(name: str, item_id: str, key=Depends(require_key)):
    data = load_lists()
    items = data.get(name, [])
    data[name] = [i for i in items if i["id"] != item_id]
    save_lists(data)
    return {"ok": True}

@app.delete("/lists/{name}")
def clear_list(name: str, key=Depends(require_key)):
    data = load_lists()
    data.pop(name, None)
    save_lists(data)
    return {"ok": True}


# ── ROUTINES (skincare, workouts, custom) ─────────────────────────────
ROUTINES_FILE = DATA_DIR / "routines.json"

def load_routines() -> dict:
    if ROUTINES_FILE.exists():
        return json.loads(ROUTINES_FILE.read_text())
    return {}

def save_routines(data: dict):
    ROUTINES_FILE.write_text(json.dumps(data, indent=2))

@app.get("/routines/{name}")
def get_routine(name: str, key=Depends(require_key)):
    data = load_routines()
    routine = data.get(name, {"name": name, "log": []})
    log = routine.get("log", [])
    today_str = date.today().isoformat()
    done_today = any(e["date"] == today_str for e in log)
    # streak: count consecutive days back from today
    streak = 0
    d = date.today()
    while True:
        ds = d.isoformat()
        if any(e["date"] == ds for e in log):
            streak += 1
            d -= timedelta(days=1)
        else:
            break
    return {"name": name, "done_today": done_today, "streak": streak, "log": log[-30:]}

@app.post("/routines/{name}/log")
def log_routine(name: str, key=Depends(require_key)):
    data = load_routines()
    routine = data.setdefault(name, {"name": name, "log": []})
    today_str = date.today().isoformat()
    if not any(e["date"] == today_str for e in routine["log"]):
        routine["log"].append({"date": today_str, "logged_at": datetime.now().isoformat()})
    save_routines(data)
    return {"ok": True, "date": today_str}

# ── BODY WEIGHT ───────────────────────────────────────────────────────
WEIGHT_FILE = DATA_DIR / "weight_log.json"

def load_weights() -> list:
    if WEIGHT_FILE.exists():
        try:
            return json.loads(WEIGHT_FILE.read_text())
        except json.JSONDecodeError:
            return []
    return []

def save_weights(weights: list):
    # Atomic write so a crash mid-write can't corrupt the log.
    tmp = WEIGHT_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(weights, indent=2))
    tmp.replace(WEIGHT_FILE)

class WeightEntry(BaseModel):
    kg: float
    # Optional ISO date YYYY-MM-DD. Defaults to today on the server side.
    date: Optional[str] = None

@app.get("/weight")
def get_weight_log(days: int = 60, key=Depends(require_key)):
    """Return the weight log, oldest-first, capped to the last `days` window
    (so the client sparkline doesn't lug around a year of history)."""
    weights = load_weights()
    if not weights:
        return {"entries": []}
    cutoff = (date.today() - timedelta(days=max(1, min(days, 730)))).isoformat()
    filtered = [w for w in weights if w.get("date", "") >= cutoff]
    filtered.sort(key=lambda w: w["date"])
    return {"entries": filtered}

@app.post("/weight")
def log_weight(entry: WeightEntry, key=Depends(require_key)):
    """Record a weight reading. One per day — same-day re-logs OVERWRITE
    rather than appending (the user's 'this morning' weigh-in is the only
    one that matters for trend analysis). Clamps to a sane physiological
    range to catch typos."""
    if entry.kg < 30 or entry.kg > 300:
        raise HTTPException(status_code=400, detail="kg must be between 30 and 300")
    target = entry.date or date.today().isoformat()
    try:
        date.fromisoformat(target)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be ISO YYYY-MM-DD")
    weights = load_weights()
    # Overwrite same-day entry if it exists
    weights = [w for w in weights if w.get("date") != target]
    weights.append({
        "date": target,
        "kg": round(float(entry.kg), 2),
        "logged_at": datetime.now().isoformat(),
    })
    weights.sort(key=lambda w: w["date"])
    # Keep last 730 days (2 years) — bigger than the 60-day default read window
    # so users can switch year-on-year views later without losing data.
    weights = weights[-730:]
    save_weights(weights)
    return {"ok": True, "date": target, "kg": round(float(entry.kg), 2)}

@app.get("/routines/{name}/streak")
def get_streak(name: str, key=Depends(require_key)):
    data = load_routines()
    routine = data.get(name, {"log": []})
    log = routine.get("log", [])
    streak = 0
    d = date.today()
    while True:
        if any(e["date"] == d.isoformat() for e in log):
            streak += 1
            d -= timedelta(days=1)
        else:
            break
    return {"name": name, "streak": streak}


# ── AGENDA (today's plan + queue) ─────────────────────────────────────
AGENDA_FILE = DATA_DIR / "agenda.json"

def load_agenda() -> list:
    if AGENDA_FILE.exists():
        return json.loads(AGENDA_FILE.read_text())
    return []

def save_agenda(items: list):
    AGENDA_FILE.write_text(json.dumps(items, indent=2))

class AgendaItem(BaseModel):
    title: str
    notes: Optional[str] = None
    scheduled_date: Optional[str] = None  # ISO date, defaults to today

@app.get("/agenda/today")
def get_agenda_today(key=Depends(require_key)):
    items = load_agenda()
    today_str = date.today().isoformat()
    today_items = [i for i in items if i.get("scheduled_date", today_str) == today_str and not i.get("done")]
    return {"date": today_str, "items": today_items}

@app.post("/agenda")
def add_agenda_item(item: AgendaItem, key=Depends(require_key)):
    items = load_agenda()
    new_item = {
        "id": f"{int(datetime.now().timestamp()*1000)}",
        "title": item.title,
        "notes": item.notes,
        "scheduled_date": item.scheduled_date or date.today().isoformat(),
        "done": False,
        "created_at": datetime.now().isoformat(),
    }
    items.append(new_item)
    save_agenda(items)
    return {"ok": True, "item": new_item}

@app.patch("/agenda/{item_id}")
def update_agenda_item(item_id: str, key=Depends(require_key)):
    items = load_agenda()
    for item in items:
        if item["id"] == item_id:
            item["done"] = not item.get("done", False)
            item["done_at"] = datetime.now().isoformat() if item["done"] else None
            save_agenda(items)
            return {"ok": True, "item": item}
    raise HTTPException(status_code=404, detail="Item not found")

@app.delete("/agenda/{item_id}")
def delete_agenda_item(item_id: str, key=Depends(require_key)):
    items = load_agenda()
    items = [i for i in items if i["id"] != item_id]
    save_agenda(items)
    return {"ok": True}

# ── HEALTHKIT SYNC ────────────────────────────────────────────────────
# Endpoints for an iOS Shortcut that pushes Apple Health data into Health Hub.
# Covers: body weight, active calories, workouts (incl. gym sessions). The
# Shortcut is the only thing that knows about HealthKit — this side is
# storage-agnostic and just appends to JSON files.
HEALTHKIT_FILE = DATA_DIR / "healthkit.json"

class HealthKitWorkout(BaseModel):
    """A single workout / activity row from HealthKit."""
    type: str  # e.g. "Functional Strength Training", "Walking"
    start: str  # ISO 8601 datetime
    duration_min: float
    active_calories: Optional[float] = None
    distance_km: Optional[float] = None

class HealthKitPayload(BaseModel):
    # Use any combination — the Shortcut may push partial syncs (e.g. just weight).
    weight_kg: Optional[float] = None
    weight_at: Optional[str] = None  # ISO datetime
    active_calories_today: Optional[float] = None
    resting_calories_today: Optional[float] = None
    steps_today: Optional[int] = None
    workouts: Optional[list[HealthKitWorkout]] = None

def _read_healthkit() -> dict:
    if not HEALTHKIT_FILE.exists():
        return {"weight_log": [], "daily": [], "workouts": []}
    try:
        return json.loads(HEALTHKIT_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return {"weight_log": [], "daily": [], "workouts": []}

def _write_healthkit(data: dict):
    HEALTHKIT_FILE.write_text(json.dumps(data, indent=2))

@app.post("/healthkit/sync")
def healthkit_sync(payload: HealthKitPayload, key=Depends(require_key)):
    """Append HealthKit data to healthkit.json. Idempotent on workouts (dedupe
    by start+type) so the Shortcut can push the same window twice without
    duplicating entries. Returns counts so the Shortcut can show a toast."""
    store = _read_healthkit()

    added = {"weight": 0, "daily": 0, "workouts": 0}

    if payload.weight_kg is not None and payload.weight_at is not None:
        store["weight_log"].append({"kg": payload.weight_kg, "at": payload.weight_at})
        store["weight_log"] = store["weight_log"][-365:]  # cap at ~1yr
        added["weight"] = 1

    if any(v is not None for v in [payload.active_calories_today, payload.resting_calories_today, payload.steps_today]):
        today_str = date.today().isoformat()
        # Replace today's row if it exists (Shortcut may sync hourly); otherwise append.
        store["daily"] = [d for d in store["daily"] if d.get("date") != today_str]
        store["daily"].append({
            "date": today_str,
            "active_calories": payload.active_calories_today,
            "resting_calories": payload.resting_calories_today,
            "steps": payload.steps_today,
            "synced_at": datetime.now().isoformat(),
        })
        store["daily"] = store["daily"][-90:]  # 90-day window
        added["daily"] = 1

    if payload.workouts:
        existing_keys = {(w["start"], w["type"]) for w in store["workouts"]}
        for w in payload.workouts:
            key_pair = (w.start, w.type)
            if key_pair in existing_keys:
                continue
            store["workouts"].append({
                "type": w.type,
                "start": w.start,
                "duration_min": w.duration_min,
                "active_calories": w.active_calories,
                "distance_km": w.distance_km,
                "synced_at": datetime.now().isoformat(),
            })
            existing_keys.add(key_pair)
            added["workouts"] += 1
        store["workouts"] = store["workouts"][-365:]

    _write_healthkit(store)
    return {"ok": True, "added": added}

@app.get("/healthkit/latest")
def healthkit_latest(key=Depends(require_key)):
    """Returns latest synced summary so the frontend can show
    "Last HealthKit sync: 2 hours ago" + the most recent weight/active-cal totals."""
    store = _read_healthkit()
    last_weight = store["weight_log"][-1] if store["weight_log"] else None
    last_daily = store["daily"][-1] if store["daily"] else None
    last_workout = store["workouts"][-1] if store["workouts"] else None
    return {
        "last_weight": last_weight,
        "last_daily": last_daily,
        "last_workout": last_workout,
        "weight_count": len(store["weight_log"]),
        "workout_count": len(store["workouts"]),
    }


# ── WEEKLY REPORT ────────────────────────────────────────────────────
@app.get("/report/weekly")
def weekly_report(key=Depends(require_key)):
    """Returns a comprehensive summary of the past 7 days across all tracked
    health metrics: calories, protein, workouts, weight, sleep, routines,
    top foods, and hydration."""
    goals = read_goals()
    cal_goal = goals.get("calories", 2200)
    protein_goal = goals.get("protein", 160)
    gym_goal = goals.get("gym_days", 4)

    # ── Food data ────────────────────────────────────────────────────
    total_kcal = 0
    total_protein = 0
    logged_days = 0
    food_counts: dict[str, int] = {}  # name → count for top-foods

    for i in range(7):
        d = (date.today() - timedelta(days=i)).isoformat()
        content = read_food_file(d)
        entries = parse_entries(content)
        day_kcal = sum(e["kcal"] for e in entries)
        day_protein = sum(e.get("protein_g", 0) for e in entries)
        if entries:
            logged_days += 1
            total_kcal += day_kcal
            total_protein += day_protein
        # Count food names for top-foods
        for e in entries:
            # Strip leading "- " and trailing macro annotations
            raw = e.get("items", "")
            for line in raw.split("\n"):
                line = line.strip().lstrip("- ").strip()
                name = re.sub(r"\s*\(~\d+.*", "", line).strip()
                if name:
                    food_counts[name] = food_counts.get(name, 0) + 1

    weekly_cal_goal = 7 * cal_goal
    cal_pct = round(total_kcal / max(weekly_cal_goal, 1) * 100)
    avg_protein = round(total_protein / max(logged_days, 1))

    # Top 3 most logged foods
    top_foods = sorted(food_counts.items(), key=lambda x: x[1], reverse=True)[:3]

    # ── Workouts ─────────────────────────────────────────────────────
    workouts = load_workouts()
    week_start = (date.today() - timedelta(days=6)).isoformat()
    week_workouts = [w for w in workouts if w.get("start_time", "") >= week_start]
    workout_count = len(week_workouts)

    # ── Weight trend ─────────────────────────────────────────────────
    weights = load_weights()
    week_weights = [w for w in weights if w.get("date", "") >= week_start]
    weight_start = week_weights[0]["kg"] if week_weights else None
    weight_end = week_weights[-1]["kg"] if week_weights else None
    weight_change = round(weight_end - weight_start, 2) if weight_start and weight_end else None

    # ── Sleep ────────────────────────────────────────────────────────
    sleep_entries = load_sleep()
    week_sleep = [s for s in sleep_entries if s.get("date", "") >= week_start]
    avg_sleep_quality = round(sum(s["quality"] for s in week_sleep) / max(len(week_sleep), 1), 1) if week_sleep else None
    avg_sleep_duration = round(sum(s["duration_hrs"] for s in week_sleep) / max(len(week_sleep), 1), 1) if week_sleep else None

    # ── Routines ─────────────────────────────────────────────────────
    routines_data = load_routines()
    routine_streaks = {}
    for rname, rdata in routines_data.items():
        log = rdata.get("log", [])
        streak = 0
        d = date.today()
        while True:
            if any(e["date"] == d.isoformat() for e in log):
                streak += 1
                d -= timedelta(days=1)
            else:
                break
        if streak > 0:
            routine_streaks[rname] = streak

    # ── Hydration (not server-tracked; return null) ──────────────────
    hydration_avg = None  # localStorage-only on the client side

    # ── Text summary ─────────────────────────────────────────────────
    weight_str = f", {weight_change:+.1f}kg weight change" if weight_change is not None else ""
    summary = (
        f"This week: {cal_pct}% of calorie goal, "
        f"{workout_count} workout{'s' if workout_count != 1 else ''}"
        f"{weight_str}"
    )

    return {
        "period": {
            "start": week_start,
            "end": date.today().isoformat(),
        },
        "calories": {
            "total": total_kcal,
            "goal": weekly_cal_goal,
            "pct": cal_pct,
            "logged_days": logged_days,
        },
        "protein": {
            "avg_daily": avg_protein,
            "goal": protein_goal,
        },
        "workouts": {
            "count": workout_count,
            "goal": gym_goal,
        },
        "weight": {
            "start": weight_start,
            "end": weight_end,
            "change": weight_change,
        },
        "sleep": {
            "avg_quality": avg_sleep_quality,
            "avg_duration_hrs": avg_sleep_duration,
            "entries": len(week_sleep),
        },
        "routines": routine_streaks,
        "top_foods": [{"name": name, "count": count} for name, count in top_foods],
        "hydration_avg": hydration_avg,
        "summary": summary,
    }


# ── RECENT FOODS ─────────────────────────────────────────────────────
@app.get("/food/recent")
def recent_foods(days: int = 7, key=Depends(require_key)):
    """Returns deduplicated list of recently logged food items (name, kcal,
    protein_g) from the past N days. Powers the 'Recent' chips in Nutrition
    from server data instead of client-side parsing."""
    days = min(max(days, 1), 30)
    seen: dict[str, dict] = {}  # lowercase name → record

    for i in range(days):
        d = (date.today() - timedelta(days=i)).isoformat()
        content = read_food_file(d)
        entries = parse_entries(content)
        for e in entries:
            raw = e.get("items", "")
            for line in raw.split("\n"):
                line = line.strip().lstrip("- ").strip()
                name = re.sub(r"\s*\(~\d+.*", "", line).strip()
                if not name:
                    continue
                key_lower = name.lower()
                if key_lower not in seen:
                    seen[key_lower] = {
                        "name": name,
                        "kcal": e.get("kcal", 0),
                        "protein_g": e.get("protein_g", 0),
                    }

    return {"items": list(seen.values()), "days": days}


# ── SMART FOOD LOG (natural language → AI nutrition estimate) ────────
@app.post("/food/smart")
async def smart_food_log(body: dict = Body(...), key=Depends(require_key)):
    """Natural language food logging — AI estimates nutrition from description."""
    description = body.get("description", "").strip()
    if not description:
        raise HTTPException(400, "description required")

    prompt = f"""Estimate the nutritional content of this food. Be specific to UK products/portions where mentioned.

Food: {description}

Respond ONLY as JSON:
{{
  "meal": "short display name",
  "matched_product": "exact product name you identified (e.g. 'Its Bagels - Bacon Egg & Cheese Bagel' or 'Aldi Bramwells Sausage Rolls 4-pack')",
  "brand_or_shop": "brand/shop name if identified, or null",
  "portion_detail": "what portion you estimated (e.g. '1 bagel, approx 180g' or '1 roll from 4-pack, ~130g')",
  "kcal": 350,
  "protein_g": 12,
  "carbs_g": 40,
  "fat_g": 18,
  "confidence": "high or medium or low",
  "confidence_reason": "why this confidence level (e.g. 'exact product nutrition available' or 'estimated from similar products')"
}}

IMPORTANT:
- If a specific shop/brand is mentioned (Its Bagels, Greggs, Aldi, Tesco, Pret, etc.), identify the EXACT product from that shop. Say which product you matched.
- Use realistic UK portion sizes.
- "high" confidence = you know the exact product nutrition (chain restaurant, packaged food with known values).
- "medium" = you're estimating from similar products.
- "low" = rough guess, could be significantly off."""

    result = gemini_call(prompt)

    # Auto-determine meal type from time of day
    hour = datetime.now().hour
    if hour < 10:
        meal_type = "Breakfast"
    elif hour < 14:
        meal_type = "Lunch"
    elif hour < 17:
        meal_type = "Snack"
    else:
        meal_type = "Dinner"

    result.setdefault("meal", meal_type)
    result.setdefault("matched_product", result.get("meal", description))
    result["description"] = description

    return result


# ── HEALTH CHAT (AI assistant) ───────────────────────────────────────
@app.post("/chat")
async def health_chat(body: dict = Body(...), key=Depends(require_key)):
    """Natural language health assistant. Parses intent and returns a reply
    with an optional structured action the frontend can execute."""
    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(400, "message required")
    context = body.get("context", {})

    prompt = f"""You are a friendly health assistant for a fitness-focused person in the UK.

Today's stats: {json.dumps(context)}

User says: {message}

Determine the intent and respond as JSON:
{{
  "reply": "friendly response text",
  "action": null or one of: "log_food", "log_workout", "log_weight", "log_sleep", "add_list_item", "meal_suggestion", "weekly_summary",
  "data": {{}}
}}

For log_food: data = {{"meal": "Breakfast/Lunch/Snack/Dinner", "description": "what they ate", "kcal": N, "protein_g": N}}
For log_workout: data = {{"title": "workout name", "duration_min": N}}
For log_weight: data = {{"weight_kg": N}}
For log_sleep: data = {{"bedtime": "HH:MM", "wake_time": "HH:MM", "quality": 1-5}}
For add_list_item: data = {{"list": "groceries", "text": "item name"}}
For meal_suggestion: data = {{"suggestions": [{{"name": "...", "kcal": N, "protein_g": N}}]}}
For weekly_summary: data = {{}}

Rules:
- Be concise, warm, use emoji sparingly.
- Reference their remaining calorie/protein budget when relevant.
- If the user asks "how is my week" or similar, summarise from the context.
- For food logging, auto-detect meal type from time of day if not specified.
- If no specific action is needed (just chatting), set action to null and data to {{}}.
- Always estimate realistic UK portion sizes."""

    result = gemini_call(prompt, max_tokens=800, temperature=0.5)
    return result


# ── HEALTH CHECK ─────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "health-hub", "version": "1.0.0"}


# ── BODY METRICS (weight, body fat, measurements) ────────────────────
METRICS_FILE = DATA_DIR / "body_metrics.json"

def load_metrics() -> list:
    if METRICS_FILE.exists():
        return json.loads(METRICS_FILE.read_text())
    return []

def save_metrics(data: list):
    METRICS_FILE.write_text(json.dumps(data, indent=2))

class BodyMetricIn(BaseModel):
    weight_kg: Optional[float] = None
    body_fat_pct: Optional[float] = None
    waist_cm: Optional[float] = None
    chest_cm: Optional[float] = None
    arm_cm: Optional[float] = None
    notes: Optional[str] = None
    date: Optional[str] = None

@app.get("/metrics")
def get_metrics(days: int = 90, key=Depends(require_key)):
    metrics = load_metrics()
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    recent = [m for m in metrics if m.get("date", "") >= cutoff]
    return {"metrics": recent}

@app.post("/metrics")
def add_metric(entry: BodyMetricIn, key=Depends(require_key)):
    metrics = load_metrics()
    d = entry.date or date.today().isoformat()
    record = {
        "id": f"{int(datetime.now().timestamp()*1000)}",
        "date": d,
        "logged_at": datetime.now().isoformat(),
    }
    if entry.weight_kg is not None: record["weight_kg"] = entry.weight_kg
    if entry.body_fat_pct is not None: record["body_fat_pct"] = entry.body_fat_pct
    if entry.waist_cm is not None: record["waist_cm"] = entry.waist_cm
    if entry.chest_cm is not None: record["chest_cm"] = entry.chest_cm
    if entry.arm_cm is not None: record["arm_cm"] = entry.arm_cm
    if entry.notes: record["notes"] = entry.notes
    metrics.append(record)
    save_metrics(metrics)
    return {"ok": True, "metric": record}

@app.get("/metrics/latest")
def get_latest_metric(key=Depends(require_key)):
    metrics = load_metrics()
    if not metrics:
        return {"metric": None}
    return {"metric": metrics[-1]}


# ── TDEE CALCULATOR ──────────────────────────────────────────────────
import math

@app.get("/tdee")
def calculate_tdee(key=Depends(require_key)):
    """Calculate TDEE from profile + activity level + adaptive adjustment from food log."""
    profile_data = {}
    if PROFILE_FILE.exists():
        try:
            profile_data = json.loads(PROFILE_FILE.read_text())
        except Exception:
            pass

    weight_kg = profile_data.get("weight_kg", 80.0)
    height_cm = profile_data.get("height_cm", 180.0)
    age = profile_data.get("age", 25)
    sex = profile_data.get("sex", "male")
    activity_level = profile_data.get("activity_level", "moderate")

    # Latest weight from body metrics if available
    metrics = load_metrics()
    if metrics:
        for m in reversed(metrics):
            if "weight_kg" in m:
                weight_kg = m["weight_kg"]
                break

    # Mifflin-St Jeor BMR
    if sex == "female":
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161
    else:
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5

    multipliers = {
        "sedentary": 1.2,
        "light": 1.375,
        "moderate": 1.55,
        "active": 1.725,
        "very_active": 1.9,
    }
    mult = multipliers.get(activity_level, 1.55)
    tdee = round(bmr * mult)

    # Adaptive: compare avg intake over last 14 days vs TDEE
    avg_intake = 0
    logged_days = 0
    for i in range(14):
        d = (date.today() - timedelta(days=i)).isoformat()
        content = read_food_file(d)
        day_kcal = sum(int(m) for m in re.findall(r"~(\d+) kcal\)", content))
        if day_kcal > 0:
            avg_intake += day_kcal
            logged_days += 1
    if logged_days >= 3:
        avg_intake = round(avg_intake / logged_days)
    else:
        avg_intake = None

    # Weight trend (last 30 days) — require at least 3 data points spanning
    # multiple days to avoid absurd extrapolations like "+28 kg/week" from a
    # single-day pair of weigh-ins.
    weight_trend = None
    recent_weights = [(m["date"], m["weight_kg"]) for m in metrics if "weight_kg" in m][-30:]
    if len(recent_weights) >= 3:
        first_w = recent_weights[0][1]
        last_w = recent_weights[-1][1]
        days_span = (date.fromisoformat(recent_weights[-1][0]) - date.fromisoformat(recent_weights[0][0])).days
        if days_span >= 2:
            weekly_change = (last_w - first_w) / days_span * 7
            weight_trend = {"weekly_change_kg": round(weekly_change, 2), "direction": "gaining" if weekly_change > 0.1 else "losing" if weekly_change < -0.1 else "maintaining"}
        # If all data points are on the same day, trend is meaningless

    # Build response; include helpful message when trend data is insufficient
    weight_trend_msg = None
    if weight_trend is None and len(recent_weights) < 3:
        weight_trend_msg = "Log weight for 3+ days to see trends"

    return {
        "bmr": round(bmr),
        "tdee": tdee,
        "activity_level": activity_level,
        "weight_kg": weight_kg,
        "avg_intake_14d": avg_intake,
        "logged_days_14d": logged_days,
        "weight_trend": weight_trend,
        "weight_trend_message": weight_trend_msg,
        "recommendation": _tdee_recommendation(tdee, avg_intake, weight_trend),
    }

def _tdee_recommendation(tdee: int, avg_intake: Optional[int], weight_trend: Optional[dict]) -> str:
    if avg_intake is None:
        return "Log food for 3+ days to get adaptive recommendations."
    diff = avg_intake - tdee
    if weight_trend and weight_trend["direction"] == "gaining" and diff > 200:
        return f"Eating ~{diff} kcal above TDEE. Weight trending up. Consider reducing to {tdee} kcal for maintenance."
    elif weight_trend and weight_trend["direction"] == "losing" and diff < -200:
        return f"Eating ~{abs(diff)} kcal below TDEE. Weight trending down — on track if cutting."
    elif abs(diff) <= 200:
        return "Intake aligns well with TDEE. Weight should be stable."
    else:
        return f"Avg intake: {avg_intake} kcal vs TDEE: {tdee} kcal. Delta: {diff:+d} kcal/day."

@app.put("/tdee/profile")
def update_tdee_profile(key=Depends(require_key),
                        weight_kg: Optional[float] = None,
                        height_cm: Optional[float] = None,
                        age: Optional[int] = None,
                        sex: Optional[str] = None,
                        activity_level: Optional[str] = None):
    """Update TDEE profile fields (stored in profile.json)."""
    existing = {}
    if PROFILE_FILE.exists():
        try:
            existing = json.loads(PROFILE_FILE.read_text())
        except Exception:
            pass
    if weight_kg is not None: existing["weight_kg"] = weight_kg
    if height_cm is not None: existing["height_cm"] = height_cm
    if age is not None: existing["age"] = age
    if sex is not None: existing["sex"] = sex
    if activity_level is not None: existing["activity_level"] = activity_level
    PROFILE_FILE.write_text(json.dumps(existing, indent=2))
    return {"ok": True, "profile": existing}


# ── HRV + SLEEP TRACKING ────────────────────────────────────────────
SLEEP_FILE = DATA_DIR / "sleep.json"

def load_sleep() -> list:
    if SLEEP_FILE.exists():
        return json.loads(SLEEP_FILE.read_text())
    return []

def save_sleep(data: list):
    SLEEP_FILE.write_text(json.dumps(data, indent=2))

class SleepEntryIn(BaseModel):
    bedtime: str          # HH:MM
    wake_time: str        # HH:MM
    quality: int = 3      # 1-5 scale
    hrv_ms: Optional[int] = None
    resting_hr: Optional[int] = None
    notes: Optional[str] = None
    date: Optional[str] = None

@app.get("/sleep")
def get_sleep(days: int = 30, key=Depends(require_key)):
    entries = load_sleep()
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    recent = [e for e in entries if e.get("date", "") >= cutoff]
    return {"entries": recent}

@app.post("/sleep")
def log_sleep(entry: SleepEntryIn, key=Depends(require_key)):
    entries = load_sleep()
    d = entry.date or date.today().isoformat()
    bed_h, bed_m = map(int, entry.bedtime.split(":"))
    wake_h, wake_m = map(int, entry.wake_time.split(":"))
    bed_mins = bed_h * 60 + bed_m
    wake_mins = wake_h * 60 + wake_m
    if wake_mins <= bed_mins:
        wake_mins += 24 * 60
    duration_hrs = round((wake_mins - bed_mins) / 60, 1)

    record = {
        "id": f"{int(datetime.now().timestamp()*1000)}",
        "date": d,
        "bedtime": entry.bedtime,
        "wake_time": entry.wake_time,
        "duration_hrs": duration_hrs,
        "quality": min(max(entry.quality, 1), 5),
        "logged_at": datetime.now().isoformat(),
    }
    if entry.hrv_ms is not None: record["hrv_ms"] = entry.hrv_ms
    if entry.resting_hr is not None: record["resting_hr"] = entry.resting_hr
    if entry.notes: record["notes"] = entry.notes
    entries.append(record)
    save_sleep(entries)
    return {"ok": True, "sleep": record}

@app.get("/sleep/stats")
def sleep_stats(days: int = 7, key=Depends(require_key)):
    entries = load_sleep()
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    recent = [e for e in entries if e.get("date", "") >= cutoff]
    if not recent:
        return {"avg_duration": None, "avg_quality": None, "avg_hrv": None, "entries": 0}
    avg_dur = round(sum(e["duration_hrs"] for e in recent) / len(recent), 1)
    avg_qual = round(sum(e["quality"] for e in recent) / len(recent), 1)
    hrv_entries = [e["hrv_ms"] for e in recent if "hrv_ms" in e]
    avg_hrv = round(sum(hrv_entries) / len(hrv_entries)) if hrv_entries else None
    return {"avg_duration": avg_dur, "avg_quality": avg_qual, "avg_hrv": avg_hrv, "entries": len(recent)}


# ── HEALTH TIMELINE ──────────────────────────────────────────────────
@app.get("/timeline")
def get_timeline(days: int = 7, key=Depends(require_key)):
    """Unified chronological view across food, workouts, sleep, metrics, routines."""
    events = []
    for i in range(days):
        d = (date.today() - timedelta(days=i)).isoformat()

        content = read_food_file(d)
        day_kcal = sum(int(m) for m in re.findall(r"~(\d+) kcal\)", content))
        if day_kcal > 0:
            entries = parse_entries(content)
            events.append({"date": d, "type": "food", "summary": f"{day_kcal} kcal logged", "detail": f"{len(entries)} meals", "value": day_kcal})

        workouts = load_workouts()
        day_workouts = [w for w in workouts if w.get("start_time", "").startswith(d)]
        for w in day_workouts:
            events.append({"date": d, "type": "workout", "summary": w["title"], "detail": f"{len(w.get('exercises', []))} exercises"})

        sleep_entries = load_sleep()
        day_sleep = [s for s in sleep_entries if s.get("date") == d]
        for s in day_sleep:
            qual_label = ["", "Poor", "Fair", "OK", "Good", "Great"][s.get("quality", 3)]
            events.append({"date": d, "type": "sleep", "summary": f"{s['duration_hrs']}h sleep ({qual_label})", "detail": f"HRV: {s.get('hrv_ms', '?')} ms" if s.get("hrv_ms") else None})

        metrics = load_metrics()
        day_metrics = [m for m in metrics if m.get("date") == d]
        for m in day_metrics:
            parts = []
            if "weight_kg" in m: parts.append(f"{m['weight_kg']}kg")
            if "body_fat_pct" in m: parts.append(f"{m['body_fat_pct']}% BF")
            if parts:
                events.append({"date": d, "type": "metric", "summary": " . ".join(parts)})

        routines_data = load_routines()
        for rname, rdata in routines_data.items():
            for entry in rdata.get("log", []):
                if entry.get("date") == d:
                    events.append({"date": d, "type": "routine", "summary": rname.replace("-", " ").title()})

    events.sort(key=lambda e: e["date"], reverse=True)
    return {"events": events, "days": days}


# ── BARCODE SCANNER (nutrition lookup) ────────────────────────────────
@app.get("/barcode/{code}")
def barcode_lookup(code: str, key=Depends(require_key)):
    """Look up a barcode via Open Food Facts (free, no API key needed)."""
    import urllib.request
    url = f"https://world.openfoodfacts.org/api/v2/product/{code}.json"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HealthHub/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Open Food Facts lookup failed: {e}")

    if data.get("status") != 1:
        # Fallback: ask AI to identify the product from the barcode number
        prompt = f"""A UK grocery product has barcode number {code}.
What product is this likely to be? Estimate its nutritional content per 100g.
Respond as JSON: {{"name": "product name", "brand": "brand or unknown", "kcal": 250, "protein_g": 10, "carbs_g": 30, "fat_g": 12, "source": "ai_estimate"}}
If you don't recognize the barcode, make your best guess based on common UK products with similar barcode prefixes (50 = UK, 54 = Belgium, etc.)."""
        try:
            ai_result = gemini_call(prompt)
            return {
                "code": code,
                "name": ai_result.get("name", "Unknown product"),
                "brand": ai_result.get("brand", ""),
                "serving_size": "",
                "source": "ai_estimate",
                "per_100g": {
                    "kcal": ai_result.get("kcal", 0),
                    "protein_g": ai_result.get("protein_g", 0),
                    "carbs_g": ai_result.get("carbs_g", 0),
                    "fat_g": ai_result.get("fat_g", 0),
                    "fiber_g": 0,
                    "sugar_g": 0,
                    "salt_g": 0,
                },
                "image_url": "",
            }
        except Exception:
            raise HTTPException(status_code=404, detail="Product not found in Open Food Facts or AI estimate")

    product = data.get("product", {})
    nutrients = product.get("nutriments", {})
    return {
        "code": code,
        "name": product.get("product_name", "Unknown"),
        "brand": product.get("brands", ""),
        "serving_size": product.get("serving_size", ""),
        "source": "open_food_facts",
        "per_100g": {
            "kcal": nutrients.get("energy-kcal_100g", 0),
            "protein_g": nutrients.get("proteins_100g", 0),
            "carbs_g": nutrients.get("carbohydrates_100g", 0),
            "fat_g": nutrients.get("fat_100g", 0),
            "fiber_g": nutrients.get("fiber_100g", 0),
            "sugar_g": nutrients.get("sugars_100g", 0),
            "salt_g": nutrients.get("salt_100g", 0),
        },
        "image_url": product.get("image_front_url", ""),
    }


# ── WITHINGS OAUTH STUB ─────────────────────────────────────────────
WITHINGS_FILE = DATA_DIR / "withings_config.json"

@app.get("/withings/status")
def withings_status(key=Depends(require_key)):
    if WITHINGS_FILE.exists():
        try:
            config = json.loads(WITHINGS_FILE.read_text())
            return {"connected": bool(config.get("access_token")), "last_sync": config.get("last_sync")}
        except Exception:
            pass
    return {"connected": False, "last_sync": None, "message": "Withings integration not configured. Requires Withings Body Smart scale + OAuth setup."}

@app.get("/withings/auth-url")
def withings_auth_url(key=Depends(require_key)):
    """Generate OAuth2 authorization URL for Withings. Needs client_id in config."""
    if WITHINGS_FILE.exists():
        try:
            config = json.loads(WITHINGS_FILE.read_text())
            client_id = config.get("client_id")
            if client_id:
                redirect_uri = config.get("redirect_uri", "https://health-hub-dwz.pages.dev/withings-callback")
                return {"url": f"https://account.withings.com/oauth2_user/authorize2?response_type=code&client_id={client_id}&scope=user.metrics&redirect_uri={redirect_uri}&state=healthhub"}
        except Exception:
            pass
    return {"url": None, "message": "Configure Withings client_id first. Purchase scale + register at developer.withings.com."}
