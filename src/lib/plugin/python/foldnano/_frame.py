"""
foldnano._frame — roll convention for freeform helix frames.

Mirrors ``referenceRadial0`` / ``rollDegOf`` / ``withRoll`` in
``src/lib/model/geometry3d/dnaGeometry.ts``; keep the two in step.

A frame is ``{"origin", "axis", "radial0"}`` with ``{"x", "y", "z"}`` vectors in
plane-local nm. Roll is the signed angle (degrees, right-handed about ``axis``)
from the reference ``radial0`` to the stored one. Roll 0 is the plane normal
(+Z) projected perpendicular to the axis, or +X for helices within about 25° of ±Z (|axis.z| >= 0.9).
"""

from __future__ import annotations

import math
from typing import Any

Vec = tuple[float, float, float]

# Same threshold as PERPENDICULAR_AXIS_DOT in dnaGeometry.ts.
_PERPENDICULAR_AXIS_DOT = 0.9


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _normalize(v: Vec) -> Vec:
    n = math.sqrt(_dot(v, v))
    if not n >= 1e-9:
        raise ValueError("vector must be non-zero")
    return (v[0] / n, v[1] / n, v[2] / n)


def _perpendicular_unit(v: Vec, axis: Vec) -> Vec | None:
    d = _dot(v, axis)
    r = (v[0] - d * axis[0] + 0.0, v[1] - d * axis[1] + 0.0, v[2] - d * axis[2] + 0.0)
    n = math.sqrt(_dot(r, r))
    if not n >= 1e-6:
        return None
    return (r[0] / n, r[1] / n, r[2] / n)


def vec(d: dict[str, Any]) -> Vec:
    return (float(d["x"]), float(d["y"]), float(d["z"]))


def reference_radial0(axis: Vec) -> Vec:
    """Roll-0 ``radial0`` for a unit ``axis``."""
    if abs(axis[2]) < _PERPENDICULAR_AXIS_DOT:
        r = _perpendicular_unit((0.0, 0.0, 1.0), axis)
        if r is not None:
            return r
    return (
        _perpendicular_unit((1.0, 0.0, 0.0), axis)
        or _perpendicular_unit((0.0, 1.0, 0.0), axis)
        or (0.0, 1.0, 0.0)
    )


def roll_deg_of(frame: dict[str, Any]) -> float:
    """Signed roll in degrees, in (-180, 180]."""
    axis = _normalize(vec(frame["axis"]))
    ref = reference_radial0(axis)
    r = _perpendicular_unit(vec(frame["radial0"]), axis) or ref
    deg = math.degrees(math.atan2(_dot(_cross(ref, r), axis), _dot(ref, r)))
    return deg + 360.0 if deg <= -180.0 else deg


def with_roll(frame: dict[str, Any], roll_deg: float) -> dict[str, Any]:
    """Copy of ``frame`` with unit axis and ``radial0`` set ``roll_deg`` from the reference."""
    axis = _normalize(vec(frame["axis"]))
    ref = reference_radial0(axis)
    ortho = _cross(axis, ref)
    rad = math.radians(roll_deg)
    c, s = math.cos(rad), math.sin(rad)
    r0 = _normalize(tuple(c * ref[i] + s * ortho[i] + 0.0 for i in range(3)))  # type: ignore[arg-type]
    origin = frame["origin"]
    return {
        "origin": {"x": float(origin["x"]), "y": float(origin["y"]), "z": float(origin["z"])},
        "axis": {"x": axis[0], "y": axis[1], "z": axis[2]},
        "radial0": {"x": r0[0], "y": r0[1], "z": r0[2]},
    }


def normalize_frame(frame: dict[str, Any]) -> dict[str, Any]:
    """Unit axis and a unit ``radial0`` made perpendicular to it (mirrors ``normalizeFrame``).

    Raises ``ValueError`` for a zero axis or a ``radial0`` parallel to the axis.
    """
    try:
        axis = _normalize(vec(frame["axis"]))
    except ValueError:
        raise ValueError("localFrame.axis must be a non-zero vector") from None
    r0 = _perpendicular_unit(vec(frame["radial0"]), axis)
    if r0 is None:
        raise ValueError("localFrame.radial0 must not be parallel to the axis")
    origin = frame["origin"]
    return {
        "origin": {"x": float(origin["x"]), "y": float(origin["y"]), "z": float(origin["z"])},
        "axis": {"x": axis[0], "y": axis[1], "z": axis[2]},
        "radial0": {"x": r0[0], "y": r0[1], "z": r0[2]},
    }


def assert_right_handed_plane(op_name: str, u: dict[str, Any], v: dict[str, Any], normal: dict[str, Any]) -> None:
    """Refuse a mirrored plane basis (mirrors ``assertRightHandedPlane`` in opDispatch.ts)."""
    if _dot(_cross(vec(u), vec(v)), vec(normal)) <= 0:
        raise ValueError(
            f"{op_name}: the plane basis is mirrored (u x v must point along normal); "
            "its helices would twist the wrong way in 3D and export"
        )
