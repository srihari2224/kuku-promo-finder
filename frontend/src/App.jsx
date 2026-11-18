import { useMemo, useState } from "react";
import { BACKEND_URL } from "./config.js";

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

export default function App() {
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [sortDir, setSortDir] = useState("desc");

  async function runPipeline() {
    setStatus("loading");
    setError(null);
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
      setStatus("ready");
    } catch (e) {
      setError(e.message || "Something went wrong talking to the backend.");
      setStatus("error");
    }
  }

  const sortedPromos = useMemo(() => {
    if (!data) return [];
    const list = [...data.promos];
    list.sort((a, b) => (sortDir === "desc" ? b.score - a.score : a.score - b.score));
    return list;
  }, [data, sortDir]);

  return (
    <div>
      <nav className="nav">
        <div className="brand">
          KUKU <span className="hot">PROMO FINDER</span>
        </div>
      </nav>

      <div className="page">
        <h1 className="h1">Find the Promos</h1>
        <p className="body-text">
          Runs the rule-based scorer across every episode's screenplay and ranks the
          strongest 20–60s promo candidates — hook, cliffhanger, and why each one works.
        </p>

        <div className="input-row">
          <div className="input-card enabled">
            <h3>Script folder</h3>
            <p>50 episodes of "I Married a Broken Soldier" — bundled with this backend.</p>
          </div>
          <div className="input-card disabled">
            <h3>YouTube link</h3>
            <p>Not built in this submission — see plans/01 for the design.</p>
          </div>
          <div className="input-card disabled">
            <h3>Upload MP4</h3>
            <p>Not built in this submission — see plans/01 for the design.</p>
          </div>
        </div>

        <button className="btn btn-primary" onClick={runPipeline} disabled={status === "loading"}>
          {status === "loading" ? "Running pipeline…" : "Run pipeline"}
        </button>

        {status === "error" && <div className="error-box">{error}</div>}

        {data && (
          <>
            <div className="stat-row">
              <div className="stat-card">
                <div className="num">{data.episode_count}</div>
                <div className="label">Episodes</div>
              </div>
              <div className="stat-card">
                <div className="num">{data.unit_count}</div>
                <div className="label">Script units</div>
              </div>
              <div className="stat-card">
                <div className="num">{data.promo_count}</div>
                <div className="label">Promos found</div>
              </div>
              <div className="stat-card">
                <div className="num">{sortedPromos[0]?.score ?? "—"}</div>
                <div className="label">Top score</div>
              </div>
            </div>

            <div className="sort-row">
              <span className="body-text" style={{ margin: 0 }}>
                Ranked promos
              </span>
              <button
                className="sort-toggle"
                onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
              >
                Sort: {sortDir === "desc" ? "Highest first ↓" : "Lowest first ↑"}
              </button>
            </div>

            {sortedPromos.map((p, idx) => (
              <div className="promo-card" key={`${p.episode}-${idx}`}>
                <div className="promo-top">
                  <div>
                    <div className="promo-ep">Episode {p.episode}</div>
                  </div>
                  <div className="promo-score">{p.score}</div>
                </div>
                <div className="meter-track">
                  <div className="meter-fill" style={{ width: `${p.score}%` }} />
                </div>
                {p.segments.map((seg, i) => (
                  <div className="body-text" key={i} style={{ margin: 0 }}>
                    {fmtTime(seg.start)} → {fmtTime(seg.end)} · {p.duration}s
                  </div>
                ))}
                <div className="promo-line" style={{ marginTop: "12px" }}>
                  <span className="tag">Hook</span>
                  {p.hook}
                </div>
                <div className="promo-line">
                  <span className="tag">Cliffhanger</span>
                  {p.cliffhanger}
                </div>
                <div className="promo-why">{p.why}</div>
              </div>
            ))}
          </>
        )}

        {!data && status !== "loading" && status !== "error" && (
          <div className="empty-hint">Click "Run pipeline" to score all 50 episodes.</div>
        )}
      </div>
    </div>
  );
}
