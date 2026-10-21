"""
foldnano_mini.topology — occupancy index and slot helpers over the mirror dict.

:class:`TopologyIndex` is derived state: ``MutablePart`` rebuilds it lazily on
the first query after any op (it compares a generation counter that every
``_apply`` bumps), so no op can leave it stale by being forgotten in an
invalidation list. A loop of writes costs nothing extra; the next query pays
one O(segments) rebuild.
"""

from __future__ import annotations

import bisect
from typing import Any, NamedTuple

from . import lattice
from .lattice import CrossoverSite


class SegmentInfo(NamedTuple):
    segment_id: str
    oligo_id: str
    vh_index: int
    strand_index: int
    five: int
    three: int

    @property
    def low(self) -> int:
        return min(self.five, self.three)

    @property
    def high(self) -> int:
        return max(self.five, self.three)


def strand_index_from_direction(five: int, three: int) -> int:
    """The host's rule in ``Part.createOligo``: ``5' < 3'`` → strand set 0, else 1."""
    return 0 if five < three else 1


class TopologyIndex:
    """Per VH, per strand set: segment intervals sorted by their low bp."""

    def __init__(self, raw: dict[str, Any]) -> None:
        self._raw = raw
        self._vhs: dict[int, dict[str, Any]] = {
            int(vh["index"]): vh for vh in raw.get("virtualHelices", [])
        }
        strand_of: dict[str, int] = {}
        for vh in self._vhs.values():
            for ss_idx, ss in enumerate(vh.get("strandSets", [])[:2]):
                for seg_id in ss.get("segmentIds", []):
                    strand_of[seg_id] = ss_idx

        self._segments: dict[str, SegmentInfo] = {}
        self._raw_segments: dict[str, dict[str, Any]] = {}
        self._intervals: dict[tuple[int, int], list[tuple[int, int, str]]] = {}
        for oligo in raw.get("oligos", []):
            for seg in oligo.get("segments", []):
                five = int(seg["fivePrime"]["index"])
                three = int(seg["threePrime"]["index"])
                ss_idx = strand_of.get(seg["id"])
                if ss_idx is None:
                    ss_idx = strand_index_from_direction(five, three)
                info = SegmentInfo(
                    seg["id"], oligo["id"], int(seg["inVirtualHelixIndex"]), ss_idx, five, three
                )
                self._segments[info.segment_id] = info
                self._raw_segments[info.segment_id] = seg
                self._intervals.setdefault((info.vh_index, ss_idx), []).append(
                    (info.low, info.high, info.segment_id)
                )
        for intervals in self._intervals.values():
            intervals.sort()
        self._sites: dict[int, list[list[CrossoverSite]]] = {}

    # --- lookups ---------------------------------------------------------

    def vh(self, vh_index: int) -> dict[str, Any] | None:
        return self._vhs.get(vh_index)

    def segment(self, segment_id: str) -> SegmentInfo | None:
        return self._segments.get(segment_id)

    def raw_segment(self, segment_id: str) -> dict[str, Any] | None:
        return self._raw_segments.get(segment_id)

    def intervals(self, vh_index: int, strand_index: int) -> list[tuple[int, int, str]]:
        return self._intervals.get((vh_index, strand_index), [])

    def segments_overlapping(
        self, vh_index: int, strand_index: int, lo: int, hi: int
    ) -> list[str]:
        """Ids of segments on one strand set whose range intersects ``[lo, hi]``."""
        if lo > hi:
            lo, hi = hi, lo
        intervals = self.intervals(vh_index, strand_index)
        # Intervals on one strand set don't overlap, so their highs are sorted too.
        start = bisect.bisect_left(intervals, (lo,))
        if start > 0 and intervals[start - 1][1] >= lo:
            start -= 1
        out: list[str] = []
        for a, b, seg_id in intervals[start:]:
            if a > hi:
                break
            if b >= lo:
                out.append(seg_id)
        return out

    def segment_at(self, vh_index: int, strand_index: int, bp: int) -> str | None:
        hits = self.segments_overlapping(vh_index, strand_index, bp, bp)
        return hits[0] if hits else None

    def free_ranges(
        self, vh_index: int, strand_index: int, lo: int, hi: int
    ) -> list[tuple[int, int]]:
        """Maximal free inclusive ranges within ``[lo, hi]``."""
        out: list[tuple[int, int]] = []
        cursor = lo
        for a, b, _ in self.intervals(vh_index, strand_index):
            if b < cursor:
                continue
            if a > hi:
                break
            if a > cursor:
                out.append((cursor, a - 1))
            cursor = max(cursor, b + 1)
        if cursor <= hi:
            out.append((cursor, hi))
        return out

    # --- crossover sites -------------------------------------------------

    def potential_xover_sites(self, vh_index: int) -> list[list[CrossoverSite]]:
        cached = self._sites.get(vh_index)
        if cached is None:
            vh = self._vhs.get(vh_index)
            cached = [[], []] if vh is None else lattice.potential_xover_sites(self._raw, vh)
            self._sites[vh_index] = cached
        return cached

    def is_connection_constrained(
        self, vh_a: int, strand_a: int, bp_a: int, vh_b: int, strand_b: int, bp_b: int
    ) -> bool:
        """Port of ``Part.isConnectionConstrained``; the ``right`` flag is not compared."""
        if strand_a == strand_b or bp_a != bp_b:
            return False
        vh = self._vhs.get(vh_a)
        if vh is None:
            return False
        return lattice.site_at(self._raw, vh, strand_a, bp_a, vh_b) is not None

    def is_end_constrained(self, segment_id: str, is_three_prime: bool) -> bool:
        """Port of the host's derived ``SegmentEnd.isConstrained``."""
        info = self._segments.get(segment_id)
        raw_seg = self._raw_segments.get(segment_id)
        if info is None or raw_seg is None:
            return False
        end = raw_seg["threePrime" if is_three_prime else "fivePrime"]
        partner_id = end.get("connectedSegmentId")
        partner = self._segments.get(partner_id) if partner_id else None
        if partner is None:
            return False
        partner_bp = partner.five if is_three_prime else partner.three
        own_bp = info.three if is_three_prime else info.five
        return self.is_connection_constrained(
            info.vh_index, info.strand_index, own_bp,
            partner.vh_index, partner.strand_index, partner_bp,
        )

    def has_constrained_end_at(self, vh_index: int, bp: int) -> bool:
        """True when either strand has a connected, constrained end at ``bp``.

        Mirrors the host's ``hasConstrainedXoverAtPosition``.
        """
        for strand_index in (0, 1):
            seg_id = self.segment_at(vh_index, strand_index, bp)
            if seg_id is None:
                continue
            info = self._segments[seg_id]
            for is_three in (False, True):
                if (info.three if is_three else info.five) == bp and self.is_end_constrained(
                    seg_id, is_three
                ):
                    return True
        return False

    # --- skips / insertions ---------------------------------------------

    def slot_kind_at(self, vh_index: int, bp: int) -> str | None:
        """``"skip"`` / ``"insertion"`` when either strand's slot at ``bp`` is one, else ``None``.

        The host keeps both strands' slots in step, so either strand answers it.
        """
        for strand_index in (0, 1):
            seg_id = self.segment_at(vh_index, strand_index, bp)
            if seg_id is None:
                continue
            kind = slot_kind(self._raw_segments[seg_id], bp)
            if kind is not None:
                return kind
        return None


def with_article(slot_kind: str) -> str:
    """``"a skip"`` / ``"an insertion"``, for refusal messages."""
    return f"an {slot_kind}" if slot_kind[0] in "aeiou" else f"a {slot_kind}"


def slot_length(raw_segment: dict[str, Any], bp: int) -> int:
    """Bases the slot at ``bp`` holds: 0 for a skip, more than 1 for an insertion, 1 for a
    plain base (including a slot the mirror hasn't stored)."""
    slot = find_slot(raw_segment, bp)
    if slot is None:
        return 1
    return 0 if slot_kind(raw_segment, bp) == "skip" else len(slot.get("seq") or "N")


def find_slot(raw_segment: dict[str, Any], bp: int) -> dict[str, Any] | None:
    for slot in raw_segment.get("slots", []):
        if slot.get("bpIndex") == bp:
            return slot
    return None


def slot_kind(raw_segment: dict[str, Any], bp: int) -> str | None:
    """``"skip"`` / ``"insertion"`` / ``None`` for one segment's slot at ``bp``.

    Host-exported slots encode a skip as ``seq == ""`` and an insertion as a
    longer ``seq``; the offline mirror also stamps an explicit ``skip`` flag.
    A missing slot is a plain base.
    """
    slot = find_slot(raw_segment, bp)
    if slot is None:
        return None
    seq = slot.get("seq", "")
    if slot.get("skip", seq == ""):
        return "skip"
    if len(seq) > 1:
        return "insertion"
    return None
