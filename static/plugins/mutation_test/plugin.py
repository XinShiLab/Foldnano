"""
Mutation Test (foldnano_mini)
=============================
Exercises every op kind in the foldnano_mini vocabulary against the active
part. The plugin emits a single mutation log, the host replays it through
real Part methods inside one snapshotTx, producing one undo step.

Op coverage (1 op per call unless noted):

    1.  add_vh_at_coords      ×2  (scratch VHs in a lattice region)
    2.  create_segment        ×3  (two on scratch VH 0, one on scratch VH 1)
    3.  connect               ×1  (merges two of the new oligos)
    4.  set_oligo_color       ×1
    5.  set_oligo_name        ×1
    6.  set_oligo_is_scaffold ×1
    7.  set_segment_modification ×2 (5' on segA, 3' on segC)
    8.  set_slot_sequence     ×1
    9.  set_slot_skip         ×1
    10. set_slot_insertion    ×1
    11. remove_segment        ×1  (segB)
    12. remove_oligo          ×1  (oligo_c)
    13. set_vh_local_frame    ×1  (if a freeform VH exists; otherwise skipped)
    14. remove_vhs            ×1  (cleans up the empty scratch VH)

Run the plugin against any design that contains at least one lattice
(HONEYCOMB / SQUARE) region. A freeform VH is optional; if none exists,
op #13 is skipped and the log will contain 13 distinct op kinds instead
of 14 — the report flags this.
"""

from __future__ import annotations

from foldnano.plugin import PluginContext
from foldnano_mini import LatticedRegion, load_part


def _pick_lattice_region(part):
    """Return the first lattice region (HONEYCOMB / SQUARE), or None."""
    for region in part.regions:
        if isinstance(region, LatticedRegion):
            return region
    return None


def _pick_free_coords(part, region, count: int) -> list[tuple[int, int]]:
    """Pick `count` (row, col) pairs in `region` that are not already occupied."""
    used: set[tuple[int, int]] = set()
    for vh in part.virtual_helices:
        if vh.region_id == region.id and not vh.is_freeform:
            used.add((vh.row, vh.col))
    out: list[tuple[int, int]] = []
    row = 0
    col = 0
    while len(out) < count:
        if (row, col) not in used:
            out.append((row, col))
            used.add((row, col))
        col += 1
        if col > 1000:  # paranoia bound
            row += 1
            col = 0
    return out


def _pick_freeform_vh(part):
    """Return the first existing freeform VH, or None."""
    for vh in part.virtual_helices:
        if vh.is_freeform:
            return vh
    return None


def run(ctx: PluginContext) -> None:
    ctx.log("=== Mutation Test (foldnano_mini) ===")

    part = load_part(
        ctx.get_part_as_foldnano_json(),
        active_region_id=ctx.active_region_id,
    )
    ctx.log(f"Loaded part: {part!r}")

    lattice_region = _pick_lattice_region(part)
    if lattice_region is None:
        ctx.log(
            "ERROR: no lattice region (HONEYCOMB or SQUARE) found in this part. "
            "This plugin needs at least one lattice region to add scratch VHs."
        )
        return

    ctx.log(f"Using lattice region {lattice_region.kind!r} id={lattice_region.id!r}")

    # ------------------------------------------------------------------
    # Op 1: add_vh_at_coords ×2
    # ------------------------------------------------------------------
    coords = _pick_free_coords(part, lattice_region, count=2)
    ctx.log(f"Adding scratch VHs at coords {coords}")
    new_vh_a = lattice_region.add_vh_at(row=coords[0][0], col=coords[0][1])
    new_vh_b = lattice_region.add_vh_at(row=coords[1][0], col=coords[1][1])
    ctx.log(f"  new_vh_a index={new_vh_a.index}  new_vh_b index={new_vh_b.index}")

    # ------------------------------------------------------------------
    # Op 2: create_segment ×3
    # ------------------------------------------------------------------
    # Strand set is derived from endpoint ordering: 5' < 3' → strand set 0;
    # 5' > 3' → strand set 1 (matches Part.createOligo on the JS side). For
    # seg_c we want strand set 1 on new_vh_b, so we flip the endpoints.
    seg_a = part.create_segment(
        vh=new_vh_a, five_index=0, three_index=10, color="#3366cc"
    )
    seg_b = part.create_segment(
        vh=new_vh_a, five_index=12, three_index=20, color="#cc6633"
    )
    seg_c = part.create_segment(
        vh=new_vh_b, five_index=10, three_index=0, color="#33cc66"
    )
    ctx.log(f"Created 3 segments: {seg_a.id[:14]}…, {seg_b.id[:14]}…, {seg_c.id[:14]}…")

    # ------------------------------------------------------------------
    # Op 3: connect (merges seg_a's and seg_b's oligos)
    # ------------------------------------------------------------------
    part.connect(seg_a, seg_b)
    ctx.log("Connected seg_a 3' → seg_b 5'")

    # ------------------------------------------------------------------
    # Op 4-6: set_oligo_color / name / is_scaffold (on the merged oligo)
    # ------------------------------------------------------------------
    merged = part.get_oligo(seg_a.oligo_id)
    if merged is None:
        ctx.log("ERROR: could not resolve merged oligo")
        return
    merged.color = "#ff8800"
    merged.name = "mutation-test-staple"
    merged.is_scaffold = False
    ctx.log("Applied color / name / is_scaffold to the merged oligo")

    # ------------------------------------------------------------------
    # Op 7: set_segment_modification ×2
    # ------------------------------------------------------------------
    seg_a.five_modification = "/5Bio/"
    seg_c.three_modification = "/3Cy3/"
    ctx.log("Set 5' modification on seg_a and 3' modification on seg_c")

    # ------------------------------------------------------------------
    # Op 8-10: slot sequence / skip / insertion (on seg_a)
    # ------------------------------------------------------------------
    seg_a.slot_at(5).seq = "A"
    seg_a.slot_at(6).set_skip(True)
    seg_a.slot_at(7).set_insertion("AT")
    ctx.log("Applied slot ops at bp 5 (seq), 6 (skip), 7 (insertion) on seg_a")

    # ------------------------------------------------------------------
    # Op 11: remove_segment (segB)
    # ------------------------------------------------------------------
    seg_b.remove()
    ctx.log("Removed seg_b")

    # ------------------------------------------------------------------
    # Op 12: remove_oligo (oligo_c)
    # ------------------------------------------------------------------
    oligo_c = part.get_oligo(seg_c.oligo_id)
    if oligo_c is not None:
        oligo_c.remove()
        ctx.log("Removed oligo_c")
    else:
        ctx.log("WARN: oligo_c already gone, skipping remove_oligo")

    # ------------------------------------------------------------------
    # Op 13: set_vh_local_frame (only if a freeform VH exists)
    # ------------------------------------------------------------------
    freeform_vh = _pick_freeform_vh(part)
    if freeform_vh is not None:
        new_frame = {
            "origin": {"x": 5.0, "y": 0.0, "z": 0.0},
            "axis": {"x": 0.0, "y": 0.0, "z": 1.0},
            "radial0": {"x": 1.0, "y": 0.0, "z": 0.0},
        }
        freeform_vh.local_frame = new_frame
        ctx.log(f"Set local_frame on freeform VH index={freeform_vh.index}")
        local_frame_emitted = True
    else:
        ctx.log("No freeform VH found — skipping set_vh_local_frame op.")
        local_frame_emitted = False

    # ------------------------------------------------------------------
    # Op 14: remove_vhs (clean up the empty scratch VH new_vh_b)
    # ------------------------------------------------------------------
    # Pass the proxy itself, not its int index — the proxy carries a stable
    # py_id so the JS replayer removes the right VH even when its assigned
    # index disagrees with the python-side prediction (which happens whenever
    # the part has a freeform region or any non-monotonic VH indices).
    part.remove_vhs([new_vh_b])
    ctx.log(f"Removed scratch VH index={new_vh_b.index}")

    # ------------------------------------------------------------------
    # Report
    # ------------------------------------------------------------------
    log = part.mutation_log
    op_kinds = sorted({op["op"] for op in log})

    ALL_OPS = {
        "add_vh_at_coords",
        "create_segment",
        "connect",
        "set_oligo_color",
        "set_oligo_name",
        "set_oligo_is_scaffold",
        "set_segment_modification",
        "set_slot_sequence",
        "set_slot_skip",
        "set_slot_insertion",
        "remove_segment",
        "remove_oligo",
        "set_vh_local_frame",
        "remove_vhs",
    }
    expected = ALL_OPS - ({"set_vh_local_frame"} if not local_frame_emitted else set())
    missing = sorted(expected - set(op_kinds))

    ctx.log(f"\nEmitted {len(log)} op(s) covering {len(op_kinds)} distinct kind(s):")
    for kind in op_kinds:
        n = sum(1 for op in log if op["op"] == kind)
        ctx.log(f"  {kind} × {n}")
    if missing:
        ctx.log(f"\nMISSING op kinds: {missing}")

    ctx.set_result_mutation_log(log)
    ctx.set_result(
        {
            "ops_total": len(log),
            "kinds_covered": sorted(op_kinds),
            "kinds_missing": missing,
            "freeform_local_frame_tested": local_frame_emitted,
        }
    )
    ctx.log("\nDone — host will replay the log under one undo step.")
