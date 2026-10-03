"""
foldnano_mini.vh — mutable VirtualHelix proxy.

Reads pass through to the mirror dict; writes go through the transport.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from . import invariants, mutations as M

if TYPE_CHECKING:
    from .part import MutablePart


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
    def strand_set_segment_ids(self) -> list[list[str]]:
        return [list(ss.get("segmentIds", [])) for ss in self._raw().get("strandSets", [])]

    def __repr__(self) -> str:
        return f"MutableVirtualHelix(index={self._index}, region={self.region_id!r})"
