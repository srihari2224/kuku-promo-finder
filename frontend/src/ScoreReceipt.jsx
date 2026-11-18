// The literal arithmetic behind a promo's score (plan 04 §2, extended by
// plan 05). Every heuristic term is a real rule that fired on a real line;
// the AI block is the additive judgment layer. The footer makes the final
// sum explicit: heuristic + AI = total.

export default function ScoreReceipt({ promo }) {
  const r = promo?.receipt;
  if (!r) return null;

  const rows = [
    { label: "BASE", points: r.base, kind: "base" },
    ...(r.hook_terms || []).map(([term, pts]) => ({ label: term, points: pts, kind: "hook" })),
    ...(r.window_terms || []).map(([term, pts]) => ({ label: term, points: pts, kind: "window" })),
    ...(r.cliff_terms || []).map(([term, pts]) => ({ label: term, points: pts, kind: "cliff" })),
    ...(r.duration_terms || []).map(([term, pts]) => ({ label: term, points: pts, kind: pts < 0 ? "penalty" : "window" })),
    ...(r.penalty_terms || []).map(([term, pts]) => ({ label: term, points: pts, kind: "penalty" })),
  ];

  const ai = promo.ai;
  const aiScore = promo.ai_score || 0;
  const heuristic = promo.heuristic_score ?? r.total;
  const rawTotal = promo.score_raw ?? (heuristic + aiScore);
  const score100 = promo.score ?? rawTotal;

  return (
    <div className="receipt">
      <div className="receipt-title">Score receipt</div>
      <div className="receipt-rows">
        {rows.map((row, i) => (
          <div className={`receipt-row receipt-${row.kind}`} key={i}>
            <span className="receipt-label">
              {row.kind !== "base" && (row.points < 0 ? "− " : "+ ")}
              {row.label}
            </span>
            <span className="receipt-points">{row.points > 0 && row.kind !== "base" ? "+" : ""}{row.points}</span>
          </div>
        ))}
        <div className="receipt-row receipt-subtotal">
          <span className="receipt-label">HEURISTIC</span>
          <span className="receipt-points">{heuristic}</span>
        </div>

        {ai && (
          <div className={`receipt-row receipt-ai ${aiScore < 0 ? "neg" : ""}`}>
            <span className="receipt-label">
              {aiScore < 0 ? "− " : "+ "}AI judge · {ai.verdict}
              {ai.promo_type ? ` (${ai.promo_type})` : ""}
            </span>
            <span className="receipt-points">{aiScore > 0 ? "+" : ""}{aiScore}</span>
          </div>
        )}

        <div className="receipt-row receipt-rawtotal">
          <span className="receipt-label">RAW TOTAL</span>
          <span className="receipt-points">{rawTotal}</span>
        </div>
        <div className="receipt-row receipt-total">
          <span className="receipt-label">SCORE</span>
          <span className="receipt-points">{score100} / 100</span>
        </div>
      </div>
      <div className="receipt-scorebar">
        <div className="receipt-scorebar-fill" style={{ width: `${score100}%` }} />
      </div>

      {ai?.reason && (
        <div className="receipt-ai-reason">
          <span className="ai-badge">AI</span> {ai.reason}
          {promo.suspense_cut && <span className="suspense-tag"> · cut before the reveal</span>}
        </div>
      )}

      <div className="receipt-lines">
        hook line {r.hook_line_index} &middot; cliff line {r.cliff_line_index}
      </div>
    </div>
  );
}
