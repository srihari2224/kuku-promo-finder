# Kuku Promo Finder

Finds the best **promo clips** inside a 50-episode microdrama screenplay, scores
them, and surfaces the strongest ones to a human editor — so nobody has to watch
all 50 episodes to decide what to cut.

**Live app:** https://frontend-orpin-alpha-31.vercel.app
**API:** https://backend-puce-gamma-97.vercel.app

---

## What it does

- Parses all 50 episode scripts (camera / action / dialogue / sound-fx lines with
  timestamps).
- **Tier 1 — heuristic scorer:** scores every 15–60s candidate window on hook
  strength, cliffhanger pull, emotional density, two-hander conflict, action beats,
  suspense cues, and ideal length. Every point is shown as a transparent receipt.
- **Tier 2 — AI judge (optional):** an LLM (Qwen via Groq, or Anthropic) re-scores
  the top clips and flags any that would spoil a twist. `total = heuristic + AI`.
- **Tier 3 — finalize:** cuts clips *before* the reveal (suspense preservation),
  enforces cross-episode diversity, and normalizes every score to **0–100**.
- Hands the editor each top clip with its **episode number, original database
  timestamps, and full clip script** — ready to cut.

## How to use it (step by step)

1. Open the live app (link above).
2. Click **Run pipeline on 50 episodes**. It parses, scores, and ranks (a few
   seconds).
3. The radial map fills in. The **top 5 episodes** are ringed in orange and
   numbered **#1–#5** — those hold the best clips.
4. **Click a top-5 circle** to zoom into that episode. A card appears beside the
   grid listing its clips with **timestamps** and **scores (0–100)**.
5. **Click a glowing cell** to open that promo. The panel on the right shows the
   clip's dialogue with original DB timestamps and the full score receipt
   (`heuristic + AI = total`).
6. Press **▶ Play** to watch the dialogue scroll through in sync.
7. Use the **Ranked promos** rail (right) to jump to any clip; collapse either
   sidebar with the `⟩⟩` buttons to see more of the map.

## Run locally

**Backend (script pipeline + optional AI):**
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# optional AI judge — copy the template and add your key:
cp .env.example .env    # then set QWEN_API_KEY (Groq) or ANTHROPIC_API_KEY
python3 dev_server.py 8787
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```
The frontend auto-targets `http://localhost:8787` when run on localhost, and the
deployed backend otherwise — no config edit needed.

## Deployment

Both apps deploy to **Vercel** (serverless — no Docker/containers).

```bash
cd backend  && vercel deploy --prod
cd frontend && vercel deploy --prod
```

### Environment variables

| Where | Variable | Needed? |
|-------|----------|---------|
| **Frontend** (Vercel) | — | **None.** The backend URL is baked into `src/config.js`. |
| **Backend** (Vercel) | `QWEN_API_KEY`, `QWEN_BASE_URL`, `QWEN_MODEL` | **Optional.** Only to enable the AI judge on the deployed site. Left unset, the site runs the heuristic scorer only (fast, no timeout). |

> The AI judge is recommended **locally**, not on Vercel: Groq's free-tier rate
> limit can make a call wait longer than Vercel's function timeout. The deployed
> site runs heuristic-only by design; the local backend runs the full AI pipeline.

Secrets live in `backend/.env`, which is gitignored and never deployed — set any
production keys in the Vercel dashboard (Project → Settings → Environment Variables).

## Project layout

```
backend/
  api/            Vercel serverless entrypoints (pipeline.py = script scorer)
  pipeline/       parser · scorer (Tier 1/3) · ai_judge (Tier 2) · cli
  data/episodes/  the 50 episode scripts
  dev_server.py   local server (script pipeline; AI judge reads .env)
frontend/
  src/            React + Vite · Canvas2D radial map · players · receipt
plans/            architecture decision records
```
