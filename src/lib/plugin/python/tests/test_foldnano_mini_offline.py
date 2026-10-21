"""
Phase B regression tests: foldnano_mini offline transport (mutation log + mirror).

Run from project root::

    cd src/lib/plugin/python
    uv run pytest tests/test_foldnano_mini_offline.py -v
"""

from __future__ import annotations

import json

import pytest

from foldnano_mini import (
    FreeformRegion,
    LatticedRegion,
    MutableOligo,
    MutablePart,
    MutableSegment,
    OfflineTransport,
    load_part,
)
from foldnano_mini import mutations as M
from foldnano_mini import part as part_module


# ---------------------------------------------------------------------------
# Loading + read-through
# ---------------------------------------------------------------------------


def test_load_part_yields_mutable_part(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    assert isinstance(part, MutablePart)
    assert part.name == "multi-region-test-part"
    assert len(part.regions) == 3
    assert len(part.virtual_helices) == 4
    assert len(part.oligos) == 2
    assert part.mutation_log == []


def test_active_region_threaded_through(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json, active_region_id="region-square")
    assert part.active_region_id == "region-square"
    assert part.active_region is not None
    assert part.active_region.id == "region-square"


def test_region_proxy_subclasses(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    honey = part.get_region("region-honey")
    free = part.get_region("region-free")
    assert isinstance(honey, LatticedRegion)
    assert honey.supports_lattice_grid is True
    assert isinstance(free, FreeformRegion)
    assert free.supports_lattice_grid is False


def test_oligos_in_region_excludes_cross_region(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    honey_oligos = part.oligos_in_region("region-honey")
    assert [o.id for o in honey_oligos] == ["oligo-honey-only"]
    assert part.oligos_in_region("region-square") == []


# ---------------------------------------------------------------------------
# Simple oligo-property ops
# ---------------------------------------------------------------------------


def test_set_oligo_color_records_op_and_updates_mirror(
    multi_region_part_foldnano_json: str,
) -> None:
    part = load_part(multi_region_part_foldnano_json)
    oligo = part.get_oligo("oligo-honey-only")
    assert oligo is not None

    oligo.color = "#ff8800"

    # Read-through reflects the write.
    assert oligo.color == "#ff8800"
    assert part.get_oligo("oligo-honey-only").color == "#ff8800"
    # Log captures one structured op.
    assert part.mutation_log == [
        {"op": M.OP_SET_OLIGO_COLOR, "oligoId": "oligo-honey-only", "color": "#ff8800"}
    ]


def test_set_oligo_color_validates_hex(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    with pytest.raises(ValueError, match="hex color"):
        part.get_oligo("oligo-honey-only").color = "red"
    # Bad write must NOT pollute the log.
    assert part.mutation_log == []


def test_set_oligo_name_and_is_scaffold(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    oligo = part.get_oligo("oligo-honey-only")

    oligo.name = "my-staple"
    oligo.is_scaffold = True

    assert oligo.name == "my-staple"
    assert oligo.is_scaffold is True
    kinds = [op["op"] for op in part.mutation_log]
    assert kinds == [M.OP_SET_OLIGO_NAME, M.OP_SET_OLIGO_IS_SCAFFOLD]


def test_set_segment_modification(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    seg = part.get_oligo("oligo-honey-only").segments[0]

    seg.five_modification = "/5Bio/"
    seg.three_modification = "/3Cy3/"

    assert seg.five_modification == "/5Bio/"
    assert seg.three_modification == "/3Cy3/"
    assert [op["op"] for op in part.mutation_log] == [
        M.OP_SET_SEGMENT_MODIFICATION,
        M.OP_SET_SEGMENT_MODIFICATION,
    ]
    assert part.mutation_log[0]["end"] == "5"
    assert part.mutation_log[1]["end"] == "3"


# ---------------------------------------------------------------------------
# Slot ops
# ---------------------------------------------------------------------------


def test_set_slot_sequence_creates_slot_on_demand(
    multi_region_part_foldnano_json: str,
) -> None:
    part = load_part(multi_region_part_foldnano_json)
    seg = part.get_oligo("oligo-honey-only").segments[0]
    # Original fixture has no slot at bp 5.
    assert all(s.bp_index != 5 for s in seg.slots)

    seg.slot_at(5).seq = "A"

    assert seg.slot_at(5).seq == "A"
    assert part.mutation_log == [
        {
            "op": M.OP_SET_SLOT_SEQUENCE,
            "oligoId": "oligo-honey-only",
            "segmentId": "seg-A0",
            "bpIndex": 5,
            "seq": "A",
        }
    ]


def test_slot_skip_and_insertion(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    seg = part.get_oligo("oligo-honey-only").segments[0]
    seg.slot_at(7).set_skip(True)
    seg.slot_at(8).set_insertion("AT")

    assert seg.slot_at(7).skip is True
    assert seg.slot_at(8).seq == "AT"
    assert [op["op"] for op in part.mutation_log] == [
        M.OP_SET_SLOT_SKIP,
        M.OP_SET_SLOT_INSERTION,
    ]


# ---------------------------------------------------------------------------
# Structural ops: create / connect / remove segment / remove oligo
# ---------------------------------------------------------------------------


def test_create_segment_appends_new_oligo(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    n_oligos_before = len(part.oligos)

    seg = part.create_segment(vh=2, five_index=20, three_index=10, color="#00ff00")

    assert isinstance(seg, MutableSegment)
    assert len(part.oligos) == n_oligos_before + 1
    assert seg.length == 11
    assert seg.vh_index == 2
    new_oligo = part.get_oligo(seg.oligo_id)
    assert new_oligo is not None and new_oligo.color == "#00ff00"

    op = part.mutation_log[-1]
    assert op["op"] == M.OP_CREATE_SEGMENT
    assert op["newOligoId"] == new_oligo.id
    assert op["newSegmentId"] == seg.id
    assert op["fiveIndex"] == 20 and op["threeIndex"] == 10

    # New segment id is registered on the VH's strand set.
    vh = part.get_vh(2)
    assert seg.id in vh.strand_set_segment_ids[1]


def test_create_segment_validates_inputs(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    with pytest.raises(ValueError):
        part.create_segment(vh=0, five_index=5, three_index=5)
    with pytest.raises(ValueError):
        part.create_segment(vh=0, five_index=0, three_index=10, color="red")
    assert part.mutation_log == []


def test_connect_merges_oligos(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    seg_a = part.create_segment(vh=2, five_index=40, three_index=50)
    seg_b = part.create_segment(vh=2, five_index=51, three_index=60)
    n_oligos = len(part.oligos)

    part.connect(seg_a, seg_b)

    # Both connection endpoints updated.
    assert seg_a.connected_to_segment_id == seg_b.id
    assert seg_b.connected_from_segment_id == seg_a.id
    # Mirror merged the two new oligos into one.
    assert len(part.oligos) == n_oligos - 1
    op = part.mutation_log[-1]
    assert op == {
        "op": M.OP_CONNECT,
        "fromSegmentId": seg_a.id,
        "toSegmentId": seg_b.id,
    }


def test_remove_oligo(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    oligo = part.get_oligo("oligo-honey-only")
    oligo.remove()
    assert part.get_oligo("oligo-honey-only") is None
    # The seg ids should be stripped from the VHs' strandSet listings.
    for vh in part.virtual_helices:
        for ids in vh.strand_set_segment_ids:
            assert "seg-A0" not in ids and "seg-A1" not in ids


def test_remove_segment(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    oligo = part.get_oligo("oligo-cross-region")
    seg_b0 = oligo.get_segment("seg-B0")
    assert seg_b0 is not None

    seg_b0.remove()

    # Neighbour back-reference cleared.
    surviving = part.get_oligo("oligo-cross-region")
    assert surviving is not None
    other = surviving.get_segment("seg-C0")
    assert other.connected_from_segment_id is None


# ---------------------------------------------------------------------------
# VH ops (lattice add, freeform frame, remove)
# ---------------------------------------------------------------------------


def test_add_vh_at_coords_lattice(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    region = part.get_region("region-honey")
    assert isinstance(region, LatticedRegion)
    n_vhs = len(part.virtual_helices)

    new_vh = region.add_vh_at(row=1, col=0)

    assert new_vh is not None
    assert new_vh.row == 1 and new_vh.col == 0
    assert new_vh.region_id == "region-honey"
    assert len(part.virtual_helices) == n_vhs + 1
    op = part.mutation_log[-1]
    assert op["op"] == M.OP_ADD_VH_AT_COORDS
    assert op["regionId"] == "region-honey"
    assert op["row"] == 1 and op["col"] == 0


def test_allocate_unique_ids_retry_on_existing_mirror_ids(
    multi_region_part_foldnano_json: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    part = load_part(multi_region_part_foldnano_json)
    part._raw.setdefault("virtualHelices", []).append({"id": "py-vh-collision", "index": 99})
    part._raw.setdefault("oligos", []).append(
        {"id": "py-oligo-collision", "segments": [{"id": "py-seg-collision"}]}
    )
    generated = iter(
        [
            "collision",
            "fresh-vh",
            "collision",
            "fresh-oligo",
            "collision",
            "fresh-seg",
        ]
    )
    monkeypatch.setattr(part_module.uuid, "uuid4", lambda: next(generated))

    assert part.allocate_vh_id() == "py-vh-fresh-vh"
    assert part.allocate_oligo_id() == "py-oligo-fresh-oligo"
    assert part.allocate_segment_id() == "py-seg-fresh-seg"


def test_allocator_sees_ids_created_earlier_this_run(
    multi_region_part_foldnano_json: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    part = load_part(multi_region_part_foldnano_json)
    region = part.get_region("region-honey")
    assert isinstance(region, LatticedRegion)

    generated = iter(["run-vh", "run-oligo", "run-seg"])
    monkeypatch.setattr(part_module.uuid, "uuid4", lambda: next(generated))
    new_vh = region.add_vh_at(row=1, col=0)
    part.create_segment(vh=new_vh, five_index=0, three_index=10, color="#3366cc")

    retry_values = iter(["run-vh", "next-vh", "run-oligo", "next-oligo", "run-seg", "next-seg"])
    monkeypatch.setattr(part_module.uuid, "uuid4", lambda: next(retry_values))

    assert part.allocate_vh_id() == "py-vh-next-vh"
    assert part.allocate_oligo_id() == "py-oligo-next-oligo"
    assert part.allocate_segment_id() == "py-seg-next-seg"


def test_add_vh_freeform(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    free = part.get_region("region-free")
    assert isinstance(free, FreeformRegion)
    vh = free.add_vh_at(origin=(1.0, 2.0, 3.0), direction=(0.0, 0.0, 2.0), length=21)
    assert vh.region_id == "region-free"
    assert vh.is_freeform
    op = part.mutation_log[-1]
    assert op["op"] == "add_freeform_vh"
    assert op["origin"] == [1.0, 2.0, 3.0]
    assert op["axis"] == [0.0, 0.0, 1.0]
    assert op["length"] == 21


def test_set_vh_local_frame(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    vh = part.get_vh(0)
    new_frame = {
        "origin": {"x": 1, "y": 2, "z": 3},
        "axis": {"x": 0, "y": 0, "z": 1},
        "radial0": {"x": 1, "y": 0, "z": 0},
    }
    vh.local_frame = new_frame
    assert vh.local_frame == new_frame
    # Setting localFrame drops latticeCoords in the offline mirror.
    assert vh.row is None and vh.col is None


def test_remove_vhs(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    part.remove_vhs([3])
    assert part.get_vh(3) is None
    free = part.get_region("region-free")
    assert "vh-id-3" not in free.vh_order
    # The cross-region oligo's seg-C0 lived on vh 3; it should be gone.
    cross = part.get_oligo("oligo-cross-region")
    assert cross is not None
    assert all(s.vh_index != 3 for s in cross.segments)


def test_remove_vhs_int_emits_stable_id_for_added_vhs(
    multi_region_part_foldnano_json: str,
) -> None:
    """Passing an int (e.g. ``new_vh.index``) for a VH the plugin just added
    must emit the VH's stable id on the wire so the JS replayer resolves the
    same VH it created earlier in the log.
    """
    part = load_part(multi_region_part_foldnano_json)
    region = part.get_region("region-honey")
    assert isinstance(region, LatticedRegion)
    new_vh = region.add_vh_at(row=1, col=0)
    add_op = part.mutation_log[-1]
    expected_id = add_op["newVhId"]

    part.remove_vhs([new_vh.index])
    op = part.mutation_log[-1]
    assert op["op"] == M.OP_REMOVE_VHS
    assert op["vhIds"] == [expected_id]


def test_remove_vhs_int_for_preexisting_vh_emits_existing_id(
    multi_region_part_foldnano_json: str,
) -> None:
    """For VHs the plugin did not create itself, the op carries the VH's
    pre-existing id from the loaded mirror."""
    part = load_part(multi_region_part_foldnano_json)
    target = part.get_vh(3)
    assert target is not None
    expected_id = target.id
    part.remove_vhs([3])
    op = part.mutation_log[-1]
    assert op["op"] == M.OP_REMOVE_VHS
    assert op["vhIds"] == [expected_id]


def test_set_vh_local_frame_emits_vh_id(
    multi_region_part_foldnano_json: str,
) -> None:
    """``set_vh_local_frame`` carries the VH's id, not its index."""
    part = load_part(multi_region_part_foldnano_json)
    region = part.get_region("region-honey")
    assert isinstance(region, LatticedRegion)
    new_vh = region.add_vh_at(row=1, col=0)
    new_vh.local_frame = {
        "origin": {"x": 0, "y": 0, "z": 0},
        "axis": {"x": 0, "y": 0, "z": 1},
        "radial0": {"x": 1, "y": 0, "z": 0},
    }
    op = part.mutation_log[-1]
    assert op["op"] == M.OP_SET_VH_LOCAL_FRAME
    assert op["vhId"] == new_vh.id


def test_create_segment_with_int_emits_vh_id_from_mirror(
    multi_region_part_foldnano_json: str,
) -> None:
    """``part.create_segment(vh=int)`` looks up the VH's stable id in the
    mirror and emits it as ``vhId``."""
    part = load_part(multi_region_part_foldnano_json)
    pre_existing = part.get_vh(2)
    assert pre_existing is not None
    part.create_segment(vh=2, five_index=20, three_index=10, color="#00ff00")
    op = part.mutation_log[-1]
    assert op["op"] == M.OP_CREATE_SEGMENT
    assert op["vhId"] == pre_existing.id


def test_create_segment_with_proxy_emits_vh_id(
    multi_region_part_foldnano_json: str,
) -> None:
    """Passing a proxy emits the same id the JS side will see."""
    part = load_part(multi_region_part_foldnano_json)
    region = part.get_region("region-honey")
    assert isinstance(region, LatticedRegion)
    new_vh = region.add_vh_at(row=1, col=0)
    part.create_segment(vh=new_vh, five_index=0, three_index=10, color="#3366cc")
    op = part.mutation_log[-1]
    assert op["op"] == M.OP_CREATE_SEGMENT
    assert op["vhId"] == new_vh.id


# ---------------------------------------------------------------------------
# Log shape: must be JSON-serialisable
# ---------------------------------------------------------------------------


def test_mutation_log_is_json_serialisable(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    part.get_oligo("oligo-honey-only").color = "#abcdef"
    part.get_oligo("oligo-honey-only").name = "renamed"
    new_seg = part.create_segment(vh=2, five_index=50, three_index=40)
    new_seg.five_modification = "/5Bio/"

    encoded = json.dumps(part.mutation_log)
    decoded = json.loads(encoded)
    assert decoded == part.mutation_log


def test_unknown_op_kind_rejected_at_apply(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    with pytest.raises(ValueError, match="Unknown op kind"):
        part._apply({"op": "definitely-not-real"})


def test_lattice_type_and_max_base_derive_from_regions() -> None:
    """Part.toJSON() emits no top-level latticeType/maxBase; derive from first region."""
    doc = {
        "name": "no-legacy-fields",
        "id": "p1",
        "planes": [],
        "regions": [
            {
                "id": "r1",
                "name": "R",
                "kind": "SQUARE",
                "planeId": "plane-A",
                "vhOrder": [],
                "step": 32,
                "turnsPerStep": 3,
                "subStepSize": 8,
                "twistOffset": 0,
                "minBase": 0,
                "defaultMaxBase": 64,
            }
        ],
        "virtualHelices": [],
        "oligos": [],
    }
    part = load_part(json.dumps(doc))
    assert part.lattice_type == "SQUARE"
    assert part.max_base == 64


def test_offline_transport_does_not_alias_input(
    multi_region_part_foldnano_json: str,
) -> None:
    """Mutating the part must not mutate the caller's input dict."""
    raw_in = json.loads(multi_region_part_foldnano_json)
    transport = OfflineTransport(raw_in)
    part = MutablePart(transport)

    part.get_oligo("oligo-honey-only").color = "#ff0000"

    # Caller's dict is untouched.
    assert raw_in["oligos"][0]["color"] == "#0066cc"
    # Transport's mirror reflects the write.
    assert transport.read_part()["oligos"][0]["color"] == "#ff0000"
