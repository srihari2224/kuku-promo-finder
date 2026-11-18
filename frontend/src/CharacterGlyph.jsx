// SVG glyph for one character: a thin outlined circle with the
// character's initial centered. Used as:
//   - a small corner badge on a line cell (size ≈ 10-12px)
//   - a chip in the side panel's character legend (size ≈ 22px)
// Matches hexbrainai.com's severity-pip pattern — tiny, consistent,
// scannable, uses color for identity and ring-weight for state.

export default function CharacterGlyph({ style, size = 14, selected = false }) {
  if (!style) return null;
  const r = size / 2 - 1;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill={selected ? style.color : "transparent"}
        stroke={style.color}
        strokeWidth={selected ? 1 : 1.2}
      />
      <text
        x={size / 2}
        y={size / 2 + 0.5}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * (String(style.glyph).length > 1 ? 0.42 : 0.58)}
        fontWeight={700}
        fontFamily="'Recursive', system-ui"
        fill={selected ? "#13120e" : style.color}
      >
        {style.glyph}
      </text>
    </svg>
  );
}

export function CharacterChip({ style, selected = false }) {
  if (!style) return null;
  return (
    <span className={`char-chip ${selected ? "selected" : ""}`}>
      <CharacterGlyph style={style} size={20} selected={selected} />
      <span className="char-chip-name">{style.name}</span>
    </span>
  );
}
