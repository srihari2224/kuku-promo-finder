"""Vercel Python serverless function — scores a YouTube video's own
captions (auto or uploaded) the same way the script pipeline scores
screenplays. No audio download, no Whisper: yt-dlp fetches the caption
track directly, which is what keeps this feasible inside a serverless
function's time/size budget.

POST /api/youtube  { "url": "...", "top_n": 10 }
"""
import glob
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
from captions import cues_to_units, parse_vtt  # noqa: E402
from scorer import find_promos  # noqa: E402

import yt_dlp  # noqa: E402


def _fetch_captions(url):
    with tempfile.TemporaryDirectory() as tmp:
        opts = {
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": ["en", "en-US", "en-GB"],
            "subtitlesformat": "vtt",
            "outtmpl": os.path.join(tmp, "%(id)s.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)

        vtt_files = glob.glob(os.path.join(tmp, "*.vtt"))
        if not vtt_files:
            return None, info
        with open(vtt_files[0], encoding="utf-8") as f:
            text = f.read()
        return text, info


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _respond(self, result, status=200):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def do_POST(self):
        length = int(self.headers.get("content-length", 0) or 0)
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body or b"{}")
        except Exception:
            payload = {}

        url = (payload.get("url") or "").strip()
        top_n = int(payload.get("top_n", 10))
        if not url:
            return self._respond({"error": "Missing 'url'."}, 400)

        try:
            vtt_text, info = _fetch_captions(url)
        except Exception as ex:
            return self._respond({"error": f"Couldn't fetch that video: {ex}"}, 500)

        if not vtt_text:
            return self._respond({
                "error": "No English captions (auto or uploaded) found on that video — "
                         "this mode scores the existing caption track, it can't transcribe audio itself.",
            }, 422)

        cues = parse_vtt(vtt_text)
        units = cues_to_units(cues, source_id="youtube")
        promos = find_promos(units, "youtube", cap=top_n)

        self._respond({
            "episode_count": 1,
            "unit_count": len(units),
            "promo_count": len(promos),
            "promos": promos,
            "source": "youtube",
            "title": (info or {}).get("title", url),
        })
