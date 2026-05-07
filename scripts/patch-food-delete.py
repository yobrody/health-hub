"""One-shot patch script: adds POST /food/delete to api/main.py.
Run on VPS: python3 ~/patch-food-delete.py
Idempotent (checks for the endpoint marker before writing)."""
from pathlib import Path
import sys

p = Path.home() / "health-hub/api/main.py"
src = p.read_text()

if "/food/delete" in src:
    print("already patched")
    sys.exit(0)

INSERT = r'''
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
    total = sum(int(m) for m in re.findall(r"~(\d+) kcal\)", new_content))
    new_content += "\n---\n**Daily Total: ~" + str(total) + " kcal**\n"
    fp.write_text(new_content)
    return {"ok": True, "date": target_date, "total_kcal": total}

'''

# Insert just before the /food/history GET so it lives next to add_food.
marker = '@app.get("/food/history")'
idx = src.find(marker)
if idx < 0:
    print("marker not found", file=sys.stderr)
    sys.exit(1)
out = src[:idx] + INSERT + src[idx:]
p.write_text(out)
print("patched")
