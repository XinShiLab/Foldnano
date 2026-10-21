"""
Python → host replay golden: a script using the editing API writes a mutation log;
``src/lib/plugin/foldnanoMiniReplay.spec.ts`` replays it on the real ``Part`` and
checks the host ends where the Python mirror did, ids included. That proves the ops
carry every id the host needs (e.g. the stub segment of a mid-segment break).

Regenerate after changing the scenario or the API with
``UPDATE_FOLDNANO_MINI_REPLAY=1 pnpm test:python``, then run the spec.
"""

from __future__ import annotations

import itertools
import json
import os
import uuid
from pathlib import Path

import pytest

from foldnano_mini import MutablePart, load_part
from foldnano_mini.topology import slot_kind

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN_PATH = FIXTURES / "foldnano_mini_replay.golden.json"
UPDATING = os.environ.get("UPDATE_FOLDNANO_MINI_REPLAY") == "1"


def summary(raw: dict) -> dict:
    """What the replay spec compares: ids, topology, colors, modifications, skips/insertions,
    VH lengths and region bounds. Mirrored by ``summary()`` in the spec."""
    oligos = []
    for o in sorted(raw["oligos"], key=lambda o: o["id"]):
        segs = []
        for s in sorted(o["segments"], key=lambda s: s["id"]):
            mods = sorted(
                [slot["bpIndex"], slot_kind(s, slot["bpIndex"]), len(slot.get("seq") or "")]
                for slot in s.get("slots", [])
                if slot_kind(s, slot["bpIndex"]) is not None
            )
            segs.append(
                [
                    s["id"],
                    s["inVirtualHelixIndex"],
                    s["fivePrime"]["index"],
                    s["threePrime"]["index"],
                    s["fivePrime"]["connectedSegmentId"],
                    s["threePrime"]["connectedSegmentId"],
                    s["fivePrime"].get("modification"),
                    s["threePrime"].get("modification"),
                    mods,
                ]
            )
        oligos.append([o["id"], o["color"], bool(o.get("isScaffold")), segs])
    return {
        "oligos": oligos,
        "vhs": sorted([vh["index"], vh["length"]] for vh in raw["virtualHelices"]),
        "regions": sorted(
            [r["id"], r.get("maxBase", r.get("defaultMaxBase"))] for r in raw.get("regions", [])
        ),
    }


def _first_allowed(candidates, check):
    return next((c for c in candidates if check(*c)), None)


def scenario(part: MutablePart) -> None:
    """Exercise the editing API on the honeycomb parity scene."""
    vh_indices = [vh.index for vh in part.virtual_helices]
    length = part.get_vh(0).length

    # Fill empty strands, then cross them over at lattice sites.
    for vh, ss in itertools.product(vh_indices[:4], (0, 1)):  # VH 4 keeps room for a path
        if part.can_fill_empty_strand_set(vh, ss):
            part.fill_empty_strand_set(vh, ss, color="#3366cc")
    sites = [
        (vh, ss, site.bp_index, site.to_vh_index)
        for vh in vh_indices
        for ss in (0, 1)
        for site in part.get_vh(vh).potential_xover_sites(ss)
    ]
    made = 0
    for site in sites:
        if made < 4 and part.can_make_crossover(*site):
            part.make_crossover(*site)
            made += 1
    assert made == 4

    # A path oligo, then a crossover from its 3' end into the middle of another strand.
    free = part.get_vh(4).strand_sets[1].free_ranges()[0]
    path = part.create_oligo([(4, free[0] + 9, free[0])], color="#aa3300", name="path")
    target = _first_allowed(
        [(path, vh, ss, bp) for vh in vh_indices for ss in (0, 1) for bp in range(4, length - 4)],
        part.can_create_crossover,
    )
    part.create_crossover(*target)

    # Join two oligos end to end, then break one with the break tool.
    oligos = sorted(part.oligos, key=lambda o: o.id)
    pair = _first_allowed(
        [(a, b) for a in oligos for b in oligos if a != b], part.can_connect_oligos
    )
    part.connect_oligos(*pair)
    spot = _first_allowed(
        [(vh, ss, bp) for vh in vh_indices for ss in (0, 1) for bp in range(8, length - 8)],
        lambda vh, ss, bp: bool(part.get_segment_at(vh, ss, bp)) and part.can_break_at(vh, ss, bp)
        and part.get_end_at(vh, ss, bp) is None,
    )
    part.break_at(*spot)

    # Modifications on free ends, then remove a middle segment of a multi-segment oligo.
    longest = max(part.oligos, key=lambda o: (len(o.segments), o.id))
    longest.five_modification = "/5Bio/"
    longest.three_modification = "/3Cy3/"
    middle = next(
        s for s in longest.segments if not s.five_prime.is_free and not s.three_prime.is_free
    )
    part.remove_segment(middle)

    # Skips and insertions, then clear the skips in the region.
    region = part.regions[0]
    placed = 0
    for vh, ss, bp in itertools.product(vh_indices, (0,), range(5, length - 5)):
        seg = part.get_segment_at(vh, ss, bp)
        if seg is None or placed >= 3:
            continue
        slot = seg.slot_at(bp)
        if placed < 2 and slot.can_set_skip():
            slot.set_skip(True)
            placed += 1
        elif placed == 2 and slot.can_set_insertion():
            slot.set_insertion("AT")
            placed += 1
    assert placed == 3
    assert region.remove_all_skips() == 2

    # The skip and insert tools, both strands at once.
    duplex = next(
        (vh, bp)
        for vh, bp in itertools.product(vh_indices, range(6, length - 6))
        if part.can_add_insert_at(vh, bp) and part.can_add_skip_at(vh, bp + 3)
    )
    vh, bp = duplex
    part.add_insert_at(vh, bp)
    part.add_insert_at(vh, bp, count=2)
    part.add_skip_at(vh, bp + 3)
    assert [part.get_slot_at(vh, ss, bp).seq for ss in (0, 1)] == ["NNNN", "NNNN"]
    part.remove_skip_or_insertion_at(vh, bp + 3)

    # A circular oligo opened by a break, and the region grown then trimmed back.
    region.increase_length_by(region.step)
    ring = part.create_oligo(
        [(2, length + 2, length + 12), (3, length + 12, length + 2)], circular=True
    )
    opened = part.break_oligo(ring.segments[0], length + 6)
    assert opened.id == ring.id and not opened.is_circular
    part.remove_oligo(opened)
    region.reduce_unused_length()
    assert region.max_base == length


@pytest.fixture
def seeded_uuids(monkeypatch: pytest.MonkeyPatch) -> None:
    counter = itertools.count()
    monkeypatch.setattr(uuid, "uuid4", lambda: uuid.UUID(int=next(counter)))


def test_scenario_log_matches_golden(seeded_uuids: None) -> None:
    scene = json.loads((FIXTURES / "foldnano_mini_parity.golden.json").read_text())["scenes"][0]
    part = load_part(json.dumps(scene["part"]))
    scenario(part)
    golden = {"part": scene["part"], "log": part.mutation_log, "expected": summary(part.to_json())}
    if UPDATING or not GOLDEN_PATH.exists():
        GOLDEN_PATH.write_text(json.dumps(golden) + "\n")
    committed = json.loads(GOLDEN_PATH.read_text())
    assert golden == committed
