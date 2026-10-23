"""
PlaneProxy — read-only view of a Plane from foldnano_json.

A Plane defines a local 3D frame (origin + u, v, normal basis vectors) that a
DesignRegion lives in. Constructed by ``foldnano.io.parse_foldnano_json()``.
"""

from __future__ import annotations

from typing import Any

from dataclasses import dataclass


@dataclass
class _Vec3:
    """Plain xyz triple matching the foldnano_json plane field shape."""

    x: float
    y: float
    z: float

    @classmethod
    def from_json(cls, j: dict[str, Any]) -> "_Vec3":
        return cls(x=float(j["x"]), y=float(j["y"]), z=float(j["z"]))


@dataclass
class PlaneProxy:
    """
    Read-only proxy for a Plane parsed from a foldnano_json document.

    Attributes
    ----------
    id:
        Plane UUID.
    name:
        Plane display name (e.g. ``"XY Plane"``).
    origin, u, v, normal:
        World-space origin and basis vectors. ``u`` and ``v`` span the plane;
        ``normal`` is perpendicular. See ``Plane.transformPoint`` on the JS
        side for the local→world mapping.
    """

    id: str
    name: str
    origin: _Vec3
    u: _Vec3
    v: _Vec3
    normal: _Vec3

    @classmethod
    def from_json(cls, plane_json: dict[str, Any]) -> "PlaneProxy":
        return cls(
            id=plane_json["id"],
            name=plane_json.get("name", ""),
            origin=_Vec3.from_json(plane_json["origin"]),
            u=_Vec3.from_json(plane_json["u"]),
            v=_Vec3.from_json(plane_json["v"]),
            normal=_Vec3.from_json(plane_json["normal"]),
        )
