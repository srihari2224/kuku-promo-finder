import { useState, useRef, useCallback } from "react";
import { BACKEND_URL } from "./config.js";
import RadialCanvas from "./RadialCanvas.jsx";
import LyricsPlayer from "./LyricsPlayer.jsx";

const PHASE_LABELS = {
  idle: "Idle",
  parsing: "Parsing source",
  scoring: "Scoring candidate windows",
  ranking: "Cross-episode ranking",
  complete: "Done",
};

function uniqueSpeakers(promo) {
  if (!promo?.transcript) return [];
  const seen = new Set();
  promo.transcript.forEach((u) => { if (u.speaker) seen.add(u.speaker); });
  return [...seen];
}

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
  const [viewLevel, setViewLevel] = useState({ level: "overview" });
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [mp4File, setMp4File] = useState(null);
  const animRef = useRef(null);
  const canvasRef = useRef(null);

  const runAnimatedPhases = useCallback((resultData) => {
    const sequence = [
      { phase: "parsing", duration: 1000 },
      { phase: "scoring", duration: 1300 },
      { phase: "ranking", duration: 800 },
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

  function resetRun() {
    setStatus("loading");
    setError(null);
    setData(null);
    setSelectedPromo(null);
    setPanelOpen(false);
    setPhase("idle");
    setPhaseProgress(0);
    setViewLevel({ level: "overview" });
  }

  async function runPipeline() {
    resetRun();
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

  async function runYoutube() {
    if (!youtubeUrl.trim()) {
      setError("Paste a YouTube URL first.");
      setStatus("error");
      return;
    }
    resetRun();
    try {
      const res = await fetch(`${BACKEND_URL}/api/youtube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl.trim(), top_n: 10 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Backend returned ${res.status}`);
      setData(json);
      runAnimatedPhases(json);
    } catch (e) {
      setError(e.message || "Couldn't score that video.");
      setStatus("error");
      setPhase("idle");
    }
  }

  function handleSelectPromo(promo) {
    setSelectedPromo(promo);
    setPanelOpen(!!promo);
  }

  function handleViewLevelChange(v) {
    setViewLevel(v);
    if (v.level === "sunflower" && v.promo) {
      setSelectedPromo(v.promo);
      setPanelOpen(true);
    } else if (v.level !== "sunflower") {
      setPanelOpen(false);
    }
  }

  function goBack() {
    canvasRef.current?.goOverview();
  }

  const sortedPromos = data
    ? [...data.promos].sort((a, b) => (sortDir === "desc" ? b.score - a.score : a.score - b.score))
    : [];

  const breadcrumb = ["Episodes"];
  if (viewLevel.level === "episode") breadcrumb.push(`EP${viewLevel.episode}`);
  if (viewLevel.level === "sunflower") breadcrumb.push(`EP${viewLevel.episode}`, "Promo window");
  const showBack = viewLevel.level !== "overview";

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
          ref={canvasRef}
          data={data}
          phase={phase}
          animProgress={phaseProgress}
          onSelectPromo={handleSelectPromo}
          onViewLevelChange={handleViewLevelChange}
        />

        {status === "ready" && (
          <div className="breadcrumb-bar">
            <div className="breadcrumb">
              {breadcrumb.map((b, i) => (
                <span key={i}>
                  {i > 0 && <span className="crumb-sep">/</span>}
                  <span className={i === breadcrumb.length - 1 ? "crumb-current" : ""}>{b}</span>
                </span>
              ))}
            </div>
            {showBack && (
              <button className="back-btn" onClick={goBack}>← Back <kbd>Esc</kbd></button>
            )}
          </div>
        )}

        <div className="hud-overlay">
          <div className="hud-left">
            <p className="hud-desc">
              Each ring is an episode. Dot strips are scored 20–60s promo candidates — glow and
              the number beside each strip are its score. Click a strip to open its window; click
              an episode to zoom in. Bezier arcs link episodes whose top promo scores ≥60.
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
              className={`input-card ${mode === "youtube" ? "active" : ""}`}
              onClick={() => setMode("youtube")}
            >
              <h3>YouTube link</h3>
              <p>Scores the video's own captions — no audio download needed.</p>
            </button>
            <button
              className={`input-card ${mode === "upload" ? "active" : ""}`}
              onClick={() => setMode("upload")}
            >
              <h3>Upload MP4</h3>
              <p>Needs a transcription step — see note below.</p>
            </button>
          </div>

          {mode === "script" && (
            <button className="btn btn-primary btn-run" onClick={runPipeline} disabled={status === "loading"}>
              {status === "loading" ? "Running pipeline…" : "Run pipeline on 50 episodes"}
            </button>
          )}

          {mode === "youtube" && (
            <div className="mode-fallback">
              <div className="mode-row">
                <input
                  className="mode-input"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  disabled={status === "loading"}
                />
                <button className="btn btn-primary" onClick={runYoutube} disabled={status === "loading"}>
                  {status === "loading" ? "Scoring…" : "Score video"}
                </button>
              </div>
              <div className="mode-note">
                Fetches the video's own caption track (auto or uploaded) via yt-dlp and runs the
                same promo scorer against it — no Whisper, no video download, so it fits inside a
                serverless function. Needs the video to actually have English captions.
              </div>
            </div>
          )}

          {mode === "upload" && (
            <div className="mode-fallback">
              <input
                className="mode-input"
                type="file"
                accept="video/mp4"
                onChange={(e) => setMp4File(e.target.files?.[0] || null)}
              />
              <div className="mode-note">
                {mp4File ? `Selected: ${mp4File.name}. ` : ""}
                Not wired up yet — turning this file into text needs real transcription (Whisper or
                similar), and that needs a long-running worker, not a Vercel serverless function.
                Ask to have this built once you've picked how: a paid transcription API with a key,
                or an in-browser model that's free but slower.
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
                onClick={() => canvasRef.current?.focusPromo(p)}
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
          <button className="detail-close" onClick={() => { setPanelOpen(false); goBack(); }}>✕</button>
          <LyricsPlayer promo={selectedPromo} />
          {uniqueSpeakers(selectedPromo).length > 0 && (
            <div className="character-row">
              <span className="tag">Characters</span>
              <div className="character-chips">
                {uniqueSpeakers(selectedPromo).map((s) => (
                  <span className="character-chip" key={s}>{s}</span>
                ))}
              </div>
            </div>
          )}
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
