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

if TYPE_CHECKING:
    from .part import MutablePart


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
        if not isinstance(value, str):
            raise TypeError(f"seq must be str, got {type(value).__name__}")
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

    def set_skip(self, value: bool) -> None:
        self._part._apply(
            {
                "op": M.OP_SET_SLOT_SKIP,
                "oligoId": self._oligo_id,
                "segmentId": self._segment_id,
                "bpIndex": self._bp_index,
                "skip": bool(value),
            }
        )

    def set_insertion(self, sequence: str) -> None:
        if not isinstance(sequence, str) or len(sequence) < 1:
            raise ValueError("insertion sequence must be a non-empty string")
        self._part._apply(
            {
                "op": M.OP_SET_SLOT_INSERTION,
                "oligoId": self._oligo_id,
                "segmentId": self._segment_id,
                "bpIndex": self._bp_index,
                "insertion": sequence,
            }
        )


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
    def five_modification(self) -> str | None:
        return self._raw()["fivePrime"].get("modification")

    @five_modification.setter
    def five_modification(self, value: str | None) -> None:
        self._part._apply(
            {
                "op": M.OP_SET_SEGMENT_MODIFICATION,
                "oligoId": self.oligo_id,
                "segmentId": self._id,
                "end": "5",
                "modification": value,
            }
        )

    @property
    def three_modification(self) -> str | None:
        return self._raw()["threePrime"].get("modification")

    @three_modification.setter
    def three_modification(self, value: str | None) -> None:
        self._part._apply(
            {
                "op": M.OP_SET_SEGMENT_MODIFICATION,
                "oligoId": self.oligo_id,
                "segmentId": self._id,
                "end": "3",
                "modification": value,
            }
        )

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
        """Move the 5′ terminus of this segment to ``new_index``.

        The caller is responsible for ensuring the new index does not cross the
        3′ terminus or exceed the VH length.
        """
        if not isinstance(new_index, int):
            raise TypeError(f"new_index must be int, got {type(new_index).__name__}")
        self._part._apply(
            {
                "op": M.OP_MOVE_TERMINUS,
                "segmentId": self._id,
                "end": "5",
                "toIndex": new_index,
            }
        )

    def move_three_prime_to(self, new_index: int) -> None:
        """Move the 3′ terminus of this segment to ``new_index``.

        The caller is responsible for ensuring the new index does not cross the
        5′ terminus or exceed the VH length.
        """
        if not isinstance(new_index, int):
            raise TypeError(f"new_index must be int, got {type(new_index).__name__}")
        self._part._apply(
            {
                "op": M.OP_MOVE_TERMINUS,
                "segmentId": self._id,
                "end": "3",
                "toIndex": new_index,
            }
        )

    def remove(self) -> None:
        self._part._apply(
            {
                "op": M.OP_REMOVE_SEGMENT,
                "oligoId": self.oligo_id,
                "segmentId": self._id,
            }
        )

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

    def get_segment(self, segment_id: str) -> MutableSegment | None:
        for s in self._raw().get("segments", []):
            if s["id"] == segment_id:
                return MutableSegment(self._part, self._id, segment_id)
        return None

    def remove(self) -> None:
        self._part._apply({"op": M.OP_REMOVE_OLIGO, "oligoId": self._id})

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
