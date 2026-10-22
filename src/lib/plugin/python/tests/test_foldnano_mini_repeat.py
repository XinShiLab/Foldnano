"""
Repeat groups in foldnano_mini: mirror oligos built and rebuilt in Python after every
op (as the host does on replay), read-only mirror proxies, and the group ops.

The Python → host half lives in ``test_scenario_log_matches_golden``: the log and the
expected state are written to ``fixtures/foldnano_mini_repeat_replay.golden.json`` and
``src/lib/plugin/foldnanoMiniRepeatReplay.spec.ts`` replays them on the real ``Part``.
Regenerate with ``UPDATE_FOLDNANO_MINI_REPEAT=1 pnpm test:python``, then run the spec.
"""

from __future__ import annotations

import itertools
import json
import os
import uuid
from pathlib import Path

import pytest

from foldnano_mini import (
    MIRROR_EDIT_ERROR,
    InvalidOperationError,
    MirrorOligo,
    MutableOligo,
    MutablePart,
    SegmentView,
    load_part,
)
from foldnano_mini.topology import slot_kind

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN_PATH = FIXTURES / "foldnano_mini_repeat_replay.golden.json"
UPDATING = os.environ.get("UPDATE_FOLDNANO_MINI_REPEAT") == "1"
STEP = 21


@pytest.fixture
def scene_json() -> str:
    """The honeycomb parity scene: 5 VHs, 42 bp, VH 2 strand 0 empty."""
    scene = json.loads((FIXTURES / "foldnano_mini_parity.golden.json").read_text())["scenes"][0]
    return json.dumps(scene["part"])


@pytest.fixture
def part(scene_json: str) -> MutablePart:
    return load_part(scene_json)


def spans(oligo) -> list[tuple[int, int, int]]:
    return [(s.vh_index, s.five_index, s.three_index) for s in oligo.segments]


def make_group(part: MutablePart, offset: int = STEP):
    a = part.create_oligo([(2, 2, 12)], color="#aa0000", name="a")
    group = part.create_repeat_group([a], offset)
    return a, group


# ---------------------------------------------------------------------------
# Building and reading mirrors
# ---------------------------------------------------------------------------


def test_create_builds_mirrors_immediately(part: MutablePart) -> None:
    before = len(part.oligos)
    a, group = make_group(part)
    assert len(part.oligos) == before + 2  # the original and its copy
    assert len(part.real_oligos) == before + 1
    [mirror] = group.mirrors
    assert isinstance(mirror, MirrorOligo) and mirror.is_mirror
    assert spans(mirror) == [(2, 23, 33)]
    assert mirror.color == "#aa0000" and mirror.name == "a"
    info = mirror.mirror_of
    assert info.group == group and info.source == a and info.instance.bp_offset == STEP
    assert mirror.source == a
    assert a.repeat_group == group and not a.is_mirror and a.mirror_of is None
    assert mirror.repeat_group is None
    assert group.name == "Repeat 1" and group.originals == [a]
    assert [type(o) for o in part.oligos].count(MirrorOligo) == 1


def test_mirror_occupies_its_bases(part: MutablePart) -> None:
    make_group(part)
    check = part.can_create_segment(2, 25, 30)
    assert not check and "occupied" in check.reason
    seg = part.get_segment_at(2, 0, 25)
    assert isinstance(seg, SegmentView) and seg.oligo.is_mirror


def test_add_instance_grows_the_region(part: MutablePart) -> None:
    _, group = make_group(part)
    inst = group.add_instance(2 * STEP)
    assert [i.bp_offset for i in group.instances] == [STEP, 2 * STEP]
    assert spans(group.mirrors_of(inst)[0]) == [(2, 44, 54)]
    assert part.regions[0].max_base == 63 and part.get_vh(2).length == 63


# ---------------------------------------------------------------------------
# Mirrors are read-only
# ---------------------------------------------------------------------------


def test_writes_to_a_mirror_are_refused(part: MutablePart) -> None:
    a, group = make_group(part)
    mirror = group.mirrors[0]
    log_len = len(part.mutation_log)
    with pytest.raises(InvalidOperationError, match="Mirror oligos can't be edited"):
        mirror.color = "#00ff00"
    with pytest.raises(InvalidOperationError, match="Mirror oligos can't be edited"):
        mirror.segments[0].slot_at(25).seq = "A"
    with pytest.raises(InvalidOperationError, match="Mirror oligos can't be edited"):
        part.remove_oligo(mirror)
    with pytest.raises(InvalidOperationError, match="Mirror oligos can't be edited"):
        part.break_at(2, 0, 28)
    assert not hasattr(mirror, "remove")
    assert part.can_break_at(2, 0, 28).reason == MIRROR_EDIT_ERROR
    assert part.can_connect(a.segments[0], mirror.segments[0]).reason == MIRROR_EDIT_ERROR
    assert not part.can_connect_oligos(a, mirror)
    assert len(part.mutation_log) == log_len


def test_skip_opposite_a_mirror_is_refused(part: MutablePart) -> None:
    make_group(part)
    opposite = part.get_segment_at(2, 1, 29)  # the scene's strand under the mirror
    assert not opposite.oligo.is_mirror
    assert opposite.slot_at(29).can_set_skip().reason == MIRROR_EDIT_ERROR
    assert part.can_add_skip_at(2, 29).reason == MIRROR_EDIT_ERROR


# ---------------------------------------------------------------------------
# Editing an original
# ---------------------------------------------------------------------------


def test_moving_an_original_moves_its_mirrors(part: MutablePart) -> None:
    a, group = make_group(part)
    a.segments[0].move_three_prime_to(15)
    assert spans(group.mirrors[0]) == [(2, 23, 36)]
    a.segments[0].move_three_prime_to(10)
    assert spans(group.mirrors[0]) == [(2, 23, 31)]
    # The bases the mirror left are free again, as they are on the host after this op.
    assert part.can_create_segment(2, 32, 35)


def test_attribute_writes_follow_to_mirrors(part: MutablePart) -> None:
    a, group = make_group(part)
    group.add_instance(2 * STEP)
    a.color = "#123456"
    a.name = "renamed"
    a.five_modification = "/5Bio/"
    a.segments[0].slot_at(5).seq = "G"
    for mirror, offset in zip(group.mirrors, (STEP, 2 * STEP)):
        assert mirror.color == "#123456" and mirror.name == "renamed"
        assert mirror.five_modification == "/5Bio/"
        assert mirror.segments[0].slot_at(5 + offset).seq == "G"


def test_an_edit_whose_mirror_cannot_fit_is_refused_and_not_applied(part: MutablePart) -> None:
    a, group = make_group(part)
    part.create_oligo([(2, 36, 38)])  # sits where the copy would grow to
    check = a.segments[0].three_prime.can_move_to(16)
    assert not check and check.reason.startswith("Copy 1 of Repeat 1:")
    before, log_len = part.to_json(), len(part.mutation_log)
    with pytest.raises(InvalidOperationError, match="Copy 1 of Repeat 1"):
        a.segments[0].move_three_prime_to(16)
    assert part.to_json() == before and len(part.mutation_log) == log_len


def test_break_keeps_both_halves_in_the_group(part: MutablePart) -> None:
    a, group = make_group(part)
    tail = part.break_oligo(a.segments[0], 6)
    assert tail.repeat_group == group and a.repeat_group == group
    assert sorted(spans(m)[0] for m in group.mirrors) == [(2, 23, 27), (2, 28, 33)]


def test_connect_joins_the_group_and_two_groups_cannot_join(part: MutablePart) -> None:
    a, group = make_group(part)
    plain = part.create_oligo([(3, 20, 25)])
    part.connect(a.segments[0], plain.segments[0])
    assert part.get_oligo(a.id).repeat_group == group
    assert sorted(spans(group.mirrors[0])) == [(2, 23, 33), (3, 41, 46)]

    other = part.create_oligo([(4, 34, 30)])
    other_group = part.create_repeat_group([other], STEP)
    check = part.can_connect(part.get_oligo(a.id).segments[-1], other.segments[0])
    assert check.reason == "Can't join oligos from two different repeat groups."
    assert other_group.originals == [other]


# ---------------------------------------------------------------------------
# Group ops
# ---------------------------------------------------------------------------


def test_group_op_checks(part: MutablePart) -> None:
    a, group = make_group(part)
    assert group.can_add_instance(STEP).reason == "Repeat 1 already has a copy at that offset."
    assert group.can_add_instance(0).reason == "Repeat 1 already has a copy at that offset."
    assert part.can_create_repeat_group([a], 2 * STEP).reason == (
        "Some selected oligos already belong to a repeat group."
    )
    assert part.can_create_repeat_group([group.mirrors[0]], 2 * STEP).reason == (
        "Mirrors can only be made from original oligos."
    )
    assert part.can_create_repeat_group([], STEP).reason == "Select oligos to mirror."
    b = part.create_oligo([(2, 14, 16)])
    assert part.can_create_repeat_group([b], 0).reason.endswith(
        "The copy would sit on top of the original."
    )
    overlap = part.can_create_repeat_group([b], 10).reason  # onto Repeat 1's mirror
    assert overlap == "Copy 1 of Repeat 2: The copy would overlap an existing strand on VH 2 (bp 24–26)."


def test_remove_last_instance_deletes_the_group(part: MutablePart) -> None:
    a, group = make_group(part)
    group.remove_instance(group.instances[0])
    assert part.repeat_groups == [] and a.repeat_group is None
    assert not any(o.is_mirror for o in part.oligos)
    assert "repeatGroups" not in part.to_json()


def test_detach_keeps_mirrors_as_editable_oligos(part: MutablePart) -> None:
    a, group = make_group(part)
    mirror_id = group.mirrors[0].id
    group.detach()
    freed = part.get_oligo(mirror_id)
    assert isinstance(freed, MutableOligo) and not freed.is_mirror
    freed.color = "#00ff00"
    assert a.repeat_group is None and part.repeat_groups == []


def test_delete_removes_mirrors(part: MutablePart) -> None:
    a, group = make_group(part)
    group.delete()
    assert part.get_oligo(a.id) is not None
    assert not any(o.is_mirror for o in part.oligos)


def test_remove_all_skips_leaves_mirrors_to_their_original(part: MutablePart) -> None:
    a = part.create_oligo([(0, 13, 20)])
    b = part.create_oligo([(0, 20, 13)])
    a.segments[0].slot_at(16).set_skip(True)
    group = part.create_repeat_group([a, b], STEP)
    assert {slot_kind(m.segments[0]._raw(), 37) for m in group.mirrors} == {"skip"}
    assert part.regions[0].remove_all_skips() == 1
    assert {slot_kind(m.segments[0]._raw(), 37) for m in group.mirrors} == {None}


# ---------------------------------------------------------------------------
# Loading host-made mirrors, and replaying a log
# ---------------------------------------------------------------------------


def test_reload_keeps_mirrors_without_rebuilding(part: MutablePart) -> None:
    a, group = make_group(part)
    data = part.to_json()
    # A host fingerprint has a different format; load rewrites it as Python's own.
    for o in data["oligos"]:
        if o.get("mirrorOf"):
            o["mirrorOf"]["structure"] = "s|host-format"
    reloaded = load_part(json.dumps(data))
    mirror_id = reloaded.repeat_groups[0].mirrors[0].id
    reloaded.get_oligo(a.id).color = "#0000ff"  # propagated in place, no rebuild
    reloaded.create_oligo([(4, 34, 30)])  # an unrelated edit leaves mirrors alone
    assert reloaded.repeat_groups[0].mirrors[0].id == mirror_id


def id_free(raw: dict) -> list:
    return sorted(
        (
            o.get("color"),
            bool(o.get("mirrorOf")),
            tuple(
                (s["inVirtualHelixIndex"], s["fivePrime"]["index"], s["threePrime"]["index"])
                for s in o["segments"]
            ),
        )
        for o in raw["oligos"]
    )


def test_log_replays_to_the_same_state(part: MutablePart, scene_json: str) -> None:
    scenario(part)
    replayed = MutablePart.replay_log_into_fresh_mirror(scene_json, part.mutation_log)
    assert id_free(replayed) == id_free(part.to_json())


# ---------------------------------------------------------------------------
# Python → host golden
# ---------------------------------------------------------------------------


def scenario(part: MutablePart) -> None:
    """Repeat groups on the honeycomb parity scene, ending with one group of two copies."""
    a = part.create_oligo([(0, 13, 20)], color="#aa0000", name="a")
    b = part.create_oligo([(0, 20, 13)], color="#0000aa", name="b")
    a.segments[0].slot_at(16).set_skip(True)
    group = part.create_repeat_group([a, b], STEP)
    group.add_instance(2 * STEP)

    # Grow, then shrink, an original: the bases its copy left are usable straight away
    # (the host must re-sync after the move too, or this create would hit the old copy).
    a.segments[0].move_three_prime_to(23)
    a.segments[0].move_three_prime_to(18)
    part.create_oligo([(0, 40, 43)], color="#00aa00")

    # Attribute writes copied onto mirrors.
    a.color = "#cc3300"
    a.segments[0].slot_at(14).seq = "G"
    b.three_modification = "/3Cy3/"

    # A connect pulls an ordinary oligo into the group; a break keeps both halves in it.
    plain = part.create_oligo([(3, 20, 25)], color="#777777")
    part.connect(part.get_oligo(a.id).segments[0], plain.segments[0])
    part.break_oligo(part.get_oligo(b.id).segments[0], 15)

    # A second group made, given a copy, then deleted.
    c = part.create_oligo([(4, 34, 30)], color="#999999")
    other = part.create_repeat_group([c], STEP)
    other.add_instance(-STEP)
    other.delete()


def summary(raw: dict) -> dict:
    """What the replay spec compares. Mirrors get fresh ids on each side, so they are keyed
    by (source, instance). Mirrored by ``summary()`` in the spec."""

    def path(o: dict) -> list:
        return sorted(
            [
                s["inVirtualHelixIndex"],
                s["fivePrime"]["index"],
                s["threePrime"]["index"],
                s["fivePrime"].get("modification"),
                s["threePrime"].get("modification"),
                sorted(
                    [slot["bpIndex"], slot_kind(s, slot["bpIndex"])]
                    for slot in s.get("slots", [])
                    if slot_kind(s, slot["bpIndex"]) is not None
                ),
            ]
            for s in o["segments"]
        )

    real = sorted(
        [o["id"], o["color"], o.get("repeatGroupId"), path(o)]
        for o in raw["oligos"]
        if not o.get("mirrorOf")
    )
    mirrors = sorted(
        [o["mirrorOf"]["sourceOligoId"], o["mirrorOf"]["instanceId"], o["color"], path(o)]
        for o in raw["oligos"]
        if o.get("mirrorOf")
    )
    groups = sorted(
        [g["id"], g["name"], [[i["id"], i["bpOffset"]] for i in g["instances"]]]
        for g in raw.get("repeatGroups", [])
    )
    return {
        "real": real,
        "mirrors": mirrors,
        "groups": groups,
        "vhs": sorted([vh["index"], vh["length"]] for vh in raw["virtualHelices"]),
        "regions": sorted(
            [r["id"], r.get("maxBase", r.get("defaultMaxBase"))] for r in raw.get("regions", [])
        ),
    }


@pytest.fixture
def seeded_uuids(monkeypatch: pytest.MonkeyPatch) -> None:
    counter = itertools.count()
    monkeypatch.setattr(uuid, "uuid4", lambda: uuid.UUID(int=next(counter)))


def test_scenario_log_matches_golden(seeded_uuids: None, scene_json: str) -> None:
    part = load_part(scene_json)
    scenario(part)
    expected = summary(part.to_json())
    assert len(expected["groups"]) == 1 and len(expected["mirrors"]) == 6
    golden = {"part": json.loads(scene_json), "log": part.mutation_log, "expected": expected}
    if UPDATING or not GOLDEN_PATH.exists():
        GOLDEN_PATH.write_text(json.dumps(golden) + "\n")
    committed = json.loads(GOLDEN_PATH.read_text())
    assert golden == committed
