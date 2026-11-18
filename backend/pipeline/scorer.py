"""Rule-based promo scorer. No LLM, no network calls — pure text/timing
signals pulled from the screenplay's own structure (see plan 01 section 4).

Modeled on ClipCut's pick.py sliding-window approach, adapted to script-
native signals (emotion tags, ACTION/CAMERA/SOUND FX cues) instead of
audio energy.
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


def _text_hits(text, keywords):
    low = text.lower()
    return sum(1 for k in keywords if k in low)


def _starts_clean(unit, prev_unit):
    if unit["type"] != "dialogue":
        return True
    first_word = re.sub(r"[^a-z]", "", unit["text"].split(" ")[0].lower()) if unit["text"] else ""
    if first_word in WEAK_PRONOUN_START:
        # allow if the previous unit already named someone (gives it context)
        if not prev_unit or not prev_unit.get("speaker"):
            return False
    return True


def _hook_score(unit):
    score = 0.0
    if unit["type"] == "dialogue":
        if "?" in unit["text"]:
            score += 10
        score += min(15, 6 * _text_hits(unit["text"], HOOK_KEYWORDS))
        if unit.get("emotion"):
            score += min(12, 4 * _text_hits(unit["emotion"], EMOTION_HOOK_WORDS))
        if len(unit["text"].split()) <= 8:
            score += 4
    elif unit["type"] == "action":
        score += min(16, 8 * _text_hits(unit["text"], ACTION_HOOK_KEYWORDS))
    return score


def _cliff_score(last_unit, trailing_units):
    score = 0.0
    if last_unit["type"] == "dialogue":
        t = last_unit["text"].strip()
        if t.endswith("?") or t.endswith("..."):
            score += 10
        score += min(12, 5 * _text_hits(t, CLIFF_KEYWORDS))
    for u in trailing_units:
        low = u["text"].lower()
        if "cut to black" in low:
            score += 14
        if u["type"] == "sound_fx":
            score += min(10, 5 * _text_hits(low, CLIFF_SFX_KEYWORDS)) or 4
    return score


def score_window(units, i, j):
    first, last = units[i], units[j]
    duration = last["end"] - first["start"]
    trailing = [u for u in units[j + 1:] if u["start"] - last["end"] <= 2.5][:2]
    hook = _hook_score(first)
    cliff = _cliff_score(last, trailing)
    standalone_penalty = 0 if _starts_clean(first, units[i - 1] if i > 0 else None) else 15
    total = 40 + hook + cliff - standalone_penalty
    why_parts = []
    if hook >= 10:
        why_parts.append("strong opening hook")
    if cliff >= 10:
        why_parts.append("ends on a real cliffhanger")
    if not why_parts:
        why_parts.append("self-contained dramatic beat")
    return total, {"hook": hook, "cliff": cliff, "duration": duration,
                   "why": ", ".join(why_parts).capitalize() + "."}


def _anchor_indices(units):
    return [k for k, u in enumerate(units) if u["type"] in ("dialogue", "action")]


def find_promos(units, episode_id, cap=5):
    """Finds the best single-continuous-window promos in one episode's units."""
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
    cands.sort(key=lambda c: -c[0])
    chosen = []
    for score, i, j, info in cands:
        if len(chosen) >= cap:
            break
        s, e = units[i]["start"], units[j]["end"]
        if any(not (e <= units[ci]["start"] - 1 or s >= units[cj]["end"] + 1) for _, ci, cj, _ in chosen):
            continue
        chosen.append((score, i, j, info))
    out = []
    for score, i, j, info in chosen:
        hook_unit, end_unit = units[i], units[j]
        cliff_unit = end_unit
        if end_unit["type"] != "dialogue":
            for k in range(j, i - 1, -1):
                if units[k]["type"] == "dialogue":
                    cliff_unit = units[k]
                    break
        out.append({
            "episode": episode_id,
            "segments": [{"start": hook_unit["start"], "end": end_unit["end"]}],
            "score": round(min(99, max(1, score))),
            "hook": hook_unit["text"][:140],
            "cliffhanger": cliff_unit["text"][:140],
            "why": info["why"],
            "duration": round(info["duration"], 1),
        })
    out.sort(key=lambda c: -c["score"])
    return out


def rank_all(units_by_episode, cap_per_episode=5, top_n=20):
    """Runs find_promos across every episode and returns the globally ranked list."""
    all_promos = []
    for eid, units in units_by_episode.items():
        all_promos.extend(find_promos(units, eid, cap=cap_per_episode))
    all_promos.sort(key=lambda p: -p["score"])
    return all_promos[:top_n]
