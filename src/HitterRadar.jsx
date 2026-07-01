import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from "recharts";
import { Search, X, RotateCcw, Loader2, Copy, Check } from "lucide-react";

/* ----------------------------------------------------------------------------
   Where the season files live in production. build_data.py / the GitHub Action
   write players-<year>.json here. In this inline preview the fetch fails and the
   app falls back to bundled sample data, so it still renders.
---------------------------------------------------------------------------- */
const DATA_BASE = "/data";
const LATEST = new Date().getFullYear();
const SEASONS = Array.from({ length: LATEST - 2021 }, (_, i) => LATEST - i); // LATEST..2022
const MAX_COMPARE = 4;
const DEFAULT_AXES = ["ops_plus", "iso", "hard", "bb", "k", "chase", "xwoba", "sprint"];
const TIERS = ["Traditional", "Advanced", "Statcast", "Defense", "Batted ball"];
const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706"];

const dec3 = (v) => v.toFixed(3).replace(/^0/, "");
const int = (v) => String(Math.round(v));
const pct1 = (v) => v.toFixed(1) + "%";
const ftps = (v) => v.toFixed(1);
const deg = (v) => Math.round(v) + "\u00b0";
const plus = (v) => (v > 0 ? "+" : "") + Math.round(v);

const METRICS = [
  { key: "avg",    label: "AVG",       tier: "Traditional", fmt: dec3 },
  { key: "obp",    label: "OBP",       tier: "Traditional", fmt: dec3 },
  { key: "slg",    label: "SLG",       tier: "Traditional", fmt: dec3 },
  { key: "hr",     label: "HR",        tier: "Traditional", fmt: int },
  { key: "sb",     label: "SB",        tier: "Traditional", fmt: int },
  { key: "iso",    label: "ISO",       tier: "Advanced",    fmt: dec3 },
  { key: "ops_plus", label: "OPS+",   tier: "Advanced",    fmt: int },
  { key: "ops",    label: "OPS",       tier: "Advanced",    fmt: dec3, ctx: true },
  { key: "bb",     label: "BB%",       tier: "Advanced",    fmt: pct1 },
  { key: "k",      label: "K%",        tier: "Advanced",    fmt: pct1, lower: true, radarLabel: "K% avoid" },
  { key: "xwoba",  label: "xwOBA",     tier: "Statcast",    fmt: dec3 },
  { key: "xba",    label: "xBA",       tier: "Statcast",    fmt: dec3 },
  { key: "xslg",   label: "xSLG",      tier: "Statcast",    fmt: dec3 },
  { key: "barrel", label: "Barrel%",   tier: "Statcast",    fmt: pct1 },
  { key: "hard",   label: "Hard-Hit%", tier: "Statcast",    fmt: pct1 },
  { key: "ev",     label: "Avg EV",    tier: "Statcast",    fmt: ftps },
  { key: "whiff",  label: "Whiff%",    tier: "Statcast",    fmt: pct1, lower: true, radarLabel: "Whiff avoid" },
  { key: "chase",  label: "Chase%",    tier: "Statcast",    fmt: pct1, lower: true, radarLabel: "Chase avoid" },
  { key: "sprint", label: "Sprint",    tier: "Statcast",    fmt: ftps },
  { key: "oaa",    label: "OAA",       tier: "Defense",     fmt: plus },
  { key: "frv",    label: "FRV",       tier: "Defense",     fmt: plus },
  { key: "la",     label: "Launch\u00b0", tier: "Batted ball", fmt: deg, ctx: true },
  { key: "pull",   label: "Pull%",     tier: "Batted ball", fmt: pct1, ctx: true },
  { key: "gb",     label: "GB%",       tier: "Batted ball", fmt: pct1, ctx: true },
  { key: "fb",     label: "FB%",       tier: "Batted ball", fmt: pct1, ctx: true },
  { key: "ld",     label: "LD%",       tier: "Batted ball", fmt: pct1, ctx: true },
];

const RAW = [
  { id: "judge",     name: "Aaron Judge",      team: "NYY", pos: "RF", avg: .322, obp: .458, slg: .701, ops: 1.159, hr: 58, sb: 10, ops_plus: 218, bb: 18.8, k: 24.3, xwoba: .452, xba: .318, xslg: .672, barrel: 25.4, hard: 61.9, ev: 95.5, whiff: 24.8, chase: 22.1, sprint: 27.3, oaa: 3,    frv: 5,    la: 17, pull: 46, gb: 28, fb: 44, ld: 21 },
  { id: "arraez",    name: "Luis Arraez",      team: "SD",  pos: "2B", avg: .314, obp: .346, slg: .398, ops: .744, hr: 4,  sb: 6,  ops_plus: 105, bb: 4.6,  k: 6.5,  xwoba: .312, xba: .296, xslg: .383, barrel: 1.8,  hard: 28.4, ev: 84.5, whiff: 10.2, chase: 38.5, sprint: 26.8, oaa: -6,   frv: -8,   la: 6,  pull: 38, gb: 58, fb: 20, ld: 21 },
  { id: "betts",     name: "Mookie Betts",     team: "LAD", pos: "SS", avg: .289, obp: .372, slg: .491, ops: .863, hr: 19, sb: 16, ops_plus: 140, bb: 11.2, k: 13.1, xwoba: .360, xba: .281, xslg: .468, barrel: 9.8,  hard: 42.1, ev: 90.2, whiff: 18.4, chase: 24.6, sprint: 28.1, oaa: 8,    frv: 10,   la: 16, pull: 44, gb: 38, fb: 35, ld: 22 },
  { id: "soto",      name: "Juan Soto",        team: "NYY", pos: "RF", avg: .288, obp: .419, slg: .569, ops: .988, hr: 41, sb: 7,  ops_plus: 178, bb: 18.1, k: 16.8, xwoba: .418, xba: .292, xslg: .548, barrel: 16.2, hard: 53.8, ev: 92.8, whiff: 20.1, chase: 18.2, sprint: 26.5, oaa: -8,   frv: -10,  la: 14, pull: 45, gb: 36, fb: 38, ld: 20 },
  { id: "witt",      name: "Bobby Witt Jr.",   team: "KC",  pos: "SS", avg: .332, obp: .389, slg: .588, ops: .977, hr: 32, sb: 31, ops_plus: 168, bb: 7.4,  k: 14.5, xwoba: .390, xba: .315, xslg: .548, barrel: 12.6, hard: 51.2, ev: 93.1, whiff: 20.8, chase: 28.4, sprint: 29.5, oaa: 12,   frv: 15,   la: 12, pull: 42, gb: 42, fb: 32, ld: 21 },
  { id: "ohtani",    name: "Shohei Ohtani",    team: "LAD", pos: "DH", avg: .310, obp: .390, slg: .646, ops: 1.036, hr: 54, sb: 59, ops_plus: 190, bb: 11.0, k: 24.0, xwoba: .420, xba: .295, xslg: .610, barrel: 19.5, hard: 54.0, ev: 94.2, whiff: 26.2, chase: 27.0, sprint: 28.8, oaa: null, frv: null, la: 15, pull: 47, gb: 32, fb: 40, ld: 20 },
  { id: "henderson", name: "Gunnar Henderson", team: "BAL", pos: "SS", avg: .281, obp: .364, slg: .529, ops: .893, hr: 37, sb: 21, ops_plus: 155, bb: 10.8, k: 22.4, xwoba: .360, xba: .272, xslg: .502, barrel: 13.4, hard: 47.5, ev: 91.8, whiff: 25.6, chase: 24.0, sprint: 28.6, oaa: 6,    frv: 9,    la: 16, pull: 44, gb: 36, fb: 36, ld: 22 },
  { id: "alvarez",   name: "Yordan Alvarez",   team: "HOU", pos: "DH", avg: .308, obp: .392, slg: .567, ops: .959, hr: 35, sb: 1,  ops_plus: 172, bb: 12.0, k: 21.0, xwoba: .410, xba: .300, xslg: .552, barrel: 18.0, hard: 56.0, ev: 94.8, whiff: 23.5, chase: 26.5, sprint: 24.5, oaa: null, frv: null, la: 13, pull: 43, gb: 34, fb: 38, ld: 21 },
  { id: "kwan",      name: "Steven Kwan",      team: "CLE", pos: "LF", avg: .292, obp: .368, slg: .425, ops: .793, hr: 14, sb: 21, ops_plus: 122, bb: 9.0,  k: 9.5,  xwoba: .330, xba: .278, xslg: .402, barrel: 4.0,  hard: 31.0, ev: 86.2, whiff: 14.3, chase: 25.0, sprint: 28.0, oaa: 9,    frv: 12,   la: 8,  pull: 39, gb: 48, fb: 27, ld: 24 },
  { id: "elly",      name: "Elly De La Cruz",  team: "CIN", pos: "SS", avg: .259, obp: .339, slg: .471, ops: .810, hr: 25, sb: 67, ops_plus: 117, bb: 9.8,  k: 28.0, xwoba: .350, xba: .258, xslg: .455, barrel: 11.0, hard: 48.0, ev: 92.0, whiff: 31.5, chase: 30.0, sprint: 30.5, oaa: 4,    frv: 7,    la: 11, pull: 41, gb: 40, fb: 33, ld: 20 },
];

function rand(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

function buildSample(year) {
  return RAW.map((p) => {
    const f = 0.92 + rand(p.id + ":" + year) * 0.16;
    const s = (v, lo, hi) => Math.min(hi, Math.max(lo, v * f));
    const dj = (v) => (v == null ? null : Math.round(v + (rand(p.id + year + "d") * 6 - 3))); // ±3, null-safe
    return {
      id: p.id, name: p.name, team: p.team, pos: p.pos,
      pa: 480 + Math.round(rand(p.id + year + "pa") * 180),
      raw: {
        avg: +s(p.avg, .2, .37).toFixed(3), obp: +s(p.obp, .28, .48).toFixed(3),
        slg: +s(p.slg, .33, .73).toFixed(3), ops: +s(p.ops, .5, 1.2).toFixed(3),
        hr: Math.round(s(p.hr, 0, 62)),
        sb: Math.round(s(p.sb, 0, 70)), ops_plus: Math.round(s(p.ops_plus, 60, 230)),
        bb: +s(p.bb, 3, 21).toFixed(1), k: +s(p.k, 5, 35).toFixed(1),
        xwoba: +s(p.xwoba, .29, .46).toFixed(3),
        xba: +s(p.xba, .19, .36).toFixed(3), xslg: +s(p.xslg, .30, .70).toFixed(3),
        barrel: +s(p.barrel, 1, 27).toFixed(1),
        hard: +s(p.hard, 25, 64).toFixed(1), ev: +s(p.ev, 82, 97).toFixed(1),
        whiff: +s(p.whiff, 8, 38).toFixed(1), chase: +s(p.chase, 16, 40).toFixed(1),
        sprint: +s(p.sprint, 23, 31).toFixed(1), oaa: dj(p.oaa), frv: dj(p.frv),
        la: Math.round(s(p.la, 4, 20)), pull: +s(p.pull, 35, 50).toFixed(1),
        gb: +s(p.gb, 25, 60).toFixed(1), fb: +s(p.fb, 18, 50).toFixed(1),
        ld: +s(p.ld, 15, 30).toFixed(1),
      },
    };
  });
}

// Approximate league distributions for qualified hitters (mean, std). Used ONLY
// to give the bundled sample realistic percentiles, so a contact hitter shows a
// real shape instead of collapsing to the center. Real seasons ship pct from the
// ETL, which ranks against the full league of qualified hitters.
const LEAGUE = {
  avg: [.250, .025], obp: [.320, .030], slg: [.415, .065], hr: [18, 11], sb: [11, 10],
  iso: [.165, .050], ops_plus: [110, 28], bb: [8.5, 3.0], k: [22.0, 5.5],
  xwoba: [.330, .035], xba: [.250, .025], xslg: [.415, .060],
  barrel: [8.0, 4.5], hard: [41.0, 7.0], ev: [88.5, 3.5],
  whiff: [24.0, 5.5], chase: [28.0, 5.0], sprint: [27.0, 1.6],
  oaa: [0, 6], frv: [0, 7],
};

function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

function leaguePct(v, [mean, std], lower) {
  let p = normCdf((v - mean) / std);
  if (lower) p = 1 - p;          // low strikeout / chase rates are good
  return Math.max(1, Math.min(99, Math.round(p * 100)));
}

// Normalize either data shape: real JSON ships pct/pct_pos precomputed from the
// ETL (league-wide and position-relative respectively); the bundled sample has
// too few players per position for a meaningful position-relative percentile,
// so it reuses the league-wide figure for both.
function withPct(players) {
  const rows = players.map((p) => {
    const raw = { ...p.raw };
    if (raw.iso == null && raw.slg != null && raw.avg != null)
      raw.iso = +(raw.slg - raw.avg).toFixed(3);
    return { ...p, raw };
  });
  if (rows.length && rows[0].pct && Object.keys(rows[0].pct).length) return rows;
  return rows.map((p) => {
    const pct = Object.fromEntries(
      METRICS.filter((m) => LEAGUE[m.key]).map((m) => [
        m.key,
        p.raw[m.key] == null ? null : leaguePct(p.raw[m.key], LEAGUE[m.key], !!m.lower),
      ])
    );
    return { ...p, pct, pct_pos: pct };
  });
}

// Defense (OAA, FRV) is always ranked within position — a league-wide fielding
// percentile isn't meaningful across positions with very different baselines.
function getPct(player, metric, vsPosition) {
  const usePos = vsPosition || metric.tier === "Defense";
  const source = usePos ? player.pct_pos : player.pct;
  return source?.[metric.key] ?? null;
}

function heat(pctValue) {
  const t = (pctValue - 50) / 50;
  const c = t >= 0 ? "220,38,38" : "37,99,235";
  return `rgba(${c},${(0.05 + 0.32 * Math.abs(t)).toFixed(2)})`;
}

// shareable state lives in the URL hash (#y=2026&p=judge,arraez&a=wrc,iso,...),
// so a comparison can be linked or bookmarked. Hash works on static hosts.
function readHash() {
  const raw = (typeof window !== "undefined" ? window.location.hash : "").replace(/^#/, "");
  const q = new URLSearchParams(raw);
  const year = Number(q.get("y"));
  const a = (q.get("a") || "").split(",").filter((k) => METRICS.some((m) => m.key === k));
  return {
    year: SEASONS.includes(year) ? year : null,
    selected: (q.get("p") || "").split(",").filter(Boolean),
    axes: a.length >= 3 ? a : null,
  };
}

function writeHash(year, selected, axes) {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams();
  q.set("y", String(year));
  if (selected.length) q.set("p", selected.join(","));
  q.set("a", axes.join(","));
  const hash = "#" + q.toString();
  if (window.location.hash !== hash) {
    try { window.history.replaceState(null, "", hash); } catch { /* sandboxed */ }
  }
}

export default function HitterRadar() {
  const INIT = useMemo(() => readHash(), []);
  const wantSel = useRef(INIT.selected);            // restore selection once data loads
  const [year, setYear] = useState(INIT.year ?? LATEST);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("sample");
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState("");
  const [axes, setAxes] = useState(INIT.axes ?? DEFAULT_AXES);
  const [copied, setCopied] = useState(false);
  const [vsPosition, setVsPosition] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      let players, src;
      try {
        const res = await fetch(`${DATA_BASE}/players-${year}.json`);
        if (!res.ok) throw new Error(String(res.status));
        players = withPct((await res.json()).players);
        src = "live";
      } catch {
        players = withPct(buildSample(year));
        src = "sample";
      }
      if (!live) return;
      setData(players);
      setSource(src);
      setSelected((prev) => {
        const want = wantSel.current.length ? wantSel.current : prev;
        wantSel.current = [];                       // consume the hash selection once
        const idOf = new Map(players.map((p) => [String(p.id), p.id]));
        const kept = [];
        for (const w of want) {
          const nid = idOf.get(String(w));
          if (nid !== undefined && !kept.includes(nid)) kept.push(nid);
        }
        return kept.length ? kept : players.slice(0, 2).map((p) => p.id);
      });
      setLoading(false);
    })();
    return () => { live = false; };
  }, [year]);

  const byId = useMemo(() => Object.fromEntries(data.map((p) => [p.id, p])), [data]);
  const chosen = selected.map((id) => byId[id]).filter(Boolean);
  const colorOf = (id) => COLORS[selected.indexOf(id)] ?? "#64748b";
  const filtered = data.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => { writeHash(year, selected, axes); }, [year, selected, axes]);

  const copyLink = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url; document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta);
      } catch { /* clipboard blocked in this context */ }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const toggle = (id) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_COMPARE ? [...s, id] : s
    );
  const toggleAxis = (key) =>
    setAxes((a) => (a.includes(key) ? (a.length > 3 ? a.filter((x) => x !== key) : a) : [...a, key]));

  const axisMetrics = axes.map((k) => METRICS.find((m) => m.key === k)).filter(Boolean);
  const radarData = axisMetrics.map((m) => {
    const row = { axis: m.radarLabel || m.label };
    chosen.forEach((p) => (row[p.id] = getPct(p, m, vsPosition)));
    return row;
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <div className="max-w-6xl mx-auto px-5 py-8">
        <header className="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Hitter Radar</h1>
            <p className="text-sm text-slate-500 mt-1">The shape of a hitter — percentile profiles</p>
          </div>
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
            <span
              className={`text-xs uppercase tracking-wider px-2 py-1 rounded-full ${
                source === "live" ? "text-green-700 bg-green-100" : "text-amber-700 bg-amber-100"
              }`}
            >
              {source === "live" ? "Live" : "Sample data"}
            </span>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="text-sm rounded-lg border border-slate-200 bg-white px-3 py-1.5"
            >
              {SEASONS.map((y) => (
                <option key={y} value={y}>{y}{y === LATEST ? " (current)" : ""}</option>
              ))}
            </select>
            <button
              onClick={copyLink}
              className="inline-flex items-center gap-1 text-sm rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:border-slate-300"
            >
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Share"}
            </button>
          </div>
        </header>

        <div className="mb-5 -mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Offense percentiles:</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              onClick={() => setVsPosition(false)}
              className={`px-2.5 py-1 rounded-md ${!vsPosition ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"}`}
            >
              vs League
            </button>
            <button
              onClick={() => setVsPosition(true)}
              className={`px-2.5 py-1 rounded-md ${vsPosition ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"}`}
            >
              vs Position
            </button>
          </div>
          <span className="text-slate-400">— Defense (OAA, FRV) is always vs. position</span>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          <aside className="md:w-64 md:flex-none">
            <div className="relative mb-3">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search hitters"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white"
              />
            </div>
            <p className="text-xs text-slate-400 mb-2 px-1">
              Pick up to {MAX_COMPARE} — {selected.length} selected
            </p>
            <ul className="space-y-1 overflow-auto pr-1" style={{ maxHeight: 420 }}>
              {filtered.map((p) => {
                const on = selected.includes(p.id);
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => toggle(p.id)}
                      className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg border text-left ${
                        on ? "border-slate-300 bg-white shadow-sm" : "border-transparent hover:bg-white hover:border-slate-200"
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full flex-none" style={{ background: on ? colorOf(p.id) : "#cbd5e1" }} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm leading-tight truncate">{p.name}</span>
                        <span className="block text-xs text-slate-400 leading-tight">{p.team} · {p.pos}</span>
                      </span>
                      {on && <X className="w-4 h-4 text-slate-400" />}
                    </button>
                  </li>
                );
              })}
              {!loading && filtered.length === 0 && (
                <li className="text-sm text-slate-400 px-2 py-4">No hitters match the search.</li>
              )}
            </ul>
          </aside>

          <main className="flex-1 min-w-0 space-y-6">
            <section className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex flex-wrap items-center gap-2 mb-2" style={{ minHeight: 28 }}>
                {chosen.length === 0 && <span className="text-sm text-slate-400">Select a hitter to draw a profile.</span>}
                {chosen.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className="group inline-flex items-center gap-1 text-xs rounded-full px-2 py-1 border"
                    style={{ borderColor: colorOf(p.id), color: colorOf(p.id) }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: colorOf(p.id) }} />
                    {p.name}
                    <X className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                  </button>
                ))}
              </div>

              <div style={{ height: 460, marginLeft: -8, marginRight: -8 }}>
                <ResponsiveContainer width="100%" height={460}>
                  <RadarChart data={radarData} outerRadius="78%">
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: "#475569" }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    {chosen.map((p) => (
                      <Radar key={p.id} name={p.name} dataKey={p.id}
                        stroke={colorOf(p.id)} fill={colorOf(p.id)} fillOpacity={0.12}
                        strokeWidth={2} isAnimationActive={false} connectNulls />
                    ))}
                    <Tooltip formatter={(v, n) => [`${v} pct`, n]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase tracking-wider text-slate-400">Axes — tap to add or remove</span>
                  <button onClick={() => setAxes(DEFAULT_AXES)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
                    <RotateCcw className="w-3 h-3" /> Reset
                  </button>
                </div>
                {["Traditional", "Advanced", "Statcast", "Defense"].map((tier) => (
                  <div key={tier} className="mb-2">
                    <span className="text-xs uppercase tracking-wider text-slate-400">{tier}</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {METRICS.filter((m) => m.tier === tier && !m.ctx).map((m) => {
                        const on = axes.includes(m.key);
                        return (
                          <button key={m.key} onClick={() => toggleAxis(m.key)}
                            className={`text-xs px-2 py-1 rounded-full border ${
                              on ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                            }`}>
                            {m.radarLabel || m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {chosen.length > 0 && (
              <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm table-fixed">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left font-medium text-slate-400 text-xs px-4 py-2" style={{ width: "34%" }}>Metric</th>
                      {chosen.map((p) => (
                        <th key={p.id} className="text-right font-medium text-xs px-4 py-2 truncate" style={{ color: colorOf(p.id) }}>
                          {p.name.split(" ").slice(-1)[0]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {TIERS.map((tier) => {
                      const rows = METRICS.filter((m) => m.tier === tier);
                      if (!rows.length) return null;
                      const ctx = rows[0].ctx;
                      return (
                        <React.Fragment key={tier}>
                          <tr>
                            <td colSpan={chosen.length + 1} className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400 px-4 pt-3 pb-1 font-sans">
                              {tier}{ctx && " — context, not ranked"}
                            </td>
                          </tr>
                          {rows.map((m) => {
                            const vals = chosen.map((p) => getPct(p, m, vsPosition)).filter((v) => v != null);
                            const best = ctx || !vals.length ? null : Math.max(...vals);
                            return (
                              <tr key={m.key} className="border-t border-slate-100">
                                <td className="px-4 py-2 text-slate-500 font-sans">
                                  {m.label}{m.lower && <span className="text-slate-300"> ↓</span>}
                                  {m.tier === "Defense" && <span className="text-slate-300"> · pos</span>}
                                </td>
                                {chosen.map((p) => {
                                  const pv = getPct(p, m, vsPosition);
                                  const shaded = !ctx && pv != null;
                                  return (
                                    <td key={p.id} className="px-4 py-2 text-right"
                                      style={{ background: shaded ? heat(pv) : undefined, fontWeight: shaded && pv === best ? 600 : 400 }}>
                                      {p.raw[m.key] == null ? "—" : m.fmt(p.raw[m.key])}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-xs text-slate-400 px-4 py-2 border-t border-slate-100">
                  Cell shade = percentile (red high, blue low). ↓ = lower is better. — = not applicable (e.g. a DH has no defensive position).
                </p>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
