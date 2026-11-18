# Platform Build & Redesign — Deployed App, Docker, MongoDB, HexBrain-derived UI

Date: 2026-11-18
Status: Draft for review
Depends on: `01-promo-pipeline-platform-design.md` (pipeline core, TimedUnit schema,
scoring/ranking — unchanged by this doc, which covers the app shell around it)

Scope note: this is the Phase 2 platform build. It is **not** what ships in
the 48-hour Kuku submission (that's the Streamlit + script pipeline from
plan 01, section 8). Build this after the submission is in, or in parallel
only if the submission is already safely done.

## 1. One correction before anything else: Vercel can't run the pipeline

Vercel serverless functions have hard limits (execution time, ~50MB deploy
size, no persistent disk, cold starts) that `ffmpeg` + `faster-whisper`
(500MB+ model weights) + `opencv` cannot live inside. Splitting the
deployment, not forcing everything onto one host:

| Service | What it is | Where it deploys |
|---|---|---|
| `frontend/` | Next.js app (UI, design system) | **Vercel** — this part is a perfect fit |
| `backend/` | FastAPI: REST API, job orchestration, MongoDB access | **Render / Railway / Fly.io** (Docker, free tier, no timeout) |
| `pipeline/` | The actual scorer/parser/transcriber (Python package) | Runs *inside* the backend container as an imported package — not a 4th separately-hosted service. Long jobs run in a background thread, same proven pattern already in ClipCut's `app.py` (`threading.Thread` + job dict + status polling). No new queue system needed; MongoDB's job-status field is the queue. |

Three folders as requested (`frontend/`, `backend/`, `pipeline/`), two real
deployed services (Vercel + Render/Railway), one database (MongoDB Atlas,
free tier).

## 2. Repo layout

```
kuku-promo-finder/
  plans/                      ← all plan/spec docs (this file + 01-...)
  frontend/                   ← Next.js, deployed to Vercel
    app/
    components/
    styles/tokens.css         ← design tokens from Section 3
    Dockerfile                ← for local dev parity only; Vercel ignores it
  backend/                    ← FastAPI, deployed to Render/Railway
    main.py                   ← routes, job orchestration (mirrors ClipCut's app.py)
    db.py                     ← MongoDB connection + schema helpers
    Dockerfile                ← ffmpeg baked in, av==16.0.1 pinned
    requirements.txt
  pipeline/                   ← Python package, imported by backend/
    adapters/
      script_adapter.py       ← parses .txt → TimedUnit (plan 01 §3.1)
      youtube_adapter.py      ← yt-dlp → audio → Whisper (plan 01 §3.2)
      mp4_adapter.py          ← upload → audio → Whisper (plan 01 §3.2)
    scorer.py                 ← rules-mode scoring (plan 01 §4)
    llm_pass.py               ← optional Claude-CLI polish pass
    stitcher.py               ← cross-episode promo stitching
  docker-compose.yml           ← backend + mongo, for local dev
```

## 3. Design system — translated from the HexBrain reference

Pulled directly from `WEB DESIGNS/HexBrain AI — Design System PRD.html`
(decoded its nested bundler boards — Color Theory, Typography, Components,
Layout, Interactions, Canvas boards). This is a real, fully-specified design
system for a cybersecurity vulnerability-map product; we reuse its tokens
and structure as-is, and remap its domain concepts to ours.

### 3.1 Tokens (verbatim from source — do not reinvent)

```css
:root {
  --bg:    #13120e;   /* warm near-black ground */
  --raise: #1f1d17;   /* elevated surfaces: cards, nav, modals */
  --line:  #322f25;   /* borders, dividers, rules */
  --ink:   #efe6d0;   /* primary text — warm cream, not pure white */
  --dim:   #8f8874;   /* secondary text, metadata, timestamps */
  --hot:   #ff6a3d;   /* primary accent: links, CTAs, focus, hover */
  --hot-hover: #ff8a60;
  --hot-active: #e55a2d;
  --red:   #ff3b30;   /* critical/error only */
}
font-family: 'Recursive', system-ui, sans-serif; /* variable font, axes MONO/CASL/wght/slnt/ital, weight 300–800 */
/* MONO 0 (proportional) for all UI text; MONO 1 (monospace) only for IDs/codes — our equivalent: episode IDs, timestamps */
```

Type scale (unchanged): Display 48/700, H1 36/700, H2 24/600, H3 20/600,
Body 15/400, Small 13/400, Caption 11/500 (1.5px tracking), Code 13/400 MONO1.

Spacing: 8px base scale (4/8/12/16/24/32/48/64). Radius scale: 4px tags,
6px chips, 8px buttons, 12px cards, 50% pips, 3px meters. Elevation is
communicated by **layering warm background tones, not shadows** — `bg` →
`raise` → `raise + 1px line border`. Keep this discipline; don't add drop
shadows just because "3D box" was mentioned (see Section 5 for the one
deliberate exception).

Interaction timing: 100ms for color-only changes, 150ms for
border/background transitions, 300ms for layout/panel slides. Focus ring:
`2px solid var(--hot)`, offset 2px, `:focus-visible` only.

### 3.2 Domain remap (cybersecurity → promo-finder)

| HexBrain concept | Our equivalent |
|---|---|
| Vulnerability report | Candidate promo window |
| Weakness class / type (18 classes, 215 types) | Episode (radial band) / scene-window (node within band) |
| Program (Shopify, etc.) | Show (a folder in the knowledge model) |
| CVE | Top-ranked promo |
| Severity (low/med/high/critical) | Hook+cliffhanger confidence tier |
| Bounty $ amount | Promo score (0–100) |
| "14,414 reports / 18 classes / 215 weaknesses / X programs" stat row | "N candidates / 50 episodes / X promos found / 1 show" stat row |
| Stat card, program card, report card | Score card, show card, promo card — same CSS pattern (`--raise` bg, `--line` border, 12px radius) |
| Severity pips, frequency bars, linear meter | Reused directly: promo score meter (fill `--hot`, `--red` above 80 score... actually invert: high score is *good* here, so fill color logic flips — high score = `--hot` glow, not `--red`; reserve `--red` for "known bad pick" flagged candidates from the quality-check section) |

### 3.3 The Canvas 2D Radial Map — reused as the pipeline visualization

This is the single biggest reuse win, and it's a near-perfect conceptual
fit, not just a visual skin:

- **Phyllotaxis radial layout** (golden-angle distribution around a center):
  place all 50 episodes as radial bands fanning out from a center point —
  exactly the source's "18 weakness classes around center" pattern.
- **Strips with rows of dots** (source: each weakness = a strip, each dot =
  a report): each episode = a strip, each dot = a candidate scoring window.
  Dot radius/glow = score (the source already does "weakness center has a
  bright radial-gradient glow, overlapping circles with decreasing
  opacity" — reuse verbatim for "this candidate is a strong promo").
- **Bezier connector curves with particle animation**: the source uses
  these to link reports to their class. **We reuse this exactly for
  cross-episode stitched promos** — a bezier curve connecting a node in
  episode 3's band to a node in episode 11's band *is* the visual for "this
  promo joins a moment from ep3 with a moment from ep11." This single
  reused mechanic solves the "show how a stitched promo spans episodes"
  requirement for free.
- **Multi-level zoom**: overview (all 50 episodes, radial) → mid-zoom (one
  episode's strip, scene-by-scene) → detail (one promo node → opens the
  detail panel from Section 4/5).
- **60 FPS canvas, requestAnimationFrame, frame order unchanged**: clear →
  radial guides → connectors → strips/nodes → labels → particles → HUD
  overlay. During a live pipeline run, nodes light up / grow in this exact
  render loop as scores are computed — this *is* the "show scores
  increasing while the pipeline runs" requirement, achieved by streaming
  score updates from the backend (WebSocket or polling) into the existing
  particle/glow system instead of building a new progress UI.

## 4. Input flow (3 modes, one visualization)

Top of the app: three input controls (YouTube URL field / MP4 dropzone /
"Choose script folder ▾" — the knowledge-model picker), styled as the
source's button system (Primary/Secondary/Ghost). Selecting any of them
kicks off the same backend job; the radial map is what renders regardless
of input type, populated from the same `TimedUnit`→scored-candidate
pipeline described in plan 01.

Sort control: ascending/descending toggle on the stat row re-sorts which
nodes glow brightest / are listed first in the ranked side panel — doesn't
change the map layout, just the highlight order.

## 5. Promo detail panel — video path vs. script-only path

Clicking a node opens a detail panel (`--raise` card, standard elevation,
**not** a literal drop-shadow 3D box — see note below) with two different
bodies depending on whether this promo has a video:

**Video path (YouTube/MP4 input):** an actual `<video>` element plays the
clip, start→end trimmed, exactly like ClipCut's existing preview.

**Script-only path (no video exists):** a **karaoke-style scrolling text
panel** — this is the "2D lyrics box" you described. It is not a new
invention: ClipCut's own `captions.py` already ships a `karaoke` caption
style (word-by-word highlight synced to timing). We reuse that exact logic,
just without a video underneath:
- The panel shows the promo's dialogue/action lines in order.
- A simple JS timer (`requestAnimationFrame`, duration = clip's
  `end - start`) advances a highlight through the lines proportionally to
  each line's own `start`/`end` offset within the clip — same math
  ClipCut uses to highlight the "active word," just applied to whole
  screenplay lines instead of transcript words.
- Play/pause/scrub controls, same as a video player, so it *feels* like
  "running" the clip even though there's no actual media.

**On the "3D box" instruction specifically:** the HexBrain source system
explicitly avoids literal 3D/shadow depth — elevation is layered flat warm
backgrounds, by design, everywhere else in the UI. Recommendation: keep the
detail panel consistent with that (flat `--raise` card), and if a genuine
3D-tilted container is wanted specifically for this one element as a
deliberate accent (to visually signal "this is a simulated player, not real
video"), that's a one-off CSS `transform: perspective(...) rotateX(...)`
treatment scoped only to this panel — flag it as an explicit exception, not
a system-wide pattern, so the rest of the UI doesn't drift from the source
design system.

## 6. MongoDB schema

```js
// knowledge_model collection — one doc per show
{ show_id, name, created_at,
  episodes: [ { episode_id, filename, units: [TimedUnit, ...] } ] }

// jobs collection — one doc per pipeline run (mirrors ClipCut's job.json pattern)
{ job_id, input_type: "youtube"|"mp4"|"script_folder", show_id?,
  status: "queued"|"processing"|"ready"|"error", stage, progress,
  promos: [ { start, end, segments: [...], score, hook, cliffhanger, why } ],
  engine: "rules"|"llm", created_at }
```

Atlas free tier (M0) is enough for this scale (50 episodes × a few hundred
lines each — nowhere near the 512MB cap).

## 7. Docker

- `backend/Dockerfile`: Python base image, `apt-get install ffmpeg`,
  `pip install -r requirements.txt` (with `av==16.0.1` pinned — the same
  version/kwarg bug hit earlier this session, carried over as a known fix),
  copies `pipeline/` in as a local package.
- `frontend/Dockerfile`: standard Next.js multi-stage build — used for local
  dev parity; the actual Vercel deploy builds from the repo directly and
  ignores this file.
- `docker-compose.yml` at repo root: `backend` + `mongo` services, for
  running the whole thing locally before pushing to Render/Vercel.

## 8. Build order

1. `pipeline/` package (parser + scorer) — already specced in plan 01,
   build/reuse from the 48-hour submission code directly.
2. `backend/` FastAPI wrapper around it + MongoDB — mirrors ClipCut's
   `app.py` job pattern closely enough to port, not rewrite.
3. `frontend/` static shell with design tokens (Section 3.1) + input
   controls (Section 4) — no canvas yet, just forms + a plain ranked list.
4. Canvas radial map (Section 3.3) — the heaviest single piece; build last,
   after the plain list view already works end-to-end.
5. Detail panel, both paths (Section 5).
6. Docker + deploy (Vercel + Render/Railway + Atlas).

## 9. Open items

- WebSocket vs. polling for live score updates into the canvas: start with
  polling (simpler, matches ClipCut's existing `/api/jobs/{id}` pattern);
  upgrade to WebSocket only if polling visibly lags during a 50-episode run.
- Exact phyllotaxis constants (angle, spacing) need tuning once real data
  volume (50 episodes × ~5–10 candidates each) is plugged in — the source's
  constants were tuned for 215 classes / 15,000 reports, a different scale.
