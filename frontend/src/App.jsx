import { useState, useRef, useCallback } from "react";
import { BACKEND_URL } from "./config.js";
import RadialCanvas from "./RadialCanvas.jsx";
import LyricsPlayer from "./LyricsPlayer.jsx";
import VideoClipPlayer from "./VideoClipPlayer.jsx";
import ScoreReceipt from "./ScoreReceipt.jsx";
import { CharacterChip } from "./CharacterGlyph.jsx";
import { characterIndexFor, styleFor } from "./characters.js";

const PHASE_LABELS = {
  idle: "Idle",
  parsing: "Parsing source",
  scoring: "Scoring candidate windows",
  ranking: "Cross-episode ranking",
  complete: "Done",
};

// The real stages an uploaded video goes through server-side — mirrors
// ClipCut's analyze flow so the user can watch the clipping happen.
const UPLOAD_STEPS = [
  { title: "Reading video", detail: "Receiving the uploaded MP4" },
  { title: "Extracting audio", detail: "Pulling the audio track for transcription" },
  { title: "Transcribing speech", detail: "faster-whisper (small model) → transcript" },
  { title: "Scoring promo windows", detail: "Hook / cliffhanger / emotion heuristic" },
  { title: "Ranking best clips", detail: "Picking and ordering the top promos" },
];

function uniqueSpeakers(promo) {
  if (!promo?.transcript) return [];
  const seen = new Set();
  promo.transcript.forEach((u) => { if (u.speaker) seen.add(u.speaker); });
  return [...seen];
}

function cellsForEpisode(data, episodeId) {
  if (!data?.episode_cells) return [];
  return (
    data.episode_cells[episodeId] ||
    data.episode_cells[String(parseInt(episodeId, 10))] ||
    []
  );
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
  const [railOpen, setRailOpen] = useState(true);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [tutorialOn, setTutorialOn] = useState(true);
  // Video-upload step flow (ClipCut-style). -1 = inactive; otherwise the
  // index of the stage currently in progress.
  const [uploadStage, setUploadStage] = useState(-1);
  const [viewLevel, setViewLevel] = useState({ level: "overview" });
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [mp4File, setMp4File] = useState(null);
  // Blob URL for the uploaded video, kept so the detail panel can play the
  // real footage of each ranked clip. Only set for MP4 uploads; null for
  // script/YouTube runs (which have no local video to show).
  const [sourceVideoUrl, setSourceVideoUrl] = useState(null);
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
    // Drop any previous video — script/YouTube runs have no footage, and a
    // new upload replaces the old blob. Revoke so we don't leak object URLs.
    setSourceVideoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
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

  async function runUpload() {
    if (!mp4File) {
      setError("Choose an MP4 file first.");
      setStatus("error");
      return;
    }
    resetRun();
    // Walk the ClipCut-style stages while the request is in flight. These are
    // the real server-side steps; we advance them on a timer and hold at the
    // last pre-final stage until the response actually arrives, so the flow
    // is representative without needing a streaming backend.
    setUploadStage(0);
    // Transcription (step index 2) is the real bottleneck — hold the flow
    // there, spinning, until the response lands, then fast-forward the quick
    // scoring/judging/ranking steps. Keeps the progress honest.
    const holdAt = 2;
    const stepTimer = setInterval(() => {
      setUploadStage((s) => (s < holdAt ? s + 1 : s));
    }, 800);
    try {
      const form = new FormData();
      form.append("file", mp4File);
      const res = await fetch(`${BACKEND_URL}/api/upload`, { method: "POST", body: form });
      if (res.status === 404) {
        throw new Error(
          "This backend doesn't have /api/upload — it's only wired up in the local dev " +
          "server (backend/dev_server.py), since real transcription needs faster-whisper " +
          "running somewhere with a persistent process, not a Vercel serverless function."
        );
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Backend returned ${res.status}`);
      if (!json.promo_count) {
        throw new Error(
          json.unit_count
            ? `Transcribed ${json.unit_count} lines, but none formed a 15–60s promo window with a strong hook and cliffhanger. Try a longer clip with a clear dramatic beat.`
            : "No speech could be transcribed from that video — it may be silent, music-only, or not in English."
        );
      }
      clearInterval(stepTimer);
      setUploadStage(UPLOAD_STEPS.length); // all steps done
      // Keep the actual footage around so the detail panel can play each
      // ranked clip. The file never left the browser — this is the same
      // bytes we uploaded, now addressable as a <video> source.
      setSourceVideoUrl(URL.createObjectURL(mp4File));
      // brief beat so the user sees the final "clips ready" tick, then reveal
      setTimeout(() => {
        setUploadStage(-1);
        setData(json);
        runAnimatedPhases(json);
      }, 700);
    } catch (e) {
      clearInterval(stepTimer);
      setUploadStage(-1);
      setError(e.message || "Couldn't transcribe that file.");
      setStatus("error");
      setPhase("idle");
    }
  }

  function handleSelectPromo(promo) {
    setSelectedPromo(promo);
    setPanelOpen(!!promo);
    if (promo) setDetailCollapsed(false);
  }

  function handleViewLevelChange(v) {
    setViewLevel(v);
    if (v.level === "sunflower" && v.promo) {
      setSelectedPromo(v.promo);
      setPanelOpen(true);
      setDetailCollapsed(false);
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

  const activeCells = selectedPromo ? cellsForEpisode(data, selectedPromo.episode) : [];
  const activeCharIndex = selectedPromo ? characterIndexFor(selectedPromo.episode, activeCells) : null;
  const activeSpeakers = uniqueSpeakers(selectedPromo);

  const railVisible = !!(data && status === "ready" && railOpen);
  const detailVisible = !!(panelOpen && selectedPromo && !detailCollapsed);

  // Guided walkthrough — the hint changes with how far the user has drilled
  // in, matching the exact flow: pick a top-5 circle → read the big score and
  // click the cell → open the promo → hit Play.
  const TUTORIAL_HINTS = {
    overview: { step: 1, text: "The top 5 episodes are ringed in orange and numbered #1–#5. Click one of those circles to zoom in." },
    episode: { step: 2, text: "The card beside the grid lists this episode's clips and scores. Click a glowing (pulsing) cell to open its promo." },
    sunflower: { step: 3, text: "The promo opened in the panel on the right. Press ▶ Play to watch the dialogue run through it." },
  };
  const tutorialHint = TUTORIAL_HINTS[viewLevel.level];

  return (
    <div
      className="shell"
      style={{ gridTemplateColumns: `1fr ${detailVisible ? 380 : 0}px ${railVisible ? 340 : 0}px` }}
    >
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

        {status === "ready" && tutorialOn && tutorialHint && (
          <div className="coachmark">
            <div className="coachmark-step">Step {tutorialHint.step} of 3</div>
            <div className="coachmark-text">{tutorialHint.text}</div>
            <button className="coachmark-close" onClick={() => setTutorialOn(false)} aria-label="Dismiss">✕</button>
          </div>
        )}
        {status === "ready" && !tutorialOn && (
          <button className="coachmark-reopen" onClick={() => setTutorialOn(true)} title="Show the guide">?</button>
        )}

        {uploadStage >= 0 && (
          <div className="upload-progress-backdrop">
            <div className="upload-progress">
              <div className="upload-progress-title">Cutting clips from your video</div>
              <div className="upload-steps">
                {UPLOAD_STEPS.map((step, i) => {
                  const state = i < uploadStage ? "done" : i === uploadStage ? "active" : "pending";
                  return (
                    <div className={`upload-step ${state}`} key={i}>
                      <span className="upload-step-dot">
                        {state === "done" ? "✓" : state === "active" ? <span className="spin-ring" /> : i + 1}
                      </span>
                      <span className="upload-step-body">
                        <span className="upload-step-title">{step.title}</span>
                        <span className="upload-step-detail">{step.detail}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              {mp4File && <div className="upload-progress-file">{mp4File.name}</div>}
            </div>
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
            <button className="input-card active">
              <h3>Script folder</h3>
              <p>50 bundled episodes — parsed server-side.</p>
            </button>
          </div>

          <button className="btn btn-primary btn-run" onClick={runPipeline} disabled={status === "loading"}>
            {status === "loading" ? "Scoring + AI judging…" : "Run pipeline on 50 episodes"}
          </button>
          <div className="mode-note">
            Heuristic scores every clip, then an AI judge (Qwen) re-scores the top ones —
            total = heuristic + AI — and cuts before the reveal. No key ⇒ heuristic-only.
          </div>

          {status === "error" && <div className="error-box">{error}</div>}
        </div>
      </div>

      {railVisible && (
        <div className="rail">
          <div className="rail-header">
            <span>Ranked promos</span>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button className="sort-toggle" onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}>
                {sortDir === "desc" ? "Highest ↓" : "Lowest ↑"}
              </button>
              <button className="sidebar-collapse-btn" onClick={() => setRailOpen(false)} title="Collapse ranked promos">
                ⟩⟩
              </button>
            </div>
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

      {!railVisible && data && status === "ready" && (
        <button className="sidebar-reopen-tab rail-reopen" onClick={() => setRailOpen(true)}>
          Promos ‹
        </button>
      )}
      {panelOpen && selectedPromo && detailCollapsed && (
        <button className="sidebar-reopen-tab detail-reopen" onClick={() => setDetailCollapsed(false)}>
          Clip ‹
        </button>
      )}

      {detailVisible && (
        <div className="detail-column">
          <div className="detail-column-header">
            <button className="sidebar-collapse-btn" onClick={() => setDetailCollapsed(true)} title="Collapse this panel">
              ⟩⟩
            </button>
          </div>
          {sourceVideoUrl ? (
            <VideoClipPlayer promo={selectedPromo} src={sourceVideoUrl} charIndex={activeCharIndex} />
          ) : (
            <LyricsPlayer promo={selectedPromo} charIndex={activeCharIndex} />
          )}

          <ScoreReceipt promo={selectedPromo} />

          {activeSpeakers.length > 0 && (
            <div className="character-row">
              <span className="tag">Characters</span>
              <div className="character-chips">
                {activeSpeakers.map((s) => (
                  <CharacterChip key={s} style={styleFor(activeCharIndex, s)} />
                ))}
              </div>
            </div>
          )}
          <div className="detail-meta">
            <div className="promo-why">{selectedPromo.why}</div>
          </div>
        </div>
      )}
    </div>
  );
}
