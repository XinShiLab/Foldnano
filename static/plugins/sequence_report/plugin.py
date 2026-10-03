"""
Sequence Report Plugin
======================
Reads real per-oligo sequences from the lossless foldnano_json format and
produces a downloadable ``sequence_report.csv`` artifact.

Columns
-------
name, length, gc_pct, has_run, mods, segment_count, vh_indices, sequence

- ``length``      — nucleotide count (from sequence if assigned, else topology)
- ``gc_pct``      — (G+C) / length, rounded to 3 dp; empty if no sequence
- ``has_run``     — True if ≥4 consecutive identical bases (design warning)
- ``mods``        — comma-joined 5'/3' modification names; empty if none
- ``segment_count`` — number of OligoSegment objects in this oligo
- ``vh_indices``  — space-joined unique VH indices spanned
- ``sequence``    — full concatenated sequence; empty if not assigned

applyStrategy is ``previewOnly`` — this plugin never mutates the model.

Requires: no external packages (pure Python + stdlib).
"""

from __future__ import annotations

import csv
import io
import re

from foldnano.io import parse_foldnano_json
from foldnano.plugin import PluginContext


def run(ctx: PluginContext) -> None:
    ctx.log("=== Sequence Report Plugin ===")

    # -----------------------------------------------------------------------
    # 1. Parse foldnano JSON
    # -----------------------------------------------------------------------
    try:
        raw_json = ctx.get_part_as_foldnano_json()
    except RuntimeError as exc:
        ctx.log(f"ERROR: could not read design — {exc}")
        return

    part = parse_foldnano_json(raw_json)

    staples = [o for o in part.oligos if not o.is_scaffold]
    if not staples:
        ctx.log("No staple oligos found.")
        return

    ctx.log(f"Analysing {len(staples)} staple oligo(s)…")

    # -----------------------------------------------------------------------
    # 2. Per-oligo statistics
    # -----------------------------------------------------------------------
    rows: list[dict] = []
    sequenced_count = 0
    gc_values: list[float] = []
    run_count = 0
    mod_count = 0

    for oligo in staples:
        seq = oligo.sequence or ""

        # Length — prefer real sequence, fall back to topology
        if seq:
            length = len(seq)
        else:
            length = sum(seg.length for seg in oligo.segments)

        # GC content
        if seq:
            gc = (seq.count("G") + seq.count("C")) / len(seq)
            gc_pct = f"{gc:.3f}"
            gc_values.append(gc)
            sequenced_count += 1
        else:
            gc_pct = ""

        # Homopolymer run (4+ identical consecutive bases)
        has_run = bool(re.search(r"(.)\1{3}", seq)) if seq else False
        if has_run:
            run_count += 1

        # Modifications — collect from all segment ends
        mod_names: list[str] = []
        for seg in oligo.segments:
            if seg.five_prime_modification is not None:
                mod_names.append(str(seg.five_prime_modification))
            if seg.three_prime_modification is not None:
                mod_names.append(str(seg.three_prime_modification))
        mods_str = ",".join(mod_names)
        if mods_str:
            mod_count += 1

        # VH indices spanned
        vh_set: list[int] = []
        seen_vhs: set[int] = set()
        for seg in oligo.segments:
            if seg.vh_index not in seen_vhs:
                seen_vhs.add(seg.vh_index)
                vh_set.append(seg.vh_index)
        vh_indices = " ".join(str(v) for v in vh_set)

        rows.append({
            "name": oligo.name or "",
            "length": length,
            "gc_pct": gc_pct,
            "has_run": has_run,
            "mods": mods_str,
            "segment_count": len(oligo.segments),
            "vh_indices": vh_indices,
            "sequence": seq,
        })

    # -----------------------------------------------------------------------
    # 3. Write CSV artifact
    # -----------------------------------------------------------------------
    fieldnames = ["name", "length", "gc_pct", "has_run", "mods", "segment_count", "vh_indices", "sequence"]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    ctx.write_artifact("sequence_report.csv", buf.getvalue())

    # -----------------------------------------------------------------------
    # 4. Log summary
    # -----------------------------------------------------------------------
    mean_gc = f"{sum(gc_values) / len(gc_values):.1%}" if gc_values else "n/a"
    ctx.log(f"Total staples:   {len(staples)}")
    ctx.log(f"Sequenced:       {sequenced_count} / {len(staples)}")
    ctx.log(f"Mean GC%%:        {mean_gc}")
    ctx.log(f"With runs (≥4):  {run_count}")
    ctx.log(f"With mods:       {mod_count}")
    ctx.log("Artifact → sequence_report.csv")

    ctx.set_result({
        "total_staples": len(staples),
        "sequenced": sequenced_count,
        "mean_gc": sum(gc_values) / len(gc_values) if gc_values else None,
        "staples_with_runs": run_count,
        "staples_with_mods": mod_count,
    })
