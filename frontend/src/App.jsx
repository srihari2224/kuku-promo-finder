import { useState, useRef, useCallback } from "react";
import { BACKEND_URL } from "./config.js";
import RadialCanvas from "./RadialCanvas.jsx";
import LyricsPlayer from "./LyricsPlayer.jsx";

const PHASES = ["idle", "parsing", "scoring", "ranking", "complete"];
const PHASE_LABELS = {
  idle: "Idle",
  parsing: "Parsing screenplays",
  scoring: "Scoring candidate windows",
  ranking: "Cross-episode ranking",
  complete: "Done",
};

export default function App() {
  const [mode, setMode] = useState("script"); // script | youtube | upload
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [phaseProgress, setPhaseProgress] = useState(0);
  const [selectedPromo, setSelectedPromo] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const [panelOpen, setPanelOpen] = useState(false);
  const animRef = useRef(null);

  const youtubeDisabled = mode === "youtube";
  const uploadDisabled = mode === "upload";

  const runAnimatedPhases = useCallback((resultData) => {
    const episodeCount = resultData.episode_count || 50;
    const promoCount = resultData.promo_count || resultData.promos.length;

    const sequence = [
      { phase: "parsing", duration: 1100 },
      { phase: "scoring", duration: 1400 },
      { phase: "ranking", duration: 900 },
    ];

    let seqIdx = 0;
    let phaseStart = performance.now();

    function step(now) {
      const cur = sequence[seqIdx];
      const t = Math.min(1, (now - phaseStart) / cur.duration);
      setPhase(cur.phase);
      setPhaseProgress(t);

      if (t >= 1) {
        seqIdx += 1;
        if (seqIdx >= sequence.length) {
          setPhase("complete");
          setPhaseProgress(1);
          setStatus("ready");
          return;
        }
        phaseStart = now;
      }
      animRef.current = requestAnimationFrame(step);
    }
    animRef.current = requestAnimationFrame(step);
  }, []);

  async function runPipeline() {
    setStatus("loading");
    setError(null);
    setData(null);
    setSelectedPromo(null);
    setPanelOpen(false);
    setPhase("idle");
    setPhaseProgress(0);

    try {
      const res = await fetch(`${BACKEND_URL}/api/pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ top_n: 20, cap_per_episode: 5 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Backend returned ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      runAnimatedPhases(json);
    } catch (e) {
      setError(e.message || "Something went wrong talking to the backend.");
      setStatus("error");
      setPhase("idle");
    }
  }

  function handleSelectPromo(promo) {
    setSelectedPromo(promo);
    setPanelOpen(!!promo);
  }

  const sortedPromos = data
    ? [...data.promos].sort((a, b) => (sortDir === "desc" ? b.score - a.score : a.score - b.score))
    : [];

  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">
          KUKU <span className="hot">PROMO FINDER</span>
        </div>
        <div className="nav-phase">
          <span className={`phase-dot ${status === "loading" ? "spin" : ""}`} />
          {PHASE_LABELS[phase]}
        </div>
      </nav>

      <div className="canvas-stage">
        <RadialCanvas
          data={data}
          phase={phase}
          animProgress={phaseProgress}
          onSelectPromo={handleSelectPromo}
          selectedPromo={selectedPromo}
        />

        <div className="hud-overlay">
          <div className="hud-left">
            <p className="hud-desc">
              Each ring is an episode. Dot strips are scored 20–60s promo candidates — glow intensity
              is score. Click a strip to open its window; click an episode to zoom. Bezier arcs link
              episodes whose top promo scores ≥60, suggesting cross-episode promo stitching.
            </p>
          </div>
          <div className="hud-right">
            {data && (
              <>
                <div className="stat"><span className="val">{data.episode_count}</span><span className="lbl">episodes</span></div>
                <div className="stat"><span className="val">{data.unit_count}</span><span className="lbl">units</span></div>
                <div className="stat"><span className="val">{data.promo_count}</span><span className="lbl">promos</span></div>
                <div className="stat"><span className="val">{sortedPromos[0]?.score ?? "—"}</span><span className="lbl">top score</span></div>
              </>
            )}
          </div>
        </div>

        <div className="control-dock">
          <div className="input-row">
            <button
              className={`input-card ${mode === "script" ? "active" : ""}`}
              onClick={() => setMode("script")}
            >
              <h3>Script folder</h3>
              <p>50 bundled episodes — parsed server-side.</p>
            </button>
            <button
              className={`input-card ${mode === "youtube" ? "active" : ""} ${youtubeDisabled ? "coming-soon" : ""}`}
              onClick={() => setMode("youtube")}
            >
              <h3>YouTube link</h3>
              <p>Transcribe + score a public video. Paste a URL below.</p>
            </button>
            <button
              className={`input-card ${mode === "upload" ? "active" : ""} ${uploadDisabled ? "coming-soon" : ""}`}
              onClick={() => setMode("upload")}
            >
              <h3>Upload MP4</h3>
              <p>Whisper-transcribe an uploaded clip, then score it.</p>
            </button>
          </div>

          {mode === "script" && (
            <button className="btn btn-primary btn-run" onClick={runPipeline} disabled={status === "loading"}>
              {status === "loading" ? "Running pipeline…" : "Run pipeline on 50 episodes"}
            </button>
          )}

          {mode === "youtube" && (
            <div className="mode-fallback">
              <input className="mode-input" placeholder="https://youtube.com/watch?v=..." disabled />
              <div className="mode-note">
                Needs yt-dlp + Whisper on the server, which Vercel's serverless runtime can't host reliably
                (no persistent ffmpeg binary, 10s cold-start budget). Built and tested locally in ClipCut;
                not wired into this deployment — see plans/01 for the design.
              </div>
            </div>
          )}

          {mode === "upload" && (
            <div className="mode-fallback">
              <input className="mode-input" type="file" accept="video/mp4" disabled />
              <div className="mode-note">
                Same constraint as YouTube: transcription needs a long-running worker, not a serverless
                function. Works in the local ClipCut pipeline; not wired into this deployment.
              </div>
            </div>
          )}

          {status === "error" && <div className="error-box">{error}</div>}
        </div>
      </div>

      {data && status === "ready" && (
        <div className="rail">
          <div className="rail-header">
            <span>Ranked promos</span>
            <button className="sort-toggle" onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}>
              {sortDir === "desc" ? "Highest ↓" : "Lowest ↑"}
            </button>
          </div>
          <div className="rail-list">
            {sortedPromos.map((p, idx) => (
              <div
                className={`rail-card ${selectedPromo === p ? "selected" : ""}`}
                key={`${p.episode}-${idx}`}
                onClick={() => handleSelectPromo(p)}
              >
                <div className="rail-top">
                  <span className="rail-ep">EP{p.episode}</span>
                  <span className="rail-score">{p.score}</span>
                </div>
                <div className="meter-track"><div className="meter-fill" style={{ width: `${p.score}%` }} /></div>
                <div className="rail-hook">{p.hook}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {panelOpen && selectedPromo && (
        <div className="detail-panel">
          <button className="detail-close" onClick={() => setPanelOpen(false)}>✕</button>
          <LyricsPlayer promo={selectedPromo} />
          <div className="detail-meta">
            <div className="promo-line"><span className="tag">Hook</span>{selectedPromo.hook}</div>
            <div className="promo-line"><span className="tag">Cliffhanger</span>{selectedPromo.cliffhanger}</div>
            <div className="promo-why">{selectedPromo.why}</div>
          </div>
        </div>
      )}
    </div>
  );
}
