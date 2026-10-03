"""
analyzer.py — crossover extraction from cadnano_json vstrands.

A crossover exists between helix A and helix B whenever a strand at
position (A, i) has its outgoing pointer set to helix B:
    stap[i] = [..., B, j] with B != A and B != -1  (likewise for scaf)

Each physical crossover is recorded exactly once — from the departure
side — so no division by 2 is needed.
"""

from __future__ import annotations
from collections import defaultdict


def extract_crossovers(vstrands: list[dict]) -> dict[tuple[int, int], dict[str, int]]:
    """
    Returns a dict keyed by (min_vh, max_vh) with values {"scaf": int, "stap": int}.
    """
    counts: dict = defaultdict(lambda: {"scaf": 0, "stap": 0})

    for vs in vstrands:
        vh = vs["num"]
        for strand_key in ("scaf", "stap"):
            for entry in vs.get(strand_key, []):
                to_vh = entry[2]
                if to_vh != -1 and to_vh != vh:
                    pair = (min(vh, to_vh), max(vh, to_vh))
                    counts[pair][strand_key] += 1

    return dict(counts)
