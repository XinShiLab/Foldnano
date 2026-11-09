"""
Whole-oligo and whole-segment sequence writes in foldnano.edit (``fill_sequence``), the
``sequence`` / ``nucleotide_count`` reads, and the sequence-lock flag clearing on a change.

Fills never touch the opposite strand: the plugin owns both strands, and a disagreement
shows to the user as a mismatch. The host half is in the replay golden
(``test_foldnano_edit_replay_host.py``).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from foldnano.edit import InvalidOperationError, MutablePart, load_part
from foldnano.edit import mutations as M

FIXTURES = Path(__file__).parent / "fixtures"


def _fixture(edit=None) -> MutablePart:
    raw = json.loads((FIXTURES / "multi_region_part.foldnano.json").read_text())
    part_json = raw["parts"][0] if "parts" in raw else raw
    if edit is not None:
        edit(part_json)
    return load_part(json.dumps(raw))


def _oligo_json(part_json: dict, oligo_id: str) -> dict:
    return next(o for o in part_json["oligos"] if o["id"] == oligo_id)


def _segment_json(part_json: dict, segment_id: str) -> dict:
    return next(s for o in part_json["oligos"] for s in o["segments"] if s["id"] == segment_id)


# seg-A0: VH 0, bp 0 → 20; seg-A1: VH 1, bp 20 → 0; 21 bases each.
HONEY = "oligo-honey-only"


def test_fill_sequence_writes_oligo_5_to_3_as_one_op() -> None:
    part = _fixture()
    oligo = part.get_oligo(HONEY)
    assert oligo.nucleotide_count == 42
    assert oligo.sequence == "N" * 42
    seq = "ACGT" * 10 + "GG"

    oligo.fill_sequence(seq)

    assert oligo.sequence == seq
    a0, a1 = (part._segment_proxy(i) for i in ("seg-A0", "seg-A1"))
    assert a0.sequence == seq[:21] and a1.sequence == seq[21:]
    assert a0.slot_at(0).seq == "A" and a1.slot_at(20).seq == seq[21]
    assert part.mutation_log == [
        {"op": M.OP_SET_OLIGO_SEQUENCE, "oligoId": HONEY, "sequence": seq}
    ]


def test_fill_sequence_order_follows_connections_not_storage() -> None:
    part = _fixture(lambda p: _oligo_json(p, HONEY)["segments"].reverse())
    seq = "A" * 21 + "C" * 21
    part.get_oligo(HONEY).fill_sequence(seq)
    assert part._segment_proxy("seg-A0").sequence == "A" * 21
    assert part.get_oligo(HONEY).sequence == seq


def test_skips_and_insertions_count_toward_length() -> None:
    def edit(p: dict) -> None:
        _segment_json(p, "seg-A0")["slots"] = [
            {"bpIndex": 5, "seq": ""},
            {"bpIndex": 7, "seq": "NNN"},
        ]

    part = _fixture(edit)
    seg = part._segment_proxy("seg-A0")
    assert seg.nucleotide_count == 21 - 1 + 2
    seq = "ACGTA" + "C" + "TGC" + "A" * 13  # bp 0-4, bp 5 skipped, bp 6, bp 7 insertion
    seg.fill_sequence(seq)
    assert seg.sequence == seq
    assert seg.slot_at(5).seq == "" and seg.slot_at(7).seq == "TGC"


def test_segment_fill_logs_one_op_and_leaves_other_segments() -> None:
    part = _fixture()
    seg = part._segment_proxy("seg-A1")
    seg.fill_sequence("t" * 21)
    assert seg.sequence == "T" * 21
    assert part._segment_proxy("seg-A0").sequence == "N" * 21
    assert part.mutation_log == [
        {
            "op": M.OP_SET_SEGMENT_SEQUENCE,
            "oligoId": HONEY,
            "segmentId": "seg-A1",
            "sequence": "T" * 21,
        }
    ]


@pytest.mark.parametrize("seq", ["A" * 41, "A" * 43, ""])
def test_wrong_length_is_refused_and_not_logged(seq: str) -> None:
    part = _fixture()
    with pytest.raises(InvalidOperationError, match="holds 42 bases"):
        part.get_oligo(HONEY).fill_sequence(seq)
    assert part.mutation_log == []


def test_non_dna_letters_are_refused() -> None:
    part = _fixture()
    with pytest.raises(ValueError, match="A, C, G, T and N"):
        part.get_oligo(HONEY).fill_sequence("U" * 42)
    with pytest.raises(TypeError):
        part.get_oligo(HONEY).fill_sequence(None)  # type: ignore[arg-type]
    assert part.mutation_log == []


def _circular(p: dict) -> None:
    _segment_json(p, "seg-A0")["fivePrime"]["connectedSegmentId"] = "seg-A1"
    _segment_json(p, "seg-A1")["threePrime"]["connectedSegmentId"] = "seg-A0"


def test_circular_oligo_starts_at_the_lowest_5_prime_end_by_default() -> None:
    # Store seg-A1 first so the default can't come from storage order.
    def edit(p: dict) -> None:
        _circular(p)
        _oligo_json(p, HONEY)["segments"].reverse()

    part = _fixture(edit)
    oligo = part.get_oligo(HONEY)
    assert oligo.is_circular
    seq = "A" * 21 + "C" * 21
    oligo.fill_sequence(seq)
    # seg-A0 (VH 0, 5' at bp 0) comes before seg-A1 (VH 1, 5' at bp 20).
    assert part._segment_proxy("seg-A0").sequence == "A" * 21
    assert part._segment_proxy("seg-A1").sequence == "C" * 21
    assert oligo.sequence == seq
    assert part.mutation_log[-1] == {
        "op": M.OP_SET_OLIGO_SEQUENCE,
        "oligoId": HONEY,
        "sequence": seq,
        "startSegmentId": "seg-A0",
    }


def test_circular_oligo_takes_a_start_segment() -> None:
    part = _fixture(_circular)
    oligo = part.get_oligo(HONEY)
    oligo.fill_sequence("G" * 21 + "T" * 21, start=part._segment_proxy("seg-A1"))
    assert part._segment_proxy("seg-A1").sequence == "G" * 21
    assert part._segment_proxy("seg-A0").sequence == "T" * 21
    assert part.mutation_log[-1]["startSegmentId"] == "seg-A1"


def test_start_is_refused_on_a_linear_oligo_unless_it_is_the_5_prime_segment() -> None:
    part = _fixture()
    oligo = part.get_oligo(HONEY)
    with pytest.raises(InvalidOperationError, match="free 5' end"):
        oligo.fill_sequence("A" * 42, start=part._segment_proxy("seg-A1"))
    oligo.fill_sequence("A" * 42, start=part._segment_proxy("seg-A0"))
    assert "startSegmentId" not in part.mutation_log[-1]


def test_start_must_belong_to_the_oligo() -> None:
    part = _fixture(_circular)
    with pytest.raises(InvalidOperationError, match="not part of this oligo"):
        part.get_oligo(HONEY).fill_sequence("A" * 42, start=part._segment_proxy("seg-B0"))
    assert part.mutation_log == []


def _locked(p: dict) -> None:
    _oligo_json(p, HONEY)["isSequenceLocked"] = True


def test_fill_clears_the_lock() -> None:
    part = _fixture(_locked)
    oligo = part.get_oligo(HONEY)
    assert oligo.is_sequence_locked
    oligo.fill_sequence("A" * 42)
    assert not oligo.is_sequence_locked


def test_unchanged_bases_keep_the_lock() -> None:
    part = _fixture(_locked)
    oligo = part.get_oligo(HONEY)
    oligo.fill_sequence("N" * 42)
    assert oligo.is_sequence_locked


def test_slot_write_clears_the_lock_only_on_change() -> None:
    part = _fixture(_locked)
    seg = part._segment_proxy("seg-A0")
    seg.slot_at(3).seq = "N"
    assert part.get_oligo(HONEY).is_sequence_locked
    seg.slot_at(3).seq = "C"
    assert not part.get_oligo(HONEY).is_sequence_locked


def test_fill_never_writes_the_opposite_strand() -> None:
    scene = json.loads((FIXTURES / "foldnano_edit_parity.golden.json").read_text())["scenes"][0]
    part = load_part(json.dumps(scene["part"]))
    for vh in part.virtual_helices:
        for ss in (0, 1):
            if part.can_fill_empty_strand_set(vh.index, ss):
                part.fill_empty_strand_set(vh.index, ss)
    top, bottom = next(
        (t, b)
        for vh in part.virtual_helices
        for bp in range(vh.length)
        if (t := part.get_segment_at(vh.index, 0, bp)) is not None
        and (b := part.get_segment_at(vh.index, 1, bp)) is not None
        and t.oligo != b.oligo
    )
    before = bottom.oligo.sequence
    top.oligo.fill_sequence("A" * top.oligo.nucleotide_count)
    assert bottom.oligo.sequence == before
