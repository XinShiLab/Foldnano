#!/usr/bin/env python3
"""
example_all_ops.py — exercises every foldnano_mini op kind exactly once.

Run from src/lib/plugin/python/:
    python example_all_ops.py
    # or: uv run python example_all_ops.py

All 24 op kinds are demonstrated in logical order. Each section prints its
op name, performs the mutation, asserts the offline-mirror reflects the
change, and prints the result.

Expected output is documented in the companion section at the bottom of
this file.
"""
from __future__ import annotations

import json
import pathlib
import sys

# Make foldnano_mini importable from the plugin directory.
_PLUGIN_DIR = pathlib.Path(__file__).resolve().parent
if str(_PLUGIN_DIR) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_DIR))

from foldnano_mini import FreeformRegion, LatticedRegion, load_part  # noqa: E402

# ---------------------------------------------------------------------------
# Fixture — same JSON as tests/fixtures/multi_region_part.foldnano.json
# ---------------------------------------------------------------------------
PART_JSON = json.dumps(
    {
        "name": "multi-region-test-part",
        "id": "test-part-multi-001",
        "planes": [
            {
                "id": "plane-A",
                "name": "Plane A",
                "origin": {"x": 0, "y": 0, "z": 0},
                "u": {"x": 1, "y": 0, "z": 0},
                "v": {"x": 0, "y": 1, "z": 0},
                "normal": {"x": 0, "y": 0, "z": 1},
            },
            {
                "id": "plane-B",
                "name": "Plane B",
                "origin": {"x": 100, "y": 0, "z": 0},
                "u": {"x": 1, "y": 0, "z": 0},
                "v": {"x": 0, "y": 1, "z": 0},
                "normal": {"x": 0, "y": 0, "z": 1},
            },
        ],
        "regions": [
            {
                "id": "region-honey",
                "name": "Honey Region",
                "kind": "HONEYCOMB",
                "planeId": "plane-A",
                "vhOrder": ["vh-id-0", "vh-id-1"],
                "step": 21,
                "turnsPerStep": 2,
                "subStepSize": 7,
                "twistOffset": 340,
                "minBase": 0,
                "defaultMaxBase": 42,
            },
            {
                "id": "region-square",
                "name": "Square Region",
                "kind": "SQUARE",
                "planeId": "plane-A",
                "vhOrder": ["vh-id-2"],
                "step": 32,
                "turnsPerStep": 3,
                "subStepSize": 8,
                "twistOffset": 195,
                "minBase": 0,
                "defaultMaxBase": 64,
            },
            {
                "id": "region-free",
                "name": "Freeform Region",
                "kind": "FREEFORM",
                "planeId": "plane-B",
                "vhOrder": ["vh-id-3"],
                "step": 21,
                "turnsPerStep": 2,
                "subStepSize": 7,
                "twistOffset": 0,
                "minBase": 0,
                "defaultMaxBase": 42,
            },
        ],
        "virtualHelices": [
            {
                "id": "vh-id-0",
                "index": 0,
                "regionId": "region-honey",
                "listRow": 0,
                "latticeCoords": {"row": 0, "col": 0},
                "length": 42,
                "strandSets": [{"segmentIds": ["seg-A0"]}, {"segmentIds": []}],
            },
            {
                "id": "vh-id-1",
                "index": 1,
                "regionId": "region-honey",
                "listRow": 1,
                "latticeCoords": {"row": 0, "col": 1},
                "length": 42,
                "strandSets": [{"segmentIds": []}, {"segmentIds": ["seg-A1"]}],
            },
            {
                "id": "vh-id-2",
                "index": 2,
                "regionId": "region-square",
                "listRow": 2,
                "latticeCoords": {"row": 0, "col": 2},
                "length": 64,
                "strandSets": [{"segmentIds": ["seg-B0"]}, {"segmentIds": []}],
            },
            {
                "id": "vh-id-3",
                "index": 3,
                "regionId": "region-free",
                "listRow": 3,
                "localFrame": {
                    "origin": {"x": 0, "y": 0, "z": 0},
                    "axis": {"x": 0, "y": 0, "z": 1},
                    "radial0": {"x": 1, "y": 0, "z": 0},
                },
                "length": 42,
                "strandSets": [{"segmentIds": ["seg-C0"]}, {"segmentIds": []}],
            },
        ],
        "oligos": [
            {
                "id": "oligo-honey-only",
                "color": "#0066cc",
                "isScaffold": False,
                "isSequenceLocked": False,
                "name": "honey-staple",
                "segments": [
                    {
                        "id": "seg-A0",
                        "inVirtualHelixIndex": 0,
                        "fivePrime": {
                            "segmentId": "seg-A0",
                            "isThreePrime": False,
                            "index": 0,
                            "connectedSegmentId": None,
                            "modification": None,
                            "isConstrained": False,
                        },
                        "threePrime": {
                            "segmentId": "seg-A0",
                            "isThreePrime": True,
                            "index": 20,
                            "connectedSegmentId": "seg-A1",
                            "modification": None,
                            "isConstrained": False,
                        },
                        "sequence": "ATCGATCGATCGATCGATCGA",
                        "slots": [],
                    },
                    {
                        "id": "seg-A1",
                        "inVirtualHelixIndex": 1,
                        "fivePrime": {
                            "segmentId": "seg-A1",
                            "isThreePrime": False,
                            "index": 20,
                            "connectedSegmentId": "seg-A0",
                            "modification": None,
                            "isConstrained": False,
                        },
                        "threePrime": {
                            "segmentId": "seg-A1",
                            "isThreePrime": True,
                            "index": 0,
                            "connectedSegmentId": None,
                            "modification": None,
                            "isConstrained": False,
                        },
                        "sequence": "GATCGATCGATCGATCGATCG",
                        "slots": [],
                    },
                ],
            },
            {
                "id": "oligo-cross-region",
                "color": "#ff0000",
                "isScaffold": False,
                "isSequenceLocked": False,
                "name": "cross",
                "segments": [
                    {
                        "id": "seg-B0",
                        "inVirtualHelixIndex": 2,
                        "fivePrime": {
                            "segmentId": "seg-B0",
                            "isThreePrime": False,
                            "index": 0,
                            "connectedSegmentId": None,
                            "modification": None,
                            "isConstrained": False,
                        },
                        "threePrime": {
                            "segmentId": "seg-B0",
                            "isThreePrime": True,
                            "index": 31,
                            "connectedSegmentId": "seg-C0",
                            "modification": None,
                            "isConstrained": False,
                        },
                        "sequence": "A" * 32,
                        "slots": [],
                    },
                    {
                        "id": "seg-C0",
                        "inVirtualHelixIndex": 3,
                        "fivePrime": {
                            "segmentId": "seg-C0",
                            "isThreePrime": False,
                            "index": 0,
                            "connectedSegmentId": "seg-B0",
                            "modification": None,
                            "isConstrained": False,
                        },
                        "threePrime": {
                            "segmentId": "seg-C0",
                            "isThreePrime": True,
                            "index": 20,
                            "connectedSegmentId": None,
                            "modification": None,
                            "isConstrained": False,
                        },
                        "sequence": "T" * 21,
                        "slots": [],
                    },
                ],
            },
        ],
    }
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def sep(title: str) -> None:
    print(f"\n{'─' * 60}")
    print(f"  {title}")
    print("─" * 60)


def ok(label: str, value) -> None:
    print(f"  ✓ {label}: {value!r}")


# ===========================================================================
# Main
# ===========================================================================

part = load_part(PART_JSON, active_region_id="region-honey")

sep("Initial state")
print(f"  {part}")
print(f"  Regions  : {[r.id for r in part.regions]}")
print(f"  VHs      : {[vh.index for vh in part.virtual_helices]}")
print(f"  Oligos   : {[o.id for o in part.oligos]}")
print(f"  Planes   : {[p.id for p in part.planes]}")

# ───────────────────────────────────────────────────────────────────────────
# GROUP 1 — Oligo property mutations
# ───────────────────────────────────────────────────────────────────────────

sep("Op 1 — set_oligo_color")
oligo_honey = part.get_oligo("oligo-honey-only")
assert oligo_honey is not None
oligo_honey.color = "#ff8800"
assert oligo_honey.color == "#ff8800"
ok("oligo color", oligo_honey.color)

sep("Op 2 — set_oligo_name")
oligo_honey.name = "scaffold-strand"
assert oligo_honey.name == "scaffold-strand"
ok("oligo name", oligo_honey.name)

sep("Op 3 — set_oligo_is_scaffold")
oligo_honey.is_scaffold = True
assert oligo_honey.is_scaffold is True
ok("is_scaffold", oligo_honey.is_scaffold)

# ───────────────────────────────────────────────────────────────────────────
# GROUP 2 — Segment modifications
# ───────────────────────────────────────────────────────────────────────────

sep("Op 4 — set_segment_modification  (5' end)")
seg_a0 = oligo_honey.segments[0]  # seg-A0: vh=0, five=0, three=20
seg_a0.five_modification = "/5BioTEG/"
assert seg_a0.five_modification == "/5BioTEG/"
ok("5' modification", seg_a0.five_modification)

sep("Op 5 — set_segment_modification  (3' end)  [same op kind, 2nd call]")
seg_a0.three_modification = "/3Cy3/"
assert seg_a0.three_modification == "/3Cy3/"
ok("3' modification", seg_a0.three_modification)

# ───────────────────────────────────────────────────────────────────────────
# GROUP 3 — Slot-level annotations
# ───────────────────────────────────────────────────────────────────────────

sep("Op 6 — set_slot_sequence")
seg_a0.slot_at(5).seq = "T"
assert seg_a0.slot_at(5).seq == "T"
ok("slot[5] seq", seg_a0.slot_at(5).seq)

sep("Op 7 — set_slot_skip")
seg_a0.slot_at(10).set_skip(True)
assert seg_a0.slot_at(10).skip is True
ok("slot[10] skip", seg_a0.slot_at(10).skip)

sep("Op 8 — set_slot_insertion")
seg_a0.slot_at(15).set_insertion("GCGC")
assert seg_a0.slot_at(15).seq == "GCGC"
ok("slot[15] insertion", seg_a0.slot_at(15).seq)

# ───────────────────────────────────────────────────────────────────────────
# GROUP 4 — VH and region sizing
# ───────────────────────────────────────────────────────────────────────────

sep("Op 9 — set_vh_length")
# Extend vh-id-2 (SQUARE, currently 64 bp) to 96 bp directly.
vh_square = part.get_vh(2)
assert vh_square is not None
assert vh_square.length == 64
vh_square.length = 96
assert vh_square.length == 96
ok("vh[2] length (64 → 96)", vh_square.length)

sep("Op 10 — set_region_max_base  (via increase_length_by)")
# Extend all VHs in the HONEYCOMB region by one step (21 bp: 42 → 63).
region_honey = part.get_region("region-honey")
assert isinstance(region_honey, LatticedRegion)
assert region_honey.max_base == 42
region_honey.increase_length_by(21)
assert region_honey.max_base == 63
assert part.get_vh(0).length == 63  # vh-id-0 stretched
assert part.get_vh(1).length == 63  # vh-id-1 stretched
ok("region-honey max_base (42 → 63)", region_honey.max_base)
ok("vh[0] length after region grow", part.get_vh(0).length)
ok("vh[1] length after region grow", part.get_vh(1).length)

# ───────────────────────────────────────────────────────────────────────────
# GROUP 5 — Draw strands and connect
# ───────────────────────────────────────────────────────────────────────────

sep("Op 11 — create_segment")
# Draw a new segment on vh-id-2 (SQUARE), positions [35..50] ascending.
seg_new1 = part.create_segment(vh=2, five_index=35, three_index=50, color="#884400")
assert seg_new1.five_index == 35
assert seg_new1.three_index == 50
assert seg_new1.length == 16  # |50 - 35| + 1
ok("seg_new1 five_index", seg_new1.five_index)
ok("seg_new1 three_index", seg_new1.three_index)
ok("seg_new1 length", seg_new1.length)

# Draw a second segment [51..63] to connect to.
seg_new2 = part.create_segment(vh=2, five_index=51, three_index=63, color="#884400")

sep("Op 12 — connect")
n_oligos_before = len(part.oligos)
part.connect(seg_new1, seg_new2)
# Mirror merges the two fresh oligos into one.
assert len(part.oligos) == n_oligos_before - 1
assert seg_new1.connected_to_segment_id == seg_new2.id
assert seg_new2.connected_from_segment_id == seg_new1.id
ok("oligos after connect (merged)", len(part.oligos))
ok("seg_new1 → seg_new2 link", seg_new1.connected_to_segment_id == seg_new2.id)

# ───────────────────────────────────────────────────────────────────────────
# GROUP 6 — Break a crossover
# ───────────────────────────────────────────────────────────────────────────

sep("Op 13 — break_oligo  (boundary break at crossover)")
# seg-A0 runs [0..20] on vh-id-0 and its 3' end connects to seg-A1.
# Breaking at_index=20 (== three of seg-A0) severs that crossover.
assert not oligo_honey.is_circular
seg_a0_fresh = oligo_honey.segments[0]  # re-resolve after prior ops
n_segs_before = len(oligo_honey.segments)
broken_oligo = part.break_oligo(seg_a0_fresh, at_index=20)

# oligo-honey-only retains only seg-A0; seg-A1 moves to broken_oligo.
assert len(oligo_honey.segments) == n_segs_before - 1
assert seg_a0_fresh.connected_to_segment_id is None  # crossover severed
ok("oligo-honey-only segments after break", len(oligo_honey.segments))
ok("seg-A0 three end disconnected", seg_a0_fresh.connected_to_segment_id)
ok("broken_oligo color (always #26bf40)", broken_oligo.color)
ok("broken_oligo segments", len(broken_oligo.segments))

# ───────────────────────────────────────────────────────────────────────────
# GROUP 7 — Trim strand termini
# ───────────────────────────────────────────────────────────────────────────

sep("Op 14 — move_terminus  (5' end)")
# Trim seg-A0's 5' end from 0 to 3.
assert seg_a0_fresh.five_index == 0
seg_a0_fresh.move_five_prime_to(3)
assert seg_a0_fresh.five_index == 3
ok("seg-A0 five_index (0 → 3)", seg_a0_fresh.five_index)

sep("Op 15 — move_terminus  (3' end)  [same op kind, 2nd call]")
# Trim seg-A0's 3' end from 20 to 18.
assert seg_a0_fresh.three_index == 20
seg_a0_fresh.move_three_prime_to(18)
assert seg_a0_fresh.three_index == 18
ok("seg-A0 three_index (20 → 18)", seg_a0_fresh.three_index)

# ───────────────────────────────────────────────────────────────────────────
# GROUP 8 — Add new virtual helices
# ───────────────────────────────────────────────────────────────────────────

sep("Op 16 — add_vh_at_coords  (lattice VH in HONEYCOMB region)")
n_vhs = len(part.virtual_helices)
new_lattice_vh = region_honey.add_vh_at(row=1, col=0)
assert new_lattice_vh.row == 1
assert new_lattice_vh.col == 0
assert new_lattice_vh.region_id == "region-honey"
assert len(part.virtual_helices) == n_vhs + 1
ok("new_lattice_vh (row, col)", (new_lattice_vh.row, new_lattice_vh.col))
ok("new_lattice_vh id (stable py- prefix)", new_lattice_vh.id.startswith("py-vh-"))

sep("Op 17 — add_freeform_vh  (freeform VH in FREEFORM region)")
region_free = part.get_region("region-free")
assert isinstance(region_free, FreeformRegion)
n_vhs = len(part.virtual_helices)
new_free_vh = region_free.add_vh_at(
    origin=(10.0, 0.0, 0.0),
    direction=(0.0, 0.0, 1.0),
    length=42,
)
assert new_free_vh.is_freeform is True
assert new_free_vh.region_id == "region-free"
assert new_free_vh.length == 42
assert len(part.virtual_helices) == n_vhs + 1
ok("new_free_vh is_freeform", new_free_vh.is_freeform)
ok("new_free_vh origin x", new_free_vh.local_frame["origin"]["x"])

# ───────────────────────────────────────────────────────────────────────────
# GROUP 9 — Reposition and reframe VHs
# ───────────────────────────────────────────────────────────────────────────

sep("Op 18 — move_lattice_vh  (Δrow=1, Δcol=1 → parity preserved)")
# new_lattice_vh is at (row=1, col=0). Move to (row=2, col=1).
# Δrow+Δcol = 1+1 = 2 (even) → valid honeycomb parity.
new_lattice_vh.move_to(col=1, row=2)
assert new_lattice_vh.row == 2
assert new_lattice_vh.col == 1
ok("new_lattice_vh after move (row, col)", (new_lattice_vh.row, new_lattice_vh.col))

# Parity violation should raise:
try:
    new_lattice_vh.move_to(col=2, row=2)  # Δrow=0, Δcol=1 → sum odd → bad
    assert False, "should have raised"
except ValueError as exc:
    ok("parity violation raises ValueError", str(exc)[:50])

sep("Op 19 — set_vh_local_frame  (reposition freeform VH)")
vh_free_orig = part.get_vh(3)  # vh-id-3 — already freeform
assert vh_free_orig is not None
vh_free_orig.local_frame = {
    "origin": {"x": 5.0, "y": 0.0, "z": 0.0},
    "axis": {"x": 0.0, "y": 0.0, "z": 1.0},
    "radial0": {"x": 1.0, "y": 0.0, "z": 0.0},
}
assert vh_free_orig.local_frame["origin"]["x"] == 5.0
ok("vh[3] new origin x", vh_free_orig.local_frame["origin"]["x"])

sep("Op 20 — reorder_vh  (move vh-id-0 to last position in its region)")
# HONEYCOMB region vhOrder before: ["vh-id-0", "vh-id-1", new_lattice_vh.id]
# Move vh-id-0 to position 2 (end).
vh_0 = part.get_vh(0)
assert vh_0 is not None
region_honey_fresh = part.get_region("region-honey")
order_before = region_honey_fresh.vh_order
print(f"  vhOrder before reorder: {order_before}")
part.reorder_vh(vh_0, target_region_row=2)
order_after = part.get_region("region-honey").vh_order
print(f"  vhOrder after reorder : {order_after}")
assert order_after[-1] == "vh-id-0"
ok("vh-id-0 moved to last", order_after[-1])

# ───────────────────────────────────────────────────────────────────────────
# GROUP 10 — Plane and region structure
# ───────────────────────────────────────────────────────────────────────────

sep("Op 21 — transform_plane  (shift plane-B origin from x=100 to x=200)")
plane_b_before = next(p for p in part.planes if p.id == "plane-B")
assert plane_b_before.origin["x"] == 100.0
part.set_plane_transform(
    "plane-B",
    origin=(200.0, 0.0, 0.0),
    u=(1.0, 0.0, 0.0),
    v=(0.0, 1.0, 0.0),
    normal=(0.0, 0.0, 1.0),
)
plane_b_after = next(p for p in part.planes if p.id == "plane-B")
assert plane_b_after.origin["x"] == 200.0
ok("plane-B origin x (100 → 200)", plane_b_after.origin["x"])

sep("Op 22 — add_region_and_plane  (add a new SQUARE region)")
n_regions_before = len(part.regions)
n_planes_before = len(part.planes)
extra_region = part.add_region(
    kind="SQUARE",
    name="Extra Square",
    max_base=64,
    plane_origin=(300.0, 0.0, 0.0),
    plane_name="Extra Plane",
)
assert len(part.regions) == n_regions_before + 1
assert len(part.planes) == n_planes_before + 1
assert extra_region.kind == "SQUARE"
assert extra_region.max_base == 64
assert extra_region.step == 32  # SQUARE default
ok("extra_region kind", extra_region.kind)
ok("extra_region max_base", extra_region.max_base)
ok("extra_region id (py- prefix)", extra_region.id.startswith("py-region-"))
ok("total regions now", len(part.regions))

sep("Op 23 — split_region  (split HONEYCOMB region after vh-id-1)")
# HONEYCOMB vhOrder after reorder: ["vh-id-1", new_lattice_vh.id, "vh-id-0"]
# Split after vh-id-1 → top keeps ["vh-id-1"], bottom gets [new_lattice_vh.id, "vh-id-0"].
n_regions_before = len(part.regions)
vh_1 = part.get_vh(1)
split_off = part.split_region(part.get_region("region-honey"), vh_1)
assert len(part.regions) == n_regions_before + 1
assert split_off.kind == "HONEYCOMB"
assert part.get_region("region-honey").vh_order == ["vh-id-1"]
assert new_lattice_vh.region_id == split_off.id  # moved to split region
assert part.get_vh(0).region_id == split_off.id  # vh-id-0 also moved
ok("region-honey vhOrder after split", part.get_region("region-honey").vh_order)
ok("split_off vhOrder", split_off.vh_order)
ok("new_lattice_vh.region_id now", new_lattice_vh.region_id)
ok("total regions now", len(part.regions))

# ───────────────────────────────────────────────────────────────────────────
# GROUP 11 — Cleanup: remove operations
# ───────────────────────────────────────────────────────────────────────────

sep("Op 24 — remove_segment  (drop seg_new2 from vh-id-2)")
seg_new2_id = seg_new2.id
n_oligos_before = len(part.oligos)
seg_new2.remove()
# seg_new1's oligo still exists but its connection to seg_new2 is cleared.
assert seg_new1.connected_to_segment_id is None
# If removing seg_new2 left the merged oligo with only seg_new1, it survives.
ok("seg_new1 three_end disconnected", seg_new1.connected_to_segment_id)

sep("Op 25 — remove_oligo  (drop the broken oligo containing seg-A1)")
broken_oligo_id = broken_oligo.id
part.get_oligo(broken_oligo_id).remove()
assert part.get_oligo(broken_oligo_id) is None
# seg-A1's id should be gone from all VH strand sets.
vh_1_ss = part.get_vh(1)
assert all("seg-A1" not in ss for ss in vh_1_ss.strand_set_segment_ids)
ok("broken_oligo gone", part.get_oligo(broken_oligo_id) is None)
ok("seg-A1 stripped from vh-id-1 strandSets", True)

sep("Op 26 — remove_vhs  (drop the freeform VH we added in op 17)")
new_free_vh_id = new_free_vh.id
n_vhs_before = len(part.virtual_helices)
part.remove_vhs([new_free_vh])
assert len(part.virtual_helices) == n_vhs_before - 1
assert new_free_vh_id not in part.get_region("region-free").vh_order
ok("VH count after remove", len(part.virtual_helices))
ok("new_free_vh gone from region-free", new_free_vh_id not in part.get_region("region-free").vh_order)

# ───────────────────────────────────────────────────────────────────────────
# Final summary
# ───────────────────────────────────────────────────────────────────────────

sep("Final state")
print(f"  {part}")
print(f"  Regions  : {[r.id for r in part.regions]}")
print(f"  VHs      : {[vh.index for vh in part.virtual_helices]}")
print(f"  Oligos   : {[o.id for o in part.oligos]}")
print(f"  Planes   : {[p.id for p in part.planes]}")

sep("Mutation log — all 24 op kinds covered")
log = part.mutation_log
op_kinds = [op["op"] for op in log]
print(f"  Total ops logged : {len(log)}")
for i, kind in enumerate(op_kinds, 1):
    print(f"  {i:2d}. {kind}")

# Verify all 24 op kinds appear at least once.
from foldnano_mini.mutations import KNOWN_OPS

missing = KNOWN_OPS - set(op_kinds)
assert not missing, f"MISSING ops: {missing}"
ok("All 24 op kinds present in log", True)

sep("Self-consistency check — replay log into fresh mirror")
replayed = part.replay_log_into_fresh_mirror(PART_JSON, log)
assert replayed == part.to_json()
ok("replay_log_into_fresh_mirror matches part.to_json()", True)

print("\n\nAll assertions passed.\n")
