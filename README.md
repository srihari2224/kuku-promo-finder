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

Backend — `backend/dev_server.py` runs all three endpoints (`/api/pipeline`,
`/api/youtube`, `/api/upload`) behind one plain Python process, which is
both simpler and more reliable than `vercel dev`'s mixed Node/Python
emulation for local testing:

```bash
cd backend
pip install -r requirements.txt
pip install faster-whisper av    # only needed for /api/upload (MP4 mode)
python3 dev_server.py 8787
```

`faster-whisper`/`av` aren't in `requirements.txt` because that file is also
what Vercel's `/api/youtube` function bundles — adding Whisper's weights to
a serverless function's bundle is the opposite of what we want there.

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Then edit `frontend/src/config.js` to point `BACKEND_URL` at
`http://localhost:8787` (or wherever the backend is running) — **and set it
back to the production URL before deploying**, since this file is what both
`vercel --prod` runs ship with no further editing.

YouTube mode only works against a backend running from a normal residential
connection — YouTube blocks caption requests from datacenter IPs (Vercel
included) with a bot check, which is a deliberate reason to test it via
`dev_server.py` locally rather than against the deployed backend.

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
  `.txt` files, scores every candidate window, ranks the top promos. A
  Canvas2D radial map (episodes as rings, scored windows as dot strips,
  cross-episode links weighted by combined score) with an animated
  parse → score → rank pipeline reveal, SVG-rendered labels with collision
  avoidance, and a ranked-promo rail that drives the map the same way
  clicking the canvas would. A karaoke-style lyrics player that scrubs/
  scrolls the promo's transcript line by line, with a characters chip row.
  YouTube input — scores the video's own caption track via yt-dlp, no
  audio download or transcription model, which is what keeps it inside a
  serverless function's budget (works from a normal connection; blocked
  from Vercel's IPs by YouTube's bot check — see "Run locally" above). MP4
  upload — real transcription via faster-whisper, capped at 20 minutes of
  video to stay within a non-GPU machine's memory; only runs against
  `dev_server.py` locally, since a persistent model process is exactly
  what a Vercel serverless function can't host.
- **Documented, not built:** the MongoDB knowledge model — see `plans/02`
  for why and how, if that gets built next.

## Raw outputs

`backend/pipeline/cli.py <folder> <top_n>` runs the pipeline standalone and
dumps JSON — this is what produces the raw-outputs folder for submission.
