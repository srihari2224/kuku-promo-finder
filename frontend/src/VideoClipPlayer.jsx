import { useState, useRef, useEffect, useCallback } from "react";
import CharacterGlyph from "./CharacterGlyph.jsx";
import { styleFor } from "./characters.js";

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

const TYPE_TAGS = {
  camera: { label: "CAM", className: "camera" },
  action: { label: "ACTION", className: "action" },
  dialogue: { label: "", className: "dialogue" },
  sound_fx: { label: "SFX", className: "sfx" },
};

// Real video clip player for MP4 uploads. Unlike LyricsPlayer (a transcript
// scrubber with a fake clock), this drives an actual <video> element and
// plays ONLY the ranked promo's [start, end] window of the source file —
// so you see the real footage of the clip the scorer picked, not just its
// words. The source file never leaves the browser: App hands us a blob URL
// made from the File the user chose, and we seek into it. No ffmpeg, no
// server-side cutting, no re-upload.
export default function VideoClipPlayer({ src, promo, charIndex }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const lineRefs = useRef([]);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);

  const transcript = promo?.transcript || [];
  // The clip window in absolute source-video time.
  const seg = promo?.segments?.[0] || {};
  const clipStart = seg.start ?? transcript[0]?.start ?? 0;
  const clipEnd = seg.end ?? transcript[transcript.length - 1]?.end ?? (clipStart + (promo?.duration || 0));
  const clipDur = Math.max(0.01, clipEnd - clipStart);

  // When the promo changes, seek the video to the start of its clip window.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setPlaying(false);
    const seek = () => { try { v.currentTime = clipStart; } catch { /* not ready yet */ } setCurrent(clipStart); };
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
  }, [promo, clipStart, src]);

  // Stop at the clip's end — this is what makes it a "clip" and not the
  // whole movie: the moment playback crosses clipEnd we pause and rewind
  // to the clip start, so the window loops cleanly instead of running on.
  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.currentTime >= clipEnd) {
      v.pause();
      v.currentTime = clipStart;
      setPlaying(false);
      setCurrent(clipStart);
      return;
    }
    setCurrent(v.currentTime);
  }, [clipStart, clipEnd]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < clipStart || v.currentTime >= clipEnd - 0.05) v.currentTime = clipStart;
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  function seekTo(absTime) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(clipStart, Math.min(clipEnd, absTime));
    setCurrent(v.currentTime);
  }

  // Last line that has started by the current playback time — monotonic,
  // never drops out in the gaps between overlapping line timestamps.
  let activeIdx = -1;
  for (let k = 0; k < transcript.length; k++) {
    if (transcript[k].start <= current) activeIdx = k;
    else break;
  }

  useEffect(() => {
    if (activeIdx >= 0 && lineRefs.current[activeIdx] && containerRef.current) {
      const el = lineRefs.current[activeIdx];
      const c = containerRef.current;
      c.scrollTo({ top: el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
    }
  }, [activeIdx]);

  if (!promo) return null;

  const progressPct = ((current - clipStart) / clipDur) * 100;

  return (
    <div className="clip-player">
      <div className="clip-header">
        <div>
          <div className="clip-ep">
            {promo.episode === "upload" || promo.episode === "youtube"
              ? "Uploaded video"
              : `Episode ${promo.episode}`} · Score {promo.score}
          </div>
          <div className="clip-title">{(promo.hook || "").slice(0, 70)}</div>
        </div>
      </div>

      <div className="clip-video-wrap">
        <video
          ref={videoRef}
          src={src}
          className="clip-video"
          playsInline
          preload="metadata"
          onTimeUpdate={onTimeUpdate}
          onClick={togglePlay}
        />
        <button className="clip-play-overlay" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "►"}
        </button>
      </div>

      <div className="clip-scrubber">
        <div
          className="clip-scrubber-track"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            seekTo(clipStart + pct * clipDur);
          }}
        >
          <div className="clip-scrubber-fill" style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }} />
        </div>
        <div className="clip-time">
          {fmtTime(current - clipStart)} / {fmtTime(clipDur)}
          <span className="clip-abs">({fmtTime(clipStart)}–{fmtTime(clipEnd)} in source)</span>
        </div>
      </div>

      <div className="lyrics-lines" ref={containerRef}>
        {transcript.length === 0 && (
          <div className="lyrics-empty">No transcript lines captured for this clip.</div>
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
              onClick={() => seekTo(u.start)}
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
