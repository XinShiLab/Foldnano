"""
Parity with the host model: the Python checks and crossover-site port must agree
with what ``src/lib/plugin/foldnanoMiniParity.spec.ts`` recorded from the real
``Part`` (regenerate with ``UPDATE_FOLDNANO_MINI_PARITY=1 pnpm vitest run
src/lib/plugin/foldnanoMiniParity.spec.ts``).

The scenes have no skips or insertions, so the rules where Python is
deliberately stricter than replay never come into play here.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from foldnano_mini import load_part

GOLDEN = json.loads(
    (Path(__file__).parent / "fixtures" / "foldnano_mini_parity.golden.json").read_text()
)
SCENES = {scene["name"]: scene for scene in GOLDEN["scenes"]}


@pytest.fixture(params=sorted(SCENES))
def scene(request: pytest.FixtureRequest) -> dict:
    return SCENES[request.param]


def _part(scene: dict):
    return load_part(json.dumps(scene["part"]))


def test_potential_xover_sites_match_host(scene: dict) -> None:
    part = _part(scene)
    for vh_index, strands in scene["sites"].items():
        got = part.potential_xover_sites(int(vh_index))
        assert [[list(site) for site in strand] for strand in got] == strands, vh_index


def test_is_constrained_matches_host(scene: dict) -> None:
    part = _part(scene)
    seen = 0
    for oligo in part.oligos:
        for seg in oligo.segments:
            raw = seg._raw()
            assert seg.five_prime.is_constrained == raw["fivePrime"]["isConstrained"], seg.id
            assert seg.three_prime.is_constrained == raw["threePrime"]["isConstrained"], seg.id
            seen += raw["fivePrime"]["isConstrained"] + raw["threePrime"]["isConstrained"]
    assert seen == 2  # the scene's one site crossover, both ends


def test_move_checks_match_host(scene: dict) -> None:
    part = _part(scene)
    mismatches = []
    for seg_id, is_three, bp, host_ok in scene["moves"]:
        seg = part._segment_proxy(seg_id)
        end = seg.three_prime if is_three else seg.five_prime
        check = end.can_move_to(bp)
        if bool(check) != host_ok:
            mismatches.append((seg_id, is_three, bp, host_ok, check.reason))
    assert mismatches == []


def test_create_checks_match_host(scene: dict) -> None:
    part = _part(scene)
    mismatches = []
    for vh_index, five, three, host_ok in scene["creates"]:
        check = part.can_create_segment(vh_index, five, three)
        if bool(check) != host_ok:
            mismatches.append((vh_index, five, three, host_ok, check.reason))
    assert mismatches == []


def test_connect_checks_match_host(scene: dict) -> None:
    part = _part(scene)
    mismatches = []
    for from_id, to_id, host_ok in scene["connects"]:
        check = part.can_connect(part._segment_proxy(from_id), part._segment_proxy(to_id))
        if bool(check) != host_ok:
            mismatches.append((from_id, to_id, host_ok, check.reason))
    assert mismatches == []


# ---------------------------------------------------------------------------
# Composite edits: same outcome as the host
# ---------------------------------------------------------------------------


def _structure(part) -> list:
    """Id-free topology, as ``structure()`` in the parity spec."""
    out = []
    for oligo in part.oligos:
        segs = oligo._raw()["segments"]
        by_id = {s["id"]: s for s in segs}
        key = lambda s: [s["inVirtualHelixIndex"], s["fivePrime"]["index"], s["threePrime"]["index"]]
        start = next((s for s in segs if s["fivePrime"]["connectedSegmentId"] is None), None)
        circular = start is None
        if start is None:
            start = min(segs, key=key)
        path, cur = [], start
        while cur is not None and len(path) < len(segs):
            path.append(key(cur))
            cur = by_id.get(cur["threePrime"]["connectedSegmentId"])
        out.append([circular, path])
    return sorted(out, key=lambda o: json.dumps(o, separators=(",", ":")))


def _run(part, call: str, args: list) -> None:
    if call == "break_at":
        part.break_at(*args)
    elif call == "create_crossover":
        from_id, *pos = args
        part.create_crossover(part.get_oligo(from_id), *pos)
    elif call == "make_crossover":
        part.make_crossover(*args)
    elif call == "connect_oligos":
        part.connect_oligos(part.get_oligo(args[0]), part.get_oligo(args[1]))
    elif call == "fill_empty_strand_set":
        part.fill_empty_strand_set(*args)
    elif call == "remove_segment":
        part.remove_segment(part._segment_proxy(args[0]))
    else:
        raise AssertionError(call)


# Where the host returns early without an error, Python refuses with a reason instead. The
# golden can't tell that early return from an edit that leaves the design as it was (re-making
# an existing crossover), so for these an unchanged host result accepts either answer.
_REFUSES_HOST_NOOP = {"make_crossover", "fill_empty_strand_set"}


def test_composite_edits_match_host(scene: dict) -> None:
    from foldnano_mini import InvalidOperationError

    mismatches = []
    for call, args, threw, changed, expected in scene["outcomes"]:
        part = _part(scene)
        try:
            _run(part, call, args)
            refused = None
        except InvalidOperationError as e:
            refused = str(e)
        if not threw and not changed and call in _REFUSES_HOST_NOOP:
            if refused is None and _structure(part) != expected:
                mismatches.append((call, args, "different result", _structure(part), expected))
            continue
        host_ok = not threw
        if (refused is None) != host_ok:
            mismatches.append((call, args, "host ok" if host_ok else "host refused", refused))
        elif refused is None and _structure(part) != expected:
            mismatches.append((call, args, "different result", _structure(part), expected))
    assert mismatches == []
