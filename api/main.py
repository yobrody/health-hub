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
    # Split content into blocks starting with ### HH:MM
    blocks = re.split(r"(?=### \d{2}:\d{2} — )", content)
    for block in blocks:
        m = re.match(r"### (\d{2}:\d{2}) — (.+?)\n((?:- .+(?:\n|$))+)", block)
        if not m:
            continue
        time, meal, items = m.group(1), m.group(2), m.group(3)
        kcal_match = re.search(r"~(\d+) kcal", items)
        protein_match = re.search(r"~(\d+) g protein", items)
        entry: dict = {
            "time": time,
            "meal": meal,
            "items": items.strip(),
            "kcal": int(kcal_match.group(1)) if kcal_match else 0,
            "protein_g": int(protein_match.group(1)) if protein_match else 0,
        }
        # Extract extended macros from <!-- ... --> comment in the block
        comment = re.search(r"<!--\s*(.+?)\s*-->", block)
        if comment:
            meta = comment.group(1)
            for key, field in [("carbs", "carbs_g"), ("fat", "fat_g"),
                               ("fiber", "fiber_g"), ("sugar", "sugar_g")]:
                vm = re.search(rf"{key}=(\d+)g", meta)
                if vm:
                    entry[field] = int(vm.group(1))
            sm = re.search(r"sodium=(\d+)mg", meta)
            if sm:
                entry["sodium_mg"] = int(sm.group(1))
            cm = re.search(r"confidence=(\w+)", meta)
            if cm:
                entry["confidence"] = cm.group(1)
        entries.append(entry)
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
    carbs_g: Optional[int] = None
    fat_g: Optional[int] = None
    fiber_g: Optional[int] = None
    sugar_g: Optional[int] = None
    sodium_mg: Optional[int] = None
    confidence: Optional[str] = None
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
    # Extended macros stored as metadata comment for richer detail views
    macro_parts = []
    if entry.carbs_g is not None:
        macro_parts.append(f"carbs={entry.carbs_g}g")
    if entry.fat_g is not None:
        macro_parts.append(f"fat={entry.fat_g}g")
    if entry.fiber_g is not None:
        macro_parts.append(f"fiber={entry.fiber_g}g")
    if entry.sugar_g is not None:
        macro_parts.append(f"sugar={entry.sugar_g}g")
    if entry.sodium_mg is not None:
        macro_parts.append(f"sodium={entry.sodium_mg}mg")
    if entry.confidence:
        macro_parts.append(f"confidence={entry.confidence}")
    macro_comment = f"\n<!-- {' '.join(macro_parts)} -->" if macro_parts else ""
    block = "\n### " + t + " — " + entry.meal + "\n- " + entry.description + " (~" + str(entry.kcal) + " kcal" + protein_str + ")" + macro_comment + "\n**Subtotal: ~" + str(entry.kcal) + " kcal**\n"
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
        "IMPORTANT: If the image appears to be upside-down, mirrored, or rotated, still identify its contents. "
        "Read text in any orientation. If you see product packaging, read the brand name even if the text is flipped or rotated.\n\n"
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
        "  Rules for food identification:\n"
        "  - Count items separately. If there are 2 pies, list as '2x chicken pot pie' with nutrition for BOTH combined.\n"
        "  - Be specific with UK products — use brand names when recognizable from packaging or appearance (e.g. 'Aldi Brooklea Greek Yogurt' not just 'yogurt').\n"
        "  - Estimate portion sizes carefully based on plate/bowl size, depth, and visual density:\n"
        "    * A full bowl of yogurt with toppings is typically 200-350g (250-400 kcal), NOT 60 kcal.\n"
        "    * A standard dinner plate filled = 400-600g of food.\n"
        "    * A sandwich = typically 250-400 kcal depending on filling.\n"
        "  - For each item, the 'grams' field should reflect the actual visible portion weight.\n"
        "  - If multiple units of the same food are visible, combine them into one entry with total nutrition.\n"
        '  confidence: "high" if clearly identifiable, "medium" if somewhat ambiguous, "low" if very uncertain\n'
    )
    parsed = gemini_call(prompt, image_b64=input.image, mime_type=media_type, max_tokens=2000, temperature=0.2)
    scan_type = parsed.get("type", "food")

    if scan_type == "barcode":
        code = parsed.get("code")
        if code:
            return {"type": "barcode", "code": code}
        # Barcode not readable — re-classify as food product from the packaging
        food_prompt = (
            "This is a photo of a food product. Identify it from the packaging and estimate nutrition.\n"
            "IMPORTANT: If the image appears to be upside-down, mirrored, or rotated, still identify its contents. "
            "Read text in any orientation. If you see product packaging, read the brand name even if the text is flipped or rotated.\n"
            'Respond as JSON: {"type": "food", "foods": [{"name": "product name", "kcal": N, "protein_g": N, "carbs_g": N, "fat_g": N, "grams": N}], "confidence": "medium"}\n'
            "Be specific — include the brand name if visible."
        )
        parsed = gemini_call(food_prompt, image_b64=input.image, mime_type=media_type, max_tokens=1000, temperature=0.2)
        scan_type = "food"

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

# ── FOOD RECALCULATE ─────────────────────────────────────────────────
@app.post("/food/recalculate")
async def recalculate_food(body: dict = Body(...), key=Depends(require_key)):
    """Recalculate nutrition for a corrected food item name."""
    name = body.get("name", "").strip()
    original_name = body.get("original_name", "")
    if not name:
        raise HTTPException(400, "name required")

    # Check fridge for brand context
    fridge_context = ""
    try:
        fridge = read_fridge()
        all_items = []
        for section in fridge.values():
            if isinstance(section, list):
                all_items.extend([i.get("name", "") for i in section])
        matching = [i for i in all_items if name.lower().split()[0] in i.lower() or i.lower() in name.lower()]
        if matching:
            fridge_context = f"\nThe user has these in their fridge that might match: {', '.join(matching)}. Use the specific product nutrition if it matches."
    except Exception:
        pass

    prompt = f"""Estimate nutrition for this specific food item:
"{name}"
{fridge_context}

Respond as JSON: {{"name": "corrected display name", "kcal": N, "protein_g": N, "carbs_g": N, "fat_g": N, "grams": N, "confidence": "high|medium|low", "note": "brief explanation of estimate"}}

Be precise. If a count is specified (e.g. "2 chicken pot pies"), calculate for the total quantity. Use UK supermarket products where relevant."""

    result = gemini_call(prompt)
    # Normalise fields
    return {
        "name": (result.get("name") or name).strip(),
        "kcal": int(result.get("kcal") or 0),
        "protein_g": round(float(result.get("protein_g") or 0)),
        "carbs_g": round(float(result.get("carbs_g") or 0)),
        "fat_g": round(float(result.get("fat_g") or 0)),
        "grams": int(result.get("grams") or 0) if result.get("grams") else None,
        "confidence": result.get("confidence", "medium"),
        "note": result.get("note", ""),
    }

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

# ── MEAL PLANNING ────────────────────────────────────────────────────
MEAL_PLAN_FILE = DATA_DIR / "meal_plans.json"

def load_meal_plans() -> dict:
    if MEAL_PLAN_FILE.exists():
        try:
            return json.loads(MEAL_PLAN_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}

def save_meal_plans(plans: dict):
    MEAL_PLAN_FILE.write_text(json.dumps(plans, indent=2))

@app.post("/ai/meal-plan")
async def meal_plan(body: dict = Body(...), key=Depends(require_key)):
    """Generate a meal plan for tomorrow based on goals, fridge, and today's intake."""
    goals = read_goals()
    target_kcal = body.get("target_kcal", goals.get("calories", 2200))
    target_protein = body.get("target_protein", goals.get("protein", 160))

    # Today's intake for context
    today_content = read_food_file()
    today_entries = parse_entries(today_content)
    eaten_kcal = sum(e["kcal"] for e in today_entries)
    eaten_protein = sum(e.get("protein_g", 0) for e in today_entries)

    # Fridge contents
    fridge = read_fridge()
    all_items = [i["name"] for sec in fridge.values() for i in sec]
    fridge_str = ", ".join(all_items) if all_items else "(fridge is empty)"

    # Optional swap: regenerate just one meal slot
    swap_slot = body.get("swap")  # e.g. "lunch"
    existing_plan = body.get("existing_plan")  # list of 4 meals to keep context

    if swap_slot and existing_plan:
        keep = [m for m in existing_plan if m.get("slot") != swap_slot]
        keep_str = "; ".join(f'{m["slot"]}: {m["name"]} ({m["kcal"]} kcal, {m["protein_g"]}g protein)' for m in keep)
        budget_kcal = target_kcal - sum(m.get("kcal", 0) for m in keep)
        budget_protein = target_protein - sum(m.get("protein_g", 0) for m in keep)
        prompt = (
            f"I need a replacement {swap_slot} meal for tomorrow.\n"
            f"Fridge: {fridge_str}\n"
            f"The other meals are: {keep_str}\n"
            f"This meal must fit ~{budget_kcal} kcal and ~{budget_protein}g protein.\n"
            f"Must be a realistic UK meal. Use fridge items where possible.\n\n"
            'Return ONLY this JSON:\n'
            '{"slot":"' + swap_slot + '","name":"Meal Name","ingredients":["item1","item2"],"kcal":500,"protein_g":35,"carbs_g":50,"fat_g":15,"prep_minutes":10}'
        )
        result = gemini_call(prompt, max_tokens=400, temperature=0.7)
        if isinstance(result, dict) and "slot" not in result:
            result["slot"] = swap_slot
        return {"meal": result}

    prompt = (
        f"Create a full meal plan for tomorrow with exactly 4 meals: breakfast, lunch, dinner, snack.\n"
        f"Daily targets: ~{target_kcal} kcal total, ~{target_protein}g protein total.\n"
        f"Fridge/pantry contents: {fridge_str}\n"
        f"Today's intake so far: {eaten_kcal} kcal, {eaten_protein}g protein "
        f"(context only — plan is for TOMORROW, a fresh day).\n\n"
        "Rules:\n"
        "- Use items from the fridge/pantry where possible\n"
        "- All meals should be realistic UK meals (practical, not fancy)\n"
        "- The 4 meals together must roughly hit the calorie and protein targets\n"
        "- Include prep time estimate for each meal\n\n"
        'Return ONLY this JSON (no markdown):\n'
        '{"meals":[\n'
        '  {"slot":"breakfast","name":"Meal Name","ingredients":["item1","item2"],"kcal":500,"protein_g":35,"carbs_g":50,"fat_g":15,"prep_minutes":10},\n'
        '  {"slot":"lunch","name":"...","ingredients":["..."],"kcal":600,"protein_g":40,"carbs_g":60,"fat_g":20,"prep_minutes":15},\n'
        '  {"slot":"dinner","name":"...","ingredients":["..."],"kcal":700,"protein_g":50,"carbs_g":70,"fat_g":25,"prep_minutes":25},\n'
        '  {"slot":"snack","name":"...","ingredients":["..."],"kcal":300,"protein_g":20,"carbs_g":30,"fat_g":10,"prep_minutes":5}\n'
        ']}'
    )
    parsed = gemini_call(prompt, max_tokens=1200, temperature=0.6)
    meals = parsed.get("meals") if isinstance(parsed, dict) else parsed
    if not isinstance(meals, list):
        meals = []

    # Calculate totals
    total_kcal = sum(m.get("kcal", 0) for m in meals)
    total_protein = sum(m.get("protein_g", 0) for m in meals)

    # Save plan for tomorrow
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    plans = load_meal_plans()
    plans[tomorrow] = {"meals": meals, "generated_at": datetime.now().isoformat()}
    save_meal_plans(plans)

    return {
        "date": tomorrow,
        "meals": meals,
        "totals": {"kcal": total_kcal, "protein_g": total_protein},
        "targets": {"kcal": target_kcal, "protein_g": target_protein},
    }

@app.get("/ai/meal-plan/{plan_date}")
def get_meal_plan(plan_date: str, key=Depends(require_key)):
    """Retrieve a previously generated meal plan by date."""
    plans = load_meal_plans()
    plan = plans.get(plan_date)
    if not plan:
        raise HTTPException(status_code=404, detail="No meal plan for that date")
    meals = plan.get("meals", [])
    return {
        "date": plan_date,
        "meals": meals,
        "totals": {
            "kcal": sum(m.get("kcal", 0) for m in meals),
            "protein_g": sum(m.get("protein_g", 0) for m in meals),
        },
    }

@app.post("/ai/meal-plan/use")
async def use_meal_plan(body: dict = Body(...), key=Depends(require_key)):
    """Pre-fill tomorrow's food log slots from a meal plan."""
    meals = body.get("meals", [])
    plan_date = body.get("date")
    if not plan_date or not meals:
        raise HTTPException(status_code=400, detail="date and meals required")

    # Build markdown entries for each meal
    slot_times = {"breakfast": "08:00", "lunch": "12:30", "dinner": "18:30", "snack": "15:00"}
    p = food_file(plan_date)
    lines = []
    if p.exists():
        lines = [p.read_text()]
    for meal in meals:
        slot = meal.get("slot", "meal")
        t = slot_times.get(slot, "12:00")
        name = meal.get("name", slot.title())
        kcal = meal.get("kcal", 0)
        protein = meal.get("protein_g", 0)
        ingredients = ", ".join(meal.get("ingredients", []))
        lines.append(f"\n### {t} — {name}")
        lines.append(f"- {ingredients}")
        lines.append(f"- ~{kcal} kcal | ~{protein} g protein")
        # Extended macros comment
        carbs = meal.get("carbs_g")
        fat = meal.get("fat_g")
        if carbs is not None or fat is not None:
            meta_parts = []
            if carbs is not None:
                meta_parts.append(f"carbs={carbs}g")
            if fat is not None:
                meta_parts.append(f"fat={fat}g")
            meta_parts.append("confidence=planned")
            lines.append(f"<!-- {' '.join(meta_parts)} -->")

    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(lines))
    return {"ok": True, "date": plan_date, "meals_added": len(meals)}

# ── RECIPE CALCULATOR ─────────────────────────────────────────────────
@app.post("/recipes/calculate")
async def calculate_recipe(body: dict = Body(...), key=Depends(require_key)):
    """Calculate per-serving macros from a list of ingredients."""
    ingredients = body.get("ingredients", [])
    servings = body.get("servings", 1)
    if not ingredients:
        raise HTTPException(status_code=400, detail="ingredients list required")

    prompt = f"""Calculate total and per-serving nutrition for this recipe:
Ingredients: {json.dumps(ingredients)}
Servings: {servings}

Respond as JSON:
{{"recipe_total": {{"kcal": N, "protein_g": N, "carbs_g": N, "fat_g": N, "fiber_g": N}},
 "per_serving": {{"kcal": N, "protein_g": N, "carbs_g": N, "fat_g": N, "fiber_g": N}},
 "ingredients": [{{"name": "...", "amount": "...", "kcal": N, "protein_g": N}}],
 "confidence": "high|medium|low"}}"""

    result = gemini_call(prompt, max_tokens=1200)
    result["servings"] = servings
    return result

# ── WATER TRACKING ────────────────────────────────────────────────────
WATER_DIR = DATA_DIR / "water"
WATER_DIR.mkdir(parents=True, exist_ok=True)

def _water_file(d: str = None) -> Path:
    d = d or today()
    return WATER_DIR / f"{d}.json"

def _read_water(d: str = None) -> dict:
    p = _water_file(d)
    if p.exists():
        try:
            return json.loads(p.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"date": d or today(), "entries": [], "total_ml": 0, "goal_ml": 2000}

def _write_water(data: dict):
    p = _water_file(data.get("date"))
    p.write_text(json.dumps(data, indent=2))

@app.get("/water")
def get_water(d: str = None, key=Depends(require_key)):
    """Get water intake for a date (defaults to today)."""
    return _read_water(d)

@app.post("/water")
def log_water(body: dict = Body(...), key=Depends(require_key)):
    """Log water intake. Body: {ml: 250, label?: "Glass", date?: "2026-05-28"}"""
    ml = body.get("ml", 250)
    label = body.get("label", "Water")
    d = body.get("date") or today()
    data = _read_water(d)
    entry = {
        "time": datetime.now().strftime("%H:%M"),
        "ml": ml,
        "label": label,
    }
    data["entries"].append(entry)
    data["total_ml"] = sum(e["ml"] for e in data["entries"])
    data["date"] = d
    _write_water(data)
    return {"ok": True, "total_ml": data["total_ml"], "entry": entry}

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
    def _wd(w):
        if "date" in w: return w["date"][:10]
        wid = w.get("id", "")
        return wid[:10] if len(wid) >= 10 and wid[4] == "-" and wid[7] == "-" else w.get("start_time", "")[:10]
    week_workouts = [w for w in workouts if _wd(w) >= week_start]
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

    def _wk_date(w):
        if "date" in w: return w["date"][:10]
        wid = w.get("id", "")
        if len(wid) >= 10 and wid[4] == "-" and wid[7] == "-": return wid[:10]
        return w.get("start_time", "")[:10]

    week_workouts = [w for w in workouts if _wk_date(w) >= week_start]
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
        "text_summary": summary,
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
  "fiber_g": 3,
  "sugar_g": 8,
  "sodium_mg": 450,
  "confidence": "high or medium or low",
  "confidence_reason": "why this confidence level (e.g. 'exact product nutrition available' or 'estimated from similar products')"
}}

IMPORTANT:
- If a specific shop/brand is mentioned (Its Bagels, Greggs, Aldi, Tesco, Pret, etc.), identify the EXACT product from that shop. Say which product you matched.
- Use realistic UK portion sizes.
- "high" confidence = you know the exact product nutrition (chain restaurant, packaged food with known values).
- "medium" = you're estimating from similar products.
- "low" = rough guess, could be significantly off.
- fiber_g, sugar_g, sodium_mg are estimates - provide best guesses based on the food type."""

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


# ── FOOD DATABASE SEARCH (Open Food Facts) ───────────────────────────
@app.get("/food/search")
def food_search(q: str, key=Depends(require_key)):
    """Search verified food database (Open Food Facts). Returns matching products with nutrition."""
    import urllib.request, urllib.parse
    url = (
        f"https://uk.openfoodfacts.net/cgi/search.pl?"
        f"search_terms={urllib.parse.quote(q)}&search_simple=1&action=process&json=1"
        f"&page_size=10&fields=product_name,brands,nutriments,image_front_small_url,quantity,serving_size"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HealthHub/2.0 (brody@healthhub.app)"})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode())
        results = []
        for p in (data.get("products") or []):
            n = p.get("nutriments", {})
            results.append({
                "name": p.get("product_name", "Unknown"),
                "brand": p.get("brands", ""),
                "serving_size": p.get("serving_size", ""),
                "quantity": p.get("quantity", ""),
                "image_url": p.get("image_front_small_url", ""),
                "per_100g": {
                    "kcal": round(n.get("energy-kcal_100g", 0)),
                    "protein_g": round(n.get("proteins_100g", 0), 1),
                    "carbs_g": round(n.get("carbohydrates_100g", 0), 1),
                    "fat_g": round(n.get("fat_100g", 0), 1),
                    "fiber_g": round(n.get("fiber_100g", 0), 1),
                    "sugar_g": round(n.get("sugars_100g", 0), 1),
                    "sodium_mg": round(n.get("sodium_100g", 0) * 1000, 0),
                    "salt_g": round(n.get("salt_100g", 0), 1),
                },
                "source": "open_food_facts",
            })
        return {"query": q, "results": results, "count": len(results)}
    except Exception as e:
        return {"query": q, "results": [], "count": 0, "error": str(e)}


# ── ADAPTIVE TDEE (MacroFactor-style) ────────────────────────────────
@app.get("/tdee/adaptive")
def adaptive_tdee(key=Depends(require_key)):
    """Adaptive TDEE — adjusts weekly based on actual weight trend vs calorie intake.
    Uses the same principle as MacroFactor: if you're eating X calories and gaining Y weight,
    your true TDEE is calculable from the energy balance equation."""

    # --- Gather profile for estimated TDEE baseline ---
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

    # Latest weight from body metrics
    metrics = load_metrics()
    for m in reversed(metrics):
        if "weight_kg" in m:
            weight_kg = m["weight_kg"]
            break

    # Mifflin-St Jeor BMR
    if sex == "female":
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161
    else:
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
    multipliers = {"sedentary": 1.2, "light": 1.375, "moderate": 1.55, "active": 1.725, "very_active": 1.9}
    estimated_tdee = round(bmr * multipliers.get(activity_level, 1.55))

    # --- Pull last 14 days of food logs (total calories per day) ---
    daily_intake: list[tuple[str, int]] = []  # (date_str, kcal)
    for i in range(14):
        d = (date.today() - timedelta(days=i)).isoformat()
        content = read_food_file(d)
        day_kcal = sum(int(m) for m in re.findall(r"~(\d+) kcal\)", content))
        if day_kcal > 0:
            daily_intake.append((d, day_kcal))

    # --- Pull last 14 days of weight data ---
    weights = load_weights()
    cutoff_14d = (date.today() - timedelta(days=14)).isoformat()
    recent_weights = [(w["date"], w["kg"]) for w in weights if w.get("date", "") >= cutoff_14d]
    recent_weights.sort(key=lambda x: x[0])

    food_days = len(daily_intake)
    weight_entries = len(recent_weights)
    sufficient_data = food_days >= 7 and weight_entries >= 3
    tentative_data = food_days >= 3 and weight_entries >= 2

    result: dict = {
        "estimated_tdee": estimated_tdee,
        "bmr": round(bmr),
        "activity_level": activity_level,
        "weight_kg": weight_kg,
        "data_status": {
            "food_days_logged": food_days,
            "weight_entries": weight_entries,
            "sufficient": sufficient_data,
            "tentative": tentative_data and not sufficient_data,
            "message": None,
        },
    }

    if not sufficient_data and not tentative_data:
        missing = []
        if food_days < 3:
            missing.append(f"need {3 - food_days} more days of food logging")
        if weight_entries < 2:
            missing.append(f"need {2 - weight_entries} more weight entries")
        result["data_status"]["message"] = "Insufficient data: " + "; ".join(missing)
        result["adaptive_tdee"] = None
        result["source"] = "estimated"
        result["recommendation"] = _adaptive_recommendation(estimated_tdee, None, profile_data)
        return result

    # --- Calculate adaptive TDEE ---
    avg_daily_intake = round(sum(kcal for _, kcal in daily_intake) / food_days)

    # Weight change: earliest vs latest in the 14-day window
    first_weight = recent_weights[0][1]
    last_weight = recent_weights[-1][1]
    weight_change_kg = last_weight - first_weight
    days_span = max((date.fromisoformat(recent_weights[-1][0]) - date.fromisoformat(recent_weights[0][0])).days, 1)

    # 1 kg body weight change ~ 7700 kcal surplus/deficit
    # True TDEE = avg_daily_intake - (weight_change_kg * 7700 / days)
    adaptive_tdee = round(avg_daily_intake - (weight_change_kg * 7700 / days_span))

    # Sanity clamp: adaptive TDEE shouldn't be absurdly far from estimated
    adaptive_tdee = max(min(adaptive_tdee, estimated_tdee + 1200), estimated_tdee - 1200)

    weekly_change_kg = round(weight_change_kg / days_span * 7, 2)

    # Goal-based calorie recommendation
    goal_direction = profile_data.get("goal_direction", "maintain")

    source = "adaptive" if sufficient_data else "tentative"
    caveat = "" if sufficient_data else " (tentative — based on limited data, log more for accuracy)"

    result.update({
        "adaptive_tdee": adaptive_tdee,
        "source": source,
        "avg_daily_intake": avg_daily_intake,
        "weight_change_kg": round(weight_change_kg, 2),
        "weekly_change_kg": weekly_change_kg,
        "days_span": days_span,
        "recommendation": _adaptive_recommendation(adaptive_tdee, goal_direction, profile_data) + caveat,
        "targets": _goal_targets(adaptive_tdee, goal_direction),
    })
    if not sufficient_data:
        result["data_status"]["message"] = f"Tentative estimate from {food_days} food days + {weight_entries} weight entries. Log more for full accuracy."
    return result


def _adaptive_recommendation(tdee: int, goal_direction: str | None, profile: dict) -> str:
    if tdee is None:
        return "Log food and weight consistently to unlock adaptive TDEE."
    if goal_direction == "lose":
        target = tdee - 500
        return f"To lose ~0.5 kg/wk, aim for {target} kcal/day (adaptive TDEE {tdee} minus 500)."
    elif goal_direction == "gain":
        target = tdee + 300
        return f"To gain ~0.3 kg/wk, aim for {target} kcal/day (adaptive TDEE {tdee} plus 300)."
    return f"To maintain, aim for {tdee} kcal/day. Your adaptive TDEE is {tdee}."


def _goal_targets(tdee: int, direction: str) -> dict:
    if direction == "lose":
        return {"maintain": tdee, "target": tdee - 500, "aggressive": tdee - 750, "direction": "lose"}
    elif direction == "gain":
        return {"maintain": tdee, "target": tdee + 300, "aggressive": tdee + 500, "direction": "gain"}
    return {"maintain": tdee, "target": tdee, "aggressive": tdee, "direction": "maintain"}


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

        # Water intake
        water = _read_water(d)
        if water.get("total_ml", 0) > 0:
            goal = water.get("goal_ml", 2000)
            pct = round(water["total_ml"] / goal * 100)
            events.append({"date": d, "type": "water", "summary": f"{water['total_ml']}ml water ({pct}% of goal)", "detail": f"{len(water.get('entries', []))} drinks"})

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

# ── HEALTH INSIGHTS ENGINE ─────���──────────────────────────────────────
@app.get("/insights")
def health_insights(key=Depends(require_key)):
    """Analyze the last 30 days of health data and return up to 6 actionable
    insights with correlations across sleep, nutrition, fitness, and weight."""
    insights = []
    today_d = date.today()

    # ── Gather data ──────────────────────────────────────────────────────
    # Food data per day (last 30 days)
    food_days = []
    for i in range(30):
        d = (today_d - timedelta(days=i)).isoformat()
        content = read_food_file(d)
        entries = parse_entries(content)
        total_kcal = sum(e["kcal"] for e in entries)
        total_protein = sum(e.get("protein_g", 0) for e in entries)
        logged = bool(content.strip())
        day_of_week = (today_d - timedelta(days=i)).weekday()  # 0=Mon, 6=Sun
        food_days.append({
            "date": d, "kcal": total_kcal, "protein": total_protein,
            "logged": logged, "is_weekend": day_of_week >= 5,
        })

    # Workouts (last 30 days)
    workouts = load_workouts()
    cutoff_30 = (today_d - timedelta(days=30)).isoformat()

    def _workout_date(w: dict) -> str:
        """Extract date from workout — try 'date' field, then 'id' prefix, then 'start_time'."""
        if "date" in w:
            return w["date"][:10]
        wid = w.get("id", "")
        # id format: YYYY-MM-DD-N
        if len(wid) >= 10 and wid[4] == "-" and wid[7] == "-":
            return wid[:10]
        return w.get("start_time", "")[:10]

    recent_workouts = [w for w in workouts if _workout_date(w) >= cutoff_30]
    workout_dates = set(_workout_date(w) for w in recent_workouts)

    # Sleep data (last 30 days)
    sleep_entries = load_sleep()
    recent_sleep = [s for s in sleep_entries if s.get("date", "") >= cutoff_30]

    # Weight data (last 30 days)
    weights = load_weights()
    recent_weights = [w for w in weights if w.get("date", "") >= cutoff_30]
    recent_weights.sort(key=lambda w: w["date"])

    # Goals
    goals = read_goals()

    # ── Insight: Sleep duration on workout days vs rest days ─────────────
    if recent_sleep and workout_dates:
        sleep_workout = [s for s in recent_sleep if s["date"] in workout_dates]
        sleep_rest = [s for s in recent_sleep if s["date"] not in workout_dates]
        if len(sleep_workout) >= 1 and len(sleep_rest) >= 1:
            avg_workout = sum(s["duration_hrs"] for s in sleep_workout) / len(sleep_workout)
            avg_rest = sum(s["duration_hrs"] for s in sleep_rest) / len(sleep_rest)
            diff_mins = round((avg_workout - avg_rest) * 60)
            if abs(diff_mins) >= 15:
                direction = "longer" if diff_mins > 0 else "shorter"
                insights.append({
                    "text": f"You sleep {abs(diff_mins)} minutes {direction} on days you work out",
                    "type": "positive" if diff_mins > 0 else "neutral",
                    "icon": "\U0001F4AA",
                    "category": "sleep",
                    "data": {"workout_avg_hrs": round(avg_workout, 1), "rest_avg_hrs": round(avg_rest, 1), "diff_mins": diff_mins},
                })

    # ── Insight: Sleep quality on gym days vs rest days ──────────────────
    if recent_sleep and workout_dates:
        qual_workout = [s["quality"] for s in recent_sleep if s["date"] in workout_dates]
        qual_rest = [s["quality"] for s in recent_sleep if s["date"] not in workout_dates]
        if len(qual_workout) >= 1 and len(qual_rest) >= 1:
            avg_q_gym = round(sum(qual_workout) / len(qual_workout), 1)
            avg_q_rest = round(sum(qual_rest) / len(qual_rest), 1)
            if abs(avg_q_gym - avg_q_rest) >= 0.4:
                insights.append({
                    "text": f"Best sleep quality: {avg_q_gym}/5 on gym days vs {avg_q_rest}/5 on rest days",
                    "type": "positive" if avg_q_gym > avg_q_rest else "negative",
                    "icon": "\U0001F31F",
                    "category": "sleep",
                    "data": {"gym_quality": avg_q_gym, "rest_quality": avg_q_rest},
                })

    # ── Insight: Protein weekday vs weekend ─────────────────────────────
    weekday_food = [d for d in food_days if not d["is_weekend"] and d["logged"]]
    weekend_food = [d for d in food_days if d["is_weekend"] and d["logged"]]
    if len(weekday_food) >= 1 and len(weekend_food) >= 1:
        avg_protein_wd = sum(d["protein"] for d in weekday_food) / len(weekday_food)
        avg_protein_we = sum(d["protein"] for d in weekend_food) / len(weekend_food)
        if avg_protein_wd > 0:
            pct_diff = round((avg_protein_wd - avg_protein_we) / avg_protein_wd * 100)
            if abs(pct_diff) >= 15:
                direction = "lower" if pct_diff > 0 else "higher"
                insights.append({
                    "text": f"Your protein is {abs(pct_diff)}% {direction} on weekends",
                    "type": "negative" if pct_diff > 15 else "neutral",
                    "icon": "\U0001F969",
                    "category": "nutrition",
                    "data": {"weekday_avg_g": round(avg_protein_wd), "weekend_avg_g": round(avg_protein_we), "pct_diff": pct_diff},
                })

    # ── Insight: Calorie goal adherence this week ───────────────────────
    this_week = [d for d in food_days[:7] if d["logged"]]
    if this_week:
        goal_cal = goals.get("calories", 2200)
        # Within 10% of goal counts as "hit"
        hits = sum(1 for d in this_week if abs(d["kcal"] - goal_cal) <= goal_cal * 0.10)
        if len(this_week) >= 1:
            insights.append({
                "text": f"You've hit your calorie goal {hits} out of {len(this_week)} days this week",
                "type": "positive" if hits >= len(this_week) * 0.7 else "negative" if hits <= 2 else "neutral",
                "icon": "\U0001F3AF",
                "category": "nutrition",
                "data": {"hits": hits, "days_logged": len(this_week), "goal_kcal": goal_cal},
            })

    # ── Insight: Weight trend over 2 weeks ───���──────────────────────────
    if len(recent_weights) >= 2:
        two_weeks_ago = (today_d - timedelta(days=14)).isoformat()
        first_half = [w for w in recent_weights if w["date"] <= two_weeks_ago]
        second_half = [w for w in recent_weights if w["date"] > two_weeks_ago]
        if first_half and second_half:
            avg_first = sum(w["kg"] for w in first_half) / len(first_half)
            avg_second = sum(w["kg"] for w in second_half) / len(second_half)
            delta = round(avg_second - avg_first, 1)
            if abs(delta) >= 0.2:
                direction = "down" if delta < 0 else "up"
                insights.append({
                    "text": f"Your average weight is trending {direction} {abs(delta)}kg over 2 weeks",
                    "type": "positive" if delta < 0 else "neutral",
                    "icon": "\u2696\uFE0F",
                    "category": "weight",
                    "data": {"first_half_avg": round(avg_first, 1), "second_half_avg": round(avg_second, 1), "delta_kg": delta},
                })

    # ── Insight: Logging consistency weekday vs weekend ──────────────────
    weekdays_total = sum(1 for d in food_days if not d["is_weekend"])
    weekends_total = sum(1 for d in food_days if d["is_weekend"])
    weekdays_logged = sum(1 for d in food_days if not d["is_weekend"] and d["logged"])
    weekends_logged = sum(1 for d in food_days if d["is_weekend"] and d["logged"])
    if weekdays_total >= 1 and weekends_total >= 1:
        wd_pct = round(weekdays_logged / weekdays_total * 100)
        we_pct = round(weekends_logged / weekends_total * 100)
        if abs(wd_pct - we_pct) >= 20:
            insights.append({
                "text": f"You log food more consistently on weekdays ({wd_pct}%) than weekends ({we_pct}%)",
                "type": "neutral" if we_pct >= 50 else "negative",
                "icon": "\U0001F4DD",
                "category": "nutrition",
                "data": {"weekday_pct": wd_pct, "weekend_pct": we_pct},
            })

    # ── Insight: Workout frequency ──────────────────────────────────────
    if recent_workouts:
        workouts_per_week = len(recent_workouts) / (30 / 7)
        goal_gym = goals.get("gym_days", 4)
        if workouts_per_week >= goal_gym:
            insights.append({
                "text": f"Averaging {workouts_per_week:.1f} workouts/week — above your {goal_gym}x goal",
                "type": "positive",
                "icon": "\U0001F525",
                "category": "fitness",
                "data": {"avg_per_week": round(workouts_per_week, 1), "goal": goal_gym},
            })
        elif workouts_per_week < goal_gym * 0.6:
            insights.append({
                "text": f"Only {workouts_per_week:.1f} workouts/week vs your {goal_gym}x goal",
                "type": "negative",
                "icon": "\U0001F3CB\uFE0F",
                "category": "fitness",
                "data": {"avg_per_week": round(workouts_per_week, 1), "goal": goal_gym},
            })
        else:
            insights.append({
                "text": f"Averaging {workouts_per_week:.1f} workouts/week — close to your {goal_gym}x goal",
                "type": "neutral",
                "icon": "\U0001F3CB\uFE0F",
                "category": "fitness",
                "data": {"avg_per_week": round(workouts_per_week, 1), "goal": goal_gym},
            })

    # Return the top 6 most interesting (prioritize positive + negative over neutral)
    insights.sort(key=lambda x: {"positive": 0, "negative": 1, "neutral": 2}[x["type"]])
    return {"insights": insights[:6], "period_days": 30, "generated_at": datetime.now().isoformat()}


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


# ── DATA EXPORT ──────────────────────────────────────────────────────
@app.get("/export")
def export_all_data(key=Depends(require_key)):
    """Export all health data as JSON for backup/portability."""
    # Food logs — last 90 days
    food_logs = {}
    for i in range(90):
        d = (date.today() - timedelta(days=i)).isoformat()
        content = read_food_file(d)
        if content.strip():
            food_logs[d] = parse_entries(content)

    # Workouts
    workouts = load_workouts()

    # Weight / metrics
    weights = load_weights()
    metrics = load_metrics()

    # Sleep
    sleep = load_sleep()

    # Routines
    routines = load_routines()

    # Fridge
    fridge = read_fridge()

    # Goals
    goals = read_goals()

    # Agenda
    agenda = load_agenda()

    # Lists
    lists = load_lists()

    # Water
    water_logs = {}
    for i in range(90):
        d = (date.today() - timedelta(days=i)).isoformat()
        w = _read_water(d)
        if w.get("total_ml", 0) > 0:
            water_logs[d] = w

    return {
        "exported_at": datetime.now().isoformat(),
        "food_logs": food_logs,
        "workouts": workouts,
        "weights": weights,
        "metrics": metrics,
        "sleep": sleep,
        "routines": routines,
        "fridge": fridge,
        "goals": goals,
        "agenda": agenda,
        "lists": lists,
        "water": water_logs,
    }
