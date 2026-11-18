"""Parses a Kuku screenplay .txt into a list of TimedUnit dicts.

Format (per the input pack):
  SCENE 01
  Scene heading: INT. CATHEDRAL - DAY
  Scene start: 00:00.00
  Scene end: 02:18.00

  Actions and dialogue:

  **CAMERA:**
  Start: (00:00.00) | End: (00:04.80)
  <description>

  **LADY JULIANA (Confused, Breathless):**
  Start: (00:13.50) | End: (00:14.30)
  "Why?"

Header labels are either a fixed type (CAMERA / ACTION / SOUND FX) or a
dialogue speaker name optionally followed by one or more parenthetical
emotion/annotation tags.
"""
import re

HEADER_RE = re.compile(r"^\*\*(.+?):\*\*$")
TIME_RE = re.compile(r"\((\d+):(\d+(?:\.\d+)?)\)")
SCENE_RE = re.compile(r"^SCENE\s+(\S+)")
FIXED_TYPES = {"CAMERA", "ACTION", "SOUND FX"}


def _parse_time(mm, ss):
    return int(mm) * 60 + float(ss)


def _classify_label(label):
    """Returns (speaker, emotion, type) for a header label."""
    if label in FIXED_TYPES:
        return None, None, label.lower().replace(" ", "_")
    parens = re.findall(r"\(([^)]*)\)", label)
    speaker = re.sub(r"\s*\(.*", "", label).strip()
    tags = [p.strip() for p in parens if p.strip().upper() not in ("O.S.", "V.O.")]
    emotion = ", ".join(tags) if tags else None
    return speaker, emotion, "dialogue"


def parse_episode(text, episode_id):
    """Parses one episode's raw .txt content into a list of TimedUnit dicts."""
    lines = text.splitlines()
    units = []
    scene_num = None
    i, n = 0, len(lines)
    while i < n:
        line = lines[i].strip()
        m = SCENE_RE.match(line)
        if m:
            scene_num = m.group(1)
            i += 1
            continue
        hm = HEADER_RE.match(line)
        if not hm:
            i += 1
            continue
        label = hm.group(1).strip()
        i += 1
        if i >= n:
            break
        times = TIME_RE.findall(lines[i])
        if len(times) < 2:
            continue
        start = _parse_time(*times[0])
        end = _parse_time(*times[1])
        i += 1
        content = []
        while i < n:
            nxt = lines[i].strip()
            if not nxt or HEADER_RE.match(nxt) or SCENE_RE.match(nxt) or nxt.startswith("---"):
                break
            content.append(nxt)
            i += 1
        text_content = " ".join(content).strip().strip('"')
        speaker, emotion, utype = _classify_label(label)
        units.append({
            "episode": episode_id, "scene": scene_num, "type": utype,
            "speaker": speaker, "emotion": emotion, "text": text_content,
            "start": round(start, 2), "end": round(end, 2),
        })
    return units


def episode_id_from_text(text, fallback):
    m = re.search(r"EPISODE NUMBER:\s*Episode\s*(\d+)", text)
    return int(m.group(1)) if m else fallback


def parse_folder(folder_path):
    """Parses every episode-*.txt in a folder. Returns {episode_id: [units]}."""
    import os
    out = {}
    for fname in sorted(os.listdir(folder_path)):
        if not fname.endswith(".txt"):
            continue
        with open(os.path.join(folder_path, fname), encoding="utf-8") as f:
            text = f.read()
        fallback = len(out) + 1
        eid = episode_id_from_text(text, fallback)
        out[eid] = parse_episode(text, eid)
    return out
