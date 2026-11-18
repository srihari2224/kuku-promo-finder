# Simplified Final Architecture — React + Express + Python, both on Vercel

Date: 2026-11-18 · Status: Approved, building now. Supersedes the hosting
split in plan 02 (Render/Railway) — not the pipeline/design logic, which
is unchanged.

## What changed from plan 02

- No MongoDB, no knowledge-model persistence, no auth, no `.env` files —
  dropped for simplicity, as instructed. Script-folder selection just reads
  from a local folder on the server for now.
- **One backend, one frontend.** Two deployments total: `frontend` (React)
  and `backend` (Express + the Python pipeline) — both on Vercel.
- Scope stays text-only (Problem 1's actual input: `.txt` screenplays). No
  ffmpeg/Whisper in this build, so the earlier Vercel-can't-run-ffmpeg
  objection doesn't apply here — there's nothing heavy to run.

## The one technical fact that shapes the backend

Vercel doesn't let a Node function `spawn()` an arbitrary Python
subprocess in production — but it **does** natively run Python files as
serverless functions, side-by-side with Node ones, in the same project,
same domain, same deploy. So "Node+Express AND the Python pipeline in one
backend" becomes:

```
backend/
  api/
    index.js        ← Express app, mounted as the Node serverless entry
    pipeline.py      ← the actual parser+scorer, as a native Vercel Python function
  pipeline/          ← shared Python package imported by pipeline.py
    parser.py
    scorer.py
  package.json
  vercel.json
```

Express (`api/index.js`) handles routing/validation and calls
`/api/pipeline` internally over HTTP for the actual scoring work. No
subprocess, no second service, no queue, no env vars. One Vercel project,
one URL, two runtimes under the hood — invisible to the frontend, which
just calls the one backend URL.

## Frontend

`frontend/`: plain React (Vite). Design tokens from
`02-platform-build-and-redesign.md` §3.1 as a single `tokens.css`. First
pass ships: input selector (script-folder only enabled; YouTube/MP4 shown
but disabled with a "coming soon" note — honest about what's built),
ranked promo list, pipeline-run status. The radial canvas visualization
(plan 02 §3.3) is the second pass once the plain list view works.

## Build order (now)

1. `pipeline/parser.py` + `pipeline/scorer.py` — pure Python, no deps
   beyond stdlib, testable standalone against the real episode files.
2. `backend/api/pipeline.py` — thin Vercel-function wrapper around it.
3. `backend/api/index.js` — Express app, one route (`POST /api/run`) that
   proxies to the Python function.
4. `frontend/` — React shell, calls the Express route, renders the table.
5. `vercel.json` for both, deploy, wire the backend URL into the frontend.
