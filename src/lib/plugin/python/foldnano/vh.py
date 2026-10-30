"""
VirtualHelixProxy — read-only view of a virtual helix from foldnano_json.

Constructed by ``foldnano.io.parse_foldnano_json()``. Plugin authors access
VH properties through this object rather than indexing the raw dict.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from ._frame import roll_deg_of


@dataclass
class VirtualHelixProxy:
    """
    Read-only proxy for a VirtualHelix parsed from a foldnano_json document.

    Attributes
    ----------
    index:
        VH index (unique within the part).
    id:
        VH UUID (stable identity; not the same as ``index``).
    region_id:
        UUID of the DesignRegion this VH belongs to. ``None`` for documents
        predating the regions schema.
    row, col:
        Lattice coordinates (``None`` for freeform VHs that lack
        ``latticeCoords``). ``parity_is_even`` raises in that case.
    local_frame:
        Optional local 3D frame for freeform VHs (origin / axis / radial0).
        Mirrors ``VirtualHelix.localFrame`` on the JS side.
    length:
        Number of base-pair slots on this helix.
    strand_set_segment_ids:
        Two lists of segment IDs — ``[ss0_ids, ss1_ids]``.
        ss0 runs 5'→3' (step +1); ss1 runs 3'←5' (step −1).
        Which is scaffold depends on parity: even parity → ss0 is scaffold.
    """

    index: int
    id: str
    region_id: Optional[str]
    row: Optional[int]
    col: Optional[int]
    length: int
    strand_set_segment_ids: list[list[str]]
    local_frame: Optional[dict] = None
    list_row: Optional[int] = field(default=None)

    @classmethod
    def from_json(cls, vh_json: dict[str, Any]) -> "VirtualHelixProxy":
        coords = vh_json.get("latticeCoords")
        row = coords["row"] if coords else None
        col = coords["col"] if coords else None
        return cls(
            index=vh_json["index"],
            id=vh_json.get("id", ""),
            region_id=vh_json.get("regionId"),
            row=row,
            col=col,
            length=vh_json["length"],
            strand_set_segment_ids=[ss["segmentIds"] for ss in vh_json["strandSets"]],
            local_frame=vh_json.get("localFrame"),
            list_row=vh_json.get("listRow"),
        )

    @property
    def roll_deg(self) -> Optional[float]:
        """
        Rotation of a freeform helix about its own axis, in degrees (-180, 180].

        0 means ``radial0`` points along the region plane's normal (or +X for a
        helix standing along ±Z); positive is right-handed about the axis.
        ``None`` when the VH has no ``local_frame``.
        """
        return None if self.local_frame is None else roll_deg_of(self.local_frame)

    @property
    def is_freeform(self) -> bool:
        """True when this VH has no lattice coordinates (freeform region VH)."""
        return self.row is None or self.col is None

    @property
    def parity_is_even(self) -> bool:
        """
        True when row % 2 == col % 2 (scaffold on strandSet[0]).

        Raises
        ------
        ValueError
            For freeform VHs with no ``latticeCoords``. Mirrors the JS
            ``VirtualHelix.isEvenParity`` guard — parity is undefined without
            a lattice.
        """
        if self.row is None or self.col is None:
            raise ValueError(
                f"VH index={self.index} has no latticeCoords (freeform VH); "
                "parity is undefined."
            )
        return self.row % 2 == self.col % 2
