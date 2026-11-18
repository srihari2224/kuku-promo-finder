import { useRef, useEffect, useCallback } from "react";

const BG = "#13120e", RAISE = "#1f1d17", LINE = "#322f25", INK = "#efe6d0",
  DIM = "#8f8874", HOT = "#ff6a3d", RED = "#ff3b30";
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TWO_PI = Math.PI * 2;

const R_CLASS = 400;
const R_STRIP_START = 490;
const NODE_R_BASE = 14;
const DOT_SIZE = 3;
const DOT_GAP = 2.5;
const DOT_PITCH = DOT_SIZE + DOT_GAP;
const STRIP_GAP_RADIAL = 14;
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

  const allEpisodeIds = [];
  for (let i = 1; i <= (data.episode_count || 50); i++) {
    const id = String(i).padStart(2, "0");
    allEpisodeIds.push(id);
  }
  episodeIds.forEach((id) => {
    if (!allEpisodeIds.includes(id)) allEpisodeIds.push(id);
  });

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
        const wx = ox + col * DOT_PITCH * tanX + row * DOT_PITCH * cosA;
        const wy = ox + col * DOT_PITCH * tanY + row * DOT_PITCH * sinA;
        dots.push({
          col, row, wx: ox + col * DOT_PITCH * tanX + row * DOT_PITCH * cosA,
          wy: oy + col * DOT_PITCH * tanY + row * DOT_PITCH * sinA,
          seg: promo.transcript ? promo.transcript[ri] : null,
        });
      }

      promoDots.push({
        episode: eid, episodeIndex: ci, promoIndex: pi, promo,
        angle, ox, oy, cosA, sinA, tanX, tanY,
        stripW, stripH, cols, rows, dots, currentR,
        score: promo.score,
      });

      currentR += stripH + STRIP_GAP_RADIAL;
    });
  });

  srand(99);
  const highScoreEps = episodes.filter((e) => e.maxScore >= 60);
  for (let i = 0; i < highScoreEps.length; i++) {
    for (let j = i + 1; j < highScoreEps.length; j++) {
      if (rand() < 0.35) {
        const src = highScoreEps[i], dst = highScoreEps[j];
        const mx = (src.x + dst.x) * 0.15;
        const my = (src.y + dst.y) * 0.15;
        const perp = Math.atan2(dst.y - src.y, dst.x - src.x) + Math.PI / 2;
        const offset = (rand() - 0.5) * 160;
        connections.push({
          srcIdx: src.index, dstIdx: dst.index,
          cp1: { x: mx + offset * Math.cos(perp), y: my + offset * Math.sin(perp) },
          cp2: { x: mx - offset * 0.4 * Math.cos(perp), y: my - offset * 0.4 * Math.sin(perp) },
          particles: Array.from({ length: 1 + Math.floor(rand() * 2) }, () => ({
            t: rand(), speed: 0.0006 + rand() * 0.0012,
          })),
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

export default function RadialCanvas({ data, phase, onSelectPromo, selectedPromo, animProgress }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({
    camera: { x: 0, y: 0, zoom: 0.55, targetX: 0, targetY: 0, targetZoom: 0.55 },
    layout: null, hovered: { ep: -1, strip: -1, dot: -1 },
    isDragging: false, dragStart: { x: 0, y: 0 },
    mouseScreen: { x: 0, y: 0 }, mouseWorld: { x: 0, y: 0 },
    isZoomedIn: false, sunflower: null, sunflowerDots: [],
    W: 0, H: 0, dpr: 1, animId: 0,
    phase: "idle", animProgress: 0,
    selectedStripIdx: -1,
  });
  const callbackRef = useRef({ onSelectPromo });

  useEffect(() => { callbackRef.current.onSelectPromo = onSelectPromo; }, [onSelectPromo]);

  useEffect(() => {
    const st = stateRef.current;
    st.phase = phase;
    st.animProgress = animProgress || 0;
    if (data) {
      st.layout = buildLayout(data);
    } else {
      st.layout = buildIdleLayout(50);
    }
    if (phase === "idle" || !data) {
      st.camera.targetZoom = 0.55;
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
    }

    function w2s(wx, wy) {
      return { x: (wx - st.camera.x) * st.camera.zoom + st.W / 2, y: (wy - st.camera.y) * st.camera.zoom + st.H / 2 };
    }
    function s2w(sx, sy) {
      return { x: (sx - st.W / 2) / st.camera.zoom + st.camera.x, y: (sy - st.H / 2) / st.camera.zoom + st.camera.y };
    }

    function drawRadialGuides() {
      const c = w2s(0, 0);
      ctx.save();
      [200, R_CLASS, R_STRIP_START, 750, 1000].forEach((r) => {
        const sr = r * st.camera.zoom;
        if (sr < 4) return;
        ctx.beginPath();
        ctx.arc(c.x, c.y, sr, 0, TWO_PI);
        ctx.strokeStyle = r === R_CLASS ? "rgba(50,47,37,0.35)" : "rgba(50,47,37,0.12)";
        ctx.lineWidth = r === R_CLASS ? 1 : 0.5;
        ctx.stroke();
      });
      if (st.camera.zoom > 0.25 && st.layout) {
        st.layout.episodes.forEach((ep) => {
          const far = w2s(ep.x * 2.6, ep.y * 2.6);
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(far.x, far.y);
          ctx.strokeStyle = "rgba(50,47,37,0.06)";
          ctx.lineWidth = 0.5;
          ctx.stroke();
        });
      }
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
        const alpha = st.hovered.ep >= 0 ? (isHot ? 0.5 : 0.02) : 0.1;

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

        if (isStripHot) {
          const { ox, oy, stripW, stripH, cosA, sinA, tanX, tanY } = strip;
          const corners = [
            w2s(ox, oy),
            w2s(ox + stripW * tanX, oy + stripW * tanY),
            w2s(ox + stripW * tanX + stripH * cosA, oy + stripW * tanY + stripH * sinA),
            w2s(ox + stripH * cosA, oy + stripH * sinA),
          ];
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          corners.slice(1).forEach((c) => ctx.lineTo(c.x, c.y));
          ctx.closePath();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = HOT;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
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
        const r = ep.radius * Math.min(st.camera.zoom * 1.3, 1.1);
        const isHot = st.hovered.ep === ci;
        const shouldFade = st.hovered.ep >= 0 && !isHot;
        const isIdle = st.phase === "idle";

        ctx.globalAlpha = isIdle ? 0.3 : (shouldFade ? 0.2 : 1);

        if (isHot && st.camera.zoom > 0.25) {
          const sectorAngle = (TWO_PI / totalEps) * 0.82;
          const arcR = (R_STRIP_START - 30) * st.camera.zoom;
          ctx.beginPath();
          ctx.arc(center.x, center.y, arcR, ep.angle - sectorAngle / 2, ep.angle + sectorAngle / 2);
          ctx.strokeStyle = "rgba(255,106,61,0.25)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        if (isHot && st.camera.zoom > 0.3) {
          ctx.save();
          ctx.setLineDash([6, 6]);
          ctx.strokeStyle = "rgba(255,106,61,0.15)";
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(s.x, s.y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, TWO_PI);
        ctx.fillStyle = BG;
        ctx.fill();
        ctx.lineWidth = isHot ? 2.5 : 1.5;
        ctx.strokeStyle = isHot ? HOT : (ep.promoCount > 0 ? "rgba(255,106,61,0.4)" : LINE);
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

        if (st.camera.zoom > 0.18) {
          const fSize = Math.max(7, Math.min(12, 13 * st.camera.zoom));
          ctx.font = `600 ${fSize}px 'Recursive',system-ui`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = isHot ? HOT : INK;
          ctx.fillText(`EP${ep.id}`, s.x, s.y);
        }

        if (st.camera.zoom > 0.35) {
          const labelDist = r + 16;
          const lx = s.x + Math.cos(ep.angle) * labelDist;
          const ly = s.y + Math.sin(ep.angle) * labelDist;

          const normA = ((ep.angle % TWO_PI) + TWO_PI) % TWO_PI;
          ctx.textAlign = normA > Math.PI * 0.35 && normA < Math.PI * 1.65 ? "right" : "left";
          ctx.textBaseline = "middle";

          const fz = Math.max(9, 11 * Math.min(st.camera.zoom, 1));
          ctx.font = `500 ${fz}px 'Recursive',system-ui`;
          ctx.fillStyle = isHot ? HOT : INK;
          ctx.globalAlpha = isIdle ? 0.15 : (shouldFade ? 0.12 : (isHot ? 1 : 0.6));
          ctx.fillText(`Episode ${ep.id}`, lx, ly);

          if (ep.promoCount > 0 && !isIdle) {
            ctx.font = `400 ${fz - 1}px 'Recursive',system-ui`;
            ctx.fillStyle = isHot ? HOT : DIM;
            ctx.fillText(`${ep.promoCount} promos · best ${ep.maxScore}`, lx, ly + fz + 2);
          }
        }

        ctx.globalAlpha = 1;
      });
      ctx.restore();
    }

    function drawPromoLabels() {
      if (!st.layout || st.camera.zoom < 0.5 || st.phase === "idle" || st.phase === "parsing") return;
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, (st.camera.zoom - 0.5) * 0.8);
      const fz = Math.max(8, 10 * Math.min(st.camera.zoom, 1.5));
      ctx.font = `400 ${fz}px 'Recursive',monospace`;

      st.layout.promoDots.forEach((strip) => {
        if (st.hovered.ep >= 0 && st.hovered.ep !== strip.episodeIndex) return;
        const lx = strip.ox + strip.stripH * 0.5 * strip.cosA + strip.stripW * 0.5 * strip.tanX;
        const ly = strip.oy + strip.stripH * 0.5 * strip.sinA + strip.stripW * 0.5 * strip.tanY;
        const s = w2s(lx, ly);
        if (s.x < -50 || s.x > st.W + 50 || s.y < -50 || s.y > st.H + 50) return;

        ctx.save();
        ctx.translate(s.x, s.y);
        let rot = strip.angle;
        if (rot > Math.PI / 2 || rot < -Math.PI / 2) rot += Math.PI;
        ctx.rotate(rot);
        ctx.fillStyle = DIM;
        ctx.textAlign = "center";
        ctx.fillText(`P${strip.promoIndex + 1} · ${strip.score}pts`, 0, -strip.stripW * st.camera.zoom / 2 - 4);
        ctx.restore();
      });
      ctx.restore();
    }

    function drawSunflower() {
      if (!st.sunflower) return;
      const strip = st.sunflower;
      const cx = strip.ox + strip.stripW / 2 * strip.tanX + strip.stripH / 2 * strip.cosA;
      const cy = strip.oy + strip.stripW / 2 * strip.tanY + strip.stripH / 2 * strip.sinA;
      const center = w2s(cx, cy);

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
        ctx.fillText("Run the pipeline to map 50 episodes", c.x, c.y + 12);
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
          if (dx * dx + dy * dy < 20) {
            st.hovered.dot = i;
            return;
          }
        }
        return;
      }

      for (let i = 0; i < st.layout.episodes.length; i++) {
        const ep = st.layout.episodes[i];
        const dx = world.x - ep.x, dy = world.y - ep.y;
        if (dx * dx + dy * dy < ep.radius * ep.radius * 2.5) {
          st.hovered.ep = i;
          return;
        }
      }

      if (st.camera.zoom > 0.25) {
        for (let i = 0; i < st.layout.promoDots.length; i++) {
          const strip = st.layout.promoDots[i];
          const rx = world.x - strip.ox, ry = world.y - strip.oy;
          const tangProj = rx * strip.tanX + ry * strip.tanY;
          const radProj = rx * strip.cosA + ry * strip.sinA;
          if (tangProj >= -2 && tangProj <= strip.stripW + 2 && radProj >= -2 && radProj <= strip.stripH + 2) {
            st.hovered.strip = i;
            st.hovered.ep = strip.episodeIndex;
            return;
          }
        }
      }
    }

    function enterSunflower(strip) {
      st.sunflower = strip;
      st.isZoomedIn = true;
      st.selectedStripIdx = st.layout.promoDots.indexOf(strip);
      const cx = strip.ox + strip.stripW / 2 * strip.tanX + strip.stripH / 2 * strip.cosA;
      const cy = strip.oy + strip.stripW / 2 * strip.tanY + strip.stripH / 2 * strip.sinA;

      const spacing = 7;
      st.sunflowerDots = strip.dots.map((d, i) => {
        const angle = i * GOLDEN_ANGLE;
        const radius = spacing * Math.sqrt(i + 1);
        return { ...d, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), radius, angle: angle, idx: i };
      });

      st.camera.targetX = cx;
      st.camera.targetY = cy;
      st.camera.targetZoom = 3.5;
    }

    function zoomOut() {
      st.sunflower = null;
      st.isZoomedIn = false;
      st.selectedStripIdx = -1;
      st.sunflowerDots = [];
      st.camera.targetX = 0;
      st.camera.targetY = 0;
      st.camera.targetZoom = 0.55;
    }

    function onMouseDown(e) {
      st.isDragging = true;
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
        st.camera.targetX -= dx;
        st.camera.targetY -= dy;
        st.camera.x = st.camera.targetX;
        st.camera.y = st.camera.targetY;
        st.dragStart = { x: e.clientX, y: e.clientY };
      } else {
        hitTest(mx, my);
        canvas.style.cursor = st.hovered.ep >= 0 || st.hovered.strip >= 0 || st.hovered.dot >= 0 ? "pointer" : "default";
      }
    }
    function onMouseUp() {
      st.isDragging = false;
      canvas.style.cursor = "default";
    }
    function onClick() {
      if (st.phase !== "complete") return;
      if (st.isZoomedIn) return;
      if (st.hovered.strip >= 0) {
        const strip = st.layout.promoDots[st.hovered.strip];
        enterSunflower(strip);
        callbackRef.current.onSelectPromo?.(strip.promo);
      } else if (st.hovered.ep >= 0) {
        const ep = st.layout.episodes[st.hovered.ep];
        st.camera.targetX = ep.x;
        st.camera.targetY = ep.y;
        st.camera.targetZoom = 1.3;
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
      if (e.key === "Escape" && st.isZoomedIn) {
        zoomOut();
        callbackRef.current.onSelectPromo?.(null);
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
      if (st.isZoomedIn) {
        drawSunflower();
      } else {
        drawStrips();
      }
      drawEpisodeNodes();
      if (!st.isZoomedIn) {
        drawPromoLabels();
        drawCenterInfo();
      }

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

  return <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />;
}
