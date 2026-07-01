#!/usr/bin/env python3
"""
Regression check for Hitter Radar season JSONs — read-only, no app changes.
Run with `python audit.py`; it discovers whatever players-<year>.json files
exist under hitter-radar/public/data and checks: (1) raw value sanity against
plausible MLB ranges, (2) a spot-check of known players' lines for the latest
season, (3) percentile-direction integrity (incl. lower-is-better inversion),
(4) join correctness (missing-stat counts, OPS+ vs OPS rank consistency), and
(5) null handling for DH defensive stats and unmatched OPS+.
"""
import json
import statistics as st
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "hitter-radar" / "public" / "data"
SEASONS = sorted(int(p.stem.split("-")[1]) for p in DATA_DIR.glob("players-*.json"))
BASE = str(DATA_DIR / "players-{}.json")

if not SEASONS:
    raise SystemExit(f"No players-<year>.json files found in {DATA_DIR}")

# Ranges calibrated for a 75-PA minimum pool (400-500+ players/season).
# Small samples produce legitimate extremes, so bounds are wider than for
# a 502-PA qualifier pool. Still tight enough to catch real scale bugs:
# - percentage stats stored as 0-1 decimals (e.g. hard=0.42 not 42) → lower bound > 1 catches it
# - xwOBA/xBA/xSLG values above .600 indicate a unit error
# - OPS+ below -25 or above 300 indicates a scraper mis-parse
# - sprint/EV below 70 mph or above 115 mph indicates wrong units
PLAUSIBLE = {
    "avg":    (.040, .420), "obp": (.090, .530), "slg": (.040, .820),
    "ops":    (.150, 1.400), "iso": (-.010, .500),
    "hr":     (0, 70), "sb": (0, 90),
    "ops_plus": (-40, 280),
    "bb":     (.4, 28), "k": (1.5, 58),
    "xwoba":  (.130, .540), "xba": (.070, .410), "xslg": (.110, .840),
    "barrel": (0, 38), "hard": (3, 75), "ev": (73, 108),
    "whiff":  (1.5, 56), "chase": (4, 62), "sprint": (19, 34),
    "oaa":    (-35, 40), "frv": (-35, 40),
    "la":     (-10, 35), "pull": (9, 72), "gb": (6, 95), "fb": (1.5, 64), "ld": (3, 50),
}

def load(season):
    with open(BASE.format(season)) as f:
        return json.load(f)["players"]

# ---------------------------------------------------------------- #
# 1. RAW VALUE SANITY
# ---------------------------------------------------------------- #
print("=" * 100)
print("1. RAW VALUE SANITY")
print("=" * 100)

flags = []
for season in SEASONS:
    players = load(season)
    print(f"\n--- {season} ({len(players)} players) ---")
    for key, (lo, hi) in PLAUSIBLE.items():
        vals = [(p["raw"].get(key), p["name"]) for p in players if p["raw"].get(key) is not None]
        if not vals:
            continue
        nums = [v for v, _ in vals]
        mn, mx = min(nums), max(nums)
        mn_name = next(n for v, n in vals if v == mn)
        mx_name = next(n for v, n in vals if v == mx)
        mean = st.mean(nums)
        out_of_range = mn < lo or mx > hi
        flag = "  <-- FLAG" if out_of_range else ""
        print(f"  {key:10s} min={mn:>8.3f} ({mn_name:20s}) max={mx:>8.3f} ({mx_name:20s}) mean={mean:>8.3f}{flag}")
        if out_of_range:
            flags.append((season, key, mn, mx, lo, hi))

print("\n--- Out-of-range flags ---")
if flags:
    for season, key, mn, mx, lo, hi in flags:
        print(f"  {season} {key}: range [{mn}, {mx}] vs plausible [{lo}, {hi}]")
else:
    print("  None")

# ---------------------------------------------------------------- #
# 2. SPOT-CHECK vs SOURCE (latest season)
# ---------------------------------------------------------------- #
LATEST = SEASONS[-1]
print("\n" + "=" * 100)
print(f"2. SPOT-CHECK vs SOURCE ({LATEST})")
print("=" * 100)

players_latest = {p["name"]: p for p in load(LATEST)}
for name in ["Aaron Judge", "Luis Arraez", "Bobby Witt Jr."]:
    p = players_latest.get(name)
    print(f"\n--- {name} ---")
    if not p:
        print("  NOT FOUND in JSON")
        continue
    print(f"  pa={p['pa']}  team={p['team']}  pos={p['pos']}")
    for k in sorted(p["raw"].keys()):
        print(f"    {k:10s} = {p['raw'][k]}")

# ---------------------------------------------------------------- #
# 3. PERCENTILE INTEGRITY (latest season)
# ---------------------------------------------------------------- #
print("\n" + "=" * 100)
print(f"3. PERCENTILE INTEGRITY ({LATEST})")
print("=" * 100)

players = load(LATEST)
LOWER_IS_BETTER = {"k", "chase", "whiff"}
RANKED_CHECK = ["avg", "obp", "slg", "xwoba", "k", "chase", "whiff", "ops_plus"]

for key in RANKED_CHECK:
    vals = [(p["raw"].get(key), p["pct"].get(key), p["name"]) for p in players
            if p["raw"].get(key) is not None and p["pct"].get(key) is not None]
    if not vals:
        print(f"  {key}: no data")
        continue
    raw_max_row = max(vals, key=lambda t: t[0])
    raw_min_row = min(vals, key=lambda t: t[0])
    lower = key in LOWER_IS_BETTER
    direction = "LOWER-IS-BETTER" if lower else "higher-is-better"
    print(f"\n  {key} ({direction}):")
    print(f"    raw max = {raw_max_row[0]:>8.3f} ({raw_max_row[2]:20s}) -> pct = {raw_max_row[1]}")
    print(f"    raw min = {raw_min_row[0]:>8.3f} ({raw_min_row[2]:20s}) -> pct = {raw_min_row[1]}")
    if lower:
        ok = raw_max_row[1] <= 5 and raw_min_row[1] >= 95
        print(f"    expect: max-raw -> low pct, min-raw -> high pct   {'OK' if ok else 'FLAG'}")
    else:
        ok = raw_max_row[1] >= 95 and raw_min_row[1] <= 5
        print(f"    expect: max-raw -> high pct, min-raw -> low pct   {'OK' if ok else 'FLAG'}")

# ---------------------------------------------------------------- #
# 4. JOIN CORRECTNESS
# ---------------------------------------------------------------- #
print("\n" + "=" * 100)
print("4. JOIN CORRECTNESS")
print("=" * 100)

ALL_KEYS = ["avg", "obp", "slg", "ops", "hr", "sb", "iso", "ops_plus", "bb", "k",
            "xwoba", "xba", "xslg", "barrel", "hard", "ev", "whiff", "chase",
            "sprint", "oaa", "frv", "la", "pull", "gb", "fb", "ld"]

for season in SEASONS:
    players = load(season)
    print(f"\n--- {season} ({len(players)} players) — missing counts ---")
    for key in ALL_KEYS:
        missing = sum(1 for p in players if p["raw"].get(key) is None)
        if missing:
            print(f"  {key:10s} missing for {missing}/{len(players)}")

# OPS+ vs OPS rank correlation check (latest season) — mismatched names would break this
print(f"\n--- OPS+ vs OPS rank consistency ({LATEST}) ---")
rows = [(p["name"], p["raw"].get("ops"), p["raw"].get("ops_plus"))
        for p in players_latest.values()
        if p["raw"].get("ops") is not None and p["raw"].get("ops_plus") is not None]
rows_by_ops = sorted(rows, key=lambda r: r[1], reverse=True)
rows_by_opsplus = sorted(rows, key=lambda r: r[2], reverse=True)
top10_ops_names = {r[0] for r in rows_by_ops[:10]}
top10_opsplus_names = {r[0] for r in rows_by_opsplus[:10]}
overlap = len(top10_ops_names & top10_opsplus_names)
print(f"  Top 10 by OPS vs top 10 by OPS+ overlap: {overlap}/10")
# Spearman-ish: simple rank diff check
ops_rank = {name: i for i, (name, _, _) in enumerate(rows_by_ops)}
opsplus_rank = {name: i for i, (name, _, _) in enumerate(rows_by_opsplus)}
diffs = [(name, abs(ops_rank[name] - opsplus_rank[name])) for name, _, _ in rows]
diffs.sort(key=lambda t: -t[1])
print("  Largest rank discrepancies (name, |rank diff|):")
for name, d in diffs[:5]:
    print(f"    {name:20s} diff={d}")

# ---------------------------------------------------------------- #
# 5. NULL HANDLING
# ---------------------------------------------------------------- #
print("\n" + "=" * 100)
print("5. NULL HANDLING")
print("=" * 100)

for season in SEASONS:
    players = load(season)
    dh_like = [p for p in players if p["pos"] in ("DH",)]
    print(f"\n--- {season}: {len(dh_like)} DH players ---")
    for p in dh_like:
        oaa, frv = p["raw"].get("oaa"), p["raw"].get("frv")
        # Small nonzero values are correct for DHs who logged some fielding innings.
        # Only flag implausibly large magnitudes (>15), which would indicate a data error.
        bad_oaa = oaa is not None and abs(oaa) > 15
        bad_frv = frv is not None and abs(frv) > 15
        flag = "  <-- FLAG (implausibly large for a DH)" if (bad_oaa or bad_frv) else ""
        print(f"  {p['name']:20s} oaa={oaa!r:>6} frv={frv!r:>6}{flag}")

    no_ops_plus = [p["name"] for p in players if p["raw"].get("ops_plus") is None]
    print(f"  {len(no_ops_plus)} players missing OPS+ (should be null, sample): {no_ops_plus[:5]}")
