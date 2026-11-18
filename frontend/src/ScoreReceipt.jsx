// The literal arithmetic behind a promo's score — plan 04 §2. Every term
// here is a real rule that fired on a real line, not a summary; this is
// the direct answer to "show the score calculation, how it's been
// enhanced" instead of a bare total.

export default function ScoreReceipt({ promo }) {
  const r = promo?.receipt;
  if (!r) return null;

  const rows = [
    { label: "BASE", points: r.base, kind: "base" },
    ...r.hook_terms.map(([term, pts]) => ({ label: term, points: pts, kind: "hook" })),
    ...r.cliff_terms.map(([term, pts]) => ({ label: term, points: pts, kind: "cliff" })),
  ];
  if (r.penalty > 0) {
    rows.push({ label: "weak pronoun start", points: -r.penalty, kind: "penalty" });
  }

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
        <div className="receipt-row receipt-total">
          <span className="receipt-label">TOTAL</span>
          <span className="receipt-points">{r.total}</span>
        </div>
      </div>
      <div className="receipt-lines">
        line {r.hook_line_index} = hook &middot; line {r.cliff_line_index} = cliff
      </div>
    </div>
  );
}
