import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { characterIndexFor, styleFor } from "./characters.js";

const BG = "#13120e", INK = "#efe6d0", DIM = "#8f8874", HOT = "#ff6a3d", RED = "#ff3b30";
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TWO_PI = Math.PI * 2;

const R_CLASS = 460;
const R_STRIP_START = 560;
const NODE_R_BASE = 16;
const DOT_SIZE = 3;
const DOT_GAP = 2.5;
const DOT_PITCH = DOT_SIZE + DOT_GAP;
const STRIP_GAP_RADIAL = 18;
const MAX_COLS = 5;

let _seed = 42;
function srand(s) { _seed = s; }
function rand() {
  _seed = (_seed * 16807 + 0) % 2147483647;
  return (_seed & 0x7fffffff) / 0x7fffffff;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function buildLayout(data) {
  if (!data || !data.promos || data.promos.length === 0) return null;

  srand(7);
  const promosByEp = {};
  data.promos.forEach((p) => {
    const eid = p.episode;
    if (!promosByEp[eid]) promosByEp[eid] = [];
    promosByEp[eid].push(p);
  });

  const cellsByEp = data.episode_cells || {};
  const episodeIdsFromCells = Object.keys(cellsByEp);
  const episodeIdsFromPromos = Object.keys(promosByEp);
  const episodeIds = [...new Set([...episodeIdsFromCells, ...episodeIdsFromPromos])].sort((a, b) => {
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
  });

  const allNumeric = episodeIds.every((id) => !isNaN(parseInt(id, 10)));
  let allEpisodeIds;
  if (allNumeric && (data.episode_count || 0) > episodeIds.length) {
    allEpisodeIds = [];
    for (let i = 1; i <= data.episode_count; i++) allEpisodeIds.push(String(i).padStart(2, "0"));
    episodeIds.forEach((id) => { if (!allEpisodeIds.includes(id)) allEpisodeIds.push(id); });
  } else {
    allEpisodeIds = episodeIds.length ? episodeIds : [];
  }

  const N = allEpisodeIds.length;
  const angleStep = TWO_PI / N;

  const episodes = [];
  const connections = [];

  allEpisodeIds.forEach((eid, ci) => {
    const angle = ci * angleStep - Math.PI / 2;
    const promos = promosByEp[eid] || [];
    const rawCells = cellsByEp[eid] || cellsByEp[String(parseInt(eid, 10))] || [];
    const totalScore = promos.reduce((s, p) => s + p.score, 0);
    const nodeR = NODE_R_BASE + Math.min(promos.length * 2, 10);

    // One grid of N cells per episode (plan 04 §1). Lays out as a
    // near-square dot grid in the episode's angular sector, sized so it
    // doesn't collide with the neighboring episode's grid tangentially.
    const lineCount = rawCells.length;
    const sectorArc = angleStep * R_STRIP_START;        // tangential px at strip radius
    const maxColsBySpace = Math.max(3, Math.floor((sectorArc - 8) / DOT_PITCH));
    const idealCols = Math.ceil(Math.sqrt(lineCount));
    const cols = Math.max(3, Math.min(idealCols, maxColsBySpace));
    const rows = Math.max(1, Math.ceil(lineCount / cols));
    const stripW = cols * DOT_PITCH;
    const stripH = rows * DOT_PITCH;

    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const tanX = -sinA, tanY = cosA;
    const ox = R_STRIP_START * cosA - (stripW / 2) * tanX;
    const oy = R_STRIP_START * sinA - (stripW / 2) * tanY;

    const cells = rawCells.map((cell, ri) => {
      const col = ri % cols;
      const row = Math.floor(ri / cols);
      return {
        ...cell,
        col, row,
        wx: ox + col * DOT_PITCH * tanX + row * DOT_PITCH * cosA,
        wy: oy + col * DOT_PITCH * tanY + row * DOT_PITCH * sinA,
      };
    });

    // Attach the containing promo to each cell so clicking jumps to it.
    promos.forEach((promo) => {
      const [i, j] = promo.line_range || [-1, -1];
      for (let k = i; k <= j; k++) {
        if (cells[k]) cells[k].promo = promo;
      }
    });

    const ep = {
      id: eid, index: ci, angle,
      x: R_CLASS * Math.cos(angle), y: R_CLASS * Math.sin(angle),
      radius: nodeR, promoCount: promos.length, totalScore, promos,
      maxScore: Math.max(0, ...promos.map((p) => p.score)),
      angle_cos: cosA, angle_sin: sinA, tanX, tanY,
      stripW, stripH, cols, rows, ox, oy, cells,
      centroidX: ox + (stripW / 2) * tanX + (stripH / 2) * cosA,
      centroidY: oy + (stripW / 2) * tanY + (stripH / 2) * sinA,
      charIndex: characterIndexFor(eid, cells),
    };
    episodes.push(ep);
  });

  // Cross-episode links, weighted by combined score rather than an
  // all-or-nothing threshold — this is what gives hexbrainai.com's map its
  // dense "hairball" interior instead of a handful of isolated arcs.
  srand(99);
  const activeEps = episodes.filter((e) => e.promoCount > 0);
  for (let i = 0; i < activeEps.length; i++) {
    for (let j = i + 1; j < activeEps.length; j++) {
      const src = activeEps[i], dst = activeEps[j];
      const combined = (src.maxScore + dst.maxScore) / 200;
      const prob = combined * combined * 0.65;
      if (rand() < prob) {
        const mx = (src.x + dst.x) * 0.15;
        const my = (src.y + dst.y) * 0.15;
        const perp = Math.atan2(dst.y - src.y, dst.x - src.x) + Math.PI / 2;
        const offset = (rand() - 0.5) * 160;
        connections.push({
          srcIdx: src.index, dstIdx: dst.index, brightness: combined,
          cp1: { x: mx + offset * Math.cos(perp), y: my + offset * Math.sin(perp) },
          cp2: { x: mx - offset * 0.4 * Math.cos(perp), y: my - offset * 0.4 * Math.sin(perp) },
          particles: combined > 0.6 ? Array.from({ length: 1 + Math.floor(rand() * 2) }, () => ({
            t: rand(), speed: 0.0006 + rand() * 0.0012,
          })) : [],
        });
      }
    }
  }

  // Top 5 episodes — the distinct episodes that own the best clips, in
  // ranked order. Their circles get the persistent highlight (no per-clip
  // gold marker anymore), so the editor sees at a glance which handful of
  // episodes to pull from.
  const top5 = [];
  for (const p of data.promos) {
    const en = parseInt(p.episode, 10);
    if (!top5.includes(en)) top5.push(en);
    if (top5.length >= 5) break;
  }
  episodes.forEach((ep) => {
    ep.top5Rank = top5.indexOf(parseInt(ep.id, 10)); // 0..4, or -1
  });

  return { episodes, connections, top5 };
}

function buildIdleLayout(episodeCount) {
  const N = episodeCount || 50;
  const angleStep = TWO_PI / N;
  const episodes = [];
  for (let i = 0; i < N; i++) {
    const angle = i * angleStep - Math.PI / 2;
    episodes.push({
      id: String(i + 1).padStart(2, "0"), index: i, angle,
      x: R_CLASS * Math.cos(angle), y: R_CLASS * Math.sin(angle),
      radius: NODE_R_BASE, promoCount: 0, totalScore: 0, promos: [], maxScore: 0,
      cells: [], cols: 0, rows: 0, stripW: 0, stripH: 0,
    });
  }
  return { episodes, connections: [] };
}

// Helper — iterate every episode's cells. Used in several places that
// used to iterate promoDots, now iterating cells across all episodes.
function allCells(layout) {
  const out = [];
  if (!layout) return out;
  for (const ep of layout.episodes) {
    for (const c of ep.cells || []) out.push({ ep, cell: c });
  }
  return out;
}

const RadialCanvas = forwardRef(function RadialCanvas(
  { data, phase, onSelectPromo, onViewLevelChange, animProgress },
  ref
) {
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const cardRef = useRef(null);
  const stateRef = useRef({
    camera: { x: 0, y: 0, zoom: 0.5, targetX: 0, targetY: 0, targetZoom: 0.5 },
    layout: null, hovered: { ep: -1, cellEp: -1, cellIdx: -1 },
    isDragging: false, dragMoved: false, dragStart: { x: 0, y: 0 },
    mouseScreen: { x: 0, y: 0 }, mouseWorld: { x: 0, y: 0 },
    isZoomedIn: false, sunflower: null, sunflowerDots: [],
    W: 0, H: 0, dpr: 1, animId: 0,
    phase: "idle", animProgress: 0,
    viewLevel: "overview",
  });
  const callbackRef = useRef({ onSelectPromo, onViewLevelChange });
  const actionsRef = useRef({});

  useEffect(() => {
    callbackRef.current.onSelectPromo = onSelectPromo;
    callbackRef.current.onViewLevelChange = onViewLevelChange;
  }, [onSelectPromo, onViewLevelChange]);

  useImperativeHandle(ref, () => ({
    goOverview() {
      actionsRef.current.goOverview?.();
    },
    // Lets the ranked-promo list drive the map the way hexbrainai.com's
    // weakness list drives its canvas — clicking a rail card should move
    // the camera and open the same sunflower view a canvas click would.
    focusPromo(promo) {
      const st = stateRef.current;
      if (!st.layout || !promo) return;
      for (const ep of st.layout.episodes) {
        if ((ep.promos || []).includes(promo)) {
          actionsRef.current.enterPromo?.(ep, promo);
          return;
        }
      }
    },
  }));

  useEffect(() => {
    const st = stateRef.current;
    st.phase = phase;
    st.animProgress = animProgress || 0;
    st.layout = data ? buildLayout(data) : buildIdleLayout(50);
    if (phase === "idle" || !data) {
      st.camera.targetZoom = 0.5;
      st.camera.targetX = 0;
      st.camera.targetY = 0;
    }
  }, [data, phase, animProgress]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const st = stateRef.current;

    function resize() {
      st.dpr = window.devicePixelRatio || 1;
      st.W = canvas.parentElement.clientWidth;
      st.H = canvas.parentElement.clientHeight;
      canvas.width = st.W * st.dpr;
      canvas.height = st.H * st.dpr;
      canvas.style.width = st.W + "px";
      canvas.style.height = st.H + "px";
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      if (svgRef.current) svgRef.current.setAttribute("viewBox", `0 0 ${st.W} ${st.H}`);
    }

    function w2s(wx, wy) {
      return { x: (wx - st.camera.x) * st.camera.zoom + st.W / 2, y: (wy - st.camera.y) * st.camera.zoom + st.H / 2 };
    }
    function s2w(sx, sy) {
      return { x: (sx - st.W / 2) / st.camera.zoom + st.camera.x, y: (sy - st.H / 2) / st.camera.zoom + st.camera.y };
    }

    // Text goes through an SVG overlay instead of canvas fillText — real
    // DOM text antialiases far more crisply than canvas text at the sizes
    // and zoom levels this map runs at (this is what hexbrainai.com does
    // too: canvas for the graphics layer, SVG <text> for every label).
    // Labels queue up during the draw pass, then run through a greedy
    // collision filter so overlapping labels drop instead of smearing —
    // that's the fix for score badges and episode names piling up.
    let labelQueue = [];
    function queueLabel(l) { labelQueue.push(l); }

    function estimateWidth(text, fontSize, weight) {
      ctx.font = `${weight || 400} ${fontSize}px 'Recursive',system-ui`;
      return ctx.measureText(String(text)).width;
    }

    function flushLabels() {
      const svg = svgRef.current;
      if (!svg) { labelQueue = []; return; }

      const sorted = [...labelQueue].sort((a, b) => b.priority - a.priority);
      const boxes = [];
      const accepted = [];
      for (const l of sorted) {
        const w = estimateWidth(l.text, l.fontSize, l.weight) + 4;
        const h = l.fontSize * 1.35;
        let x0, x1;
        if (l.align === "center") { x0 = l.x - w / 2; x1 = l.x + w / 2; }
        else if (l.align === "right") { x0 = l.x - w; x1 = l.x; }
        else { x0 = l.x; x1 = l.x + w; }
        const y0 = l.y - h / 2, y1 = l.y + h / 2;
        if (!l.skipCollision) {
          const hit = boxes.some((b) => !(x1 < b.x0 || x0 > b.x1 || y1 < b.y0 || y0 > b.y1));
          if (hit) continue;
        }
        boxes.push({ x0, x1, y0, y1 });
        accepted.push(l);
      }

      svg.innerHTML = accepted.map((l) => (
        `<text x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" font-size="${l.fontSize}" ` +
        `font-weight="${l.weight || 400}" text-anchor="${l.align || "left"}" ` +
        `dominant-baseline="central" fill="${l.color}" opacity="${l.opacity ?? 1}" ` +
        `font-family="Recursive,system-ui">${l.text}</text>`
      )).join("");
      labelQueue = [];
    }

    function drawRadialGuides() {
      const c = w2s(0, 0);
      ctx.save();
      [200, R_CLASS, R_STRIP_START, 850, 1150].forEach((r) => {
        const sr = r * st.camera.zoom;
        if (sr < 4) return;
        ctx.beginPath();
        ctx.arc(c.x, c.y, sr, 0, TWO_PI);
        ctx.strokeStyle = r === R_CLASS ? "rgba(50,47,37,0.35)" : "rgba(50,47,37,0.12)";
        ctx.lineWidth = r === R_CLASS ? 1 : 0.5;
        ctx.stroke();
      });
      ctx.restore();
    }

    function bezPt(t, p0, p1, p2, p3) {
      const u = 1 - t;
      return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
    }

    function drawConnectors() {
      if (!st.layout || !st.layout.connections.length) return;
      const revealFrac = st.phase === "ranking" ? st.animProgress : st.phase === "complete" ? 1 : 0;
      if (revealFrac <= 0) return;

      ctx.save();
      ctx.globalAlpha = revealFrac;
      st.layout.connections.forEach((conn) => {
        const src = st.layout.episodes[conn.srcIdx];
        const dst = st.layout.episodes[conn.dstIdx];
        if (!src || !dst) return;
        const isHot = st.hovered.ep === conn.srcIdx || st.hovered.ep === conn.dstIdx;
        const ambient = 0.03 + conn.brightness * 0.14;
        const alpha = st.hovered.ep >= 0 ? (isHot ? 0.5 : ambient * 0.3) : ambient;

        const s1 = w2s(src.x, src.y), s2 = w2s(dst.x, dst.y);
        const sc1 = w2s(conn.cp1.x, conn.cp1.y), sc2 = w2s(conn.cp2.x, conn.cp2.y);

        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.bezierCurveTo(sc1.x, sc1.y, sc2.x, sc2.y, s2.x, s2.y);
        ctx.strokeStyle = isHot ? `rgba(255,106,61,${alpha})` : `rgba(239,230,208,${alpha})`;
        ctx.lineWidth = isHot ? 1.5 : 0.6;
        ctx.stroke();

        if (alpha > 0.05) {
          [s1, s2].forEach((pt) => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, isHot ? 3 : 1.5, 0, TWO_PI);
            ctx.fillStyle = isHot ? HOT : `rgba(255,106,61,${alpha * 4})`;
            ctx.fill();
          });
        }

        conn.particles.forEach((p) => {
          p.t += p.speed * (isHot ? 3 : 1);
          if (p.t > 1) p.t -= 1;
          const pt = bezPt(p.t, s1, sc1, sc2, s2);
          ctx.save();
          ctx.shadowBlur = isHot ? 12 : 6;
          ctx.shadowColor = HOT;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, isHot ? 2.5 : 1.5, 0, TWO_PI);
          ctx.fillStyle = HOT;
          ctx.fill();
          ctx.restore();
        });
      });
      ctx.restore();
    }

    // Fan lines go from each episode node to its best-scoring promo's
    // hook-line centroid — one per episode, scored. Dense but structured,
    // the hexbrain pattern of "every strip's own column traces to the parent"
    // but simplified to one line per episode so overview stays legible.
    function drawFanLines() {
      if (!st.layout) return;
      const revealFrac = st.phase === "scoring" ? st.animProgress
        : st.phase === "ranking" || st.phase === "complete" ? 1 : 0;
      if (revealFrac <= 0) return;

      ctx.save();
      st.layout.episodes.forEach((ep, ci) => {
        if (!ep.promos.length) return;
        const isHot = st.hovered.ep === ci;
        const baseShow = st.camera.zoom > 0.4;
        if (!baseShow && !isHot) return;

        const s1 = w2s(ep.x, ep.y);
        const s2 = w2s(ep.centroidX, ep.centroidY);
        const alpha = isHot ? 0.35 : 0.08;

        ctx.globalAlpha = alpha * revealFrac;
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        const mx = (s1.x + s2.x) / 2 + (s2.y - s1.y) * 0.05;
        const my = (s1.y + s2.y) / 2 - (s2.x - s1.x) * 0.05;
        ctx.quadraticCurveTo(mx, my, s2.x, s2.y);
        ctx.strokeStyle = isHot ? HOT : INK;
        ctx.lineWidth = isHot ? 1 : 0.5;
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Line-cell grid: one cell per transcript line per episode, colored
    // by role (hook/cliff/connective/candidate/outside). This is the data
    // density ask from plan 04 §1 — every line visible, not just the
    // final-picked promo windows.
    function drawCells() {
      if (!st.layout) return;
      const revealFrac = st.phase === "scoring" ? st.animProgress
        : st.phase === "ranking" || st.phase === "complete" ? 1 : 0;
      if (revealFrac <= 0) return;

      ctx.save();
      const zoom = st.camera.zoom;
      const episodes = st.layout.episodes;
      const totalEps = episodes.length;
      const revealedCount = Math.ceil(revealFrac * totalEps);

      episodes.forEach((ep, ci) => {
        if (ci >= revealedCount) return;
        if (!ep.cells.length) return;

        const isEpHot = st.hovered.ep === ci;
        const shouldFade = st.hovered.ep >= 0 && !isEpHot;
        const groupAlpha = shouldFade ? 0.12 : 1;
        const stripReveal = ci < revealedCount - 1 ? 1 : (revealFrac * totalEps - ci);

        ctx.globalAlpha = groupAlpha * stripReveal;

        if (isEpHot && ep.cells.length) {
          const s = w2s(ep.centroidX, ep.centroidY);
          const haloR = Math.max(ep.stripW, ep.stripH) * zoom * 0.9;
          const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, haloR);
          grad.addColorStop(0, "rgba(255,106,61,0.18)");
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(s.x, s.y, haloR, 0, TWO_PI);
          ctx.fill();
        }

        const sz = Math.max(DOT_SIZE * zoom, 1.4);

        ep.cells.forEach((c, ci2) => {
          const s = w2s(c.wx, c.wy);
          if (s.x < -10 || s.x > st.W + 10 || s.y < -10 || s.y > st.H + 10) return;

          const isHovered = st.hovered.cellEp === ci && st.hovered.cellIdx === ci2;
          let fill;
          switch (c.role) {
            case "hook":       fill = HOT; break;
            case "cliff":      fill = RED; break;
            case "connective": fill = `rgba(255,106,61,${0.35 + 0.004 * (c.best_points || 0)})`; break;
            case "candidate":  fill = `rgba(239,230,208,${0.5 + 0.015 * (c.best_points || 0)})`; break;
            default:           fill = "rgba(239,230,208,0.35)";
          }

          if (isHovered) {
            ctx.save();
            ctx.shadowBlur = 8;
            ctx.shadowColor = HOT;
            ctx.fillStyle = HOT;
            ctx.globalAlpha = 1;
            ctx.fillRect(s.x - sz, s.y - sz, sz * 2, sz * 2);
            ctx.restore();
            ctx.globalAlpha = groupAlpha * stripReveal;
          } else {
            ctx.fillStyle = fill;
            ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);
          }

          // Character glyph badge — plan 04 §3. Only once cells are big
          // enough to carry a legible initial; collision-filtered so a
          // dense dialogue run doesn't smear glyphs into each other.
          if (zoom > 0.85 && c.type === "dialogue" && c.speaker) {
            const style = styleFor(ep.charIndex, c.speaker);
            if (style) {
              queueLabel({
                x: s.x, y: s.y - sz, text: style.glyph, align: "center",
                fontSize: Math.max(7, 8 * zoom), weight: 700,
                color: style.color, priority: isHovered ? 980 : 60,
              });
            }
          }
        });

        // Per-episode score badges. Shown for the top-5 episodes (so their
        // scores are always visible) and for whichever episode is hovered;
        // everything else stays an unlabeled colored cell so the grid reads
        // clean. No per-clip marker — the highlight lives on the episode
        // circle instead (drawEpisodeNodes).
        if (zoom > 0.3) {
          const isTop5 = ep.top5Rank >= 0;
          ep.promos.forEach((promo) => {
            const i = promo.receipt?.hook_line_index;
            if (i == null || !ep.cells[i]) return;
            if (!isEpHot && !isTop5) return;

            const cell = ep.cells[i];
            const s = w2s(cell.wx, cell.wy);
            const lx = s.x + ep.angle_cos * 12 * zoom;
            const ly = s.y + ep.angle_sin * 12 * zoom;
            queueLabel({
              x: lx, y: ly, text: promo.score, align: "center",
              fontSize: Math.max(10, 12 * Math.min(zoom, 1.3)), weight: 700,
              color: isEpHot ? HOT : DIM,
              priority: isEpHot ? 950 : (isTop5 ? 700 : 500),
            });
          });
        }

        // Zoomed into THIS episode → pulse a ring on each promo's hook cell as
        // a "click me" cue. All the TEXT (episode, timestamps, scores, the
        // click instruction) now lives in the HTML info card beside the grid
        // (updateEpisodeCard) so nothing overlaps the cells anymore.
        if (st.viewLevel === "episode" && st.focusEp === ci && ep.promos.length) {
          const cellSz = Math.max(DOT_SIZE * zoom, 2);
          const pulse = 7 + 4 * Math.sin(performance.now() / 300);
          ep.promos.forEach((promo) => {
            const hi = promo.receipt?.hook_line_index;
            if (hi == null || !ep.cells[hi]) return;
            const s = w2s(ep.cells[hi].wx, ep.cells[hi].wy);
            ctx.save();
            ctx.beginPath();
            ctx.arc(s.x, s.y, cellSz + pulse, 0, TWO_PI);
            ctx.strokeStyle = "rgba(255,106,61,0.95)";
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.restore();
          });
        }

        ctx.globalAlpha = 1;
      });
      ctx.restore();
    }

    function drawEpisodeNodes() {
      if (!st.layout) return;
      ctx.save();
      const center = w2s(0, 0);
      const revealFrac = st.phase === "idle" ? 0.3 : st.phase === "parsing" ? st.animProgress : 1;
      const totalEps = st.layout.episodes.length;
      const revealedCount = Math.ceil(revealFrac * totalEps);

      st.layout.episodes.forEach((ep, ci) => {
        if (ci >= revealedCount && st.phase !== "idle") return;

        const s = w2s(ep.x, ep.y);
        // Radius must scale WITH zoom, not against a clamped curve of it —
        // node spacing shrinks proportionally as you zoom out (it's a
        // function of camera.zoom via w2s), so a radius that doesn't shrink
        // the same way inevitably overlaps neighboring nodes at low zoom.
        // This was the real cause of "overlapping circles," not just labels.
        const r = Math.max(ep.radius * st.camera.zoom * 1.1, 3);
        const isHot = st.hovered.ep === ci;
        const shouldFade = st.hovered.ep >= 0 && !isHot;
        const isIdle = st.phase === "idle";
        const zoomedHere = st.viewLevel === "episode" && st.focusEp === ci;
        const isTop5 = ep.top5Rank >= 0;      // one of the 5 best episodes
        const accent = isHot || zoomedHere || isTop5;

        ctx.globalAlpha = isIdle ? 0.3 : (shouldFade ? 0.2 : 1);

        // Persistent soft glow behind the top-5 episode circles so they read
        // as "the ones to pull from" at a glance, even without hovering.
        if (isTop5 && !isIdle && !shouldFade) {
          const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 2.4);
          grad.addColorStop(0, "rgba(255,106,61,0.22)");
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r * 2.4, 0, TWO_PI);
          ctx.fill();
        }

        if ((isHot || zoomedHere) && st.camera.zoom > 0.25) {
          const sectorAngle = (TWO_PI / totalEps) * 0.82;
          const arcR = (R_STRIP_START - 40) * st.camera.zoom;
          ctx.beginPath();
          ctx.arc(center.x, center.y, arcR, ep.angle - sectorAngle / 2, ep.angle + sectorAngle / 2);
          ctx.strokeStyle = "rgba(255,106,61,0.25)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Grey ring by default, same restraint hexbrainai.com uses — every
        // class node there is the same neutral white/grey outline regardless
        // of report count; only the hovered/focused one turns orange. Data
        // magnitude already reads through node size, not hue.
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, TWO_PI);
        ctx.fillStyle = BG;
        ctx.fill();
        ctx.lineWidth = isHot || zoomedHere ? 2.5 : isTop5 ? 2.5 : 1.5;
        ctx.strokeStyle = isHot || zoomedHere
          ? HOT
          : isTop5
            ? "rgba(255,106,61,0.9)"
            : (ep.promoCount > 0 ? "rgba(239,230,208,0.55)" : "#322f25");
        ctx.stroke();

        const ir = r * 0.72;
        ctx.beginPath();
        ctx.arc(s.x, s.y, ir, 0, TWO_PI);
        ctx.strokeStyle = isHot ? "rgba(255,106,61,0.35)" : "rgba(50,47,37,0.45)";
        ctx.lineWidth = 0.8;
        ctx.stroke();

        if ((isHot || zoomedHere) && !isIdle) {
          const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 2.2);
          grad.addColorStop(0, "rgba(255,106,61,0.3)");
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r * 2.2, 0, TWO_PI);
          ctx.fill();
        }

        if (st.camera.zoom > 0.16) {
          const fSize = Math.max(7, Math.min(12, 13 * st.camera.zoom));
          queueLabel({
            x: s.x, y: s.y, align: "center", fontSize: fSize, weight: 600,
            color: isHot || isTop5 ? HOT : INK,
            text: ep.id.length > 3 ? ep.id.slice(0, 6).toUpperCase() : `EP${ep.id}`,
            priority: 800, skipCollision: true,
          });
        }

        // Rank badge (#1..#5) pinned to the top-right of a top-5 circle.
        if (isTop5 && st.camera.zoom > 0.16) {
          const off = r * 0.78;
          queueLabel({
            x: s.x + off, y: s.y - off, align: "center",
            fontSize: Math.max(8, 10 * st.camera.zoom), weight: 700,
            color: HOT, text: `#${ep.top5Rank + 1}`,
            priority: 900, skipCollision: true,
          });
        }

        // Full label + score summary on hover only. When zoomed INTO this
        // episode the HTML info card carries all this text, so suppress the
        // canvas label to avoid the overlap the user flagged.
        if (isHot && !zoomedHere && st.camera.zoom > 0.2) {
          const labelDist = r + 18;
          const lx = s.x + Math.cos(ep.angle) * labelDist;
          const ly = s.y + Math.sin(ep.angle) * labelDist;
          const normA = ((ep.angle % TWO_PI) + TWO_PI) % TWO_PI;
          const align = normA > Math.PI * 0.35 && normA < Math.PI * 1.65 ? "right" : "left";
          const fz = 12;

          queueLabel({
            x: lx, y: ly, align, fontSize: fz, weight: 600, color: HOT,
            text: `Episode ${ep.id}`, priority: 1000, skipCollision: true,
          });
          if (ep.promoCount > 0) {
            queueLabel({
              x: lx, y: ly + fz + 2, align, fontSize: fz - 1, weight: 400, color: DIM,
              text: `${ep.promoCount} promos · best ${ep.maxScore}`, priority: 1000, skipCollision: true,
            });
          }
        }

        ctx.globalAlpha = 1;
      });
      ctx.restore();
    }

    function drawSunflower() {
      if (!st.sunflower) return;
      const strip = st.sunflower;
      const center = w2s(strip.centroidX, strip.centroidY);

      ctx.save();
      [60, 30, 10].forEach((r, i) => {
        const sr = r * st.camera.zoom;
        const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, sr);
        grad.addColorStop(0, i === 2 ? "rgba(255,255,255,0.8)" : i === 1 ? "rgba(255,106,61,0.5)" : "rgba(255,106,61,0.15)");
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(center.x, center.y, sr, 0, TWO_PI);
        ctx.fill();
      });
      ctx.restore();

      ctx.save();
      st.sunflowerDots.forEach((d, i) => {
        const s = w2s(d.x, d.y);
        if (s.x < -20 || s.x > st.W + 20 || s.y < -20 || s.y > st.H + 20) return;
        const sz = Math.max(3 * st.camera.zoom, 2);
        const isHov = st.hovered.sunflowerIdx === i && st.isZoomedIn;
        if (isHov) {
          ctx.save();
          ctx.shadowBlur = 10;
          ctx.shadowColor = HOT;
          ctx.fillStyle = HOT;
          ctx.fillRect(s.x - sz, s.y - sz, sz * 2, sz * 2);
          ctx.restore();
        } else {
          const type = d.seg?.type;
          ctx.fillStyle = type === "dialogue" ? INK : type === "action" ? HOT : type === "sound_fx" ? RED : DIM;
          ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);
        }

        if (d.seg?.type === "dialogue" && d.seg?.speaker) {
          const ep = st.layout?.episodes.find((e) => e.id === strip.episode);
          const style = ep && styleFor(ep.charIndex, d.seg.speaker);
          if (style) {
            queueLabel({
              x: s.x, y: s.y - sz - 2, text: style.glyph, align: "center",
              fontSize: Math.max(8, 9 * st.camera.zoom * 0.3), weight: 700,
              color: style.color, priority: isHov ? 980 : 70,
            });
          }
        }
      });
      ctx.restore();

      ctx.save();
      const outerR = st.sunflowerDots.length > 0 ? (st.sunflowerDots[st.sunflowerDots.length - 1].radius + 40) * st.camera.zoom : 100;
      const hy = center.y - outerR;
      ctx.textAlign = "center";
      ctx.font = "400 11px Recursive,system-ui"; ctx.fillStyle = DIM;
      ctx.fillText(`EP${strip.episode} · PROMO ${(strip.promo.promo_index ?? 0) + 1}`, center.x, hy);
      ctx.font = "600 18px Recursive,system-ui"; ctx.fillStyle = INK;
      ctx.fillText(strip.promo.hook.slice(0, 60) + (strip.promo.hook.length > 60 ? "..." : ""), center.x, hy + 18);
      ctx.font = "500 13px Recursive,system-ui"; ctx.fillStyle = HOT;
      ctx.fillText(`Score ${strip.promo.score} · ${strip.promo.duration}s`, center.x, hy + 36);
      ctx.restore();
    }

    function drawCenterInfo() {
      const c = w2s(0, 0);
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (st.phase === "idle") {
        ctx.font = "700 24px 'Recursive',system-ui";
        ctx.fillStyle = INK;
        ctx.globalAlpha = 0.6;
        ctx.fillText("KUKU PROMO FINDER", c.x, c.y - 16);
        ctx.font = "400 13px 'Recursive',system-ui";
        ctx.fillStyle = DIM;
        ctx.fillText("Run the pipeline to map the episodes", c.x, c.y + 12);
      } else if (st.phase === "parsing") {
        const count = Math.ceil(st.animProgress * (st.layout?.episodes.length || 50));
        ctx.font = "700 32px 'Recursive',system-ui";
        ctx.fillStyle = HOT;
        ctx.fillText(count, c.x, c.y - 10);
        ctx.font = "400 12px 'Recursive',system-ui";
        ctx.fillStyle = DIM;
        ctx.fillText("EPISODES PARSED", c.x, c.y + 14);
      } else if (st.phase === "scoring") {
        const totalLines = (st.layout?.episodes || []).reduce((s, e) => s + e.cells.length, 0);
        const count = Math.ceil(st.animProgress * totalLines);
        ctx.font = "700 32px 'Recursive',system-ui";
        ctx.fillStyle = HOT;
        ctx.fillText(count, c.x, c.y - 10);
        ctx.font = "400 12px 'Recursive',system-ui";
        ctx.fillStyle = DIM;
        ctx.fillText("LINES SCORED", c.x, c.y + 14);
      } else if (st.phase === "ranking") {
        ctx.font = "700 32px 'Recursive',system-ui";
        ctx.fillStyle = HOT;
        ctx.fillText("RANKING", c.x, c.y - 10);
        ctx.font = "400 12px 'Recursive',system-ui";
        ctx.fillStyle = DIM;
        ctx.fillText("Cross-episode analysis", c.x, c.y + 14);
      } else if (st.phase === "complete" && st.viewLevel === "overview" && st.layout) {
        const top = st.layout.episodes.reduce((m, e) => Math.max(m, e.maxScore), 0);
        ctx.font = "700 40px 'Recursive',system-ui";
        ctx.fillStyle = INK;
        ctx.globalAlpha = 0.9;
        ctx.fillText(top || "—", c.x, c.y - 12);
        ctx.font = "400 11px 'Recursive',system-ui";
        ctx.fillStyle = DIM;
        ctx.fillText("TOP SCORE", c.x, c.y + 16);
      }

      if (st.phase !== "idle") {
        const glowR = 80 * st.camera.zoom;
        const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, glowR);
        grad.addColorStop(0, "rgba(255,106,61,0.08)");
        grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(c.x, c.y, glowR, 0, TWO_PI);
        ctx.fill();
      }

      ctx.restore();
    }

    function hitTest(mx, my) {
      const world = s2w(mx, my);
      st.hovered = { ep: -1, cellEp: -1, cellIdx: -1, sunflowerIdx: -1 };
      if (!st.layout) return;

      if (st.isZoomedIn && st.sunflowerDots.length) {
        for (let i = st.sunflowerDots.length - 1; i >= 0; i--) {
          const d = st.sunflowerDots[i];
          const dx = world.x - d.x, dy = world.y - d.y;
          if (dx * dx + dy * dy < 24) {
            st.hovered.sunflowerIdx = i;
            return;
          }
        }
        return;
      }

      if (st.camera.zoom > 0.22) {
        for (let ei = 0; ei < st.layout.episodes.length; ei++) {
          const ep = st.layout.episodes[ei];
          if (!ep.cells.length) continue;
          const rx = world.x - ep.ox, ry = world.y - ep.oy;
          const tangProj = rx * ep.tanX + ry * ep.tanY;
          const radProj = rx * ep.angle_cos + ry * ep.angle_sin;
          const pad = 6;
          if (tangProj >= -pad && tangProj <= ep.stripW + pad && radProj >= -pad && radProj <= ep.stripH + pad) {
            st.hovered.ep = ei;
            // At zoom ≥ 1 we're close enough to pick individual cells —
            // otherwise just treat the whole strip as a group hover.
            if (st.camera.zoom > 0.9) {
              const col = Math.max(0, Math.min(ep.cols - 1, Math.floor(tangProj / DOT_PITCH)));
              const row = Math.max(0, Math.min(ep.rows - 1, Math.floor(radProj / DOT_PITCH)));
              const idx = row * ep.cols + col;
              if (idx < ep.cells.length) {
                st.hovered.cellEp = ei;
                st.hovered.cellIdx = idx;
              }
            }
            return;
          }
        }
      }

      for (let i = 0; i < st.layout.episodes.length; i++) {
        const ep = st.layout.episodes[i];
        const dx = world.x - ep.x, dy = world.y - ep.y;
        if (dx * dx + dy * dy < ep.radius * ep.radius * 4.5) {
          st.hovered.ep = i;
          return;
        }
      }
    }

    function enterPromo(ep, promo) {
      const [i, j] = promo.line_range || [0, 0];
      const cellsInRange = ep.cells.slice(i, j + 1);
      const cx = cellsInRange.reduce((s, c) => s + c.wx, 0) / (cellsInRange.length || 1);
      const cy = cellsInRange.reduce((s, c) => s + c.wy, 0) / (cellsInRange.length || 1);

      st.sunflower = { episode: ep.id, promo, centroidX: cx, centroidY: cy };
      st.isZoomedIn = true;
      st.viewLevel = "sunflower";

      const spacing = 7;
      st.sunflowerDots = cellsInRange.map((d, i2) => {
        const angle = i2 * GOLDEN_ANGLE;
        const radius = spacing * Math.sqrt(i2 + 1);
        return { ...d, seg: d, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), radius, angle, idx: i2 };
      });

      st.camera.targetX = cx;
      st.camera.targetY = cy;
      st.camera.targetZoom = 3.2;

      callbackRef.current.onViewLevelChange?.({ level: "sunflower", episode: ep.id, promo });
    }

    function enterEpisode(ep, idx) {
      st.viewLevel = "episode";
      st.focusEp = idx;
      // Target the midpoint between the ring node (ep.x/ep.y, at R_CLASS)
      // and its line-cell grid's centroid (further out, at R_STRIP_START).
      // Centering purely on the node left the grid — the actual content —
      // sprawled off to one side of the viewport every time, which read as
      // "not aligned centrally" when zooming in/out; centering purely on
      // the grid would do the same to the node. The midpoint keeps both
      // balanced on screen.
      st.camera.targetX = (ep.x + ep.centroidX) / 2;
      st.camera.targetY = (ep.y + ep.centroidY) / 2;
      st.camera.targetZoom = 1.4; // >0.9 so per-cell hover/glyphs kick in immediately
      callbackRef.current.onViewLevelChange?.({ level: "episode", episode: ep.id });
    }

    function goOverview() {
      st.sunflower = null;
      st.isZoomedIn = false;
      st.sunflowerDots = [];
      st.viewLevel = "overview";
      st.camera.targetX = 0;
      st.camera.targetY = 0;
      st.camera.targetZoom = 0.5;
      callbackRef.current.onViewLevelChange?.({ level: "overview" });
      callbackRef.current.onSelectPromo?.(null);
    }

    actionsRef.current = { enterPromo, enterEpisode, goOverview };

    function onMouseDown(e) {
      st.isDragging = true;
      st.dragMoved = false;
      st.dragStart = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = "grabbing";
    }
    function onMouseMove(e) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      st.mouseScreen = { x: mx, y: my };
      st.mouseWorld = s2w(mx, my);
      if (st.isDragging) {
        const dx = (e.clientX - st.dragStart.x) / st.camera.zoom;
        const dy = (e.clientY - st.dragStart.y) / st.camera.zoom;
        if (Math.abs(e.clientX - st.dragStart.x) > 3 || Math.abs(e.clientY - st.dragStart.y) > 3) st.dragMoved = true;
        st.camera.targetX -= dx;
        st.camera.targetY -= dy;
        st.camera.x = st.camera.targetX;
        st.camera.y = st.camera.targetY;
        st.dragStart = { x: e.clientX, y: e.clientY };
      } else {
        hitTest(mx, my);
        const canHit = st.hovered.ep >= 0 || st.hovered.cellIdx >= 0 || st.hovered.sunflowerIdx >= 0;
        canvas.style.cursor = canHit ? "pointer" : "grab";
      }
    }
    function onMouseUp() {
      st.isDragging = false;
      canvas.style.cursor = "grab";
    }
    function onClick(e) {
      if (st.phase !== "complete") return;
      if (st.dragMoved) return;

      const rect = canvas.getBoundingClientRect();
      hitTest(e.clientX - rect.left, e.clientY - rect.top);

      if (st.isZoomedIn) {
        if (st.hovered.sunflowerIdx < 0) goOverview();
        return;
      }
      // Clicked a specific cell inside a chosen promo → jump straight
      // into that promo's sunflower view. Clicked a non-promo cell →
      // zoom into the episode so you can see that cell in context.
      if (st.hovered.cellIdx >= 0 && st.hovered.cellEp >= 0) {
        const ep = st.layout.episodes[st.hovered.cellEp];
        const cell = ep.cells[st.hovered.cellIdx];
        if (cell.promo) {
          enterPromo(ep, cell.promo);
          return;
        }
      }
      if (st.hovered.ep >= 0) {
        enterEpisode(st.layout.episodes[st.hovered.ep], st.hovered.ep);
      } else if (st.viewLevel !== "overview") {
        goOverview();
      }
    }
    function onWheel(e) {
      e.preventDefault();
      const f = e.deltaY > 0 ? 0.9 : 1.1;
      const nz = Math.max(0.08, Math.min(8, st.camera.targetZoom * f));
      const rect = canvas.getBoundingClientRect();
      const world = s2w(e.clientX - rect.left, e.clientY - rect.top);
      st.camera.targetZoom = nz;
      st.camera.targetX += (world.x - st.camera.targetX) * (1 - 1 / f) * 0.3;
      st.camera.targetY += (world.y - st.camera.targetY) * (1 - 1 / f) * 0.3;
    }
    function onKeyDown(e) {
      if (e.key === "Escape" && st.viewLevel !== "overview") goOverview();
    }

    // HTML info card shown beside the cell grid when zoomed into an episode.
    // HTML (not canvas text) so it lays out cleanly — heading, timestamp/score
    // rows, click hint — and never overlaps the dots. Content rebuilds only
    // when the focused episode changes; position updates every frame.
    function updateEpisodeCard() {
      const card = cardRef.current;
      if (!card) return;
      const show = st.viewLevel === "episode" && st.focusEp != null && st.layout
        && st.layout.episodes[st.focusEp] && !st.isZoomedIn;
      if (!show) {
        if (card.style.display !== "none") card.style.display = "none";
        st._cardEp = null;
        return;
      }
      const ep = st.layout.episodes[st.focusEp];
      const gc = w2s(ep.centroidX, ep.centroidY);
      // Place on whichever side of the grid has the screen's empty space:
      // grid on the left half → card to the right, and vice-versa.
      const halfSpan = (Math.max(ep.stripW, ep.stripH) / 2) * st.camera.zoom + 28;
      const onRight = gc.x < st.W * 0.5;
      card.style.display = "block";
      card.style.top = `${gc.y}px`;
      if (onRight) {
        card.style.left = `${gc.x + halfSpan}px`;
        card.style.right = "auto";
        card.style.transform = "translateY(-50%)";
      } else {
        card.style.left = "auto";
        card.style.right = `${st.W - (gc.x - halfSpan)}px`;
        card.style.transform = "translateY(-50%)";
      }

      if (st._cardEp !== st.focusEp) {
        st._cardEp = st.focusEp;
        const promos = [...ep.promos].sort((a, b) => b.score - a.score);
        const rows = promos.map((p, i) => {
          const seg = p.segments && p.segments[0] ? p.segments[0] : {};
          const tc = seg.start_tc ? `${seg.start_tc}–${seg.end_tc}` : "";
          return (
            `<div class="epcard-row">` +
            `<span class="epcard-rank">${i + 1}</span>` +
            `<span class="epcard-tc">${tc}</span>` +
            `<span class="epcard-score">${p.score}</span>` +
            `</div>`
          );
        }).join("");
        card.innerHTML =
          `<div class="epcard-head">Episode ${ep.id}</div>` +
          `<div class="epcard-sub">${ep.promoCount} promo${ep.promoCount === 1 ? "" : "s"} &middot; best ${ep.maxScore}/100</div>` +
          `<div class="epcard-cols"><span>#</span><span>TIMESTAMP</span><span>SCORE</span></div>` +
          `<div class="epcard-list">${rows}</div>` +
          `<div class="epcard-hint">Click a glowing cell to open its promo</div>`;
      }
    }

    function render() {
      st.camera.x = lerp(st.camera.x, st.camera.targetX, 0.08);
      st.camera.y = lerp(st.camera.y, st.camera.targetY, 0.08);
      st.camera.zoom = lerp(st.camera.zoom, st.camera.targetZoom, 0.08);

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, st.W, st.H);

      drawRadialGuides();
      drawConnectors();
      drawFanLines();
      if (st.isZoomedIn) {
        drawSunflower();
      } else {
        drawCells();
      }
      drawEpisodeNodes();
      if (!st.isZoomedIn) drawCenterInfo();
      flushLabels();
      updateEpisodeCard();

      st.animId = requestAnimationFrame(render);
    }

    resize();
    window.addEventListener("resize", resize);
    // The canvas also changes size when the side panels slide open/closed —
    // the grid column it lives in shrinks without the window resizing. Without
    // observing that, st.W/st.H (and the center the drawing is anchored to)
    // keep the old full-width value, so the whole map appears shoved off to
    // one side. A ResizeObserver on the container recenters it on every
    // layout change, panels included.
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => resize());
      ro.observe(canvas.parentElement);
    }
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKeyDown);
    canvas.style.cursor = "grab";

    st.animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(st.animId);
      window.removeEventListener("resize", resize);
      if (ro) ro.disconnect();
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      <svg
        ref={svgRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden" }}
      />
      <div ref={cardRef} className="epcard" style={{ display: "none" }} />
    </div>
  );
});

export default RadialCanvas;
