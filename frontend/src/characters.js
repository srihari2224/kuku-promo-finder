// Deterministic character → color + glyph assignment.
// First-appearance order, not alphabetical — the protagonist usually
// enters first and lands on color index 0, keeping the "warm" lead
// character warm, same convention hexbrainai.com uses for its most-
// severe class getting the hot color.

const PALETTE = [
  "#ff6a3d", // hot (lead)
  "#5fb3ff", // steel blue
  "#8f6fff", // violet
  "#5fd4a0", // mint
  "#ff6ab0", // rose
  "#d4b85f", // amber
  "#5fdcdc", // teal
  "#c05fff", // orchid
  "#ffa05f", // peach
  "#7f7f7f", // grey (anonymous/narrator)
];

// Cached per episode, keyed by episode id so two episodes with
// different speaker-orders don't collide.
const _cache = new Map();

function normalize(name) {
  if (!name) return null;
  return String(name).trim().toUpperCase();
}

// Pick a short glyph that distinguishes this name from the ones already
// assigned. name[0] alone collides badly — "LADY JULIANA" and "LADY IN
// GOLD GOWN" both yield "L". So: try the first letter of the last word,
// then two-word initials, then first two letters, then fall back to a
// numbered tag so two characters never share a glyph.
function pickGlyph(name, taken) {
  const words = name.split(/\s+/).filter(Boolean);
  const candidates = [];
  if (words.length) {
    candidates.push(words[0][0]);                       // first initial
    candidates.push(words[words.length - 1][0]);        // last-word initial
    if (words.length >= 2) candidates.push(words[0][0] + words[words.length - 1][0]); // first+last
    candidates.push(name.slice(0, 2));                  // first two chars
    candidates.push(words[0].slice(0, 2));
  }
  for (const g of candidates) {
    if (g && !taken.has(g)) { taken.add(g); return g; }
  }
  // Last resort: first initial + a disambiguating count.
  let n = 2;
  const base = (words[0]?.[0]) || "·";
  while (taken.has(base + n)) n++;
  const g = base + n;
  taken.add(g);
  return g;
}

export function buildCharacterIndex(cells) {
  const order = [];
  const seen = new Set();
  for (const c of cells || []) {
    const n = normalize(c.speaker);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    order.push(n);
  }
  const index = {};
  const takenGlyphs = new Set();
  order.forEach((name, i) => {
    index[name] = {
      name,
      color: PALETTE[i % PALETTE.length],
      glyph: pickGlyph(name, takenGlyphs),
      order: i,
    };
  });
  return index;
}

export function characterIndexFor(episodeId, cells) {
  if (!_cache.has(episodeId)) _cache.set(episodeId, buildCharacterIndex(cells));
  return _cache.get(episodeId);
}

export function clearCharacterCache() { _cache.clear(); }

export function styleFor(index, speaker) {
  if (!speaker) return null;
  return index?.[normalize(speaker)] || null;
}
