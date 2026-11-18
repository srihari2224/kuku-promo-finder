"""Promo scorer — Tier 1 (heuristic) + Tier 3 (finalize / rank) of plan 05.

Tier 1 generates every valid promo window per episode and scores it with a
transparent, keyword+structure signal set, emitting a literal receipt (which
rule fired, for how many points). Tier 2 (the additive AI judge) lives in
ai_judge.py and is applied by rank_all between candidate generation and final
ranking. Tier 3 (here) applies the suspense cut, combines
total = heuristic_score + ai_score, enforces cross-episode diversity, and
carries the ORIGINAL database timestamps through to the output so an editor
can jump straight to the clip in the source.

Signal set modeled on ClipCut's pick.py, adapted to script-native cues
(emotion tags, CAMERA/ACTION/SOUND FX lines, speaker turns).
"""
import re

# Promo window length bounds (seconds) and the ideal length we reward toward.
LO, HI = 15.0, 55.0
TARGET_DUR = 30.0

BASE_SCORE = 30

HOOK_KEYWORDS = [
    "secret", "truth", "lied", "lying", "pregnant", "affair", "betray",
    "never", "always", "mistake", "shocking", "duke", "marry", "divorce",
    "dead", "dying", "kill", "blood", "inherit", "disown", "disinherit",
    "stop", "wait", "no", "why", "how dare", "how could you", "confess",
    "poison", "execute", "execution", "witch", "witchcraft", "revenge",
]
ACTION_HOOK_KEYWORDS = [
    "slap", "slaps", "grip", "grips", "grab", "grabs", "drop", "drops",
    "collapse", "collapses", "gasp", "gasps", "scream", "screams", "strike",
    "strikes", "shove", "shoves", "pull", "pulls", "clench", "clenches",
    "stagger", "staggers", "kneel", "kneels", "draw", "draws", "lunge",
]
EMOTION_HOOK_WORDS = [
    "shocked", "devastated", "furious", "betrayed", "outraged", "gasping",
    "horrified", "trembling", "desperate", "stricken", "heartbroken",
    "breathless", "bewildered", "terrified", "cold", "menacing", "pleading",
    "tearful", "defiant", "anguished", "panicked", "venomous",
]
CLIFF_KEYWORDS = [
    "secret", "truth", "pregnant", "dead", "marry", "divorce", "kill",
    "lied", "mistake", "never", "enough", "choose", "disown", "duke",
    "execute", "execution", "poison", "witch", "revenge", "betray",
]
SFX_SUSPENSE_KEYWORDS = ["cliffhanger", "ominous", "swell", "dread", "tense",
                         "echoing", "thunder", "scream", "crash", "silence"]
WEAK_START = {"he", "she", "they", "it", "him", "her", "them", "and", "but",
              "so", "because", "well", "um", "uh", "the", "a"}
WEAK_END = {"the", "a", "to", "that", "and", "but", "of", "in", "for", "with"}
SECOND_PERSON = {"you", "your", "yours", "you're"}


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def fmt_tc(seconds):
    """Seconds -> 'mm:ss.ss', the script's own timestamp format. This is the
    number the editor needs to find the clip in the database."""
    if seconds is None:
        return ""
    m = int(seconds // 60)
    s = seconds - m * 60
    return f"{m:02d}:{s:05.2f}"


def _word_hits(text, keywords):
    """Word-boundary keyword match — avoids substring false-fires like
    'kill' in 'skill' or 'duke' in 'ducked'. Single words match as whole
    words; multi-word keywords (e.g. 'how dare') match as phrases. Padding
    with spaces + collapsing whitespace makes ' kill ' match only the whole
    token."""
    low = " " + re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text.lower())).strip() + " "
    return [k for k in keywords if (" " + k + " ") in low]


def _first_word(text):
    return re.sub(r"[^a-z']", "", text.split(" ")[0].lower()) if text else ""


def _last_word(text):
    t = text.strip().rstrip(".!?\"'")
    return re.sub(r"[^a-z']", "", t.split(" ")[-1].lower()) if t else ""


# --------------------------------------------------------------------------
# Tier 1 — per-line and per-window scoring
# --------------------------------------------------------------------------
def _hook_score(unit):
    """Score the opening line. Returns (score, [(term, points), ...])."""
    terms = []
    score = 0.0
    text = unit["text"]
    if unit["type"] == "dialogue":
        if text.strip().endswith("?"):
            terms.append(("opens on a question", 12)); score += 12
        hits = _word_hits(text, HOOK_KEYWORDS)
        if hits:
            pts = min(18, 6 * len(hits))
            terms.append((f"hook word: {', '.join(hits)}", pts)); score += pts
        if unit.get("emotion"):
            ehits = _word_hits(unit["emotion"], EMOTION_HOOK_WORDS)
            if ehits:
                pts = min(15, 5 * len(ehits))
                terms.append((f"charged emotion: {', '.join(ehits)}", pts)); score += pts
        if _word_hits(text, SECOND_PERSON):
            terms.append(("direct address (you/your)", 5)); score += 5
        if re.search(r"\b\d", text):
            terms.append(("names a number", 4)); score += 4
        if len(text.split()) <= 8:
            terms.append(("short, punchy opener", 4)); score += 4
    elif unit["type"] == "action":
        ahits = _word_hits(text, ACTION_HOOK_KEYWORDS)
        if ahits:
            pts = min(16, 8 * len(ahits))
            terms.append((f"physical beat: {', '.join(ahits)}", pts)); score += pts
    return score, terms


def _cliff_score(last_unit, trailing_units):
    """Score the closing line + up to 2 trailing lines."""
    terms = []
    score = 0.0
    if last_unit["type"] == "dialogue":
        t = last_unit["text"].strip()
        if t.endswith("?"):
            terms.append(("ends on a question", 12)); score += 12
        elif t.endswith("..."):
            terms.append(("ends on a trailing '...'", 12)); score += 12
        chits = _word_hits(t, CLIFF_KEYWORDS)
        if chits:
            pts = min(12, 5 * len(chits))
            terms.append((f"cliff word: {', '.join(chits)}", pts)); score += pts
    for u in trailing_units:
        low = u["text"].lower()
        if "cut to black" in low:
            terms.append(("'cut to black'", 14)); score += 14
        if u["type"] == "sound_fx":
            sfx = _word_hits(low, SFX_SUSPENSE_KEYWORDS)
            if sfx:
                pts = min(10, 5 * len(sfx))
                terms.append((f"suspense SFX: {', '.join(sfx)}", pts)); score += pts
    return score, terms


def _window_score(window):
    """Signals that read across the whole window, not just its endpoints:
    emotional density, two-hander conflict (speaker alternation), physical
    action beats, suspense SFX, and punctuation emphasis."""
    terms = []
    score = 0.0

    emo_lines = sum(1 for u in window if u.get("emotion"))
    if emo_lines >= 2:
        pts = min(12, 3 * emo_lines)
        terms.append((f"emotional density ({emo_lines} charged lines)", pts)); score += pts

    speakers = [u.get("speaker") for u in window if u["type"] == "dialogue" and u.get("speaker")]
    switches = sum(1 for a, b in zip(speakers, speakers[1:]) if a != b)
    if switches >= 2:
        pts = min(10, 3 * switches)
        terms.append((f"back-and-forth conflict ({switches} exchanges)", pts)); score += pts

    action_beats = sum(1 for u in window if u["type"] == "action" and _word_hits(u["text"], ACTION_HOOK_KEYWORDS))
    if action_beats:
        pts = min(8, 4 * action_beats)
        terms.append((f"physical action beats ({action_beats})", pts)); score += pts

    sfx_beats = sum(1 for u in window if u["type"] == "sound_fx" and _word_hits(u["text"], SFX_SUSPENSE_KEYWORDS))
    if sfx_beats:
        pts = min(8, 4 * sfx_beats)
        terms.append((f"suspense sound cues ({sfx_beats})", pts)); score += pts

    excl = sum(u["text"].count("!") for u in window if u["type"] == "dialogue")
    if excl >= 2:
        pts = min(6, 2 * excl)
        terms.append((f"raised voices ({excl} '!')", pts)); score += pts

    return score, terms


def _duration_score(duration):
    """Reward windows near the ideal promo length, penalize extremes.
    Previously duration was computed but never scored at all."""
    dev = abs(duration - TARGET_DUR)
    pts = round(8 - min(14, dev * 0.5))  # +8 at ideal, decaying below zero
    if pts >= 0:
        return pts, [(f"ideal length (~{int(duration)}s)", pts)]
    return pts, [(f"off-ideal length ({int(duration)}s)", pts)]


def _boundary_penalty(first, last, prev_unit):
    """Penalize clips that start or end on a weak word — the ClipCut
    boundary-cleanliness rule. A clip that opens on 'and/but/the' or a bare
    pronoun with no prior speaker feels cut-in; one that ends on 'the/to/a'
    feels cut-off."""
    terms = []
    penalty = 0
    if first["type"] == "dialogue":
        fw = _first_word(first["text"])
        if fw in WEAK_START and (not prev_unit or not prev_unit.get("speaker")):
            terms.append(("weak start (needs prior context)", -12)); penalty += 12
    if last["type"] == "dialogue":
        lw = _last_word(last["text"])
        if lw in WEAK_END:
            terms.append(("weak ending (sentence unfinished)", -8)); penalty += 8
    return penalty, terms


def score_window(units, i, j):
    first, last = units[i], units[j]
    window = units[i:j + 1]
    duration = last["end"] - first["start"]
    trailing = [u for u in units[j + 1:] if u["start"] - last["end"] <= 2.5][:2]

    hook_val, hook_terms = _hook_score(first)
    cliff_val, cliff_terms = _cliff_score(last, trailing)
    win_val, win_terms = _window_score(window)
    dur_val, dur_terms = _duration_score(duration)
    penalty, pen_terms = _boundary_penalty(first, last, units[i - 1] if i > 0 else None)

    total = BASE_SCORE + hook_val + cliff_val + win_val + dur_val - penalty

    why_parts = []
    if hook_val >= 10:
        why_parts.append("strong opening hook")
    if cliff_val >= 10:
        why_parts.append("ends on a cliffhanger")
    if win_val >= 8:
        why_parts.append("high dramatic density")
    if not why_parts:
        why_parts.append("self-contained dramatic beat")

    return total, {
        "hook": hook_val, "hook_terms": hook_terms,
        "cliff": cliff_val, "cliff_terms": cliff_terms,
        "window": win_val, "window_terms": win_terms,
        "duration": duration, "duration_pts": dur_val, "duration_terms": dur_terms,
        "penalty": penalty, "penalty_terms": pen_terms,
        "why": ", ".join(why_parts).capitalize() + ".",
    }


def _anchor_indices(units):
    return [k for k, u in enumerate(units) if u["type"] in ("dialogue", "action")]


def _line_dict(idx, u):
    return {
        "index": idx, "start": u["start"], "end": u["end"],
        "start_tc": fmt_tc(u["start"]), "end_tc": fmt_tc(u["end"]),
        "type": u["type"], "speaker": u.get("speaker", ""),
        "text": u["text"], "emotion": u.get("emotion", ""),
    }


def find_promos(units, episode_id, cap=6):
    """Returns (chosen_promos, all_candidates).

    chosen_promos: up to `cap` non-overlapping best windows for this episode,
    each a full promo dict with a receipt, ORIGINAL timestamps, and the full
    clip script. These are what the AI judge (Tier 2) then scores.
    all_candidates: every scored window (for the cell-grid shading).
    """
    anchors = _anchor_indices(units)
    cands = []
    for ai, i in enumerate(anchors):
        for j in anchors[ai:]:
            dur = units[j]["end"] - units[i]["start"]
            if dur > HI:
                break
            if dur < LO:
                continue
            score, info = score_window(units, i, j)
            cands.append((score, i, j, info))

    cands_sorted = sorted(cands, key=lambda c: -c[0])
    chosen = []
    for score, i, j, info in cands_sorted:
        if len(chosen) >= cap:
            break
        s, e = units[i]["start"], units[j]["end"]
        if any(not (e <= units[ci]["start"] - 1 or s >= units[cj]["end"] + 1)
               for _, ci, cj, _ in chosen):
            continue
        chosen.append((score, i, j, info))

    out = []
    for rank, (score, i, j, info) in enumerate(chosen):
        hook_unit, end_unit = units[i], units[j]
        cliff_unit = end_unit
        if end_unit["type"] != "dialogue":
            for k in range(j, i - 1, -1):
                if units[k]["type"] == "dialogue":
                    cliff_unit = units[k]
                    break
        # Keep the heuristic raw (not clamped at 99) so ranking resolution
        # survives — the enriched signals legitimately push strong clips past
        # 100, and clamping them all to 99 is what destroyed the ordering.
        heuristic = round(max(1, score))
        out.append({
            "episode": episode_id,
            "promo_index": rank,
            "segments": [{"start": hook_unit["start"], "end": end_unit["end"],
                          "start_tc": fmt_tc(hook_unit["start"]), "end_tc": fmt_tc(end_unit["end"])}],
            # heuristic_score is Tier 1's number; ai_score is filled by Tier 2;
            # score (the ranking key) = heuristic + ai, set in finalize_promo.
            "heuristic_score": heuristic,
            "ai_score": 0,
            "ai": None,
            "score": heuristic,
            "hook": hook_unit["text"][:140],
            "cliffhanger": cliff_unit["text"][:140],
            "why": info["why"],
            "duration": round(info["duration"], 1),
            "info": {"hook_score": round(info["hook"]), "cliff_score": round(info["cliff"]),
                     "window_score": round(info["window"])},
            "receipt": {
                "base": BASE_SCORE,
                "hook_line_index": i,
                "hook_terms": info["hook_terms"],
                "cliff_line_index": j,
                "cliff_terms": info["cliff_terms"],
                "window_terms": info["window_terms"],
                "duration_terms": info["duration_terms"],
                "penalty": info["penalty"],
                "penalty_terms": info["penalty_terms"],
                "total": heuristic,
            },
            "line_range": [i, j],
            "transcript": [_line_dict(idx, u) for idx, u in enumerate(units[i:j + 1], start=i)],
        })
    out.sort(key=lambda c: -c["heuristic_score"])
    return out, cands


# --------------------------------------------------------------------------
# Tier 3 — finalize (suspense cut, total score) + diversity ranking
# --------------------------------------------------------------------------
def finalize_promo(promo, units):
    """Combine heuristic + AI into the ranking score and apply the suspense
    cut: if the AI flagged that this clip SPOILS a reveal, trim the window to
    end just before the reveal line so the promo withholds the answer (plan
    05 Rule 1). Re-derives timestamps/transcript if trimmed.
    """
    ai = promo.get("ai") or {}
    promo["ai_score"] = int(ai.get("ai_score", 0) or 0)

    reveal_idx = ai.get("reveal_line_index")
    withholds = ai.get("withholds_reveal", True)
    i, j = promo["line_range"]
    if reveal_idx is not None and not withholds and i <= reveal_idx <= j:
        new_j = max(i, reveal_idx - 1)
        # only accept the cut if the trimmed window is still a viable promo
        if new_j > i and (units[new_j]["end"] - units[i]["start"]) >= LO * 0.6:
            j = new_j
            promo["line_range"] = [i, j]
            end_unit = units[j]
            promo["segments"] = [{"start": units[i]["start"], "end": end_unit["end"],
                                  "start_tc": fmt_tc(units[i]["start"]), "end_tc": fmt_tc(end_unit["end"])}]
            promo["duration"] = round(end_unit["end"] - units[i]["start"], 1)
            promo["transcript"] = [_line_dict(idx, u) for idx, u in enumerate(units[i:j + 1], start=i)]
            promo["receipt"]["cliff_line_index"] = j
            promo["suspense_cut"] = True

    # Honest additive total — heuristic + AI — not capped at 99, so the
    # breakdown the editor sees (heuristic + ai = total) always adds up and
    # ranking keeps full resolution.
    promo["score"] = int(max(1, promo["heuristic_score"] + promo["ai_score"]))
    return promo


def apply_judgment(units, promos, episode_id="", meta=None, judge=None):
    """Run Tier 2 (optional AI judge) + Tier 3 (finalize) over a single
    source's promos and re-sort by total score. Used by the video/YouTube
    paths, which have one pseudo-episode and no logline/continuity — the AI
    still judges from the lines, which is what revives the signal captions
    strip out (no speaker/emotion)."""
    if judge and promos:
        items = [{"id": str(p["promo_index"]), "episode": episode_id,
                  "meta": meta or {}, "promo": p} for p in promos]
        try:
            judge(items)  # one batched call; mutates each promo's `ai`
        except Exception:
            pass
    for p in promos:
        finalize_promo(p, units)
    _normalize_scores(promos)
    promos.sort(key=lambda p: -p.get("score_raw", p["score"]))
    return promos


def _diversify(promos, top_n, per_episode_cap=2):
    """Cross-episode diversity: no single episode may monopolize the top
    list. Walk best-first, allow at most `per_episode_cap` clips per episode
    until we've filled top_n (then relax if we still have room)."""
    promos = sorted(promos, key=lambda p: -p.get("score_raw", p["score"]))
    picked, counts = [], {}
    for p in promos:
        eid = p["episode"]
        if counts.get(eid, 0) < per_episode_cap:
            picked.append(p); counts[eid] = counts.get(eid, 0) + 1
        if len(picked) >= top_n:
            break
    if len(picked) < top_n:
        for p in promos:
            if p not in picked:
                picked.append(p)
            if len(picked) >= top_n:
                break
    return picked[:top_n]


def build_episode_cells(units, chosen_promos, all_candidates):
    """One cell per unit, labeled hook/cliff/connective/candidate/outside for
    the line-grid visualization (unchanged logic from plan 04)."""
    role_by_index = {}
    best_pts_by_index = {}

    for score, i, j, info in all_candidates:
        pts = info["hook"]
        if pts > best_pts_by_index.get(i, -1):
            best_pts_by_index[i] = pts
        if i not in role_by_index:
            role_by_index[i] = "candidate"
        pts_c = info["cliff"]
        if pts_c > best_pts_by_index.get(j, -1):
            best_pts_by_index[j] = pts_c

    for p in chosen_promos:
        i = p["receipt"]["hook_line_index"]
        j = p["receipt"]["cliff_line_index"]
        role_by_index[i] = "hook"
        role_by_index[j] = "cliff"
        for k in range(i + 1, j):
            if role_by_index.get(k) not in ("hook", "cliff"):
                role_by_index[k] = "connective"

    cells = []
    for idx, u in enumerate(units):
        cells.append({
            "index": idx, "role": role_by_index.get(idx, "outside"),
            "speaker": u.get("speaker"), "type": u["type"],
            "start": u["start"], "end": u["end"],
            "text": u["text"][:160], "emotion": u.get("emotion"),
            "best_points": round(best_pts_by_index.get(idx, 0)),
        })
    return cells


def rank_all(units_by_episode, cap_per_episode=6, top_n=20, meta_by_episode=None,
             judge=None, judge_buffer=8):
    """Returns (ranked_promos, episode_cells_by_id).

    Pipeline: Tier 1 find_promos for EVERY episode -> Tier 2 `judge` (optional
    AI) for only the episodes whose best candidate lands in the global top
    (top_n + judge_buffer) by heuristic -> Tier 3 finalize (suspense cut +
    total score) -> cross-episode diversity ranking to top_n.

    Judging only the top episodes keeps the AI-call count (and rate-limit
    exposure) proportional to what can actually reach the final list — the AI
    can shift a clip by ~±30, so a buffer above top_n covers the clips that
    could still climb in. `judge` is a callable (episode_id, meta, promos) ->
    annotated promos, injected so scorer.py stays dependency-free and testable.
    """
    meta_by_episode = meta_by_episode or {}

    # Tier 1 — score every episode first.
    per_ep = {}
    heur_ranked = []
    for eid, units in units_by_episode.items():
        chosen, cands = find_promos(units, eid, cap=cap_per_episode)
        per_ep[eid] = (units, chosen, cands)
        for p in chosen:
            heur_ranked.append((p["heuristic_score"], eid, p))

    # Tier 2 — ONE batched AI call over the top (top_n + buffer) candidates
    # across all episodes. One request instead of one-per-episode is the big
    # speed win on a rate-limited tier.
    if judge:
        heur_ranked.sort(key=lambda x: -x[0])
        items = [
            {"id": f"{eid}:{p['promo_index']}", "episode": eid,
             "meta": meta_by_episode.get(eid, {}), "promo": p}
            for _score, eid, p in heur_ranked[: top_n + judge_buffer]
        ]
        try:
            judge(items)  # mutates each promo's `ai` in place
        except Exception:
            pass  # AI failure must never break the heuristic pipeline

    # Tier 3 — finalize (suspense cut + raw total) and build cells.
    all_promos = []
    episode_cells = {}
    for eid, (units, chosen, cands) in per_ep.items():
        for p in chosen:
            finalize_promo(p, units)
        all_promos.extend(chosen)
        episode_cells[str(eid)] = build_episode_cells(units, chosen, cands)

    _normalize_scores(all_promos)
    ranked = _diversify(all_promos, top_n)
    return ranked, episode_cells


def _normalize_scores(promos):
    """Map the raw additive total (heuristic + ai, which can exceed 100) onto a
    clean 0-100 scale so the best clip reads as 100 and the rest as a share of
    it — an "out of 100" the editor can reason about. `score_raw` keeps the
    real additive number for the receipt; `score` becomes the 0-100 headline."""
    if not promos:
        return
    max_raw = max(p["score"] for p in promos) or 1
    for p in promos:
        p["score_raw"] = p["score"]
        p["score"] = max(1, min(100, round(100 * p["score"] / max_raw)))
