"""
Crossover Analyzer Plugin
=========================
Counts scaffold and staple crossovers between every connected pair of
virtual helices and exports a CSV report.

This plugin is intentionally split across three files to demonstrate
the multi-file zip plugin capability:

  plugin.py    — entry point (this file): orchestrates the run
  analyzer.py  — data extraction: scans vstrands for crossover connections
  report.py    — presentation: CSV formatting and summary statistics

Usage: Activate → Run. The "crossovers.csv" artifact is available for
download and statistics appear in the plugin result panel.

Format:   cadnano_json  (no sequence data required)
Strategy: previewOnly   (read-only; no model changes)
"""

from __future__ import annotations
import json
from foldnano.plugin import PluginContext

# These modules live alongside plugin.py inside the zip bundle.
from analyzer import extract_crossovers
from report import build_csv, build_summary


def run(ctx: PluginContext) -> None:
    ctx.log("=== Crossover Analyzer ===")

    try:
        raw_json = ctx.get_part_as_cadnano_json()
    except RuntimeError as exc:
        ctx.log(f"ERROR: {exc}")
        return

    data = json.loads(raw_json)
    vstrands = data.get("vstrands", [])

    if not vstrands:
        ctx.log("No virtual helices found.")
        return

    ctx.log(f"Design: '{data.get('name', '<unnamed>')}', {len(vstrands)} helices")

    vh_row_col = {vs["num"]: (vs["row"], vs["col"]) for vs in vstrands}
    crossovers = extract_crossovers(vstrands)
    ctx.log(f"Found {len(crossovers)} connected helix pair(s)")

    csv_data = build_csv(crossovers, vh_row_col)
    summary = build_summary(crossovers, len(vstrands))

    ctx.write_artifact("crossovers.csv", csv_data)

    if summary["max_xovers_pair"]:
        mp = summary["max_xovers_pair"]
        ctx.log(
            f"Most-connected pair: VH {mp['vh_a']}↔{mp['vh_b']} "
            f"({mp['scaf']} scaf + {mp['stap']} stap)"
        )

    ctx.log(
        f"Total: {summary['total_scaf_xovers']} scaffold + "
        f"{summary['total_stap_xovers']} staple crossovers"
    )

    ctx.set_result(summary)
    ctx.log("Done — crossovers.csv written.")
