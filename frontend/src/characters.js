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
  order.forEach((name, i) => {
    index[name] = {
      name,
      color: PALETTE[i % PALETTE.length],
      glyph: name[0] || "·",
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
