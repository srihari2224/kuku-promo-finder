# ADR-05: Promo-Clip Scoring — Editor-Triage Pipeline with an Additive AI Judgment Layer

**Status:** Proposed (revised after owner clarification)
**Date:** 2026-11-18
**Deciders:** Project owner (take-home author)
**Supersedes scoring portions of:** [03-simplified-final-architecture](03-simplified-final-architecture.md), [04-line-level-cell-grid](04-line-level-cell-grid-character-mapping.md)

---

## The real task (corrected)

**This is an editor-triage tool, not a visualization toy.** A human editor will not watch all 50 episodes to find promo material. The pipeline's job is to do that watching for him and hand back a short, ranked list of **the best clips, with everything he needs to cut them without opening the episode first.**

For every top clip the output must give:
1. **Which episode** it came from (e.g. "Episode 38").
2. **The original database timestamps** of the clip window — in the script's own `mm:ss.ss` format, episode-relative — plus the per-line timestamps.
3. **The full clip script** (the camera/action/dialogue/SFX lines of that window) with those original timestamps attached, so he goes straight to that spot in the DB, trims, and uploads.

The score exists only to **rank** which of those clips he should cut first.

### Verified data facts (checked against `backend/data/episodes/`)

- **50 episode script files**, not 45. Each is one scene, **~1:20 to ~3:20 long** (mostly 1.5–3 min). So a 20–40s promo covers a large fraction of an episode — the problem is "pick the single best beat per episode, then rank across 50," not "find a needle in 9 minutes."
- **Timestamp format:** `Start: (00:16.00) | End: (00:17.30)` — `mm:ss.ss`, relative to episode start. This is the number the editor needs; it must survive end-to-end into the output.
- **Line types:** `**CAMERA:**`, `**ACTION:**`, `**SOUND FX:**`, and speaker dialogue `**JULIANA (Breathless, Bewildered):**` (emotion in parens). Parsed by `pipeline/parser.py` — rich and real for scripts.
- **Every episode has `EPISODE LOGLINE` + `CONTINUITY NOTES`** (50/50) — a pre-written one-paragraph dramatic summary. This is a first-class input for the AI layer: it tells the model what the episode is *about* and, critically, **where the twist/secret is**, without the model having to infer it from raw lines.

## The promo-craft rules we were getting wrong

The current scorer (`pipeline/scorer.py`) decides promos naively: base 40 + "has a question mark" + a few hook keywords. That is **not how a promo works.** Two corrections are now first-class requirements:

### Rule 1 — Suspense preservation (withhold the reveal)
A promo's whole job is to make the audience need the next episode. If an episode contains a **twist, secret, or suspense**, the clip must **build the tension and cut *before* the reveal** — never include the payoff line. If the clip answers its own question, it has no pull.

Mechanically this is a **clip-end-boundary rule**: find the reveal/payoff line, set the clip end *just before it*, and keep the open question inside the window. This is exactly the kind of judgment keywords can't make and the AI layer can (it can read the logline + lines and point at "the secret is revealed here").

### Rule 2 — Dramatic intent, not keyword presence
A line full of hook words is not automatically a promo. Cliffhanger, emotion, humor, suspense, and twist are *qualities of a dramatic beat*, judged in context — which is what the AI score is for.

## Decision

A **three-tier pipeline** where the heuristic does cheap high-recall candidate work, the **AI adds an additive judgment score**, and a deterministic stage enforces boundaries and the output contract.

```
TIER 1  HEURISTIC CANDIDATES          (cheap, deterministic, high recall)
        Enriched scorer generates every valid window per episode, scores it
        with the ClipCut-style signal set, emits a transparent receipt, and
        keeps the top ~10 candidates per episode.  → heuristic_score (0..~100)

TIER 2  AI JUDGMENT  (LLM only)        (semantic, additive, the decider)
        For each candidate, the AI receives:
          · the clip's full script lines (type/speaker/emotion/text/timestamps)
          · the episode LOGLINE + CONTINUITY NOTES
          · OUR heuristic receipt (the scores/terms we already computed)
        The AI returns a DECISION + its own score + the reveal location:
          { verdict, ai_score (-X..+Y), reveal_line_index|null,
            withholds_reveal: bool, promo_type, reason }
        · If the AI judges it a weak/unintentional/reveal-spoiling clip, ai_score
          is NEGATIVE and pulls the total down.
        · total_score = heuristic_score + ai_score   ← this ranks the clips.

TIER 3  FINALIZE + OUTPUT CONTRACT     (deterministic)
        · Apply the suspense cut: if withholds_reveal is false and a reveal_line
          exists, trim the window to end just before reveal_line, re-check length.
        · Snap to line/pause boundaries, add breathing room.
        · Enforce cross-episode diversity (quota so one episode can't monopolize).
        · Emit episode id + ORIGINAL db timestamps (window + per line) + full
          clip script, ranked by total_score, grouped best-episodes-first.
```

**The AI is an additive scoring judge, per the owner's design** — not a replacement for the heuristic and not a pure re-ranker. We compute our score, the AI reads our score *and* the script, issues a decision, and its decision becomes a number we **add** to ours. The combined total makes the top clips. When the AI is unavailable, `ai_score = 0` and the pipeline still ranks by the heuristic alone (graceful degradation).

## Why the AI sits exactly here (not elsewhere)

- **Not at candidate generation.** Generating candidates is a recall problem over hundreds of windows × 50 episodes — cheap heuristics are correct and keep the explainable receipt. Sending all of that to an LLM is slow and wasteful.
- **At judgment, yes.** Whether a beat actually lands as a promo, and *where the reveal is*, are semantic questions. Judging only the ~10 survivors per episode is ~1 small LLM call per episode — affordable, and it's where the quality comes from.
- **The additive formula keeps it honest.** The heuristic score stays visible (the receipt), the AI score is a separate visible term, and `total = heuristic + ai`. The editor can see *both* why the keywords fired and what the AI thought — no black box.

## The AI contract (LLM only)

**Input per candidate** (one batched call per episode covering its ~10 candidates):
- Episode `LOGLINE` + `CONTINUITY NOTES`.
- Each candidate's lines: `type, speaker, emotion, text, start, end` (original timestamps).
- Our heuristic receipt for each candidate (base, hook terms, cliff terms, penalty, total).

**Rubric the AI scores against** (adapted from ClipCut's viral-editor prompt `pick.py:221-241`, retargeted to microdrama promos):
- Hook strength in the first 1–2 lines (a claim, question, tension, shock).
- Emotional stakes / character conflict / humor where present.
- **Cliffhanger pull: does it make you need the next episode?**
- **Suspense preservation: does the clip stop *before* the twist/secret is revealed?** If it spoils the reveal → penalize hard and point at `reveal_line_index`.
- Standalone comprehensibility (works without having seen the episode).

**Output (strict JSON, one object per candidate):**
```json
{ "candidate_id": "...",
  "verdict": "strong | ok | weak | spoils_reveal",
  "ai_score": 18,                 // signed; negative for weak/spoiling clips
  "promo_type": "cliffhanger|emotional|twist|humor|suspense",
  "reveal_line_index": 7,         // or null — where the secret/payoff lands
  "withholds_reveal": true,       // false ⇒ Tier 3 trims before reveal_line
  "reason": "Builds dread as the guard approaches; cuts on 'Why?' before the motive is shown." }
```

**Runtime:** Anthropic Messages API via `ANTHROPIC_API_KEY` (owner will supply the key), Haiku-class model for the judge (fast + cheap for a scoring pass), low temperature for stability. On missing key / parse failure / timeout → `ai_score = 0`, pipeline falls back to pure heuristic. (The local `claude` CLI, present on this machine, is an optional no-key dev fallback.)

## Tier-1 heuristic signals to add (the "more parameters" list)

Ported/adapted from ClipCut (`pick.py:73-106`) and tuned for these scripts:
1. **Duration sweet-spot** — reward a target promo length (peak ≈25–35s); today duration is computed but never scored (`scorer.py:122`).
2. **Boundary discipline** — port `_starts_clean`/`_ends_clean`/`finalize`: snap to line/pause boundaries, weak-start (`and/but/so`) and weak-end penalties, breathing room.
3. **Emotional intensity** — use the `emotion` parenthetical as a real weighted signal across the window, not just the one narrow hook bonus.
4. **Speaker dynamics** — protagonist-speaking weight + rapid speaker alternation (two-hander conflict) as a tension signal; uses the `speaker` field we currently ignore in scoring.
5. **Action/physical-beat weighting** — slaps, collapses, grabs (we have `ACTION_HOOK_KEYWORDS` but only on the single hook line; spread across the window).
6. **SFX/music cues** — "ominous," "swell," "dread" as suspense signals (we have the list, barely used).
7. **Second-person & numbers** in the hook line.
8. **Punctuation emphasis** — `!`, `...`, caps counts.
9. **Wider normalization** — map to a 60–98 display band for ranking resolution (today scores cluster ~40–90).

Bug fixes: substring→word-boundary matching (`kill`⊄`skill`, `duke`⊄`ducked`); hook `"?" in` → `endswith("?")`; make duration affect score.

> Audio-energy scoring (ClipCut's RMS z-score) applies to the **video/MP4 path**, not the script DB (scripts have no audio). Keep it for the upload pipeline; it's not needed for the 50-episode script triage that is the core task.

## Ranking & output

- **Two-level ranking:** rank episodes by their best clip's `total_score` (and by logline-level drama if we want an episode headline), then within each surface its top clip(s). Editor sees "best episodes first, best clip inside each."
- **Cross-episode diversity** in `rank_all`: per-episode quota + near-duplicate suppression so the top list isn't one episode repeated.
- **Output contract per clip:** `episode`, `total_score`, `heuristic_score`, `ai_score`, `promo_type`, `reason`, `withholds_reveal`, and `lines: [{type, speaker, emotion, text, start, end}]` with **original DB timestamps**. The detail panel must show those original timestamps (today it shows clip-relative time — change `LyricsPlayer`/`VideoClipPlayer` to display the DB `start`/`end`).

## Options considered (for the AI layer)

| Option | What | Verdict |
|--------|------|---------|
| **A. Additive judge (CHOSEN)** | Heuristic scores; AI judges the shortlist and its signed score is **added**; total ranks. | Owner's design. Bounded cost, explainable, graceful fallback, enforces the suspense rule. |
| B. AI re-rank only | AI reorders candidates but contributes no additive score. | Rejected — owner wants the AI's decision folded into the number, not a reshuffle. |
| C. Full-LLM selection | LLM picks clips end-to-end from raw transcript. | Rejected — expensive at 50-episode scale, no receipt, opaque, dies without the model. |

## Consequences

**Easier:** promo quality and *intent* improve; the suspense rule is actually enforced; the editor gets copy-paste-ready episode+timestamp+script output; the AI-Generalist story is concrete (bounded, additive, explainable LLM judgment).

**Harder:** a model dependency + key enter the final stage (bounded, fallback-guarded, non-deterministic — mitigated by low temperature and the additive blend); two scoring tiers to test; timestamp provenance must be preserved end-to-end.

**Revisit:** batching/caching the judge across 50 episodes; whether logline-level episode ranking should be its own AI pass; tuning the heuristic↔AI weight once real outputs are seen.

## Action items

1. [x] Tier 1: enrich `scorer.py` (duration sweet-spot, boundary discipline, emotion/speaker/action/SFX weighting, second-person/numbers, raw-score range); fixed substring→word-boundary, `endswith`, and unused-duration bugs.
2. [x] Tier 2: AI judge (`ai_judge.py`) over each episode's shortlist via Messages API (`ANTHROPIC_API_KEY`, stdlib HTTPS, no SDK); strict-JSON contract; `total = heuristic + ai_score`; `ai_score = 0` / `get_judge()=None` fallback when no key. Wired into script, upload, and YouTube paths.
3. [x] Suspense cut: `finalize_promo` trims the window to end before `reveal_line_index` when `withholds_reveal=false`, re-validating length and re-deriving timestamps/transcript.
4. [x] Tier 3: boundary penalties in scoring; cross-episode diversity (`_diversify`, ≤2/episode) in `rank_all`.
5. [x] Output: ORIGINAL db timestamps (`mm:ss.ss`) carried through window + per line; shown in `LyricsPlayer`/`VideoClipPlayer` (line tags + DB-window header); `ScoreReceipt` shows `HEURISTIC + AI = TOTAL` with the AI verdict/reason and a "cut before the reveal" tag.
6. [ ] (Video path only, future) ClipCut audio-energy + word timestamps for MP4 uploads — not yet built; the AI enrichment of speaker/emotion on the caption path is the higher-value next step.

## Status (2026-11-18)

Built and verified headlessly: all backend modules import clean; full 50-episode script run yields 20 promos across 16 distinct episodes (diversity cap holding), honest `heuristic + ai = total`, original DB timestamps in the window and every line, enriched receipt terms. AI judge structurally verified (prompt/parse/score-map/no-key fallback); a live API call awaits the owner's `ANTHROPIC_API_KEY`. Frontend builds clean; live-UI visual check was blocked only by the headless browser pane being hidden (pauses `requestAnimationFrame`, which drives the phase animation) — not an app fault.

**To enable the AI layer:** put keys in `backend/.env` (gitignored; template in `backend/.env.example`). Two providers, first configured wins:
- **Qwen via Groq (active):** `QWEN_BASE_URL` + `QWEN_API_KEY` + `QWEN_MODEL` (OpenAI-compatible `/chat/completions`).
- **Anthropic:** `ANTHROPIC_API_KEY` [+ `KUKU_JUDGE_MODEL`].

No key ⇒ pure heuristic, instantly. `ai_judge.py` is dependency-free (stdlib HTTPS), sends a browser-style User-Agent (Groq's Cloudflare 403s the default `Python-urllib` UA), and retries on 429 honoring `Retry-After`.

**Verified live (2026-11-18) against Qwen/Groq:** real judgments attach, `total = heuristic + ai` (e.g. EP38 123+21=144), and the **suspense cut fires** — EP1 flagged `spoils_reveal`, trimmed before the reveal.

**Speed — one batched call, not one-per-episode.** The AI judges the top candidates in a SINGLE request (`_build_batch_prompt`), compacted (dialogue/action lines only, truncated) to fit the free Groq tier's hard limit of **7000 input tokens/minute** (which refills at only ~117 tok/s, so a near-7k call can never accumulate headroom between retries). The prompt is budgeted to ~3300 tokens ≈ the **top ~8 clips**; on a fresh minute the whole 50-episode AI pass finishes in ~3s (vs. ~7 min for the old per-episode approach). Clips beyond the budget stay on their heuristic score. Raising the Groq tier (higher ITPM) lets `MAX_PROMPT_CHARS` go up to judge all 20+.
