#!/usr/bin/env python3
"""
build_data.py — nightly ETL for the Hitter Radar site.

Pulls one season of hitting data, merges on the MLBAM player id, filters to
qualified hitters, computes percentiles (flipping "lower is better" stats), and
writes a single static JSON the front end reads. Run it on a schedule (e.g. a
GitHub Action cron); the committed JSON triggers a redeploy of the static site.

Sources, by reliability:
  - Baseball Savant   (official, public CSV)  -> Statcast: xwOBA, barrels, EV, speed, discipline, OAA, FRV
  - MLB Stats API     (official, no auth)      -> traditional line + ids/teams/positions
  - Baseball-Reference (scraped, best-effort)  -> OPS+  [park-adjusted, 100 = average]
  - pybaseball Chadwick register (cached)      -> MLBAM<->BBRef id crosswalk for the OPS+ join

Every ranked stat gets two percentiles: "pct" (vs. the full qualified league)
and "pct_pos" (vs. other qualified hitters at the same primary position; falls
back to league-wide when fewer than MIN_POS_GROUP players share that position).

Usage:
  pip install requests pandas lxml beautifulsoup4 pybaseball
  python build_data.py --season 2024 --min-pa 75    # writes players-2024.json
"""

import argparse, datetime, io, json, re, sys
import requests
import pandas as pd

UA = {"User-Agent": "Mozilla/5.0 (hitter-radar ETL)"}  # Savant rejects empty UAs

# MLB Stats API returns team.id/team.name but no abbreviation field — team ids
# are stable across seasons, so a static map is fine.
TEAM_ABBR = {
    108: "LAA", 109: "ARI", 110: "BAL", 111: "BOS", 112: "CHC", 113: "CIN",
    114: "CLE", 115: "COL", 116: "DET", 117: "HOU", 118: "KC",  119: "LAD",
    120: "WSH", 121: "NYM", 133: "OAK", 134: "PIT", 135: "SD",  136: "SEA",
    137: "SF",  138: "STL", 139: "TB",  140: "TEX", 141: "TOR", 142: "MIN",
    143: "PHI", 144: "ATL", 145: "CWS", 146: "MIA", 147: "NYY", 158: "MIL",
}


# --------------------------------------------------------------------------- #
# Sources
# --------------------------------------------------------------------------- #
def savant_custom(season: int, min_pa: int) -> pd.DataFrame:
    """Statcast custom leaderboard as CSV. One row per qualified batter."""
    url = (
        "https://baseballsavant.mlb.com/leaderboard/custom"
        f"?year={season}&type=batter&filter=&min={min_pa}"
        "&selections=xwoba,xba,xslg,barrel_batted_rate,hard_hit_percent,exit_velocity_avg,"
        "k_percent,bb_percent,whiff_percent,sprint_speed,oz_swing_percent,"
        "launch_angle_avg,pull_percent,groundballs_percent,flyballs_percent,linedrives_percent"
        "&sort=xwoba&sortDir=desc&csv=true"
    )
    df = pd.read_csv(io.StringIO(requests.get(url, headers=UA, timeout=60).text))
    df = df.rename(columns={
        "player_id": "mlbam",
        "barrel_batted_rate": "barrel",
        "hard_hit_percent": "hard",
        "exit_velocity_avg": "ev",
        "whiff_percent": "whiff",
        "sprint_speed": "sprint",
        "oz_swing_percent": "chase",
        "launch_angle_avg": "la",
        "pull_percent": "pull",
        "groundballs_percent": "gb",
        "flyballs_percent": "fb",
        "linedrives_percent": "ld",
    })
    return df[["mlbam", "xwoba", "xba", "xslg", "barrel", "hard", "ev", "whiff",
               "sprint", "chase", "la", "pull", "gb", "fb", "ld"]]


def savant_fielding(season: int) -> pd.DataFrame:
    """Statcast OAA and FRV (Fielding Run Value), summed across positions per player."""
    url = (
        "https://baseballsavant.mlb.com/leaderboard/outs_above_average"
        f"?type=Fielder&year={season}&min=1&csv=true"
    )
    df = pd.read_csv(io.StringIO(requests.get(url, headers=UA, timeout=60).text))
    df = df.rename(columns={
        "player_id": "mlbam",
        "outs_above_average": "oaa",
        "fielding_runs_prevented": "frv",
    })
    return df.groupby("mlbam", as_index=False)[["oaa", "frv"]].sum()


def mlb_stats_api(season: int) -> pd.DataFrame:
    """Official MLB Stats API: traditional line + identity fields. No auth."""
    url = (
        "https://statsapi.mlb.com/api/v1/stats"
        f"?stats=season&group=hitting&season={season}&gameType=R"
        "&playerPool=all&limit=2000&sportId=1"
    )
    splits = requests.get(url, headers=UA, timeout=60).json()["stats"][0]["splits"]
    rows = []
    for s in splits:
        p, st = s["player"], s["stat"]
        rows.append({
            "mlbam": p["id"],
            "name": p["fullName"],
            "team": TEAM_ABBR.get(s.get("team", {}).get("id"), ""),
            "pos": s.get("position", {}).get("abbreviation", ""),
            "pa": int(st.get("plateAppearances", 0)),
            "avg": float(st.get("avg", 0) or 0),
            "obp": float(st.get("obp", 0) or 0),
            "slg": float(st.get("slg", 0) or 0),
            "hr": int(st.get("homeRuns", 0)),
            "sb": int(st.get("stolenBases", 0)),
            "ops": float(st.get("ops", 0) or 0),
            "bb": round(100 * int(st.get("baseOnBalls", 0)) / max(int(st.get("plateAppearances", 1)), 1), 1),
            "k": round(100 * int(st.get("strikeOuts", 0)) / max(int(st.get("plateAppearances", 1)), 1), 1),
        })
    df = pd.DataFrame(rows)
    df["iso"] = (df["slg"] - df["avg"]).round(3)
    return df


def bref_ops_plus(season: int) -> pd.DataFrame:
    """
    OPS+ from Baseball-Reference. Best-effort — a failure just leaves the spoke
    empty. Players traded mid-season get one row per team stint PLUS a combined
    "2TM"/"3TM"/etc. row holding their full-season line — we keep only the
    combined row for those players so a trade doesn't truncate their OPS+ to a
    single stint.
    """
    try:
        from bs4 import BeautifulSoup
        url = f"https://www.baseball-reference.com/leagues/majors/{season}-standard-batting.shtml"
        html = requests.get(url, headers=UA, timeout=60).text
        soup = BeautifulSoup(html, "lxml")
        table = soup.find("table", id="players_standard_batting")
        if table is None:
            raise ValueError("table not found")
        rows = []
        for tr in table.select("tbody tr:not(.thead)"):
            name_cell = tr.find("td", {"data-stat": "name_display"})
            ops_plus_cell = tr.find("td", {"data-stat": "b_onbase_plus_slugging_plus"})
            if not name_cell or not ops_plus_cell or not ops_plus_cell.text.strip():
                continue
            a = name_cell.find("a")
            if not a or "href" not in a.attrs:
                continue
            href = a["href"]
            parts = href.rstrip("/").split("/")
            bref_id = parts[-1].removesuffix(".shtml") if parts else ""
            team_cell = tr.find("td", {"data-stat": "team_name_abbr"})
            team = team_cell.get_text().strip() if team_cell else ""
            rows.append({
                "bref_id": bref_id,
                "bref_name": name_cell.get_text().replace("\xa0", " ").strip().rstrip("*#"),
                "ops_plus": int(ops_plus_cell.text.strip()),
                "is_multi_team": bool(re.fullmatch(r"\dTM", team)),
            })
        df = pd.DataFrame(rows)
        if df.empty:
            return df
        # multi-team aggregate row first, so it survives drop_duplicates(keep="first").
        # Dedup key is bref_id (stable across a player's stint rows), not name —
        # name matching was the source of the accented-name dropouts and the
        # traded-player mis-join this replaces.
        df = df.sort_values("is_multi_team", ascending=False)
        df = df.drop_duplicates(subset="bref_id", keep="first")
        return df.drop(columns="is_multi_team")
    except Exception as e:
        print(f"  ! Baseball-Reference unavailable, continuing without OPS+: {e}", file=sys.stderr)
        return pd.DataFrame(columns=["bref_id", "bref_name", "ops_plus"])


def bbref_crosswalk() -> pd.DataFrame:
    """
    MLBAM <-> Baseball-Reference id crosswalk via pybaseball's Chadwick register
    (downloaded once, cached locally by pybaseball thereafter). Best-effort —
    a failure just leaves OPS+ unmatched, same as any other optional source.
    """
    try:
        from pybaseball import chadwick_register
        reg = chadwick_register()
        return reg[["key_mlbam", "key_bbref"]].dropna()
    except Exception as e:
        print(f"  ! Chadwick register unavailable, OPS+ join skipped: {e}", file=sys.stderr)
        return pd.DataFrame(columns=["key_mlbam", "key_bbref"])


# --------------------------------------------------------------------------- #
# Percentiles
# --------------------------------------------------------------------------- #
# key -> whether lower raw values are better (percentile gets flipped)
LOWER_IS_BETTER = {"k": True, "chase": True, "whiff": True}
# directional / descriptive — kept in the table but never ranked on the radar
CONTEXT = {"la", "pull", "gb", "fb", "ld", "ops"}
RANKED = ["avg", "obp", "slg", "hr", "sb", "iso", "ops_plus",
          "bb", "k", "xwoba", "xba", "xslg", "barrel", "hard", "ev",
          "whiff", "chase", "sprint", "oaa", "frv"]

# position groups smaller than this fall back to league-wide percentiles —
# ranking against e.g. 3 qualified catchers is too noisy to be useful
MIN_POS_GROUP = 10


def add_percentiles(df: pd.DataFrame) -> pd.DataFrame:
    """Adds league-wide ({key}_pct) and position-relative ({key}_pct_pos) percentiles."""
    pos_counts = df["pos"].value_counts()
    small_pos = df["pos"].map(pos_counts) < MIN_POS_GROUP

    for key in RANKED:
        if key not in df:
            continue
        ascending = not LOWER_IS_BETTER.get(key, False)
        # higher-is-better ranks ascending; lower-is-better ranks descending, so
        # both directions bottom out near 1/league_size rather than exactly 0.
        league_pr = df[key].rank(pct=True, ascending=ascending)
        df[f"{key}_pct"] = (league_pr * 100).round().astype("Int64")

        pos_pr = df.groupby("pos")[key].rank(pct=True, ascending=ascending)
        pos_pct = (pos_pr * 100).round()
        # small position groups fall back to the league-wide percentile
        pos_pct = pos_pct.where(~small_pos, league_pr * 100).round()
        df[f"{key}_pct_pos"] = pos_pct.astype("Int64")
    return df


# --------------------------------------------------------------------------- #
# Assemble
# --------------------------------------------------------------------------- #
def build(season: int, min_pa: int) -> dict:
    print("Pulling MLB Stats API ...")
    base = mlb_stats_api(season)
    print(f"  {len(base)} qualified hitters")

    print("Pulling Baseball Savant ...")
    base = base.merge(savant_custom(season, min_pa), on="mlbam", how="left")
    base = base.merge(savant_fielding(season), on="mlbam", how="left")

    print("Pulling Baseball-Reference (best-effort) ...")
    bref = bref_ops_plus(season)
    if not bref.empty:
        xwalk = bbref_crosswalk()
        if not xwalk.empty:
            bref = bref.merge(xwalk, left_on="bref_id", right_on="key_bbref", how="inner")
            ops_map = dict(zip(bref["key_mlbam"].astype(int), bref["ops_plus"]))
            base["ops_plus"] = base["mlbam"].map(ops_map)
            matched = base["ops_plus"].notna().sum()
            print(f"  Matched OPS+ for {matched}/{len(base)} hitters by id")

    base = base[base["pa"] >= min_pa].copy()
    base = add_percentiles(base)

    all_keys = RANKED + sorted(CONTEXT)
    players = []
    for _, r in base.iterrows():
        raw = {k: (None if pd.isna(r.get(k)) else round(float(r[k]), 3))
               for k in all_keys if k in r}
        pct = {k: (None if pd.isna(r.get(f"{k}_pct")) else int(r[f"{k}_pct"]))
               for k in RANKED if f"{k}_pct" in r}
        pct_pos = {k: (None if pd.isna(r.get(f"{k}_pct_pos")) else int(r[f"{k}_pct_pos"]))
                   for k in RANKED if f"{k}_pct_pos" in r}
        players.append({
            "id": int(r["mlbam"]),
            "name": r["name"], "team": r["team"], "pos": r["pos"], "pa": int(r["pa"]),
            "raw": raw, "pct": pct, "pct_pos": pct_pos,
        })
    players.sort(key=lambda p: (p["pct"].get("ops_plus") or p["pct"].get("xwoba") or 0), reverse=True)
    return {"season": season, "minPA": min_pa, "count": len(players), "players": players}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=datetime.date.today().year)
    ap.add_argument("--min-pa", type=int, default=75)
    ap.add_argument("--out", default=None, help="defaults to players-<season>.json")
    a = ap.parse_args()

    out = a.out or f"players-{a.season}.json"
    data = build(a.season, a.min_pa)
    with open(out, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"Wrote {out} — {data['count']} hitters, {round(len(json.dumps(data))/1024)} KB")


if __name__ == "__main__":
    main()
