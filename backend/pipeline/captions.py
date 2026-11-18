"""Turns a WebVTT caption file into TimedUnit dicts the scorer already
understands (same shape parser.py produces from screenplays, minus
speaker/emotion/scene — captions don't carry those).
"""
import re

TS_RE = re.compile(r"(\d+:\d+:\d+\.\d+|\d+:\d+\.\d+)\s*-->\s*(\d+:\d+:\d+\.\d+|\d+:\d+\.\d+)")
TAG_RE = re.compile(r"<[^>]+>")


def _to_seconds(ts):
    parts = ts.split(":")
    if len(parts) == 3:
        h, m, s = parts
    else:
        h = "0"
        m, s = parts
    return int(h) * 3600 + int(m) * 60 + float(s)


def parse_vtt(text):
    """Returns a de-duplicated, time-sorted list of {start, end, text} cues."""
    lines = text.splitlines()
    cues = []
    i, n = 0, len(lines)
    while i < n:
        m = TS_RE.search(lines[i])
        if not m:
            i += 1
            continue
        start, end = _to_seconds(m.group(1)), _to_seconds(m.group(2))
        i += 1
        content = []
        while i < n and lines[i].strip():
            content.append(TAG_RE.sub("", lines[i]).strip())
            i += 1
        joined = " ".join(c for c in content if c).strip()
        if joined:
            cues.append({"start": start, "end": end, "text": joined})

    cues.sort(key=lambda c: c["start"])
    deduped = []
    for c in cues:
        if deduped:
            prev = deduped[-1]
            same_text = c["text"].strip().lower() == prev["text"].strip().lower()
            if same_text and c["start"] - prev["start"] < 5:
                continue
        deduped.append(c)
    return deduped


def cues_to_units(cues, source_id="youtube"):
    return [
        {
            "episode": source_id, "scene": None, "type": "dialogue",
            "speaker": None, "emotion": None, "text": c["text"],
            "start": round(c["start"], 2), "end": round(c["end"], 2),
        }
        for c in cues
    ]
