"""
foldnano_mini occupancy queries, end proxies, ``can_*`` checks and ``create_oligo``.

Host parity of the checks lives in ``test_foldnano_mini_parity.py``; these cover the
Python-side API and the rules where Python is stricter than replay.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from foldnano_mini import (
    Check,
    InvalidOperationError,
    MutablePart,
    MutableSegmentEnd,
    SegmentSpec,
    load_part,
)
from foldnano_mini import mutations as M

GOLDEN = json.loads(
    (Path(__file__).parent / "fixtures" / "foldnano_mini_parity.golden.json").read_text()
)


@pytest.fixture
def honey() -> MutablePart:
    """Honeycomb part with a constrained crossover s-site-a (vh 0) → s-site-b (vh 1) at bp 11."""
    scene = next(s for s in GOLDEN["scenes"] if s["name"] == "HONEYCOMB")
    return load_part(json.dumps(scene["part"]))


# ---------------------------------------------------------------------------
# Check
# ---------------------------------------------------------------------------


def test_check_is_truthy_with_reason() -> None:
    assert Check.passed()
    failed = Check.failed("nope")
    assert not failed
    assert failed.reason == "nope"
    with pytest.raises(InvalidOperationError, match="nope"):
        failed.raise_if_failed()
    assert issubclass(InvalidOperationError, ValueError)


# ---------------------------------------------------------------------------
# Occupancy queries
# ---------------------------------------------------------------------------


def test_strand_set_queries(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    vh0 = part.get_vh(0)
    ss0, ss1 = vh0.strand_sets
    assert ss0.strand_index == 0 and ss1.strand_index == 1
    assert ss0.segment_ids == ["seg-A0"]
    assert ss1.is_empty
    assert ss0.is_range_occupied(20, 25)
    assert ss0.is_range_occupied(25, 20)
    assert not ss0.is_range_occupied(21, 30)
    assert ss0.is_index_occupied_by(5).id == "seg-A0"
    assert ss0.is_index_occupied_by(21) is None
    assert ss0.free_ranges() == [(21, 41)]
    assert ss1.free_ranges() == [(0, 41)]
    assert [s.id for s in vh0.segments_at(10)] == ["seg-A0"]


def test_queries_see_edits_made_since_the_last_query(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    vh0 = part.get_vh(0)
    assert vh0.strand_sets[1].free_ranges() == [(0, 41)]
    seg = part.create_segment(vh0, 30, 25)
    assert vh0.strand_sets[1].free_ranges() == [(0, 24), (31, 41)]
    seg.move_three_prime_to(10)
    assert vh0.strand_sets[1].segments_in_range(0, 41) == [seg]
    assert vh0.strand_sets[1].free_ranges() == [(0, 9), (31, 41)]


def test_segment_and_strand_identity(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    seg = part.get_vh(1).strand_sets[1].segments[0]
    assert seg.id == "seg-A1"
    assert seg.in_strand_index == 1
    assert seg.in_virtual_helix.index == 1
    assert (seg.low_index, seg.high_index) == (0, 20)
    assert seg.oligo.id == "oligo-honey-only"


# ---------------------------------------------------------------------------
# End proxies
# ---------------------------------------------------------------------------


def test_end_proxy_mirrors_segment_end(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    oligo = part.get_oligo("oligo-honey-only")
    five = oligo.five_prime
    three = oligo.three_prime
    assert isinstance(five, MutableSegmentEnd)
    assert (five.segment.id, five.is_three_prime, five.index) == ("seg-A0", False, 0)
    assert (three.segment.id, three.is_three_prime, three.index) == ("seg-A1", True, 0)
    assert five.is_free and three.is_free

    junction = five.segment.three_prime
    assert not junction.is_free
    assert junction.connected_segment.id == "seg-A1"
    assert junction.connected_end == part._segment_proxy("seg-A1").five_prime
    assert junction.connected_end.connected_end == junction
    # bp 20 isn't a crossover site between these VHs.
    assert junction.is_constrained is False


def test_end_index_setter_moves_and_checks(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    seg = part.create_segment(0, 30, 25)
    seg.three_prime.index = 22
    assert seg.three_index == 22
    assert part.mutation_log[-1] == {
        "op": M.OP_MOVE_TERMINUS,
        "segmentId": seg.id,
        "end": "3",
        "toIndex": 22,
    }
    n_ops = len(part.mutation_log)
    with pytest.raises(InvalidOperationError, match="reverse direction"):
        seg.three_prime.index = 31
    with pytest.raises(InvalidOperationError, match="out of bounds"):
        seg.five_prime.index = 42
    assert len(part.mutation_log) == n_ops


def test_end_modification(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    seg = part.create_segment(0, 30, 25)
    seg.five_prime.modification = "/5Bio/"
    assert seg.five_prime.modification == "/5Bio/"
    assert seg.five_modification == "/5Bio/"


def test_constrained_end(honey: MutablePart) -> None:
    a = honey._segment_proxy("s-site-a")
    assert a.three_prime.is_constrained
    assert a.three_prime.connected_end.is_constrained
    assert not a.five_prime.is_constrained
    site_bps = [s.bp_index for s in honey.get_vh(0).potential_xover_sites(0) if s.to_vh_index == 1]
    assert a.three_index in site_bps
    # Off-site: refused even though the bases are free.
    assert not a.three_prime.can_move_to(a.three_index - 1)


# ---------------------------------------------------------------------------
# Mutating calls refuse what their check refuses
# ---------------------------------------------------------------------------


def test_create_segment_refuses_out_of_region_bounds(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    check = part.can_create_segment(0, 30, 42)
    assert not check and "bounds (0-41)" in check.reason
    with pytest.raises(InvalidOperationError, match="bounds"):
        part.create_segment(0, 30, 42)
    assert part.mutation_log == []


def test_create_segment_refuses_occupied_range(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    assert not part.can_create_segment(0, 15, 25)
    assert part.can_create_segment(0, 25, 15)  # other strand set
    with pytest.raises(InvalidOperationError, match="occupied"):
        part.create_segment(0, 15, 25)


def test_connect_refuses_connected_end(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    a0 = part._segment_proxy("seg-A0")
    new = part.create_segment(2, 40, 50)
    check = part.can_connect(a0, new)
    assert not check and "already connected" in check.reason
    with pytest.raises(InvalidOperationError):
        part.connect(a0, new)
    assert not part.can_connect(new, new)


# ---------------------------------------------------------------------------
# Skip / insertion rules (Python is stricter than replay here)
# ---------------------------------------------------------------------------


@pytest.fixture
def duplex(multi_region_part_foldnano_json: str):
    part = load_part(multi_region_part_foldnano_json)
    up = part._segment_proxy("seg-A0")  # vh 0, 0 → 20
    down = part.create_segment(0, 20, 0)
    return part, up, down


def test_skip_refused_at_a_segment_end(duplex) -> None:
    part, up, _ = duplex
    check = up.slot_at(20).can_set_skip()
    assert not check and "segment end" in check.reason
    with pytest.raises(InvalidOperationError):
        up.slot_at(0).set_skip(True)


def test_skip_refused_without_complementary_strand(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    check = part._segment_proxy("seg-A0").slot_at(7).can_set_skip()
    assert not check and "complementary" in check.reason


def test_skip_refused_on_a_modified_slot(duplex) -> None:
    part, up, down = duplex
    up.slot_at(7).set_skip(True)
    assert not down.slot_at(7).can_set_skip()
    assert not up.slot_at(7).can_set_insertion()
    up.slot_at(9).set_insertion("AT")
    assert not up.slot_at(9).can_set_skip()
    assert up.slot_at(9).can_set_insertion()


def test_skip_refused_at_constrained_crossover_bp(honey: MutablePart) -> None:
    a = honey._segment_proxy("s-site-a")  # 0 → 11, constrained 3' end at 11
    honey.create_segment(0, 15, 0)
    check = a.slot_at(11).can_set_skip()
    assert not check  # a segment end too; the complementary strand still sees the crossover
    comp = honey.get_vh(0).strand_sets[1].is_index_occupied_by(11)
    check = comp.slot_at(11).can_set_skip()
    assert not check and "constrained crossover" in check.reason


def test_move_and_break_refuse_skip_slots(duplex) -> None:
    part, up, down = duplex
    up.slot_at(7).set_skip(True)
    # break: the new 3' end (bp 7) or the new 5' end (bp 7, after breaking at 6) on the skip.
    assert not part.can_break_oligo(up, 7)
    assert not part.can_break_oligo(up, 6)
    assert part.can_break_oligo(up, 10)
    # move: an end onto the skip.
    assert not down.three_prime.can_move_to(7)
    assert down.three_prime.can_move_to(8)


def _put_skip_on_end(part: MutablePart, seg, bp: int) -> None:
    # A loaded design can carry this (Python's own edits never produce it).
    seg._raw().setdefault("slots", []).append({"bpIndex": bp, "seq": ""})
    part._generation += 1


def test_connect_refuses_an_end_on_a_skip(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    a = part.create_segment(0, 25, 30)
    b = part.create_segment(1, 30, 25)
    _put_skip_on_end(part, b, 30)
    check = part.can_connect(a, b)
    assert not check and "VH 1 bp 30: it is a skip" in check.reason


# ---------------------------------------------------------------------------
# create_oligo
# ---------------------------------------------------------------------------


def test_create_oligo_crossover_path(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    vh0 = part.get_vh(0)
    oligo = part.create_oligo(
        [(vh0, 30, 25), SegmentSpec(1, 25, 35)], color="#ff8800", name="staple"
    )
    segs = oligo.segments
    assert [(s.vh_index, s.five_index, s.three_index) for s in segs] == [(0, 30, 25), (1, 25, 35)]
    assert segs[0].three_prime.connected_segment == segs[1]
    assert (oligo.color, oligo.name, oligo.is_scaffold) == ("#ff8800", "staple", False)
    assert not oligo.is_circular
    assert [op["op"] for op in part.mutation_log] == [
        M.OP_CREATE_SEGMENT,
        M.OP_CREATE_SEGMENT,
        M.OP_CONNECT,
    ]
    replayed = MutablePart.replay_log_into_fresh_mirror(
        multi_region_part_foldnano_json, part.mutation_log
    )
    assert replayed == part.to_json()


def test_create_oligo_merges_adjacent_entries(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    oligo = part.create_oligo([(0, 25, 30), (0, 31, 35), (1, 35, 25)])
    assert [(s.vh_index, s.five_index, s.three_index) for s in oligo.segments] == [
        (0, 25, 35),
        (1, 35, 25),
    ]
    assert [op["op"] for op in part.mutation_log].count(M.OP_CREATE_SEGMENT) == 2


def test_create_oligo_circular(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    oligo = part.create_oligo([(0, 25, 35), (1, 35, 25)], circular=True)
    assert oligo.is_circular
    assert oligo.five_prime is None and oligo.three_prime is None
    assert not part.can_create_oligo([(0, 36, 40)], circular=True)


def test_create_oligo_refuses_whole_path_before_logging(
    multi_region_part_foldnano_json: str,
) -> None:
    part = load_part(multi_region_part_foldnano_json)
    check = part.can_create_oligo([(0, 25, 30), (1, 30, 25), (0, 28, 35)])
    assert not check and "segments 0 and 2 overlap" in check.reason
    with pytest.raises(InvalidOperationError, match="segment 1"):
        part.create_oligo([(0, 25, 30), (1, 15, 10)])  # vh 1 strand 1 is taken there
    with pytest.raises(InvalidOperationError, match="bounds"):
        part.create_oligo([(0, 25, 30), (1, 30, 50)])
    assert part.mutation_log == []


def test_create_oligo_rejects_malformed_entries(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    with pytest.raises(TypeError):
        part.create_oligo([(0, 25)])
    with pytest.raises(ValueError):
        part.create_oligo([(0, 25, 25)])


# ---------------------------------------------------------------------------
# Editor-level calls (host parity of their results: test_foldnano_mini_parity.py)
# ---------------------------------------------------------------------------


def test_lookups_by_position(honey: MutablePart) -> None:
    assert honey.get_segment_at(0, 0, 5).id == "s-site-a"
    assert honey.get_oligo_at(0, 0, 5).id == "o-site-a"
    assert honey.get_segment_at(0, 1, 5) is None
    assert honey.get_end_at(0, 0, 0) == honey._segment_proxy("s-site-a").five_prime
    assert honey.get_end_at(0, 0, 11) == honey._segment_proxy("s-site-a").three_prime
    assert honey.get_end_at(0, 0, 5) is None


def test_break_at_returns_the_three_prime_side(honey: MutablePart) -> None:
    tail = honey.break_at(4, 0, 20)  # s-plain-b, 0 → 41
    assert [(s.five_index, s.three_index) for s in tail.segments] == [(21, 41)]
    assert honey.get_oligo_at(4, 0, 5).three_prime.index == 20
    # Next to a free 3' end the host does nothing, so neither does Python.
    same = honey.break_at(4, 0, 40)
    assert same.id == tail.id and len(honey.mutation_log) == 2
    assert not honey.can_break_at(4, 1, 5)  # no strand there


def test_oligo_level_crossovers(honey: MutablePart) -> None:
    plain_c = honey.get_oligo("o-plain-c")  # vh 3, 41 → 31
    check = honey.can_create_crossover(plain_c, 4, 0, 1)
    assert not check and "1-nt" in check.reason
    honey.create_crossover(plain_c, 4, 0, 20)
    assert [(s.vh_index, s.five_index, s.three_index) for s in plain_c.segments] == [
        (3, 41, 31),
        (4, 20, 41),
    ]
    # Its own free 3' end (vh 4 bp 41) to its free 5' end (vh 3 bp 41) closes a ring.
    honey.connect_oligos(plain_c, plain_c)
    assert plain_c.is_circular
    check = honey.can_connect_oligos(plain_c, honey.get_oligo("o-free-a"))
    assert not check and "free ends" in check.reason


def test_make_crossover_requires_a_site(honey: MutablePart) -> None:
    check = honey.can_make_crossover(4, 0, 3, 0)
    assert not check and "No potential crossover site" in check.reason


def test_oligo_modifications(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    ring = part.create_oligo([(0, 25, 35), (1, 35, 25)], circular=True)
    assert ring.five_modification is None
    with pytest.raises(InvalidOperationError, match="circular"):
        ring.five_modification = "/5Bio/"


def test_region_shrink_is_checked(honey: MutablePart) -> None:
    region = honey.regions[0]
    check = region.can_set_max_base(region.max_base - region.step)
    assert not check and "strands reach bp 41" in check.reason
    assert not region.can_set_max_base(region.max_base + 1)
    region.increase_length_by(region.step)
    assert honey.get_vh(0).length == 63
    region.reduce_unused_length()
    assert (region.max_base, honey.get_vh(0).length) == (42, 42)


def test_remove_all_insertions(duplex) -> None:
    part, up, _ = duplex
    up.slot_at(5).set_insertion("AT")
    up.slot_at(9).set_skip(True)
    assert part.regions[0].remove_all_insertions() == 1
    assert up.slot_at(5).seq == "A" and up.slot_at(9).skip
    assert part.regions[0].remove_all_skips() == 1
    assert not up.slot_at(9).skip


def test_remove_segment_splits_downstream(honey: MutablePart) -> None:
    oligo = honey.create_oligo([(4, 30, 25), (2, 25, 20), (3, 20, 25)])
    tail = honey.remove_segment(oligo.segments[1])
    assert [s.vh_index for s in oligo.segments] == [4]
    assert [s.vh_index for s in tail.segments] == [3]


# ---------------------------------------------------------------------------
# Skip and insert tools (both strands, as the editor does)
# ---------------------------------------------------------------------------


def test_get_slot_at(duplex) -> None:
    part, up, down = duplex
    assert part.get_slot_at(0, 0, 7).bp_index == 7
    assert part.get_slot_at(0, 0, 7)._segment_id == up.id
    assert part.get_slot_at(0, 1, 7)._segment_id == down.id
    assert part.get_slot_at(1, 0, 30) is None


def test_add_insert_at_is_cumulative_on_both_strands(duplex) -> None:
    part, up, down = duplex
    up.slot_at(5).seq = "G"
    part.add_insert_at(0, 5)
    part.add_insert_at(0, 5, count=2)
    assert up.slot_at(5).seq == "GNNN"  # keeps its base
    assert len(down.slot_at(5).seq) == 4
    assert [op["op"] for op in part.mutation_log[-2:]] == [M.OP_ADD_SKIP_OR_INSERTION] * 2
    part.remove_skip_or_insertion_at(0, 5)
    assert up.slot_at(5).seq == "G" and len(down.slot_at(5).seq) == 1


def test_add_skip_at_on_both_strands(duplex) -> None:
    part, up, down = duplex
    part.add_skip_at(0, 9)
    assert up.slot_at(9).skip and down.slot_at(9).skip
    check = part.can_add_insert_at(0, 9)
    assert not check and "skip" in check.reason
    n_ops = len(part.mutation_log)
    part.remove_skip_or_insertion_at(0, 9)
    part.remove_skip_or_insertion_at(0, 9)  # plain now: records nothing
    assert len(part.mutation_log) == n_ops + 1


def test_skip_insert_tools_refuse_like_the_editor(duplex) -> None:
    part, up, down = duplex
    # bp 0 is an end of both strands; bp 20 too.
    check = part.can_add_skip_at(0, 0)
    assert not check and "segment end" in check.reason
    with pytest.raises(InvalidOperationError):
        part.add_insert_at(0, 20)
    assert not part.can_add_skip_at(1, 30)  # no strand there
    with pytest.raises(ValueError):
        part.add_insert_at(0, 5, count=0)


def test_slot_seq_cannot_change_length(duplex) -> None:
    part, up, down = duplex
    up.slot_at(5).seq = "A"
    with pytest.raises(InvalidOperationError, match="strands differ"):
        up.slot_at(6).seq = "AT"
    with pytest.raises(InvalidOperationError, match="strands differ"):
        up.slot_at(6).seq = ""
    part.add_insert_at(0, 6)
    up.slot_at(6).seq = "AT"  # same length as the insertion: fine
    assert up.slot_at(6).seq == "AT"
