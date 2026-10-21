"""
foldnano_mini.vh — mutable VirtualHelix proxy.

Reads pass through to the mirror dict; writes go through the transport.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from . import invariants, mutations as M
from .lattice import CrossoverSite

if TYPE_CHECKING:
    from .oligo import MutableSegment
    from .part import MutablePart


class MutableStrandSet:
    """One strand of a VH — mirrors the host's ``StrandSet``.

    Strand set 0 runs 5′→3′ with ascending bp, strand set 1 descending. Reach it as
    ``vh.strand_sets[0]`` / ``vh.strand_sets[1]``. Occupancy queries read an index
    rebuilt lazily after any edit, so they always see the current mirror.
    """

    __slots__ = ("_part", "_vh_index", "_strand_index")

    def __init__(self, part: "MutablePart", vh_index: int, strand_index: int) -> None:
        self._part = part
        self._vh_index = vh_index
        self._strand_index = strand_index

    @property
    def strand_index(self) -> int:
        return self._strand_index

    @property
    def virtual_helix(self) -> "MutableVirtualHelix":
        return MutableVirtualHelix(self._part, self._vh_index)

    @property
    def segment_ids(self) -> list[str]:
        """Ids of this strand's segments, sorted by their low bp."""
        return [seg_id for _, _, seg_id in self._intervals()]

    @property
    def segments(self) -> list["MutableSegment"]:
        """This strand's segments, sorted by their low bp."""
        return [self._part._segment_proxy(seg_id) for seg_id in self.segment_ids]

    @property
    def is_empty(self) -> bool:
        return not self._intervals()

    def is_index_occupied(self, bp_index: int) -> bool:
        return self.is_index_occupied_by(bp_index) is not None

    def is_index_occupied_by(self, bp_index: int) -> "MutableSegment | None":
        """The segment covering ``bp_index`` on this strand, or ``None``."""
        seg_id = self._part._topology().segment_at(self._vh_index, self._strand_index, bp_index)
        return self._part._segment_proxy(seg_id) if seg_id else None

    def is_range_occupied(self, start_index: int, end_index: int) -> bool:
        """True when any segment overlaps the inclusive range (either order)."""
        return bool(self.segments_in_range(start_index, end_index))

    def segments_in_range(self, start_index: int, end_index: int) -> list["MutableSegment"]:
        """Segments overlapping the inclusive range (either order), sorted by low bp."""
        ids = self._part._topology().segments_overlapping(
            self._vh_index, self._strand_index, start_index, end_index
        )
        return [self._part._segment_proxy(seg_id) for seg_id in ids]

    def free_ranges(self) -> list[tuple[int, int]]:
        """Maximal free inclusive ``(low, high)`` ranges within the VH's region bounds
        (where ``part.create_segment`` may place a segment)."""
        lo, hi = self._part._create_bounds(self._part._raw_vh(self._vh_index))
        return self._part._topology().free_ranges(
            self._vh_index, self._strand_index, lo, hi - 1
        )

    def _intervals(self) -> list[tuple[int, int, str]]:
        return self._part._topology().intervals(self._vh_index, self._strand_index)

    def __repr__(self) -> str:
        return f"MutableStrandSet(vh={self._vh_index}, strand_index={self._strand_index})"


class MutableVirtualHelix:
    __slots__ = ("_part", "_index")

    def __init__(self, part: "MutablePart", vh_index: int) -> None:
        self._part = part
        self._index = vh_index

    def _raw(self) -> dict[str, Any]:
        return self._part._raw_vh(self._index)

    @property
    def index(self) -> int:
        return self._index

    @property
    def id(self) -> str:
        return self._raw().get("id", "")

    @property
    def region_id(self) -> str | None:
        return self._raw().get("regionId")

    @property
    def length(self) -> int:
        return int(self._raw()["length"])

    @length.setter
    def length(self, value: int) -> None:
        if not isinstance(value, int) or value < 2:
            raise ValueError(f"length must be an int >= 2, got {value!r}")
        self._part._apply(
            {
                "op": M.OP_SET_VH_LENGTH,
                "vhId": self.id,
                "length": int(value),
            }
        )

    @property
    def row(self) -> int | None:
        coords = self._raw().get("latticeCoords")
        return coords["row"] if coords else None

    @property
    def col(self) -> int | None:
        coords = self._raw().get("latticeCoords")
        return coords["col"] if coords else None

    @property
    def is_freeform(self) -> bool:
        return self._raw().get("latticeCoords") is None

    @property
    def parity_is_even(self) -> bool:
        coords = self._raw().get("latticeCoords")
        if coords is None:
            raise ValueError(
                f"VH index={self._index} has no latticeCoords (freeform); parity is undefined."
            )
        return coords["row"] % 2 == coords["col"] % 2

    @property
    def local_frame(self) -> dict | None:
        return self._raw().get("localFrame")

    @local_frame.setter
    def local_frame(self, value: dict | None) -> None:
        if value is not None and not isinstance(value, dict):
            raise TypeError(f"localFrame must be dict or None, got {type(value).__name__}")
        self._part._apply(
            {
                "op": M.OP_SET_VH_LOCAL_FRAME,
                "vhId": self.id,
                "localFrame": value,
            }
        )

    def move_to(self, col: int, row: int) -> None:
        """Move this lattice VH to (col, row), preserving parity.

        Raises ``ValueError`` if the VH is freeform or if the target breaks
        lattice parity (i.e. Δrow + Δcol is odd).
        """
        coords = self._raw().get("latticeCoords")
        if coords is None:
            raise ValueError(
                f"VH index={self._index} is a freeform VH — use vh.local_frame to reposition it"
            )
        invariants.validate_lattice_parity(coords["row"], coords["col"], row, col)
        self._part._apply(
            {
                "op": M.OP_MOVE_LATTICE_VH,
                "vhId": self.id,
                "col": int(col),
                "row": int(row),
            }
        )

    @property
    def is_even_parity(self) -> bool:
        """Same as ``parity_is_even``; named after the host's ``VirtualHelix.isEvenParity``."""
        return self.parity_is_even

    @property
    def strand_sets(self) -> list[MutableStrandSet]:
        """``[strand set 0, strand set 1]`` — see :class:`MutableStrandSet`."""
        return [MutableStrandSet(self._part, self._index, i) for i in (0, 1)]

    def segments_at(self, bp_index: int, strand_index: int | None = None) -> list["MutableSegment"]:
        """Segments covering ``bp_index`` — on one strand set, or both (strand 0 first)."""
        strands = (0, 1) if strand_index is None else (strand_index,)
        for ss in strands:
            invariants.validate_strand_set_index(ss)
        out: list["MutableSegment"] = []
        for ss in strands:
            seg = self.strand_sets[ss].is_index_occupied_by(bp_index)
            if seg is not None:
                out.append(seg)
        return out

    def potential_xover_sites(self, strand_index: int) -> list[CrossoverSite]:
        """Potential crossover sites from one strand set, as the host's
        ``potentialXoverSites(vh)[strand_index]``.

        Each is ``CrossoverSite(bp_index, to_vh_index, right)``; only sites whose
        target lattice position holds a VH in the same region are listed. Freeform
        VHs have none. A connection between ends at a site's bp (opposite strand
        indices) is a constrained crossover — see ``MutableSegmentEnd.is_constrained``.
        """
        invariants.validate_strand_set_index(strand_index)
        return list(self._part._topology().potential_xover_sites(self._index)[strand_index])

    @property
    def strand_set_segment_ids(self) -> list[list[str]]:
        return [list(ss.get("segmentIds", [])) for ss in self._raw().get("strandSets", [])]

    def __repr__(self) -> str:
        return f"MutableVirtualHelix(index={self._index}, region={self.region_id!r})"
