"""Local-only dev server — mirrors the two Vercel Python functions
(api/pipeline.py, api/youtube.py) behind one process on one port, so the
app can be tested against a real backend without deploying. Not used in
production; Vercel's rewrites (vercel.json) handle routing there.

Usage: python3 dev_server.py [port]
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "pipeline"))
from cli import run as run_pipeline  # noqa: E402
from captions import cues_to_units, parse_vtt  # noqa: E402
from scorer import find_promos  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "api"))
from youtube import _fetch_captions  # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(__file__), "data", "episodes")


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _respond(self, result, status=200):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/health"):
            return self._respond({"status": "ok", "service": "local dev"})
        self._respond({"error": "Not found", "path": self.path}, 404)

    def do_POST(self):
        length = int(self.headers.get("content-length", 0) or 0)
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body or b"{}")
        except Exception:
            payload = {}

        if self.path.startswith("/api/pipeline"):
            try:
                result = run_pipeline(
                    DATA_DIR,
                    top_n=int(payload.get("top_n", 20)),
                    cap_per_episode=int(payload.get("cap_per_episode", 5)),
                )
                return self._respond(result)
            except Exception as ex:
                return self._respond({"error": str(ex)}, 500)

        if self.path.startswith("/api/youtube"):
            url = (payload.get("url") or "").strip()
            top_n = int(payload.get("top_n", 10))
            if not url:
                return self._respond({"error": "Missing 'url'."}, 400)
            try:
                vtt_text, info = _fetch_captions(url)
            except Exception as ex:
                return self._respond({"error": f"Couldn't fetch that video: {ex}"}, 500)
            if not vtt_text:
                return self._respond({"error": "No English captions found on that video."}, 422)
            cues = parse_vtt(vtt_text)
            units = cues_to_units(cues, source_id="youtube")
            promos = find_promos(units, "youtube", cap=top_n)
            return self._respond({
                "episode_count": 1, "unit_count": len(units),
                "promo_count": len(promos), "promos": promos,
                "source": "youtube", "title": (info or {}).get("title", url),
            })

        self._respond({"error": "Not found", "path": self.path}, 404)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    print(f"Local dev backend on http://localhost:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
