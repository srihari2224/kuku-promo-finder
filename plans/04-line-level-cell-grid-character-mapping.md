# 04 — Line-level cell grid, per-line score attribution, character mapping

Supersedes the "minute grid" idea in ADR-04 (chat). You clarified the cell
unit should be **transcript lines**, not minutes — this plan redoes the
math around that, and starts from literally parsing what's in the four
hexbrainai.com screenshots you gave, since you asked for that explicitly.

## 0. What's actually in the four screenshots

Not vibes — a structural read of each one, since that's what the cell
grid and score panel below are modeled on.

**Screenshot 1 — band/bracket zoomed view ("Band 2 2 CVEs", "Band 4 10
CVEs", "Band 5 549 CVEs").**
A class is broken into *bands* — buckets of CVEs grouped by exploit
likelihood ("Ready check, not yet exploited" / "Possible 1–10%" /
"Unlikely under 1%"). Each band renders as its own dot-grid block, sized
to its count (2 dots → a tiny 2-dot cluster; 549 → a dense ~23×24 block).
A labeled bracket (the orange `⌐...⌐` line) spans all bands vertically,
tying them to one parent. Curved lines fan from each block toward a
single point that converges further right into the month node ("n/d",
"561 CVEs"). **The structural idea: sub-groups within a parent get their
own proportionally-sized block, not one undifferentiated strip.**

**Screenshot 2 — full overview ("407,168 registered CVEs").**
Years ring the outside (2026, 2025, ... 2000), each with its own report
count and exploited-count printed beside it. Months ring the inside, each
a small circle labeled `00`–`26`/`99`. Between the two rings: some months
show a dot-grid "fan" (dense, structured — screenshot 3 zooms into one of
these), others show a loose circular cluster of red dots ("sunflower"
pre-click state). The center carries the single aggregate number and the
one red-highlighted sub-stat ("exploited in the wild"). **The structural
idea: the center is reserved for exactly one aggregate number + one
red-flagged stat — not a legend, not instructions.**

**Screenshot 3 — zoomed dot-grid blocks converging on "ACL" node.**
Two large rectangular blocks (one denser/brighter = more reports, one
sparser/dimmer = fewer) each made of a strict grid of small squares —
brightness of an individual square varies (not binary), reads as "this
report mattered more than that one" even within the same block. From
both blocks, **individually-curving lines trace from the block's edge
toward one converging point** at the "ACL" node (not one line per block —
a line per *column* of the block, so the convergence itself communicates
"all of this funnels into this one place"). **The structural idea: fan
lines originate from structure (per-column), not from a block's center —
the convergence point is earned by following real sub-divisions.**

**Screenshot 4 — sunburst with report-row list ("Improper Access Control
- Generic", "888 reports $330,755").**
Center: a bright core (white→orange→transparent radial gradient), individual
small squares scattered outward from it at increasing radius (this is the
literal "each report is a dot, radius ∝ some ordering" sunflower). Flanking
the burst on **both left and right**: a plain-text list, each row = report
number (`#530441`), the program (`Uber`), the bounty (`$4,500`), and a
one-line title truncated with `...`. No card chrome, no borders between
rows — just consistent vertical rhythm and a hover state (implied by the
cursor affordance in HexBrain's live site). **The structural idea: the
burst and the list are the *same data*, rendered twice, spatially
adjacent, not one feeding a separate modal.**

This directly explains what's wrong with our current lyrics panel: it's a
**separate floating card** (`position: fixed`, dark backdrop, close
button) instead of a **persistent side list standing next to the burst**,
which is exactly your "lyrics box is separate" complaint. Fixed in §4.

## 1. The cell model — lines, not minutes

Per episode, `N = len(units)` — literally every parsed `TimedUnit`
(dialogue, action, camera, sound_fx), not a time bucket. For a 40-minute
episode with ~90 parsed lines, `N ≈ 90`, not 40 — the grid should be as
fine as the actual transcript, which is denser and more honest than a
once-per-minute bucket.

**Grid dimensions**, same square-ish layout hexbrain uses for its blocks:

```
rows = floor(sqrt(N))
cols = ceil(N / rows)
```

Each cell `k` (0-indexed, row-major) maps to `units[k]` directly — no
aggregation, no lossy binning. This is strictly denser and more legible
than the minute-grid: a 90-line episode gets a `9×10` grid instead of a
coarse `6×7` minute grid that hides which exact line mattered.

## 2. Per-line score attribution — the actual math

A window's score is **not a single blob to paint over every line in it**.
Looking at `score_window()`, the score is the sum of exactly two
line-local measurements plus a constant:

```
score(i, j) = 40 + hook_score(units[i]) + cliff_score(units[j], trailing) − penalty(i)
```

`hook_score` only ever reads `units[i]` (the window's *first* line).
`cliff_score` only ever reads `units[j]` and up to 2 trailing lines
(the window's *last* line + what follows). **Every other line in the
window contributes exactly zero to the number.** That's not a limitation
to paper over — it's the honest answer to "which line enhanced the
score," and the UI should say exactly that instead of implying every
line in a clip is equally responsible.

Per-line attribution, computed once `find_promos` has picked its windows:

```
for each chosen window (score, i, j, info):
    line_contribution[i]  += {"role": "hook",  "points": info.hook}
    line_contribution[j]  += {"role": "cliff",  "points": info.cliff}
    for k in (i+1 .. j-1):
        line_contribution[k] += {"role": "connective", "points": 0}
```

Cell render rule, driven directly by this:
- **hook line**: bright highlight, `+{hook_score}` badge, orange
- **cliff line**: bright highlight, `+{cliff_score}` badge, red-orange
  (distinct hue from hook, matching hexbrain's severity-color convention
  — hook and cliff are different *kinds* of contribution, not the same
  color at different intensity)
- **connective lines** (inside the window but not hook/cliff): dim
  highlight, no badge — reads as "part of the clip" without implying it
  did any scoring work
- **lines outside every chosen window**: grey, same as an un-selected
  hexbrain report dot

This requires `_hook_score`/`_cliff_score` to also return *which specific
keyword/emotion terms matched* (not just the summed float), so the badge
on click can show the literal receipt:

```python
def _hook_score(unit):
    terms = []
    score = 0.0
    if unit["type"] == "dialogue":
        if "?" in unit["text"]:
            terms.append(("ends with ?", 10)); score += 10
        hits = [k for k in HOOK_KEYWORDS if k in unit["text"].lower()]
        if hits:
            pts = min(15, 6 * len(hits))
            terms.append((f"hook word: {', '.join(hits)}", pts)); score += pts
        # ...same pattern for emotion, brevity
    return score, terms
```

Click-on-cell panel then renders literally:

```
LINE 23 · HOOK                                    +20
  "You're the Duke?"
  ends with ?                                      +10
  hook word: duke                                   +6
  brevity (≤8 words)                                +4
```

This is the direct structural match to hexbrain's report row
(`#530441 ... Unauthorized access to ...`) — a specific line, a specific
number, specific reasons, not a summary.

## 3. Character symbol mapping

Every `unit.speaker` gets a **deterministic** glyph + color, computed
once per episode (stable across re-renders, no manual assignment):

```
palette = [HOT, "#5fb3ff", "#8f6fff", "#5fd4a0", "#ff6ab0", "#d4b85f", ...]
                                                         # 8-10 fixed hues

def character_style(name, speakers_in_order):
    idx = speakers_in_order.index(name)       # first-appearance order
    return {
        "color": palette[idx % len(palette)],
        "glyph": name[0].upper(),               # "JULIANA" -> "J"
    }
```

First-appearance order (not alphabetical, not hash) so the protagonist
usually lands color index 0 and stays the "hot" orange-family color,
matching how hexbrain reserves orange for the thing currently in focus.

Each cell that is a dialogue line renders its speaker's glyph in a small
corner badge (12×12px, same treatment as hexbrain's severity pip) —
answers "show each character symbols" directly: the grid becomes
scannable by character at a glance, color-coded, before you even read
the text.

## 4. Fixing "the lyrics box is separate"

Current structure: clicking a strip/cell opens `<LyricsPlayer>` inside a
`position: fixed` panel with its own backdrop and close button — visually
and structurally disconnected from the canvas, which is why it reads as
a bolted-on afterthought. Hexbrain's screenshot 4 has no such separation:
burst and list share one coordinate space.

**Fix**: when a window is focused (cell clicked or sunflower entered),
the canvas viewport itself shrinks to make room for a **permanent docked
column** (not an overlay) — same pattern as hexbrain's `#detail-panel`,
which is `position: fixed; right: 0` but *always part of the layout*,
pushing the canvas rather than floating over it. Concretely:

- `.canvas-stage` width becomes `calc(100% - 360px)` whenever
  `viewLevel !== 'overview'`, animated via CSS transition — the canvas
  resizes (triggers our existing `resize()`), not just gets covered.
- The 360px column replaces both the current `LyricsPlayer` modal *and*
  the `.detail-panel` — one column, two stacked sections: line-list on
  top (hexbrain's report-row style, synced to canvas hover), score
  receipt + character chips below.
- Removing the backdrop/close-button chrome entirely — closing happens
  via the existing Back button, consistent with one exit mechanism
  instead of two.

## 5. Zoom levels, made explicit (fixes "zoom is very bad")

Right now zoom thresholds are scattered magic numbers across draw
functions with no single source of truth, which is exactly why the
transition from overview to focused feels inconsistent. Consolidating
into one table removes the guesswork:

| Level | `camera.zoom` | What renders | Entered by |
|---|---|---|---|
| Overview | 0.3 – 0.7 | All episode nodes, promo-count-sized strips, cross-episode web | default / Back |
| Episode | 0.9 – 1.6 | **Line-cell grid** for the focused episode (this plan §1), sector arc | click episode node |
| Cell focus | 2.5 – 4.0 | Sunflower burst of the clicked window's lines + docked side list | click a cell |

Each level gets a **fixed target zoom** (no more ad-hoc `1.15`, `1.3`,
`3.2`, `3.5` sprinkled per interaction) and the grid/strip choice is a
`viewLevel` switch, not a zoom-threshold guess — removes the
"inconsistent depending on exactly how far you scrolled" feeling.

## 6. Data contract changes (backend)

`find_promos()` return shape gains, per promo:

```json
"receipt": {
  "hook_line_index": 12,
  "hook_terms": [["ends with ?", 10], ["hook word: duke", 6]],
  "cliff_line_index": 19,
  "cliff_terms": [["cliff word: never", 5]],
  "base": 40,
  "penalty": 0
}
```

New endpoint field on the pipeline/youtube/upload responses:
`"episode_cells": {"<episode_id>": [{"index", "role", "speaker", "text_preview", "points"}]}`
— the full per-line breakdown for the episode's cell grid, built once
server-side rather than re-derived client-side from five separate promo
objects.

## 7. Build order

1. `scorer.py` — term-level receipts (§2), no behavior change to totals, same scores
2. `episode_cells` endpoint field (§6) — mechanical, depends on #1
3. Character palette assignment (§3) — pure function, no dependencies
4. `RadialCanvas.jsx` — line-cell grid replaces promo-count strips at Episode level (§1, §5)
5. Docked side column replacing the floating panel (§4) — the layout fix, last, since it depends on the grid existing to dock next to

Confirm this reads right before I start — in particular whether
`episode_cells` should ship for all 50 episodes up front (bigger payload,
zero extra requests) or lazily per-episode on zoom-in (smaller payload,
one fetch per episode you actually open). Given it's 50 episodes × ~70
lines average, the full payload is small enough (a few hundred KB of
JSON) that I'd default to shipping it all upfront — but it's your call if
you'd rather keep initial load lighter.
