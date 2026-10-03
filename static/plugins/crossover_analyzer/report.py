"""
report.py — CSV formatting and summary statistics for crossover data.
"""

from __future__ import annotations
import io
import csv


def build_csv(
    crossovers: dict[tuple[int, int], dict[str, int]],
    vh_row_col: dict[int, tuple[int, int]],
) -> str:
    """CSV with columns: vh_a, vh_b, row_a, col_a, row_b, col_b, scaf_xovers, stap_xovers, total_xovers"""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "vh_a", "vh_b",
        "row_a", "col_a", "row_b", "col_b",
        "scaf_xovers", "stap_xovers", "total_xovers",
    ])
    for (vh_a, vh_b), counts in sorted(crossovers.items()):
        row_a, col_a = vh_row_col.get(vh_a, (-1, -1))
        row_b, col_b = vh_row_col.get(vh_b, (-1, -1))
        scaf = counts["scaf"]
        stap = counts["stap"]
        writer.writerow([vh_a, vh_b, row_a, col_a, row_b, col_b, scaf, stap, scaf + stap])
    return buf.getvalue()


def build_summary(
    crossovers: dict[tuple[int, int], dict[str, int]],
    n_helices: int,
) -> dict:
    """Aggregate statistics suitable for ctx.set_result()."""
    if not crossovers:
        return {
            "helix_count": n_helices,
            "connected_pairs": 0,
            "total_scaf_xovers": 0,
            "total_stap_xovers": 0,
            "total_xovers": 0,
            "max_xovers_pair": None,
        }

    total_scaf = sum(c["scaf"] for c in crossovers.values())
    total_stap = sum(c["stap"] for c in crossovers.values())
    max_key, max_counts = max(
        crossovers.items(), key=lambda kv: kv[1]["scaf"] + kv[1]["stap"]
    )

    return {
        "helix_count": n_helices,
        "connected_pairs": len(crossovers),
        "total_scaf_xovers": total_scaf,
        "total_stap_xovers": total_stap,
        "total_xovers": total_scaf + total_stap,
        "max_xovers_pair": {
            "vh_a": max_key[0],
            "vh_b": max_key[1],
            "scaf": max_counts["scaf"],
            "stap": max_counts["stap"],
        },
    }
