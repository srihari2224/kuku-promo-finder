// No .env files, per instruction — the backend is chosen by where the
// frontend is being served from:
//   - On localhost (dev), talk to the local dev_server.py on :8787, which
//     is the ONLY backend that has /api/upload (MP4 → faster-whisper) and a
//     working /api/youtube (yt-dlp isn't IP-blocked from a home machine).
//   - Anywhere else (the deployed Vercel site), talk to the Vercel backend,
//     which serves the bundled-script pipeline. MP4 upload and YouTube are
//     expected to be local-only there — Vercel's serverless functions can't
//     host a persistent Whisper process and YouTube blocks datacenter IPs.
// Override by setting window.__BACKEND_URL__ before the app loads if needed.
const PROD_BACKEND = "https://backend-puce-gamma-97.vercel.app";
const LOCAL_BACKEND = "http://localhost:8787";

function pickBackend() {
  if (typeof window !== "undefined" && window.__BACKEND_URL__) return window.__BACKEND_URL__;
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return LOCAL_BACKEND;
  }
  return PROD_BACKEND;
}

export const BACKEND_URL = pickBackend();
