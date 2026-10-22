"""
foldnano_mini.editing — composite edits planned on a scratch copy of the mirror.

``create_crossover`` / ``make_crossover`` / ``connect_oligos`` port the host's
``Part.createCrossover``, ``makeCrossoverCmd`` and ``Part.connectTwoOligos``.
They break and then connect, and what the host refuses after the break depends
on the state the break leaves. So each runs once on a :class:`Scratch` copy:
the run either raises :class:`InvalidOperationError` with the host's reason or
returns the ops to record. ``can_*`` and the real call share that one path.

The copy duplicates oligos, segments and strand-set id lists (O(segments)); slot
lists are shared, since these edits only reassign them.
"""

from __future__ import annotations

from typing import Any, Callable

from . import mutations as M
from . import repeat
from .checks import InvalidOperationError
from .topology import TopologyIndex, strand_index_from_direction, with_article
from .transport import _HANDLERS

IdAllocator = Callable[[], str]


class Scratch:
    def __init__(self, raw: dict[str, Any], new_oligo_id: IdAllocator, new_segment_id: IdAllocator):
        self.raw = {
            **raw,
            "oligos": [
                {
                    **o,
                    "segments": [
                        {
                            **s,
                            "fivePrime": dict(s["fivePrime"]),
                            "threePrime": dict(s["threePrime"]),
                            "slots": list(s.get("slots", [])),
                        }
                        for s in o.get("segments", [])
                    ],
                }
                for o in raw.get("oligos", [])
            ],
            "virtualHelices": [
                {
                    **vh,
                    "strandSets": [
                        {**ss, "segmentIds": list(ss.get("segmentIds", []))}
                        for ss in vh.get("strandSets", [])
                    ],
                }
                for vh in raw.get("virtualHelices", [])
            ],
        }
        self.ops: list[dict[str, Any]] = []
        self.new_oligo_id = new_oligo_id
        self.new_segment_id = new_segment_id

    def topology(self) -> TopologyIndex:
        return TopologyIndex(self.raw)

    def apply(self, op: dict[str, Any]) -> None:
        repeat.apply_op(self.raw, op, _HANDLERS[op["op"]])
        self.ops.append(op)

    # --- mirror reads ----------------------------------------------------

    def oligo(self, oligo_id: str) -> dict[str, Any] | None:
        return next((o for o in self.raw["oligos"] if o["id"] == oligo_id), None)

    def oligo_of(self, segment_id: str) -> dict[str, Any]:
        for o in self.raw["oligos"]:
            if any(s["id"] == segment_id for s in o["segments"]):
                return o
        raise InvalidOperationError(f"No segment with id {segment_id!r}")

    def segment(self, segment_id: str) -> dict[str, Any]:
        for o in self.raw["oligos"]:
            for s in o["segments"]:
                if s["id"] == segment_id:
                    return s
        raise InvalidOperationError(f"No segment with id {segment_id!r}")

    def strand_index(self, seg: dict[str, Any]) -> int:
        info = self.topology().segment(seg["id"])
        if info is not None:
            return info.strand_index
        return strand_index_from_direction(int(seg["fivePrime"]["index"]), int(seg["threePrime"]["index"]))


def five_end_segment(oligo: dict[str, Any]) -> dict[str, Any] | None:
    """``Oligo.fivePrimeEndSegment``: the segment with a free 5' end (None when circular)."""
    return next((s for s in oligo["segments"] if s["fivePrime"].get("connectedSegmentId") is None), None)


def three_end_segment(oligo: dict[str, Any]) -> dict[str, Any] | None:
    return next((s for s in oligo["segments"] if s["threePrime"].get("connectedSegmentId") is None), None)


def _five(seg: dict[str, Any]) -> int:
    return int(seg["fivePrime"]["index"])


def _three(seg: dict[str, Any]) -> int:
    return int(seg["threePrime"]["index"])


def connect_oligos(sc: Scratch, from_oligo: dict[str, Any], to_oligo: dict[str, Any]) -> None:
    """``Part.connectTwoOligos``: the oligo's free 3' end to the other's free 5' end.

    Recorded as a segment ``connect`` between those terminal segments, which the host
    applies identically. Like the editor's crossover commands, a modification on either
    joined end is cleared, since modifications only live on free ends.
    """
    x3 = three_end_segment(from_oligo)
    t5 = five_end_segment(to_oligo)
    if x3 is None or t5 is None:
        raise InvalidOperationError("Both oligos must have free ends to connect")
    if x3 is t5:
        raise InvalidOperationError("Cannot connect a segment's 3' end to its own 5' end")
    topo = sc.topology()
    for seg, bp in ((x3, _three(x3)), (t5, _five(t5))):
        kind = topo.slot_kind_at(int(seg["inVirtualHelixIndex"]), bp)
        if kind is not None:
            raise InvalidOperationError(
                f"Cannot connect at VH {seg['inVirtualHelixIndex']} bp {bp}: it is {with_article(kind)}"
            )
    for seg, end_key, end in ((x3, "threePrime", "3"), (t5, "fivePrime", "5")):
        if seg[end_key].get("modification") is not None:
            sc.apply(
                {
                    "op": M.OP_SET_SEGMENT_MODIFICATION,
                    "oligoId": sc.oligo_of(seg["id"])["id"],
                    "segmentId": seg["id"],
                    "end": end,
                    "modification": None,
                }
            )
    sc.apply({"op": M.OP_CONNECT, "fromSegmentId": x3["id"], "toSegmentId": t5["id"]})


def break_oligo(sc: Scratch, oligo: dict[str, Any], seg: dict[str, Any], at_index: int) -> dict[str, Any]:
    """Record a ``break_oligo``; returns the oligo holding the 3' side, like
    ``Oligo.breakOligoAt`` (the same oligo when nothing splits off)."""
    new_oligo_id = sc.new_oligo_id()
    sc.apply(
        {
            "op": M.OP_BREAK_OLIGO,
            "oligoId": oligo["id"],
            "segmentId": seg["id"],
            "atIndex": int(at_index),
            "newOligoId": new_oligo_id,
            "newSegmentId": sc.new_segment_id(),
        }
    )
    return sc.oligo(new_oligo_id) or oligo


def create_crossover(
    sc: Scratch, from_oligo: dict[str, Any], vh_index: int, strand_index: int, bp: int
) -> None:
    """Port of ``Part.createCrossover``: join ``from_oligo``'s free 3' end to the strand
    at ``(vh_index, strand_index, bp)``, breaking that strand just before ``bp``."""
    x3 = three_end_segment(from_oligo)
    if x3 is None:
        raise InvalidOperationError(f"Oligo {from_oligo['id']!r} has no free 3' end")
    to_id = sc.topology().segment_at(vh_index, strand_index, bp)
    if to_id is None:
        raise InvalidOperationError(f"No strand at VH {vh_index} strand {strand_index} bp {bp}")
    to_seg = sc.segment(to_id)
    to_oligo = sc.oligo_of(to_id)
    same = to_oligo is from_oligo
    if same and x3 is to_seg:
        raise InvalidOperationError("Cannot create a crossover within the same segment")
    to5 = five_end_segment(to_oligo)
    if not same and to_seg is three_end_segment(to_oligo) and bp == _three(to_seg):
        raise InvalidOperationError("Cannot create a crossover to a 3' end")
    ascending = sc.strand_index(to_seg) == 0
    if to5 is to_seg and bp == _five(to_seg) + (1 if ascending else -1):
        raise InvalidOperationError("Cannot create a crossover that leaves a 1-nt segment")
    # As the host: the target oligo's free 5' index is compared to bp, on any helix.
    if to5 is not None and _five(to5) == bp:
        connect_oligos(sc, from_oligo, to_oligo)
        return
    at = bp - 1 if ascending else bp + 1
    if not min(_five(to_seg), _three(to_seg)) <= at <= max(_five(to_seg), _three(to_seg)):
        raise InvalidOperationError(f"Cannot create a crossover onto the connected 5' end at bp {bp}")
    tail = break_oligo(sc, to_oligo, to_seg, at)
    connect_oligos(sc, tail if same else from_oligo, tail)


def make_crossover(sc: Scratch, vh_index: int, strand_index: int, bp: int, to_vh_index: int) -> None:
    """Port of ``makeCrossoverCmd``: cross the two strands at a potential crossover site.

    The strand whose 3' end leaves at the site is broken there, then joined to the other
    strand at the same bp (``create_crossover``).
    """
    topo = sc.topology()
    site = next(
        (
            s
            for s in topo.potential_xover_sites(vh_index)[strand_index]
            if s.bp_index == bp and s.to_vh_index == to_vh_index
        ),
        None,
    )
    if site is None:
        raise InvalidOperationError(
            f"No potential crossover site at VH {vh_index} strand {strand_index} bp {bp} "
            f"toward VH {to_vh_index}"
        )
    here = (vh_index, strand_index)
    there = (to_vh_index, 1 - strand_index)
    start, end = (here, there) if (strand_index == 0) != site.right else (there, here)

    end_id = topo.segment_at(end[0], end[1], bp)
    if end_id is None:
        raise InvalidOperationError(f"No strand at VH {end[0]} strand {end[1]} bp {bp}")
    end_seg = sc.segment(end_id)
    three = _three(end_seg)
    if bp in (three, three - 1 if sc.strand_index(end_seg) == 0 else three + 1):
        raise InvalidOperationError("Cannot create a crossover at or 1 nt away from a 3' end")
    start_id = topo.segment_at(start[0], start[1], bp)
    if start_id is None:
        # The host does nothing here; refusing says why.
        raise InvalidOperationError(f"No strand at VH {start[0]} strand {start[1]} bp {bp}")

    start_oligo = sc.oligo_of(start_id)
    break_oligo(sc, start_oligo, sc.segment(start_id), bp)
    create_crossover(sc, start_oligo, end[0], end[1], bp)
