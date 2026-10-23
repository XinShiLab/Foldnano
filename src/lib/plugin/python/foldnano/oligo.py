"""
OligoProxy and OligoSegmentProxy — read-only views of oligos/segments
from a foldnano_json document.

Constructed by ``foldnano.io.parse_foldnano_json()``.

Segment connection model (mirrors the TypeScript model):
  - Connections flow 3' → 5'.
  - ``OligoSegmentProxy.connected_to_segment_id`` — the segment whose
    fivePrime end this segment's threePrime connects to.
  - ``OligoSegmentProxy.connected_from_segment_id`` — the segment whose
    threePrime end connects into this segment's fivePrime.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from dataclasses import dataclass, field

if TYPE_CHECKING:
    from foldnano.io import PartData


@dataclass
class OligoSegmentProxy:
    """
    Read-only proxy for one OligoSegment from a foldnano_json document.

    Attributes
    ----------
    id:
        Segment UUID.
    vh_index:
        Index of the VirtualHelix this segment lives on.
    five_prime_index:
        Base-pair index of the 5' end on the helix.
    three_prime_index:
        Base-pair index of the 3' end on the helix.
    five_prime_modification, three_prime_modification:
        Modification code (e.g. ``"/5Alex488N/"``) or ``None``.
    connected_from_segment_id:
        ID of the segment whose 3' end connects INTO this 5' end, or ``None``
        when this is a free 5' end (global oligo 5').
    connected_to_segment_id:
        ID of the segment this 3' end connects TO, or ``None`` when this is a
        free 3' end (global oligo 3').
    slots:
        Per-base slot records: ``[{"bpIndex": int, "seq": str}, ...]``.
        ``seq`` is empty for a skip, >1 char for an insertion.
    sequence:
        Pre-computed sequence string across this segment's slots (may be empty
        if not yet assigned).
    """

    id: str
    vh_index: int
    five_prime_index: int
    three_prime_index: int
    five_prime_modification: object  # str | None
    three_prime_modification: object  # str | None
    connected_from_segment_id: object  # str | None
    connected_to_segment_id: object  # str | None
    slots: list[dict]
    sequence: str

    @classmethod
    def from_json(cls, seg_json: dict[str, Any]) -> "OligoSegmentProxy":
        five = seg_json["fivePrime"]
        three = seg_json["threePrime"]
        return cls(
            id=seg_json["id"],
            vh_index=seg_json["inVirtualHelixIndex"],
            five_prime_index=five["index"],
            three_prime_index=three["index"],
            five_prime_modification=five.get("modification"),
            three_prime_modification=three.get("modification"),
            connected_from_segment_id=five.get("connectedSegmentId"),
            connected_to_segment_id=three.get("connectedSegmentId"),
            slots=seg_json.get("slots", []),
            sequence=seg_json.get("sequence", ""),
        )

    @property
    def is_free_five_prime(self) -> bool:
        """True when no upstream segment connects into this 5' end."""
        return self.connected_from_segment_id is None

    @property
    def is_free_three_prime(self) -> bool:
        """True when this 3' end does not connect to a downstream segment."""
        return self.connected_to_segment_id is None

    @property
    def length(self) -> int:
        """Number of base-pair positions spanned (inclusive)."""
        return abs(self.three_prime_index - self.five_prime_index) + 1


@dataclass
class OligoProxy:
    """
    Read-only proxy for one Oligo from a foldnano_json document.

    Attributes
    ----------
    id:
        Oligo UUID.
    color:
        Hex color string e.g. ``"#0066cc"``.
    is_scaffold:
        ``True`` when this oligo is the scaffold strand.
    is_sequence_locked:
        ``True`` when the sequence must not be overwritten.
    name:
        Optional oligo name or ``None``.
    segments:
        Ordered list of OligoSegmentProxy objects (insertion order = 5'→3').
    """

    id: str
    color: str
    is_scaffold: bool
    is_sequence_locked: bool
    name: object  # str | None
    segments: list[OligoSegmentProxy] = field(default_factory=list)

    @classmethod
    def from_json(cls, oligo_json: dict[str, Any]) -> "OligoProxy":
        return cls(
            id=oligo_json["id"],
            color=oligo_json["color"],
            is_scaffold=oligo_json.get("isScaffold", False),
            is_sequence_locked=oligo_json.get("isSequenceLocked", False),
            name=oligo_json.get("name"),
            segments=[OligoSegmentProxy.from_json(s) for s in oligo_json.get("segments", [])],
        )

    @property
    def sequence(self) -> str:
        """Concatenated sequence across all segments."""
        return "".join(s.sequence for s in self.segments)

    @property
    def is_circular(self) -> bool:
        """
        True when the last segment's 3' end connects back to the first
        segment's 5' end (circular oligo).
        """
        if not self.segments:
            return False
        last = self.segments[-1]
        first = self.segments[0]
        return (
            last.connected_to_segment_id is not None
            and last.connected_to_segment_id == first.id
        )

    def touches_regions(self, part: PartData) -> set[str]:
        """
        Return the set of region IDs this oligo's segments visit.

        A length > 1 set means the oligo crosses region boundaries. Useful for
        region-scoped plugins that must skip cross-region oligos.

        ``part`` is a ``foldnano.io.PartData`` instance — passed in (rather
        than back-referenced) because oligos do not own a part reference.
        """
        regions: set[str] = set()
        for seg in self.segments:
            vh = part.get_vh(seg.vh_index)
            if vh is not None and vh.region_id is not None:
                regions.add(vh.region_id)
        return regions
