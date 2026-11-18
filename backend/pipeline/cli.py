"""Standalone entry point: parse a script folder, score, rank, dump JSON.

Usage: python3 cli.py <script_folder> [top_n]
Also importable as run(folder, top_n) -> dict, used by the Vercel function.
"""
import json
import sys

from parser import parse_folder
from scorer import rank_all


def run(folder, top_n=20, cap_per_episode=5):
    units_by_episode = parse_folder(folder)
    top = rank_all(units_by_episode, cap_per_episode=cap_per_episode, top_n=top_n)
    return {
        "episode_count": len(units_by_episode),
        "unit_count": sum(len(u) for u in units_by_episode.values()),
        "promo_count": len(top),
        "promos": top,
    }


if __name__ == "__main__":
    folder = sys.argv[1]
    top_n = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    result = run(folder, top_n=top_n)
    print(json.dumps(result, indent=2))
