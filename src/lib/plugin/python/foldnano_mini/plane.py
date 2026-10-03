"""
foldnano_mini.plane — read-only MutablePlane proxy.

Plane transform mutations go through ``MutablePart.set_plane_transform`` so
that every write is captured in the mutation log.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .part import MutablePart


class MutablePlane:
    """Read-only view of a plane dict from the mirror.

    Use ``part.set_plane_transform(plane_id, ...)`` to mutate the plane.
    """

    __slots__ = ("_part", "_id")

    def __init__(self, part: "MutablePart", plane_id: str) -> None:
        self._part = part
        self._id = plane_id

    def _raw(self) -> dict[str, Any]:
        for p in self._part._raw.get("planes", []):
            if p["id"] == self._id:
                return p
        raise KeyError(f"No plane with id {self._id!r}")

    @property
    def id(self) -> str:
        return self._id

    @property
    def name(self) -> str:
        return self._raw().get("name", "")

    @property
    def origin(self) -> dict[str, float]:
        return dict(self._raw().get("origin", {"x": 0.0, "y": 0.0, "z": 0.0}))

    @property
    def u(self) -> dict[str, float]:
        return dict(self._raw().get("u", {"x": 1.0, "y": 0.0, "z": 0.0}))

    @property
    def v(self) -> dict[str, float]:
        return dict(self._raw().get("v", {"x": 0.0, "y": 1.0, "z": 0.0}))

    @property
    def normal(self) -> dict[str, float]:
        return dict(self._raw().get("normal", {"x": 0.0, "y": 0.0, "z": 1.0}))

    def __repr__(self) -> str:
        return f"MutablePlane(id={self._id!r}, name={self.name!r})"
