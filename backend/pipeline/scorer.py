"""Rule-based promo scorer with term-level score attribution.

Totals are unchanged from the earlier version — every point still comes
from the same rule — but the scoring functions now also return the
specific terms that fired, so the UI can show a literal receipt instead
of just a number (plan 04 §2).

Modeled on ClipCut's pick.py sliding-window approach, adapted to script-
native signals (emotion tags, ACTION/CAMERA/SOUND FX cues).
"""
import re

LO, HI = 20.0, 60.0

HOOK_KEYWORDS = [
    "secret", "truth", "lied", "lying", "pregnant", "affair", "betray",
    "never", "always", "mistake", "shocking", "duke", "marry", "divorce",
    "dead", "dying", "kill", "blood", "inherit", "disown", "disinherit",
    "stop", "wait", "no!", "why", "how dare", "how could you",
]
ACTION_HOOK_KEYWORDS = [
    "slap", "slaps", "grips", "grabs", "drops", "collapses", "gasps",
    "screams", "strikes", "shoves", "pulls", "clenches", "staggers",
]
EMOTION_HOOK_WORDS = [
    "shocked", "devastated", "furious", "betrayed", "outraged", "gasping",
    "horrified", "trembling", "desperate", "stricken", "heartbroken",
]
CLIFF_KEYWORDS = [
    "secret", "truth", "pregnant", "dead", "marry", "divorce", "kill",
    "lied", "mistake", "never", "enough", "choose", "disown", "duke",
]
CLIFF_SFX_KEYWORDS = ["cliffhanger", "ominous", "swell", "dread", "tense"]
WEAK_PRONOUN_START = {"he", "she", "they", "it", "him", "her", "them"}

BASE_SCORE = 40
STANDALONE_PENALTY = 15


def _text_hits(text, keywords):
    low = text.lower()
    return [k for k in keywords if k in low]


def _starts_clean(unit, prev_unit):
    if unit["type"] != "dialogue":
        return True
    first_word = re.sub(r"[^a-z]", "", unit["text"].split(" ")[0].lower()) if unit["text"] else ""
    if first_word in WEAK_PRONOUN_START:
        if not prev_unit or not prev_unit.get("speaker"):
            return False
    return True


def _hook_score(unit):
    """Returns (score, [(term, points), ...]) — the terms list is the
    literal receipt: which rule fired, for how many points."""
    terms = []
    score = 0.0
    if unit["type"] == "dialogue":
        if "?" in unit["text"]:
            terms.append(("ends with '?'", 10))
            score += 10
        hits = _text_hits(unit["text"], HOOK_KEYWORDS)
        if hits:
            pts = min(15, 6 * len(hits))
            terms.append((f"hook word: {', '.join(hits)}", pts))
            score += pts
        if unit.get("emotion"):
            ehits = _text_hits(unit["emotion"], EMOTION_HOOK_WORDS)
            if ehits:
                pts = min(12, 4 * len(ehits))
                terms.append((f"emotion: {', '.join(ehits)}", pts))
                score += pts
        if len(unit["text"].split()) <= 8:
            terms.append(("brevity (≤8 words)", 4))
            score += 4
    elif unit["type"] == "action":
        ahits = _text_hits(unit["text"], ACTION_HOOK_KEYWORDS)
        if ahits:
            pts = min(16, 8 * len(ahits))
            terms.append((f"action verb: {', '.join(ahits)}", pts))
            score += pts
    return score, terms


def _cliff_score(last_unit, trailing_units):
    terms = []
    score = 0.0
    if last_unit["type"] == "dialogue":
        t = last_unit["text"].strip()
        if t.endswith("?"):
            terms.append(("ends with '?'", 10))
            score += 10
        elif t.endswith("..."):
            terms.append(("ends with '...'", 10))
            score += 10
        chits = _text_hits(t, CLIFF_KEYWORDS)
        if chits:
            pts = min(12, 5 * len(chits))
            terms.append((f"cliff word: {', '.join(chits)}", pts))
            score += pts
    for u in trailing_units:
        low = u["text"].lower()
        if "cut to black" in low:
            terms.append(("'cut to black' tag", 14))
            score += 14
        if u["type"] == "sound_fx":
            sfx = _text_hits(low, CLIFF_SFX_KEYWORDS)
            if sfx:
                pts = min(10, 5 * len(sfx))
                terms.append((f"SFX cue: {', '.join(sfx)}", pts))
                score += pts
            else:
                terms.append(("SFX tag present", 4))
                score += 4
    return score, terms


def score_window(units, i, j):
    first, last = units[i], units[j]
    duration = last["end"] - first["start"]
    trailing = [u for u in units[j + 1:] if u["start"] - last["end"] <= 2.5][:2]
    hook_val, hook_terms = _hook_score(first)
    cliff_val, cliff_terms = _cliff_score(last, trailing)
    clean = _starts_clean(first, units[i - 1] if i > 0 else None)
    penalty = 0 if clean else STANDALONE_PENALTY
    total = BASE_SCORE + hook_val + cliff_val - penalty

    why_parts = []
    if hook_val >= 10:
        why_parts.append("strong opening hook")
    if cliff_val >= 10:
        why_parts.append("ends on a real cliffhanger")
    if not why_parts:
        why_parts.append("self-contained dramatic beat")

    return total, {
        "hook": hook_val, "hook_terms": hook_terms,
        "cliff": cliff_val, "cliff_terms": cliff_terms,
        "duration": duration, "penalty": penalty,
        "why": ", ".join(why_parts).capitalize() + ".",
    }


def _anchor_indices(units):
    return [k for k, u in enumerate(units) if u["type"] in ("dialogue", "action")]


def find_promos(units, episode_id, cap=5):
    """Returns (chosen_promos, all_candidates). all_candidates kept so the
    cell grid can shade lines by *best candidate that touched them*, not
    only by whichever windows we finally picked."""
    anchors = _anchor_indices(units)
    cands = []
    for ai, i in enumerate(anchors):
        for j in anchors[ai:]:
            if units[j]["end"] - units[i]["start"] > HI:
                break
            if units[j]["end"] - units[i]["start"] < LO:
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
        out.append({
            "episode": episode_id,
            "promo_index": rank,
            "segments": [{"start": hook_unit["start"], "end": end_unit["end"]}],
            "score": round(min(99, max(1, score))),
            "hook": hook_unit["text"][:140],
            "cliffhanger": cliff_unit["text"][:140],
            "why": info["why"],
            "duration": round(info["duration"], 1),
            "info": {"hook_score": round(info["hook"]), "cliff_score": round(info["cliff"])},
            "receipt": {
                "base": BASE_SCORE,
                "hook_line_index": i,
                "hook_terms": info["hook_terms"],
                "cliff_line_index": j,
                "cliff_terms": info["cliff_terms"],
                "penalty": info["penalty"],
                "total": round(info["hook"] + info["cliff"] + BASE_SCORE - info["penalty"]),
            },
            "line_range": [i, j],
            "transcript": [
                {"index": idx, "start": u["start"], "end": u["end"], "type": u["type"],
                 "speaker": u.get("speaker", ""), "text": u["text"],
                 "emotion": u.get("emotion", "")}
                for idx, u in enumerate(units[i:j + 1], start=i)
            ],
        })
    out.sort(key=lambda c: -c["score"])
    return out, cands


def build_episode_cells(units, chosen_promos, all_candidates):
    """One cell per unit. Role:
      - 'hook'       : this line is the hook line of some chosen promo
      - 'cliff'      : this line is the cliff line of some chosen promo
      - 'connective' : inside a chosen window but not its hook/cliff
      - 'candidate'  : not in any chosen window, but WAS the hook of some
                       scored-but-dropped candidate (so you can still see
                       "the scorer liked this line, but the window around
                       it overlapped a higher pick")
      - 'outside'    : scorer never considered this line a hook
    Also attaches best_candidate_score so the cell can glow in proportion
    to how much the scorer liked this line, not just whether it 'won'.
    """
    role_by_index = {}
    best_pts_by_index = {}

    # Pass 1: every candidate's hook line gets its hook_terms points attributed.
    # This is why some lines "score" even when they're not in a final promo.
    for score, i, j, info in all_candidates:
        pts = info["hook"]
        if pts > best_pts_by_index.get(i, -1):
            best_pts_by_index[i] = pts
        if i not in role_by_index:
            role_by_index[i] = "candidate"
        pts_c = info["cliff"]
        if pts_c > best_pts_by_index.get(j, -1):
            best_pts_by_index[j] = pts_c

    # Pass 2: chosen promos override with the stronger role labels.
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
            "index": idx,
            "role": role_by_index.get(idx, "outside"),
            "speaker": u.get("speaker"),
            "type": u["type"],
            "start": u["start"],
            "end": u["end"],
            "text": u["text"][:160],
            "emotion": u.get("emotion"),
            "best_points": round(best_pts_by_index.get(idx, 0)),
        })
    return cells


def rank_all(units_by_episode, cap_per_episode=5, top_n=20):
    """Returns (ranked_promos, episode_cells_by_id).
    episode_cells_by_id covers every unit of every episode — the cell
    grid's data source.
    """
    all_promos = []
    episode_cells = {}
    for eid, units in units_by_episode.items():
        chosen, cands = find_promos(units, eid, cap=cap_per_episode)
        all_promos.extend(chosen)
        episode_cells[str(eid)] = build_episode_cells(units, chosen, cands)
    all_promos.sort(key=lambda p: -p["score"])
    return all_promos[:top_n], episode_cells
