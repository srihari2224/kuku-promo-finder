import { useState, useRef, useEffect } from "react";
import CharacterGlyph from "./CharacterGlyph.jsx";
import { styleFor } from "./characters.js";

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

// Screenplay line types from the original parsed source (plan 04's feeding
// data set) — camera direction, action/stage direction, dialogue, sound fx.
// Each gets its own tag + color so the structure of the original script is
// still legible here, not flattened into a single "dialogue vs stage" look.
const TYPE_TAGS = {
  camera: { label: "CAM", className: "camera" },
  action: { label: "ACTION", className: "action" },
  dialogue: { label: "", className: "dialogue" },
  sound_fx: { label: "SFX", className: "sfx" },
};

export default function LyricsPlayer({ promo, charIndex }) {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const rafRef = useRef(null);
  const startRef = useRef(0);
  const lineRefs = useRef([]);
  const containerRef = useRef(null);

  const transcript = promo?.transcript || [];
  const segStart = transcript[0]?.start ?? 0;
  const totalDuration = promo?.duration ?? (transcript.length ? transcript[transcript.length - 1].end - segStart : 0);

  useEffect(() => {
    setPlaying(false);
    setElapsed(0);
  }, [promo]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    startRef.current = performance.now() - elapsed * 1000;
    function tick() {
      const now = (performance.now() - startRef.current) / 1000;
      if (now >= totalDuration) {
        setElapsed(totalDuration);
        setPlaying(false);
        return;
      }
      setElapsed(now);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Active = the last line that has STARTED by now (karaoke style). Using a
  // strict [start,end) window instead made the highlight vanish in every gap
  // between lines (these camera/dialogue timestamps overlap and leave gaps),
  // so it looked frozen. This advances line-by-line and never drops to -1.
  const now = elapsed + segStart;
  let activeIdx = -1;
  for (let k = 0; k < transcript.length; k++) {
    if (transcript[k].start <= now) activeIdx = k;
    else break;
  }

  useEffect(() => {
    if (activeIdx >= 0 && lineRefs.current[activeIdx] && containerRef.current) {
      const el = lineRefs.current[activeIdx];
      const container = containerRef.current;
      const elTop = el.offsetTop;
      container.scrollTo({ top: elTop - container.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
    }
  }, [activeIdx]);

  if (!promo) return null;

  const progressPct = totalDuration > 0 ? (elapsed / totalDuration) * 100 : 0;

  return (
    <div className="lyrics-player">
      <div className="lyrics-header">
        <div>
          <div className="lyrics-ep">Episode {promo.episode} · Score {promo.score}</div>
          <div className="lyrics-title">{promo.hook.slice(0, 70)}</div>
          {promo.segments?.[0]?.start_tc && (
            <div className="lyrics-dbwindow">
              DB timestamps: <strong>{promo.segments[0].start_tc} → {promo.segments[0].end_tc}</strong> in Episode {promo.episode}
            </div>
          )}
        </div>
        <button className="lyrics-play-btn" onClick={() => {
          if (elapsed >= totalDuration) setElapsed(0);
          setPlaying((p) => !p);
        }}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
      </div>

      <div className="lyrics-scrubber">
        <div className="lyrics-scrubber-track" onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          setElapsed(Math.max(0, Math.min(totalDuration, pct * totalDuration)));
        }}>
          <div className="lyrics-scrubber-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="lyrics-time">{fmtTime(elapsed)} / {fmtTime(totalDuration)}</div>
      </div>

      <div className="lyrics-lines" ref={containerRef}>
        {transcript.length === 0 && (
          <div className="lyrics-empty">No transcript lines captured for this window.</div>
        )}
        {transcript.map((u, i) => {
          const isActive = i === activeIdx;
          const isPast = i < activeIdx;
          const isDialogue = u.type === "dialogue";
          const typeInfo = TYPE_TAGS[u.type] || TYPE_TAGS.action;
          return (
            <div
              key={i}
              ref={(el) => (lineRefs.current[i] = el)}
              className={`lyrics-line ${isActive ? "active" : ""} ${isPast ? "past" : ""} ${isDialogue ? "dialogue" : "stage"} line-${typeInfo.className}`}
              onClick={() => setElapsed(Math.max(0, u.start - segStart))}
            >
              <span className="lyrics-time-tag" title="Original database timestamp">{u.start_tc || fmtTime(u.start)}</span>
              {typeInfo.label && <span className={`lyrics-type-tag type-${typeInfo.className}`}>{typeInfo.label}</span>}
              {isDialogue && u.speaker && (
                <span className="lyrics-speaker">
                  <CharacterGlyph style={styleFor(charIndex, u.speaker)} size={14} />
                  {u.speaker}
                </span>
              )}
              <span className="lyrics-text">{u.text}</span>
              {u.emotion && <span className="lyrics-emotion">({u.emotion})</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
