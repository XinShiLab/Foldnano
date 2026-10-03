"""
foldnano_mini.region — mutable region proxies.

Lattice regions support ``add_vh_at(row, col)``; freeform regions don't (the
`supports_lattice_grid` flag mirrors the JS-side capability flag).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from . import invariants, mutations as M

if TYPE_CHECKING:
    from .part import MutablePart
    from .vh import MutableVirtualHelix


class MutableRegion:
    __slots__ = ("_part", "_id")

    def __init__(self, part: "MutablePart", region_id: str) -> None:
        self._part = part
        self._id = region_id

    def _raw(self) -> dict[str, Any]:
        return self._part._raw_region(self._id)

    @property
    def id(self) -> str:
        return self._id

    @property
    def name(self) -> str:
        return self._raw().get("name", "")

    @property
    def kind(self) -> str:
        return self._raw()["kind"]

    @property
    def plane_id(self) -> str:
        return self._raw()["planeId"]

    @property
    def vh_order(self) -> list[str]:
        return list(self._raw().get("vhOrder", []))

    @property
    def step(self) -> int:
        return int(self._raw().get("step", 21))

    @property
    def default_max_base(self) -> int:
        return int(self._raw().get("defaultMaxBase", 42))

    @property
    def max_base(self) -> int:
        raw = self._raw()
        return int(raw.get("maxBase") or raw.get("defaultMaxBase", self.step * 2))

    @property
    def min_base(self) -> int:
        return int(self._raw().get("minBase", 0))

    def set_max_base(self, new_max_base: int) -> None:
        """Extend all VHs in this region to ``new_max_base``.

        ``new_max_base`` must be greater than the current ``max_base`` and a
        multiple of ``step``.
        """
        current = self.max_base
        if new_max_base <= current:
            raise ValueError(
                f"set_max_base: new_max_base ({new_max_base}) must be greater than "
                f"current max_base ({current})"
            )
        delta = new_max_base - current
        self.increase_length_by(delta)

    def increase_length_by(self, delta: int) -> None:
        """Extend all VHs in this region by ``delta`` bases.

        ``delta`` must be a positive multiple of ``step``.
        """
        if not isinstance(delta, int) or delta <= 0:
            raise ValueError(f"increase_length_by: delta must be a positive int, got {delta!r}")
        if delta % self.step != 0:
            raise ValueError(
                f"increase_length_by: delta ({delta}) must be a multiple of step ({self.step})"
            )
        self._part._apply(
            {
                "op": M.OP_SET_REGION_MAX_BASE,
                "regionId": self._id,
                "newMaxBase": self.max_base + delta,
            }
        )

    @property
    def supports_lattice_grid(self) -> bool:
        return self.kind in ("HONEYCOMB", "SQUARE")

    @property
    def virtual_helices(self) -> list["MutableVirtualHelix"]:
        return [vh for vh in self._part.virtual_helices if vh.region_id == self._id]

    def __repr__(self) -> str:
        return f"MutableRegion(id={self._id!r}, kind={self.kind})"


class LatticedRegion(MutableRegion):
    """HONEYCOMB / SQUARE region — supports adding VHs at lattice coordinates."""

    def add_vh_at(self, row: int, col: int, length: int | None = None) -> "MutableVirtualHelix":
        """Add a VH to the offline mirror.

        The returned proxy exposes the mirror's local ``index`` value. For
        newly added lattice VHs that index is not guaranteed to match the
        eventual host-side JS index after replay; ``vh.id`` is the only stable
        cross-runtime identifier.
        """
        from .vh import MutableVirtualHelix

        invariants.validate_lattice_coords(row, col)
        new_vh_id = self._part.allocate_vh_id()
        new_vh_index = self._part._next_vh_index()
        op: dict[str, Any] = {
            "op": M.OP_ADD_VH_AT_COORDS,
            "regionId": self._id,
            "row": int(row),
            "col": int(col),
            "newVhId": new_vh_id,
        }
        if length is not None:
            op["length"] = int(length)
        self._part._apply(op)
        return MutableVirtualHelix(self._part, new_vh_index)


class FreeformRegion(MutableRegion):
    """Freeform region — VHs placed by ``localFrame`` rather than lattice coords."""

    def add_vh_at(
        self,
        origin: tuple[float, float, float],
        direction: tuple[float, float, float] = (0.0, 0.0, 1.0),
        length: int | None = None,
    ) -> "MutableVirtualHelix":
        """Add a new VH to this freeform region at the given 3D position.

        ``origin`` and ``direction`` are ``(x, y, z)`` tuples in nanometres.
        ``length`` defaults to the region's ``max_base``.
        """
        from .vh import MutableVirtualHelix

        if len(origin) != 3 or len(direction) != 3:
            raise ValueError("origin and direction must be (x, y, z) 3-tuples")
        # Normalise direction
        dx, dy, dz = float(direction[0]), float(direction[1]), float(direction[2])
        mag = (dx**2 + dy**2 + dz**2) ** 0.5
        if mag < 1e-10:
            raise ValueError("direction vector must be non-zero")
        axis = (dx / mag, dy / mag, dz / mag)
        # Compute radial0 perpendicular to axis
        if abs(axis[2]) < 0.9:
            r0 = _cross_normalize((0.0, 0.0, 1.0), axis)
        else:
            r0 = _cross_normalize((1.0, 0.0, 0.0), axis)

        new_vh_id = self._part.allocate_vh_id()
        new_vh_index = self._part._next_vh_index()
        op: dict = {
            "op": M.OP_ADD_FREEFORM_VH,
            "regionId": self._id,
            "newVhId": new_vh_id,
            "origin": [float(origin[0]), float(origin[1]), float(origin[2])],
            "axis": list(axis),
            "radial0": list(r0),
        }
        if length is not None:
            op["length"] = int(length)
        self._part._apply(op)
        return MutableVirtualHelix(self._part, new_vh_index)


def _cross_normalize(
    a: tuple[float, float, float], b: tuple[float, float, float]
) -> tuple[float, float, float]:
    """Return the cross product of a and b, normalised."""
    cx = a[1] * b[2] - a[2] * b[1]
    cy = a[2] * b[0] - a[0] * b[2]
    cz = a[0] * b[1] - a[1] * b[0]
    mag = (cx**2 + cy**2 + cz**2) ** 0.5
    if mag < 1e-10:
        # Fallback: a and b are parallel; pick an arbitrary perpendicular
        return (1.0, 0.0, 0.0)
    return (cx / mag, cy / mag, cz / mag)
