"""Standalone entry point: parse a script folder, score, rank, dump JSON.

Usage: python3 cli.py <script_folder> [top_n]
Also importable as run(folder, top_n) -> dict, used by the Vercel function.
"""
import json
import sys

from parser import parse_folder
from scorer import rank_all

try:
    from ai_judge import get_judge
except Exception:  # pragma: no cover - ai_judge optional
    get_judge = lambda: None  # noqa: E731


def run(folder, top_n=20, cap_per_episode=6, use_ai=True):
    units_by_episode, meta_by_episode = parse_folder(folder)
    judge = get_judge() if use_ai else None
    top, cells_by_ep = rank_all(
        units_by_episode, cap_per_episode=cap_per_episode, top_n=top_n,
        meta_by_episode=meta_by_episode, judge=judge,
    )
    return {
        "episode_count": len(units_by_episode),
        "unit_count": sum(len(u) for u in units_by_episode.values()),
        "promo_count": len(top),
        "ai_enabled": judge is not None,
        "promos": top,
        "episode_cells": cells_by_ep,
    }


if __name__ == "__main__":
    folder = sys.argv[1]
    top_n = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    result = run(folder, top_n=top_n)
    print(json.dumps(result, indent=2))
