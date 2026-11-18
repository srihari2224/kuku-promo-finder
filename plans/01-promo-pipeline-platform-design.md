# Promo-Finder Pipeline & Platform — Design Spec

Date: 2026-11-18
Status: Draft for review

## 1. Why this shape (grounded in the JD rubric)

The JD's internal eval rubric (page 3) rewards **bias for action** ("cost of
time... marginal value of waiting/info collection is low"), **ownership**
("if someone else owns it, it shouldn't occupy mental space"), and **1st
principles** ("they have answers to your Why"). That means: for the actual
48-hour submission, we build and ship the one thing we can prove works —
the script-based promo finder — and we *describe*, crisply and with reasons,
how it generalizes into a 3-input platform. We do not spend assignment time
pre-building React/MongoDB infrastructure nobody has asked for yet. That
infra is real and worth planning (this doc does), but it is Phase 2+, after
the core pipeline is proven.

## 2. Problem recap

Kuku's Problem 1: given a microdrama screenplay (timestamped scenes/
dialogue/action/camera cues), find 20–60s **promos** — not just clips.

**Clip vs. promo** (resolved): a clip is one continuous high-intensity
window (what ClipCut/CapCut produce). A promo *may* be that, or may stitch
2–3 short segments from different episodes when there's a real narrative
reason (setup + payoff). Default to single continuous window; cross-episode
stitching is a secondary, higher-effort mode layered on top — not the
baseline strategy. "5 seconds from everywhere" is explicitly rejected: it
fails the brief's "makes sense standalone" requirement.

## 3. Core design decision: one pipeline, one intermediate schema, three input adapters

All three input modes — (a) YouTube link, (b) direct MP4 upload, (c) select
a script-folder from the knowledge model — converge on the same
intermediate shape before scoring/ranking ever runs:

```python
TimedUnit = {
    "start": float,          # seconds
    "end": float,
    "episode": str,          # which episode/video this came from
    "type": str,             # "dialogue" | "action" | "camera" | "sfx"
    "speaker": str | None,   # None for action/camera/sfx
    "emotion": str | None,   # tag if present (script) or None (video-derived)
    "text": str,
}
```

One scorer, one ranker, one output format — regardless of where the
`TimedUnit` list came from. This is the answer to "single pipeline but
input-specific steps": the *adapters* differ, the *pipeline core* does not.

```
                ┌─────────────┐
 YouTube URL →  │  Adapter A  │ → download → extract audio → Whisper
                └─────────────┘                                   \
                ┌─────────────┐                                    \
 MP4 upload  →  │  Adapter B  │ → extract audio → Whisper            →  List[TimedUnit]  →  [scorer] → [ranker] → [LLM polish, optional] → promos.json
                └─────────────┘                                    /
                ┌─────────────┐                                   /
 Script folder→ │  Adapter C  │ → parse .txt → structured lines  /
                └─────────────┘
```

### 3.1 Adapter C (script folder) — build this first, this assignment

- Input: a folder of `episode-NNN-*.txt` files (Kuku's format, or any
  screenplay using the same scene/timestamp convention).
- Parse each file into `TimedUnit`s directly from the existing tags
  (`SCENE`, `CAMERA:`, `ACTION:`, `<SPEAKER> (emotion):`, `SOUND FX:`).
- No ASR needed — this is strictly higher-fidelity than audio-derived data
  (see Section 6). This is the one we ship working end-to-end.

### 3.2 Adapters A/B (YouTube / MP4) — documented, not built, this round

- Same approach as ClipCut: download/accept file → ffmpeg extract audio →
  faster-whisper transcribe → group into sentences → `TimedUnit`s, with
  `emotion=None` (video gives no emotion tag; would need a future sentiment
  pass) and `type="dialogue"` only (no action/camera granularity from audio
  alone).
- Known fragility carried over from testing ClipCut directly: `requirements.txt`
  must pin `av==16.0.1` — unpinned installs grab `av>=19`, which drops a
  kwarg (`metadata_errors`) that `faster-whisper` still calls, crashing every
  transcription job. Fix this pin before this path is ever relied on.

### 3.3 Adapter selection (future platform UI)

A dropdown: "YouTube link" / "Upload MP4" / "Choose script folder ▾" (the
third lists folders already ingested into the knowledge model — "today: 1
folder, 50 episodes of Show X; tomorrow: Show Y"). Selecting a script folder
skips all video/audio steps entirely and goes straight to parsing.

## 4. Scoring & ranking (script path — the part we actually build)

Modeled on ClipCut's `pick.py` structure, adapted to script-native signals
(script text carries *more* signal than audio — see Section 6):

- **Candidate generation**: slide a window of scenes/lines per episode,
  20–60s, same two-pointer sliding-window approach as ClipCut's
  `pick_builtin`.
- **Hook score** (first 3s of window): emotion-tag intensity match
  (Devastated/Outraged/Gloating/etc.), physical `ACTION:` verb hit (slap,
  grips, drops, reveals), question mark, short punchy dialogue line.
- **Cliffhanger score** (last unit of window): ends on `Cut to black.`,
  `SOUND FX:` swell, unresolved question, or a reveal left hanging.
- **Standalone-sense penalty**: window opens on a bare pronoun ("he"/"she")
  with no name in the preceding 2 lines.
- **Clean-boundary gate**: reuse ClipCut's `_starts_clean`/`_ends_clean`
  logic — don't cut mid-sentence, don't start on a weak connective.
- Two engines, selectable, same fallback pattern as ClipCut:
  - `--mode=rules`: fully deterministic, zero LLM, zero cost, zero API key.
  - `--mode=llm`: after rules produce top-N candidates per episode, one
    pass through an LLM (Claude CLI, no API key needed — same trick
    ClipCut's `find_claude()` uses — or Gemini free tier) to (a) write the
    natural-language "why it works" line and (b) tie-break near-equal
    scores. The LLM never re-derives timestamps or the candidate set.
- **Cross-episode stitching** (secondary mode, built after single-window
  works): search for a setup unit in episode N and a payoff unit in episode
  N+k with thematically matching keywords/characters; propose as a 2-segment
  promo only when both segments individually score above a hook/cliffhanger
  threshold.

## 5. Output

Per promo: `episode(s)`, ordered list of `{start, end}` segments, `hook`,
`cliffhanger`, `why` (one line), `score`. Plus a cross-promo ranking and an
explicit "known bad picks" section (required by the brief's "check quality").

## 6. Why script data beats video-derived data (validated, not assumed)

Ran ClipCut itself against a real episode video as a control. Result:
Whisper ASR dropped words ("Why are you holding her hand?" → "Are you
holding her hand?"), has zero speaker ID, zero emotion tag, zero camera/
action cues, and timestamps drift ~10s+ from the script's own. The script
already contains, as structured ground truth, everything ClipCut's audio
pipeline has to *infer*: speaker, emotion, visual framing, and explicit
cliffhanger markers. The one thing script timestamps don't guarantee is
*final rendered* pacing (the script is production-intent, not necessarily
the aired cut) — flagged as the one legitimate gap, and the reason Adapters
A/B remain valuable long-term (validate/correct script-based picks against
real video once available), not because they're a better primary signal.

## 7. Platform shape (Phase 2+, not this submission's working code)

- **Frontend**: React. Three input controls as described in 3.3. Table of
  ranked promos, playback/preview where video exists, JSON/CSV export.
- **Backend**: Python API (FastAPI, same framework ClipCut already uses)
  wrapping the pipeline core from Section 3–4.
- **Knowledge model**: MongoDB collection per show/folder — stores parsed
  `TimedUnit`s once per ingested script folder so re-runs don't re-parse.
  Schema: `{show_id, episode_id, units: [TimedUnit]}`.
- **Hosting**: cloud (any free-tier target — Render/Railway for API,
  Vercel for frontend, MongoDB Atlas free tier for the DB).
- This section goes into the solution doc as "how this scales," not as
  code delivered in the raw-outputs folder.

## 8. What ships in the 48-hour submission

1. Adapter C (script parser) — working.
2. Rules-mode scorer/ranker — working, zero dependencies beyond stdlib.
3. Optional LLM-mode pass (Claude CLI) — working if time allows, clearly
   labeled optional in the doc.
4. Cross-episode stitching — stretch goal if time allows.
5. Hand-labeled eval set (3 episodes) + precision report.
6. Run on all 50 episodes → raw outputs folder.
7. Minimal Streamlit UI (not React — React/Mongo is Phase 2 platform vision,
   documented but not built now).
8. Solution doc: problem framing, assumptions, this architecture, the
   ClipCut-comparison finding (Section 6), scale/cost math, known failures,
   and the Phase 2 platform plan (Section 7) as the "how it scales" answer.

## 9. Open items / explicit assumptions

- Assuming the screenplay's emotion tags and action descriptions are
  reliable (they're AI-generated per-episode metadata, not verified against
  final video) — flagged as a limitation, not hidden.
- Assuming "makes sense standalone" can be approximately checked via the
  pronoun/name-reference heuristic; not a substitute for a human read, and
  the doc says so.
