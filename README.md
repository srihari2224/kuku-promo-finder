# Kuku Promo Finder

Finds 20–60s promo candidates (hook → cliffhanger) in microdrama screenplays.
Built for Kuku's AI Generalist take-home, Problem 1.

Design/architecture decisions are in [`plans/`](plans/) — read `01` → `02` →
`03` in order; `03` is the one that reflects what's actually built here.

## Structure

```
backend/     Express (Node) + the scoring pipeline (Python), one Vercel project
frontend/    React (Vite), the HexBrain-derived UI
plans/       design docs, in build order
```

## Run locally

Backend (two runtimes, same project — needs the Vercel CLI to emulate both
together):

```bash
cd backend
npm install
npx vercel dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Then edit `frontend/src/config.js` to point `BACKEND_URL` at wherever the
backend is running (defaults to `http://localhost:3000`, which is what
`vercel dev` uses).

## Deploy

```bash
cd backend && npx vercel --prod     # note the URL it gives you
cd ../frontend
# edit src/config.js: BACKEND_URL = "<that URL>"
npx vercel --prod
```

No environment variables, no database, no auth — intentionally, per the
assignment's scope (see `plans/03`).

## What's actually built vs. documented

- **Built:** the script-folder input path — parses the 50 bundled episode
  `.txt` files, scores every candidate window, ranks the top promos.
- **Documented, not built:** YouTube/MP4 input, MongoDB knowledge model,
  the Canvas2D radial visualization. See `plans/01` and `plans/02` for why
  and how, if those get built next.

## Raw outputs

`backend/pipeline/cli.py <folder> <top_n>` runs the pipeline standalone and
dumps JSON — this is what produces the raw-outputs folder for submission.
