import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";

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

  const episodeIds = Object.keys(promosByEp).sort((a, b) => {
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
    allEpisodeIds = episodeIds;
  }

  const N = allEpisodeIds.length;
  const angleStep = TWO_PI / N;

  const episodes = [];
  const promoDots = [];
  const connections = [];

  allEpisodeIds.forEach((eid, ci) => {
    const angle = ci * angleStep - Math.PI / 2;
    const promos = promosByEp[eid] || [];
    const totalScore = promos.reduce((s, p) => s + p.score, 0);
    const nodeR = NODE_R_BASE + Math.min(promos.length * 2, 10);

    const ep = {
      id: eid, index: ci, angle, x: R_CLASS * Math.cos(angle), y: R_CLASS * Math.sin(angle),
      radius: nodeR, promoCount: promos.length, totalScore, promos, maxScore: Math.max(0, ...promos.map((p) => p.score)),
    };
    episodes.push(ep);

    let currentR = R_STRIP_START;
    promos.forEach((promo, pi) => {
      const segCount = promo.transcript ? promo.transcript.length : Math.max(3, Math.ceil(promo.duration / 4));
      const cols = Math.min(Math.ceil(Math.sqrt(segCount) * 0.7), MAX_COLS);
      const rows = Math.ceil(segCount / cols);
      const stripW = cols * DOT_PITCH;
      const stripH = rows * DOT_PITCH;

      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const tanX = -sinA, tanY = cosA;
      const ox = currentR * cosA - (stripW / 2) * tanX;
      const oy = currentR * sinA - (stripW / 2) * tanY;

      const dots = [];
      for (let ri = 0; ri < segCount; ri++) {
        const col = ri % cols;
        const row = Math.floor(ri / cols);
        dots.push({
          col, row,
          wx: ox + col * DOT_PITCH * tanX + row * DOT_PITCH * cosA,
          wy: oy + col * DOT_PITCH * tanY + row * DOT_PITCH * sinA,
          seg: promo.transcript ? promo.transcript[ri] : null,
        });
      }

      promoDots.push({
        episode: eid, episodeIndex: ci, promoIndex: pi, promo,
        angle, ox, oy, cosA, sinA, tanX, tanY,
        stripW, stripH, cols, rows, dots, currentR,
        centroidX: ox + (stripW / 2) * tanX + (stripH / 2) * cosA,
        centroidY: oy + (stripW / 2) * tanY + (stripH / 2) * sinA,
        score: promo.score,
      });

      currentR += stripH + STRIP_GAP_RADIAL;
    });
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

  return { episodes, promoDots, connections };
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
    });
  }
  return { episodes, promoDots: [], connections: [] };
}

const RadialCanvas = forwardRef(function RadialCanvas(
  { data, phase, onSelectPromo, onViewLevelChange, animProgress },
  ref
) {
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const stateRef = useRef({
    camera: { x: 0, y: 0, zoom: 0.5, targetX: 0, targetY: 0, targetZoom: 0.5 },
    layout: null, hovered: { ep: -1, strip: -1, dot: -1 },
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
      const strip = st.layout.promoDots.find((s) => s.promo === promo);
      if (strip) actionsRef.current.enterSunflower?.(strip);
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
        `dominant-baseline="middle" fill="${l.color}" opacity="${l.opacity ?? 1}" ` +
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

    // Thin fan lines from each episode node to its own promo strips —
    // the dense interior web the hexbrain reference has, scoped per-episode
    // so it doesn't become unreadable noise at overview zoom.
    function drawFanLines() {
      if (!st.layout || !st.layout.promoDots.length) return;
      const revealFrac = st.phase === "scoring" ? st.animProgress : st.phase === "ranking" || st.phase === "complete" ? 1 : 0;
      if (revealFrac <= 0) return;

      ctx.save();
      st.layout.promoDots.forEach((strip) => {
        const ep = st.layout.episodes[strip.episodeIndex];
        if (!ep) return;
        const isHot = st.hovered.ep === strip.episodeIndex;
        const baseShow = st.camera.zoom > 0.42;
        if (!baseShow && !isHot) return;

        const s1 = w2s(ep.x, ep.y);
        const s2 = w2s(strip.centroidX, strip.centroidY);
        const alpha = isHot ? 0.3 : 0.07;

        ctx.globalAlpha = alpha * revealFrac;
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        const mx = (s1.x + s2.x) / 2 + (s2.y - s1.y) * 0.08;
        const my = (s1.y + s2.y) / 2 - (s2.x - s1.x) * 0.08;
        ctx.quadraticCurveTo(mx, my, s2.x, s2.y);
        ctx.strokeStyle = isHot ? HOT : INK;
        ctx.lineWidth = isHot ? 1 : 0.5;
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    function drawStrips() {
      if (!st.layout || !st.layout.promoDots.length) return;
      const revealFrac = st.phase === "scoring" ? st.animProgress : st.phase === "ranking" || st.phase === "complete" ? 1 : 0;
      if (revealFrac <= 0) return;

      ctx.save();
      const zoom = st.camera.zoom;
      const totalStrips = st.layout.promoDots.length;
      const revealedCount = Math.ceil(revealFrac * totalStrips);

      st.layout.promoDots.forEach((strip, si) => {
        if (si >= revealedCount) return;
        const stripReveal = si < revealedCount - 1 ? 1 : (revealFrac * totalStrips - si);

        const isEpHot = st.hovered.ep === strip.episodeIndex;
        const isStripHot = st.hovered.strip === si;
        const shouldFade = st.hovered.ep >= 0 && !isEpHot;
        const baseAlpha = shouldFade ? 0.08 : (isStripHot ? 1 : 0.75);

        ctx.globalAlpha = baseAlpha * stripReveal;

        // Soft glow highlight instead of a dashed box — a filled halo
        // behind the strip, scaling with hover rather than a hard outline.
        if (isStripHot) {
          const s = w2s(strip.centroidX, strip.centroidY);
          const haloR = Math.max(strip.stripW, strip.stripH) * zoom * 0.9;
          const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, haloR);
          grad.addColorStop(0, "rgba(255,106,61,0.22)");
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(s.x, s.y, haloR, 0, TWO_PI);
          ctx.fill();
        }

        const sz = Math.max(DOT_SIZE * zoom, 1.2);
        const scoreNorm = strip.score / 100;

        strip.dots.forEach((d, di) => {
          const s = w2s(d.wx, d.wy);
          if (s.x < -10 || s.x > st.W + 10 || s.y < -10 || s.y > st.H + 10) return;

          if (di === st.hovered.dot && si === st.hovered.strip) {
            ctx.save();
            ctx.shadowBlur = 8;
            ctx.shadowColor = HOT;
            ctx.fillStyle = HOT;
            ctx.globalAlpha = 1;
            ctx.fillRect(s.x - sz, s.y - sz, sz * 2, sz * 2);
            ctx.restore();
            ctx.globalAlpha = baseAlpha * stripReveal;
          } else {
            ctx.fillStyle = scoreNorm > 0.75 ? HOT : scoreNorm > 0.55 ? `rgba(255,106,61,${0.5 + scoreNorm * 0.5})` : INK;
            ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);
          }
        });

        // Score badge beside the strip, always legible regardless of zoom.
        // Collision-filtered (see flushLabels) so dense clusters drop the
        // lower-scoring badges instead of stacking illegible text.
        if (zoom > 0.3) {
          const bs = w2s(strip.centroidX, strip.centroidY);
          const labelDist = Math.max(strip.stripW, strip.stripH) * zoom * 0.6 + 14;
          const lx = bs.x + strip.cosA * labelDist;
          const ly = bs.y + strip.sinA * labelDist;
          queueLabel({
            x: lx, y: ly, text: strip.score, align: "center",
            fontSize: Math.max(11, 13 * Math.min(zoom, 1.3)), weight: 700,
            color: isStripHot ? HOT : scoreNorm > 0.7 ? HOT : DIM,
            priority: isStripHot ? 900 : 100 + strip.score,
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
        const r = ep.radius * Math.min(0.9 + st.camera.zoom * 0.5, 1.4);
        const isHot = st.hovered.ep === ci;
        const shouldFade = st.hovered.ep >= 0 && !isHot;
        const isIdle = st.phase === "idle";
        const zoomedHere = st.viewLevel === "episode" && st.focusEp === ci;

        ctx.globalAlpha = isIdle ? 0.3 : (shouldFade ? 0.2 : 1);

        if ((isHot || zoomedHere) && st.camera.zoom > 0.25) {
          const sectorAngle = (TWO_PI / totalEps) * 0.82;
          const arcR = (R_STRIP_START - 40) * st.camera.zoom;
          ctx.beginPath();
          ctx.arc(center.x, center.y, arcR, ep.angle - sectorAngle / 2, ep.angle + sectorAngle / 2);
          ctx.strokeStyle = "rgba(255,106,61,0.25)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, TWO_PI);
        ctx.fillStyle = BG;
        ctx.fill();
        ctx.lineWidth = isHot || zoomedHere ? 2.5 : 1.5;
        ctx.strokeStyle = isHot || zoomedHere ? HOT : (ep.promoCount > 0 ? "rgba(255,106,61,0.4)" : "#322f25");
        ctx.stroke();

        const ir = r * 0.72;
        ctx.beginPath();
        ctx.arc(s.x, s.y, ir, 0, TWO_PI);
        ctx.strokeStyle = isHot ? "rgba(255,106,61,0.35)" : "rgba(50,47,37,0.45)";
        ctx.lineWidth = 0.8;
        ctx.stroke();

        if (ep.maxScore > 0 && !isIdle) {
          const glowAlpha = (ep.maxScore / 100) * 0.4;
          const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 2);
          grad.addColorStop(0, `rgba(255,106,61,${glowAlpha})`);
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r * 2, 0, TWO_PI);
          ctx.fill();
        }

        if (st.camera.zoom > 0.16) {
          const fSize = Math.max(7, Math.min(12, 13 * st.camera.zoom));
          queueLabel({
            x: s.x, y: s.y, align: "center", fontSize: fSize, weight: 600,
            color: isHot ? HOT : INK,
            text: ep.id.length > 3 ? ep.id.slice(0, 6).toUpperCase() : `EP${ep.id}`,
            priority: 800, skipCollision: true,
          });
        }

        // Full label + score summary only on hover/focus — keeps the
        // overview from turning into a wall of overlapping text.
        if ((isHot || zoomedHere) && st.camera.zoom > 0.2) {
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
        const isHov = st.hovered.dot === i && st.isZoomedIn;
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
      });
      ctx.restore();

      ctx.save();
      const outerR = st.sunflowerDots.length > 0 ? (st.sunflowerDots[st.sunflowerDots.length - 1].radius + 40) * st.camera.zoom : 100;
      const hy = center.y - outerR;
      ctx.textAlign = "center";
      ctx.font = "400 11px Recursive,system-ui"; ctx.fillStyle = DIM;
      ctx.fillText(`EP${strip.episode} · PROMO ${strip.promoIndex + 1}`, center.x, hy);
      ctx.font = "600 18px Recursive,system-ui"; ctx.fillStyle = INK;
      ctx.fillText(strip.promo.hook.slice(0, 60) + (strip.promo.hook.length > 60 ? "..." : ""), center.x, hy + 18);
      ctx.font = "500 13px Recursive,system-ui"; ctx.fillStyle = HOT;
      ctx.fillText(`Score ${strip.score} · ${strip.promo.duration}s`, center.x, hy + 36);
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
        const count = Math.ceil(st.animProgress * (st.layout?.promoDots.length || 0));
        ctx.font = "700 32px 'Recursive',system-ui";
        ctx.fillStyle = HOT;
        ctx.fillText(count, c.x, c.y - 10);
        ctx.font = "400 12px 'Recursive',system-ui";
        ctx.fillStyle = DIM;
        ctx.fillText("PROMOS SCORED", c.x, c.y + 14);
      } else if (st.phase === "ranking") {
        ctx.font = "700 32px 'Recursive',system-ui";
        ctx.fillStyle = HOT;
        ctx.fillText("RANKING", c.x, c.y - 10);
        ctx.font = "400 12px 'Recursive',system-ui";
        ctx.fillStyle = DIM;
        ctx.fillText("Cross-episode analysis", c.x, c.y + 14);
      } else if (st.phase === "complete" && st.viewLevel === "overview" && st.layout) {
        const top = st.layout.promoDots.reduce((m, s) => Math.max(m, s.score), 0);
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
      st.hovered = { ep: -1, strip: -1, dot: -1 };
      if (!st.layout) return;

      if (st.isZoomedIn && st.sunflowerDots.length) {
        for (let i = st.sunflowerDots.length - 1; i >= 0; i--) {
          const d = st.sunflowerDots[i];
          const dx = world.x - d.x, dy = world.y - d.y;
          if (dx * dx + dy * dy < 24) {
            st.hovered.dot = i;
            return;
          }
        }
        return;
      }

      if (st.camera.zoom > 0.22) {
        for (let i = 0; i < st.layout.promoDots.length; i++) {
          const strip = st.layout.promoDots[i];
          const rx = world.x - strip.ox, ry = world.y - strip.oy;
          const tangProj = rx * strip.tanX + ry * strip.tanY;
          const radProj = rx * strip.cosA + ry * strip.sinA;
          const pad = 6;
          if (tangProj >= -pad && tangProj <= strip.stripW + pad && radProj >= -pad && radProj <= strip.stripH + pad) {
            st.hovered.strip = i;
            st.hovered.ep = strip.episodeIndex;
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

    function enterSunflower(strip) {
      st.sunflower = strip;
      st.isZoomedIn = true;
      st.viewLevel = "sunflower";

      const spacing = 7;
      st.sunflowerDots = strip.dots.map((d, i) => {
        const angle = i * GOLDEN_ANGLE;
        const radius = spacing * Math.sqrt(i + 1);
        return { ...d, x: strip.centroidX + radius * Math.cos(angle), y: strip.centroidY + radius * Math.sin(angle), radius, angle, idx: i };
      });

      st.camera.targetX = strip.centroidX;
      st.camera.targetY = strip.centroidY;
      st.camera.targetZoom = 3.2;

      callbackRef.current.onViewLevelChange?.({ level: "sunflower", episode: strip.episode, promo: strip.promo });
    }

    function enterEpisode(ep, idx) {
      st.viewLevel = "episode";
      st.focusEp = idx;
      st.camera.targetX = ep.x;
      st.camera.targetY = ep.y;
      st.camera.targetZoom = 1.15;
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

    actionsRef.current = { enterSunflower, enterEpisode, goOverview };

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
        canvas.style.cursor = st.hovered.ep >= 0 || st.hovered.strip >= 0 || st.hovered.dot >= 0 ? "pointer" : "grab";
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
        if (st.hovered.dot < 0) goOverview();
        return;
      }
      if (st.hovered.strip >= 0) {
        enterSunflower(st.layout.promoDots[st.hovered.strip]);
      } else if (st.hovered.ep >= 0) {
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
        drawStrips();
      }
      drawEpisodeNodes();
      if (!st.isZoomedIn) drawCenterInfo();
      flushLabels();

      st.animId = requestAnimationFrame(render);
    }

    resize();
    window.addEventListener("resize", resize);
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
    </div>
  );
});

export default RadialCanvas;
