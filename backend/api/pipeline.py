"""Vercel Python serverless function — the actual promo pipeline.

POST /api/pipeline  { "top_n": 20 }  -> ranked promos across all episodes
in backend/data/episodes/. This is the one Python runtime in the project;
Express (api/index.js) handles everything else in Node.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
from cli import run  # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "episodes")


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _handle(self, payload):
        top_n = int(payload.get("top_n", 20))
        cap = int(payload.get("cap_per_episode", 5))
        try:
            result = run(DATA_DIR, top_n=top_n, cap_per_episode=cap)
            status = 200
        except Exception as ex:
            result = {"error": str(ex)}
            status = 500
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
        self._handle(payload)

    def do_GET(self):
        self._handle({})
