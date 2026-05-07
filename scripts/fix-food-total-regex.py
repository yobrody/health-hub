"""Fix the buggy ~N kcal\\) regex used to recompute Daily Total in 4 call
sites. The regex only matched entries WITHOUT protein (where the closing
paren immediately follows ` kcal`), so any entry like
`~680 kcal, ~39 g protein)` was excluded from the total. Replace with
parse_entries which is what /today already uses on read."""
from pathlib import Path

p = Path.home() / "health-hub/api/main.py"
src = p.read_text()

# Two variants: against `content` and against `new_content`.
patterns = [
    ('total = sum(int(m) for m in re.findall(r"~(\\d+) kcal\\)", content))',
     'total = sum(e["kcal"] for e in parse_entries(content))'),
    ('total = sum(int(m) for m in re.findall(r"~(\\d+) kcal\\)", new_content))',
     'total = sum(e["kcal"] for e in parse_entries(new_content))'),
]

count = 0
for old, new in patterns:
    n = src.count(old)
    if n:
        src = src.replace(old, new)
        count += n
        print(f"replaced {n}x: {old[:60]}...")

p.write_text(src)
print(f"total replacements: {count}")
