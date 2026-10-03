"""
Design Statistics Plugin
========================
Analyses a cadnano design and reports per-helix occupancy statistics,
nearest-neighbour distances in the helix grid, and a GC-content estimate
for a random scaffold sequence.

When cadnano JSON input is available (Phase 4+), it analyses the real
design.  When run without input it generates a synthetic honeycomb-style
dataset so you can try the plugin before Phase 4 integration is complete.

Requires: numpy
"""

from __future__ import annotations

import json
import numpy as np

from foldnano.plugin import PluginContext


# ---------------------------------------------------------------------------
# Grid analysis
# ---------------------------------------------------------------------------

def analyse_helix_grid(vstrands: list[dict]) -> dict:
    """
    Return spatial statistics for the helix grid.

    Computes:
    - row / col bounding box
    - mean and std of nearest-neighbour lattice distances
    - bounding-box area utilisation (fraction of bbox cells occupied)
    """
    if not vstrands:
        return {"num_helices": 0}

    rows = np.array([v["row"] for v in vstrands], dtype=float)
    cols = np.array([v["col"] for v in vstrands], dtype=float)
    coords = np.column_stack([rows, cols])          # (N, 2)

    # Pairwise Euclidean distances in row/col space
    diffs = coords[:, None, :] - coords[None, :, :]   # (N, N, 2)
    dists = np.sqrt(np.sum(diffs ** 2, axis=-1))       # (N, N)
    np.fill_diagonal(dists, np.inf)
    nn_dists = dists.min(axis=1)                        # (N,)

    row_span = int(rows.max() - rows.min()) + 1
    col_span = int(cols.max() - cols.min()) + 1
    bbox_cells = row_span * col_span

    return {
        "num_helices": len(vstrands),
        "row_range": [int(rows.min()), int(rows.max())],
        "col_range": [int(cols.min()), int(cols.max())],
        "nn_dist_mean": round(float(np.mean(nn_dists)), 3),
        "nn_dist_std":  round(float(np.std(nn_dists)),  3),
        "bbox_utilisation": round(len(vstrands) / bbox_cells, 3),
    }


# ---------------------------------------------------------------------------
# Strand occupancy
# ---------------------------------------------------------------------------

_EMPTY = np.array([-1, -1, -1, -1])


def _occupied(strand_data: list[list[int]]) -> int:
    """Count positions that are not the sentinel [-1,-1,-1,-1]."""
    if not strand_data:
        return 0
    arr = np.array(strand_data, dtype=int)   # (L, 4)
    return int(np.sum(~np.all(arr == _EMPTY, axis=1)))


def analyse_strand_occupancy(vstrands: list[dict]) -> dict:
    """
    Per-helix scaffold and staple occupancy, then aggregate statistics.
    Returns a dict with per-helix list and summary numpy-derived stats.
    """
    per_helix = []
    for i, vh in enumerate(vstrands):
        s_occ = _occupied(vh.get("scaf", []))
        t_occ = _occupied(vh.get("stap", []))
        per_helix.append({
            "helix": i,
            "row": vh.get("row", 0),
            "col": vh.get("col", 0),
            "scaf_occ": s_occ,
            "stap_occ": t_occ,
            "total":    s_occ + t_occ,
        })

    if not per_helix:
        return {"per_helix": []}

    scaf = np.array([h["scaf_occ"] for h in per_helix], dtype=float)
    stap = np.array([h["stap_occ"] for h in per_helix], dtype=float)

    return {
        "per_helix":    per_helix,
        "scaf_total":   int(scaf.sum()),
        "stap_total":   int(stap.sum()),
        "scaf_mean":    round(float(np.mean(scaf)), 2),
        "scaf_std":     round(float(np.std(scaf)),  2),
        "stap_mean":    round(float(np.mean(stap)), 2),
        "stap_std":     round(float(np.std(stap)),  2),
        "helix_std_cv": round(float(np.std(scaf) / np.mean(scaf)), 3) if np.mean(scaf) > 0 else 0.0,
    }


# ---------------------------------------------------------------------------
# GC-content estimation
# ---------------------------------------------------------------------------

def estimate_gc_content(total_positions: int, rng: np.random.Generator) -> dict:
    """
    Simulate a random scaffold sequence and compute GC content.

    This is illustrative — real sequence analysis would use the foldnano_json
    format and read actual slot sequences from the Part model.
    """
    if total_positions == 0:
        return {"gc_content": None}

    # Simulate DNA bases with a slight AT bias (typical for M13 scaffold ~54 % AT)
    bases = rng.choice(["A", "T", "G", "C"], size=total_positions, p=[0.27, 0.27, 0.23, 0.23])
    gc = int(np.sum((bases == "G") | (bases == "C")))
    at = total_positions - gc
    return {
        "gc_content":       round(gc / total_positions, 4),
        "gc_count":         gc,
        "at_count":         at,
        "simulated_length": total_positions,
    }


# ---------------------------------------------------------------------------
# CSV artifact
# ---------------------------------------------------------------------------

def build_csv(per_helix: list[dict]) -> str:
    lines = ["helix,row,col,scaf_occupied,stap_occupied,total_bases"]
    for h in per_helix:
        lines.append(
            f"{h['helix']},{h['row']},{h['col']},"
            f"{h['scaf_occ']},{h['stap_occ']},{h['total']}"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Synthetic demo design (used when no cadnano JSON is supplied)
# ---------------------------------------------------------------------------

def synthetic_design(num_helices: int = 10, length: int = 42) -> dict:
    """
    Generate a minimal cadnano-compatible JSON dict for demonstration.

    Produces a honeycomb-style grid with randomised strand coverage so the
    stats analysis has something interesting to chew on.
    """
    rng = np.random.default_rng(seed=42)
    vstrands = []

    for k in range(num_helices):
        # Simple honeycomb staggering
        row = int((k // 4) * 2 + (k % 4 >= 2))
        col = int((k % 4) * 2)

        scaf = [[-1, -1, -1, -1]] * length
        stap = [[-1, -1, -1, -1]] * length

        # Randomised contiguous scaffold block
        start = int(rng.integers(0, length // 4))
        end   = int(rng.integers(3 * length // 4, length))
        for j in range(start, end):
            prev_ = j - 1 if j > start else -1
            next_ = j + 1 if j < end - 1 else -1
            scaf[j] = [k, prev_, k, next_]

        # Shorter random staple block
        ts = int(rng.integers(0, length // 3))
        te = int(rng.integers(length // 2, length))
        for j in range(ts, te):
            prev_ = j - 1 if j > ts else -1
            next_ = j + 1 if j < te - 1 else -1
            stap[j] = [k, prev_, k, next_]

        vstrands.append({"row": row, "col": col, "scaf": scaf, "stap": stap})

    return {"name": "synthetic_demo", "vstrands": vstrands}


# ---------------------------------------------------------------------------
# Plugin entry point
# ---------------------------------------------------------------------------

def run(ctx: PluginContext) -> None:
    ctx.log("=== Design Statistics Plugin ===")
    ctx.log(f"numpy {np.__version__}")

    rng = np.random.default_rng(seed=7)
    is_synthetic = False

    # ------------------------------------------------------------------
    # 1. Obtain design data
    # ------------------------------------------------------------------
    if ctx.format == "cadnano_json":
        try:
            data = json.loads(ctx.get_part_as_cadnano_json())
            design_name = data.get("name", "<unnamed>")
            ctx.log(f"Input: real design '{design_name}'")
        except RuntimeError:
            data = synthetic_design()
            is_synthetic = True
            ctx.log("No cadnano JSON supplied — running on synthetic demo design.")
    else:
        data = synthetic_design()
        is_synthetic = True
        ctx.log(f"Format is '{ctx.format}' — running on synthetic demo design.")

    vstrands = data.get("vstrands", [])
    ctx.log(f"Virtual helices: {len(vstrands)}")

    # ------------------------------------------------------------------
    # 2. Analyse the design
    # ------------------------------------------------------------------
    grid = analyse_helix_grid(vstrands)
    occ  = analyse_strand_occupancy(vstrands)

    total_scaf = occ.get("scaf_total", 0)
    gc_stats   = estimate_gc_content(total_scaf, rng)

    # ------------------------------------------------------------------
    # 3. Log summary
    # ------------------------------------------------------------------
    if "row_range" in grid:
        ctx.log(
            f"Grid: rows {grid['row_range'][0]}–{grid['row_range'][1]}, "
            f"cols {grid['col_range'][0]}–{grid['col_range'][1]}  "
            f"(utilisation {grid['bbox_utilisation']:.1%})"
        )
        ctx.log(
            f"NN distance: {grid['nn_dist_mean']:.2f} ± {grid['nn_dist_std']:.2f}"
        )

    if "scaf_mean" in occ:
        ctx.log(
            f"Scaffold occupancy: total={occ['scaf_total']:,}  "
            f"per-helix {occ['scaf_mean']:.1f} ± {occ['scaf_std']:.1f}  "
            f"(CV={occ['helix_std_cv']:.2f})"
        )
        ctx.log(
            f"Staple occupancy:   total={occ['stap_total']:,}  "
            f"per-helix {occ['stap_mean']:.1f} ± {occ['stap_std']:.1f}"
        )

    if gc_stats.get("gc_content") is not None:
        ctx.log(
            f"Simulated GC content: {gc_stats['gc_content']:.1%}  "
            f"(G+C={gc_stats['gc_count']}, A+T={gc_stats['at_count']})"
        )

    # ------------------------------------------------------------------
    # 4. Write CSV artifact
    # ------------------------------------------------------------------
    csv_data = build_csv(occ.get("per_helix", []))
    ctx.write_artifact("design_stats.csv", csv_data)
    ctx.log(f"Artifact written: design_stats.csv ({len(csv_data)} bytes)")

    # ------------------------------------------------------------------
    # 5. Structured result (shown in plugin output panel)
    # ------------------------------------------------------------------
    ctx.set_result({
        "synthetic_demo": is_synthetic,
        **{k: v for k, v in grid.items() if k != "per_helix"},
        **{k: v for k, v in occ.items()  if k != "per_helix"},
        **gc_stats,
    })

    ctx.log("Done.")
