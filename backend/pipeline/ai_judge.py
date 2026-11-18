"""Tier 2 — the additive AI judgment layer (plan 05).

The heuristic (scorer.py) generates and scores candidates. This module asks
an LLM to JUDGE each candidate as a promo and returns a signed `ai_score`
that gets ADDED to the heuristic score (total = heuristic + ai). The LLM also
reports WHERE the twist/secret is revealed, so Tier 3 can cut the clip before
the reveal (suspense preservation).

Providers (first configured one wins):
  1. Qwen via Groq — any OpenAI-compatible chat/completions endpoint
     (QWEN_BASE_URL + QWEN_API_KEY + QWEN_MODEL).
  2. Native Anthropic Messages API (ANTHROPIC_API_KEY [+ KUKU_JUDGE_MODEL]).

Design constraints:
  * LLM only. No embeddings, no other ML.
  * Dependency-free: talks to both endpoints over stdlib HTTPS — no SDK.
  * Graceful: get_judge() returns None when no provider is configured, and
    any per-episode failure leaves that episode's clips on their heuristic
    score.
  * The LLM reads OUR heuristic receipt too — it judges with our scoring in
    hand, exactly as specified.
"""
import json
import os
import re
import time
import urllib.request
import urllib.error

TIMEOUT_S = 45
MAX_LINES_PER_CANDIDATE = 12
MAX_LINE_CHARS = 110
# Free Groq tier caps input at 7000 tokens/MINUTE and refills at only ~117
# tokens/sec, so a near-7k request can never accumulate enough headroom
# between retries. Keep one batched request well under that — ~3300 tokens
# (~10k chars) refills in ~30s and fits a full bucket immediately.
MAX_PROMPT_CHARS = 10000
# Groq sits behind Cloudflare, which 403s (error 1010) the default
# "Python-urllib/x" User-Agent. A normal client UA is accepted, same as curl.
USER_AGENT = "kuku-promo-finder/1.0 (+https://github.com/)"

SYSTEM_PROMPT = (
    "You are an expert promo editor for a vertical microdrama series (think "
    "Reels/Shorts cliffhanger promos). You are given candidate clips already "
    "pre-scored by a heuristic. Your job is to judge each one as a PROMO whose "
    "only purpose is to make a viewer NEED the next episode.\n\n"
    "Judge on: hook strength in the first 1-2 lines; emotional stakes, "
    "conflict, or humor; and above all CLIFFHANGER PULL. A promo must NOT "
    "resolve its own tension: if the clip reveals the twist, secret, or answer, "
    "it is a WEAK promo, because a viewer who already knows the answer won't "
    "watch on. Identify the line where the reveal/payoff lands.\n\n"
    "Do not reward a clip merely for containing a question mark or a dramatic "
    "word — judge whether it actually works as a standalone teaser.\n\n"
    "Return ONLY a JSON array, one object per candidate, no prose, no "
    "explanation outside the JSON:\n"
    '[{"id": "<id>", "virality": 0-100, "verdict": "strong|ok|weak|spoils_reveal", '
    '"promo_type": "cliffhanger|emotional|twist|humor|suspense", '
    '"reveal_line_index": <int or null>, "withholds_reveal": true|false, '
    '"reason": "<one sentence>"}]'
)


# --------------------------------------------------------------------------
# .env loader (no python-dotenv dependency)
# --------------------------------------------------------------------------
def load_env(path=None):
    """Load KEY=VALUE lines from backend/.env into os.environ (without
    overriding anything already set in the real environment)."""
    if path is None:
        here = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(here, os.pardir, ".env")
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except FileNotFoundError:
        pass


# --------------------------------------------------------------------------
# Prompt construction
# --------------------------------------------------------------------------
def _format_candidate(gid, promo):
    """Compact form — dialogue/action lines only (camera/SFX descriptions are
    verbose and rarely change the promo judgment), each truncated. Keeps the
    batched prompt under the tight free-tier token budget."""
    lines = []
    for ln in promo["transcript"]:
        if ln["type"] not in ("dialogue", "action"):
            continue
        who = ln.get("speaker") or ("ACTION" if ln["type"] == "action" else "")
        emo = f"({ln['emotion']})" if ln.get("emotion") else ""
        txt = ln["text"][:MAX_LINE_CHARS]
        lines.append(f"  [{ln['index']}] {ln['start_tc']} {who}{emo}: {txt}")
        if len(lines) >= MAX_LINES_PER_CANDIDATE:
            break
    return (f'CLIP id="{gid}" (h={promo["heuristic_score"]}, {promo["duration"]}s)\n'
            + "\n".join(lines))


INTRO = (
    "The logline/continuity for each episode tell you its arc and where its "
    "secret or twist lies — use them to spot clips that would spoil it. Judge "
    "EVERY clip below (line indices are the script's own; timestamps mm:ss). "
    "Return one JSON object per clip, echoing its exact id.\n\n"
)


def _build_batch_prompt(items, char_budget=MAX_PROMPT_CHARS):
    """Build ONE prompt covering as many top candidates as fit in the token
    budget. `items` must be pre-sorted best-first; candidates are grouped
    under their episode (logline stated once) and added until the budget is
    reached. Returns (prompt, included_ids)."""
    blocks = []
    included = []
    seen_ep = set()
    size = len(INTRO)
    for it in items:
        eid = it["episode"]
        head = ""
        if eid not in seen_ep:
            head = f"=== EPISODE {eid} ==="
            if it["meta"].get("logline"):
                head += f"\nLOGLINE: {it['meta']['logline'][:220]}"
            if it["meta"].get("continuity"):
                head += f"\nCONTINUITY: {it['meta']['continuity'][:160]}"
            head += "\n\n"
        cand = _format_candidate(it["id"], it["promo"])
        chunk = head + cand + "\n\n"
        if size + len(chunk) > char_budget and included:
            break
        blocks.append(chunk)
        included.append(it["id"])
        seen_ep.add(eid)
        size += len(chunk)
    return INTRO + "".join(blocks), set(included)


# --------------------------------------------------------------------------
# Provider calls (stdlib HTTPS)
# --------------------------------------------------------------------------
MAX_RETRIES = 4
RETRY_CAP_S = 25


def _urlopen_json(req):
    """urlopen with retry on 429/5xx, honoring Retry-After. Free Groq tiers
    throttle hard (one call then a ~15s cooldown), so without this most of a
    50-episode run would silently fall back to heuristic-only."""
    last = None
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 500, 502, 503, 529) and attempt < MAX_RETRIES - 1:
                ra = e.headers.get("retry-after")
                try:
                    wait = min(RETRY_CAP_S, float(ra)) if ra else min(RETRY_CAP_S, 2 ** attempt)
                except ValueError:
                    wait = min(RETRY_CAP_S, 2 ** attempt)
                time.sleep(wait + 0.5)
                continue
            raise
    raise last


def _call_openai_compatible(base_url, api_key, model, system, user):
    """Groq / Qwen / any OpenAI-compatible /chat/completions endpoint."""
    url = base_url.rstrip("/") + "/chat/completions"
    payload = json.dumps({
        "model": model,
        "temperature": 0.2,
        "max_tokens": 2048,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("content-type", "application/json")
    req.add_header("authorization", f"Bearer {api_key}")
    req.add_header("user-agent", USER_AGENT)
    data = _urlopen_json(req)
    return data["choices"][0]["message"]["content"]


def _call_anthropic(api_key, model, system, user):
    url = "https://api.anthropic.com/v1/messages"
    payload = json.dumps({
        "model": model, "max_tokens": 2048, "temperature": 0.2,
        "system": system, "messages": [{"role": "user", "content": user}],
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("content-type", "application/json")
    req.add_header("x-api-key", api_key)
    req.add_header("anthropic-version", "2023-06-01")
    req.add_header("user-agent", USER_AGENT)
    data = _urlopen_json(req)
    parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    return "".join(parts)


def _resolve_provider():
    """Return a (name, call) where call(system, user) -> text, or None."""
    qwen_key = os.environ.get("QWEN_API_KEY")
    if qwen_key:
        base = os.environ.get("QWEN_BASE_URL", "https://api.groq.com/openai/v1")
        model = os.environ.get("QWEN_MODEL", "qwen/qwen3.8-27b")
        return ("qwen", lambda s, u: _call_openai_compatible(base, qwen_key, model, s, u))
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        model = os.environ.get("KUKU_JUDGE_MODEL", "claude-haiku-4-5-20251001")
        return ("anthropic", lambda s, u: _call_anthropic(anthropic_key, model, s, u))
    return None


# --------------------------------------------------------------------------
# Response parsing + scoring
# --------------------------------------------------------------------------
def _parse_response(text):
    # Some reasoning models wrap output in <think>...</think>; strip it, then
    # grab the JSON array.
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        return []
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return []


def _ai_score_from(verdict, virality):
    """Map the model's 0-100 virality into a SIGNED additive adjustment, so a
    great promo lifts the total and a weak/spoiling one drags it down without
    the AI swamping the heuristic. Range roughly -30..+25."""
    try:
        virality = float(virality)
    except (TypeError, ValueError):
        virality = 50.0
    base = round((virality - 50) * 0.5)  # -25..+25
    if verdict == "spoils_reveal":
        base -= 15
    elif verdict == "weak":
        base -= 6
    return max(-30, min(25, base))


def _attach(promo, v):
    virality = v.get("virality", 50)
    verdict = v.get("verdict", "ok")
    promo["ai"] = {
        "virality": virality,
        "verdict": verdict,
        "promo_type": v.get("promo_type"),
        "reveal_line_index": v.get("reveal_line_index"),
        "withholds_reveal": bool(v.get("withholds_reveal", True)),
        "reason": v.get("reason", ""),
        "ai_score": _ai_score_from(verdict, virality),
    }


def judge_clips(items, call):
    """Judge a batch of candidates in ONE API call.

    items: [{"id": <global id>, "episode": <eid>, "meta": {...}, "promo": <dict>}]
    Mutates each promo in place with its `ai` verdict, matched back by id.
    """
    if not items:
        return items
    prompt, included = _build_batch_prompt(items)
    raw = call(SYSTEM_PROMPT, prompt)
    verdicts = {str(v.get("id")): v for v in _parse_response(raw)}
    for it in items:
        if it["id"] not in included:
            continue
        v = verdicts.get(str(it["id"]))
        if v:
            _attach(it["promo"], v)
    return items


def get_judge():
    """Returns a batch judge callable (items) -> items, or None if no provider
    is configured. items is a list of {"id","episode","meta","promo"}. One API
    call judges them all. Best-effort: a failure leaves promos on their
    heuristic score."""
    load_env()
    provider = _resolve_provider()
    if not provider:
        return None
    _name, call = provider

    def _judge(items):
        try:
            return judge_clips(items, call)
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, json.JSONDecodeError):
            return items
    return _judge


def judge_name():
    """Which provider is active (for diagnostics), or None."""
    load_env()
    p = _resolve_provider()
    return p[0] if p else None
