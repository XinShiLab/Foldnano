"""
foldnano_mini.oligo — mutable Oligo / Segment / Slot proxies.

Reads pass through to the in-worker mirror dict. Writes go through the
transport, which appends an op to the mutation log AND mutates the mirror.
After every mutation, the proxy can still be read normally — the next
read returns the post-mutation state.

A proxy holds an ``id`` (and a parent reference for segments/slots). That
identity is what's recorded in ops. If the underlying entity is removed, the
proxy becomes "stale": further reads/writes raise ``KeyError`` because the
mirror no longer has a record under that id.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from . import invariants, mutations as M
from .checks import Check, InvalidOperationError
from .topology import slot_length

if TYPE_CHECKING:
    from .part import MutablePart
    from .vh import MutableVirtualHelix


class MutableSlot:
    """One position on a segment — sequence, skip, or insertion."""

    __slots__ = ("_part", "_segment_id", "_bp_index")

    def __init__(
        self,
        part: "MutablePart",
        oligo_id: str,  # kept for source-compat; resolved fresh each call
        segment_id: str,
        bp_index: int,
    ) -> None:
        self._part = part
        self._segment_id = segment_id
        self._bp_index = bp_index

    @property
    def _oligo_id(self) -> str:
        oid = self._part._resolve_oligo_id_for_segment(self._segment_id)
        if oid is None:
            raise KeyError(f"Segment {self._segment_id!r} no longer exists")
        return oid

    def _raw(self) -> dict[str, Any] | None:
        seg = self._part._raw_segment(self._oligo_id, self._segment_id)
        for s in seg.get("slots", []):
            if s.get("bpIndex") == self._bp_index:
                return s
        return None

    @property
    def bp_index(self) -> int:
        return self._bp_index

    @property
    def seq(self) -> str:
        raw = self._raw()
        return raw.get("seq", "") if raw else ""

    @seq.setter
    def seq(self, value: str) -> None:
        """Write this slot's bases. The length must stay as it is (one base, none for a
        skip, n for an insertion): a longer or shorter write would change one strand only.
        Use ``part.add_insert_at`` / ``add_skip_at`` / ``remove_skip_or_insertion_at``
        to change that."""
        if not isinstance(value, str):
            raise TypeError(f"seq must be str, got {type(value).__name__}")
        current = slot_length(self._part._raw_segment(self._oligo_id, self._segment_id), self._bp_index)
        if len(value) != current:
            raise InvalidOperationError(
                f"seq at bp {self._bp_index} holds {current} base(s); writing {len(value)} would "
                "make the strands differ. Use part.add_insert_at / add_skip_at / "
                "remove_skip_or_insertion_at to change its length."
            )
        self._part._apply(
            {
                "op": M.OP_SET_SLOT_SEQUENCE,
                "oligoId": self._oligo_id,
                "segmentId": self._segment_id,
                "bpIndex": self._bp_index,
                "seq": value,
            }
        )

    @property
    def skip(self) -> bool:
        raw = self._raw()
        return bool(raw.get("skip", False)) if raw else False

    def can_set_skip(self) -> Check:
        """Whether ``set_skip(True)`` is allowed here.

        Refused at a segment end, at a constrained crossover bp (either strand),
        without a complementary strand, or when either strand's slot is already
        a skip or insertion.
        """
        return self._part._check_skip_or_insertion(self._segment_id, self._bp_index, skip=True)

    def can_set_insertion(self) -> Check:
        """Whether ``set_insertion(...)`` is allowed here (same rules as a skip, but an
        existing insertion may be replaced)."""
        return self._part._check_skip_or_insertion(self._segment_id, self._bp_index, skip=False)

    def set_skip(self, value: bool) -> None:
        if value:
            self.can_set_skip().raise_if_failed()
        self._part._apply(
            {
                "op": M.OP_SET_SLOT_SKIP,
                "oligoId": self._oligo_id,
                "segmentId": self._segment_id,
                "bpIndex": self._bp_index,
                "skip": bool(value),
            }
        )

    def remove_skip_or_insertion(self) -> None:
        """Turn a skip or insertion back into a plain base on both strands
        (``OligoSegment.removeSkipOrInsertion``); a plain slot is left alone."""
        self._part._apply(
            {
                "op": M.OP_SET_SLOT_SKIP,
                "oligoId": self._oligo_id,
                "segmentId": self._segment_id,
                "bpIndex": self._bp_index,
                "skip": False,
            }
        )

    def set_insertion(self, sequence: str) -> None:
        if not isinstance(sequence, str) or len(sequence) < 1:
            raise ValueError("insertion sequence must be a non-empty string")
        self.can_set_insertion().raise_if_failed()
        self._part._apply(
            {
                "op": M.OP_SET_SLOT_INSERTION,
                "oligoId": self._oligo_id,
                "segmentId": self._segment_id,
                "bpIndex": self._bp_index,
                "insertion": sequence,
            }
        )


class MutableSegmentEnd:
    """One end of a segment — mirrors the host's ``SegmentEnd`` (``FivePrimeEnd`` /
    ``ThreePrimeEnd``).

    Reach it as ``segment.five_prime`` / ``segment.three_prime`` (or
    ``oligo.five_prime`` / ``oligo.three_prime``). Setting ``index`` moves the end,
    like assigning ``SegmentEnd.index`` on the host.
    """

    __slots__ = ("_part", "_segment_id", "_is_three_prime")

    def __init__(self, part: "MutablePart", segment_id: str, is_three_prime: bool) -> None:
        self._part = part
        self._segment_id = segment_id
        self._is_three_prime = is_three_prime

    def _raw(self) -> dict[str, Any]:
        seg = self.segment._raw()
        return seg["threePrime" if self._is_three_prime else "fivePrime"]

    @property
    def segment(self) -> "MutableSegment":
        return MutableSegment(self._part, "", self._segment_id)

    @property
    def is_three_prime(self) -> bool:
        return self._is_three_prime

    @property
    def index(self) -> int:
        return int(self._raw()["index"])

    @index.setter
    def index(self, new_index: int) -> None:
        self.can_move_to(new_index).raise_if_failed()
        self._part._apply(
            {
                "op": M.OP_MOVE_TERMINUS,
                "segmentId": self._segment_id,
                "end": "3" if self._is_three_prime else "5",
                "toIndex": new_index,
            }
        )

    def can_move_to(self, new_index: int) -> Check:
        """Port of ``SegmentEnd.canMoveTo``: within the VH length, the swept range free
        of other segments, the segment keeps its direction, and a constrained end
        only moves to a matching crossover site. Also refuses a skip/insertion bp."""
        return self._part._check_move_end(self._segment_id, self._is_three_prime, new_index)

    @property
    def modification(self) -> str | None:
        return self._raw().get("modification")

    @modification.setter
    def modification(self, value: str | None) -> None:
        """Set or clear (``None``) this end's modification; only a free end can carry one,
        as in the editor's modification tool."""
        if value is not None and not self.is_free:
            label = "3'" if self._is_three_prime else "5'"
            raise InvalidOperationError(
                f"Cannot set a modification on the connected {label} end of segment "
                f"{self._segment_id!r}: modifications live on free ends"
            )
        self._part._apply(
            {
                "op": M.OP_SET_SEGMENT_MODIFICATION,
                "oligoId": self.segment.oligo_id,
                "segmentId": self._segment_id,
                "end": "3" if self._is_three_prime else "5",
                "modification": value,
            }
        )

    @property
    def connected_segment(self) -> "MutableSegment | None":
        seg_id = self._raw().get("connectedSegmentId")
        return MutableSegment(self._part, "", seg_id) if seg_id else None

    @property
    def connected_end(self) -> "MutableSegmentEnd | None":
        """The end on the other side of this end's connection (3' ↔ 5')."""
        seg_id = self._raw().get("connectedSegmentId")
        return MutableSegmentEnd(self._part, seg_id, not self._is_three_prime) if seg_id else None

    @property
    def is_free(self) -> bool:
        return self._raw().get("connectedSegmentId") is None

    @property
    def is_constrained(self) -> bool:
        """True when this end is connected across a lattice crossover site.

        Recomputed from the current mirror like the host's derived
        ``SegmentEnd.isConstrained`` (the JSON field is only a snapshot): the two
        ends sit on different strand indices at the same bp, and this end's VH has a
        potential crossover site there pointing at the other VH. Freeform
        connections are never constrained.
        """
        return self._part._topology().is_end_constrained(self._segment_id, self._is_three_prime)

    @property
    def in_virtual_helix(self) -> "MutableVirtualHelix":
        return self.segment.in_virtual_helix

    @property
    def in_strand_index(self) -> int:
        return self.segment.in_strand_index

    def is_adjacent_to(self, other: "MutableSegmentEnd") -> bool:
        """Port of ``SegmentEnd.isAdjacentTo``: same VH and strand, 1 bp apart.

        A ``connect`` between adjacent ends merges the two segments into one.
        """
        if not isinstance(other, MutableSegmentEnd):
            raise TypeError("is_adjacent_to() takes a MutableSegmentEnd")
        a, b = self.segment, other.segment
        if a.vh_index != b.vh_index or a.in_strand_index != b.in_strand_index:
            return False
        return abs(self.index - other.index) == 1

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, MutableSegmentEnd)
            and other._segment_id == self._segment_id
            and other._is_three_prime == self._is_three_prime
        )

    def __hash__(self) -> int:
        return hash((self._segment_id, self._is_three_prime))

    def __repr__(self) -> str:
        label = "3'" if self._is_three_prime else "5'"
        return f"MutableSegmentEnd({label}, segment={self._segment_id!r}, index={self.index})"


class MutableSegment:
    __slots__ = ("_part", "_id")

    def __init__(self, part: "MutablePart", oligo_id: str, segment_id: str) -> None:
        # oligo_id is accepted for backward-compat but resolved fresh each call
        # because connect()-merges can move a segment from one oligo to another.
        self._part = part
        self._id = segment_id

    def _raw(self) -> dict[str, Any]:
        return self._part._raw_segment(self.oligo_id, self._id)

    @property
    def id(self) -> str:
        return self._id

    @property
    def oligo_id(self) -> str:
        oid = self._part._resolve_oligo_id_for_segment(self._id)
        if oid is None:
            raise KeyError(f"Segment {self._id!r} no longer exists")
        return oid

    @property
    def vh_index(self) -> int:
        return int(self._raw()["inVirtualHelixIndex"])

    @property
    def five_index(self) -> int:
        return int(self._raw()["fivePrime"]["index"])

    @property
    def three_index(self) -> int:
        return int(self._raw()["threePrime"]["index"])

    @property
    def length(self) -> int:
        return abs(self.three_index - self.five_index) + 1

    @property
    def five_prime(self) -> MutableSegmentEnd:
        return MutableSegmentEnd(self._part, self._id, False)

    @property
    def three_prime(self) -> MutableSegmentEnd:
        return MutableSegmentEnd(self._part, self._id, True)

    @property
    def low_index(self) -> int:
        return min(self.five_index, self.three_index)

    @property
    def high_index(self) -> int:
        return max(self.five_index, self.three_index)

    @property
    def in_virtual_helix(self) -> "MutableVirtualHelix":
        from .vh import MutableVirtualHelix

        return MutableVirtualHelix(self._part, self.vh_index)

    @property
    def in_strand_index(self) -> int:
        """0 or 1 — which strand set of its VH this segment lives on."""
        info = self._part._topology().segment(self._id)
        if info is None:
            raise KeyError(f"Segment {self._id!r} no longer exists")
        return info.strand_index

    @property
    def oligo(self) -> "MutableOligo":
        return MutableOligo(self._part, self.oligo_id)

    @property
    def five_modification(self) -> str | None:
        return self._raw()["fivePrime"].get("modification")

    @five_modification.setter
    def five_modification(self, value: str | None) -> None:
        self.five_prime.modification = value

    @property
    def three_modification(self) -> str | None:
        return self._raw()["threePrime"].get("modification")

    @three_modification.setter
    def three_modification(self, value: str | None) -> None:
        self.three_prime.modification = value

    @property
    def connected_from_segment_id(self) -> str | None:
        return self._raw()["fivePrime"].get("connectedSegmentId")

    @property
    def connected_to_segment_id(self) -> str | None:
        return self._raw()["threePrime"].get("connectedSegmentId")

    @property
    def slots(self) -> list[MutableSlot]:
        seg = self._raw()
        return [
            MutableSlot(self._part, self.oligo_id, self._id, s["bpIndex"])
            for s in seg.get("slots", [])
        ]

    def slot_at(self, bp_index: int) -> MutableSlot:
        """Return a proxy for the slot at ``bp_index`` (created on first write)."""
        return MutableSlot(self._part, self.oligo_id, self._id, int(bp_index))

    def move_five_prime_to(self, new_index: int) -> None:
        """Move the 5′ terminus to ``new_index`` (same as ``seg.five_prime.index = new_index``).

        Raises :class:`InvalidOperationError` when ``seg.five_prime.can_move_to``
        refuses it.
        """
        if not isinstance(new_index, int):
            raise TypeError(f"new_index must be int, got {type(new_index).__name__}")
        self.five_prime.index = new_index

    def move_three_prime_to(self, new_index: int) -> None:
        """Move the 3′ terminus to ``new_index`` (same as ``seg.three_prime.index = new_index``).

        Raises :class:`InvalidOperationError` when ``seg.three_prime.can_move_to``
        refuses it.
        """
        if not isinstance(new_index, int):
            raise TypeError(f"new_index must be int, got {type(new_index).__name__}")
        self.three_prime.index = new_index

    def remove(self) -> "MutableOligo | None":
        """Same as ``part.remove_segment(seg)``."""
        return self._part.remove_segment(self)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, MutableSegment) and other._id == self._id

    def __hash__(self) -> int:
        return hash(self._id)

    def __repr__(self) -> str:
        return f"MutableSegment(id={self._id!r}, vh={self.vh_index}, five={self.five_index}, three={self.three_index})"


class MutableOligo:
    __slots__ = ("_part", "_id")

    def __init__(self, part: "MutablePart", oligo_id: str) -> None:
        self._part = part
        self._id = oligo_id

    def _raw(self) -> dict[str, Any]:
        return self._part._raw_oligo(self._id)

    @property
    def id(self) -> str:
        return self._id

    @property
    def color(self) -> str:
        return self._raw()["color"]

    @color.setter
    def color(self, value: str) -> None:
        invariants.validate_hex_color(value)
        self._part._apply(
            {"op": M.OP_SET_OLIGO_COLOR, "oligoId": self._id, "color": value}
        )

    @property
    def name(self) -> str | None:
        return self._raw().get("name")

    @name.setter
    def name(self, value: str | None) -> None:
        if value is not None and not isinstance(value, str):
            raise TypeError(f"name must be str or None, got {type(value).__name__}")
        self._part._apply(
            {"op": M.OP_SET_OLIGO_NAME, "oligoId": self._id, "name": value}
        )

    @property
    def is_scaffold(self) -> bool:
        return bool(self._raw().get("isScaffold", False))

    @is_scaffold.setter
    def is_scaffold(self, value: bool) -> None:
        self._part._apply(
            {
                "op": M.OP_SET_OLIGO_IS_SCAFFOLD,
                "oligoId": self._id,
                "isScaffold": bool(value),
            }
        )

    @property
    def is_sequence_locked(self) -> bool:
        return bool(self._raw().get("isSequenceLocked", False))

    @property
    def is_circular(self) -> bool:
        """True if every segment's 3′ end is connected to another segment in this oligo."""
        segs = self._raw().get("segments", [])
        if not segs:
            return False
        seg_ids = {s["id"] for s in segs}
        return all(s["threePrime"].get("connectedSegmentId") in seg_ids for s in segs)

    @property
    def segments(self) -> list[MutableSegment]:
        return [MutableSegment(self._part, self._id, s["id"]) for s in self._raw().get("segments", [])]

    @property
    def five_prime(self) -> MutableSegmentEnd | None:
        """The oligo's free 5′ end, or ``None`` for a circular oligo."""
        for s in self._raw().get("segments", []):
            if s["fivePrime"].get("connectedSegmentId") is None:
                return MutableSegmentEnd(self._part, s["id"], False)
        return None

    @property
    def three_prime(self) -> MutableSegmentEnd | None:
        """The oligo's free 3′ end, or ``None`` for a circular oligo."""
        for s in self._raw().get("segments", []):
            if s["threePrime"].get("connectedSegmentId") is None:
                return MutableSegmentEnd(self._part, s["id"], True)
        return None

    def get_segment(self, segment_id: str) -> MutableSegment | None:
        for s in self._raw().get("segments", []):
            if s["id"] == segment_id:
                return MutableSegment(self._part, self._id, segment_id)
        return None

    def remove(self) -> None:
        """Same as ``part.remove_oligo(oligo)``."""
        self._part.remove_oligo(self)

    @property
    def five_modification(self) -> str | None:
        """Modification on the oligo's free 5′ end (``None`` when unset or circular)."""
        end = self.five_prime
        return end.modification if end is not None else None

    @five_modification.setter
    def five_modification(self, value: str | None) -> None:
        end = self.five_prime
        if end is None:
            raise InvalidOperationError(f"Oligo {self._id!r} is circular: it has no free 5' end")
        end.modification = value

    @property
    def three_modification(self) -> str | None:
        """Modification on the oligo's free 3′ end (``None`` when unset or circular)."""
        end = self.three_prime
        return end.modification if end is not None else None

    @three_modification.setter
    def three_modification(self, value: str | None) -> None:
        end = self.three_prime
        if end is None:
            raise InvalidOperationError(f"Oligo {self._id!r} is circular: it has no free 3' end")
        end.modification = value

    def touches_regions(self) -> set[str]:
        """Set of region IDs this oligo's segments visit (cross-region detection)."""
        regions: set[str] = set()
        for s in self._raw().get("segments", []):
            try:
                vh = self._part._raw_vh(int(s["inVirtualHelixIndex"]))
            except KeyError:
                continue
            rid = vh.get("regionId")
            if rid:
                regions.add(rid)
        return regions

    def __repr__(self) -> str:
        return f"MutableOligo(id={self._id!r}, color={self.color!r}, segments={len(self._raw().get('segments', []))})"
