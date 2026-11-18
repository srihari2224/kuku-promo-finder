import { useState, useRef, useEffect } from "react";

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

export default function LyricsPlayer({ promo }) {
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

  const activeIdx = transcript.findIndex(
    (u) => elapsed + segStart >= u.start && elapsed + segStart < u.end
  );

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
          const isPast = elapsed + segStart >= u.end;
          const isDialogue = u.type === "dialogue";
          return (
            <div
              key={i}
              ref={(el) => (lineRefs.current[i] = el)}
              className={`lyrics-line ${isActive ? "active" : ""} ${isPast ? "past" : ""} ${isDialogue ? "dialogue" : "stage"}`}
              onClick={() => setElapsed(Math.max(0, u.start - segStart))}
            >
              <span className="lyrics-time-tag">{fmtTime(u.start - segStart)}</span>
              {isDialogue && u.speaker && <span className="lyrics-speaker">{u.speaker}</span>}
              <span className="lyrics-text">{u.text}</span>
              {u.emotion && <span className="lyrics-emotion">({u.emotion})</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
