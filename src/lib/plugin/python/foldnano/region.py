"""
RegionProxy — read-only views of DesignRegions from foldnano_json.

A DesignRegion owns an ordered list of VirtualHelix IDs and lives on a Plane.
Subclasses mirror the JS hierarchy:

  - LatticedRegionProxy  (kind == "HONEYCOMB" or "SQUARE")
  - FreeformRegionProxy  (kind == "FREEFORM")
  - WireframeRegionProxy (kind == "WIREFRAME"), a freeform region with reference geometry

Constructed by ``foldnano.io.parse_foldnano_json()``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Literal, Sequence


RegionKind = Literal["HONEYCOMB", "SQUARE", "FREEFORM", "WIREFRAME"]


# Same value as BACKBONE_RISE_NM in dnaGeometry.ts: nm per bp along a helix axis.
BACKBONE_RISE_NM: float = 0.3897628551303122 * 0.8518


def _is_index(value: Any, count: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value < count


@dataclass(frozen=True)
class ReferenceMesh:
    """
    A polygon mesh in nanometres: what a wireframe design was built from.

    Immutable; the values are checked when it is created, against the same rules as the host.

    Attributes
    ----------
    vertices:
        ``(x, y, z)`` positions in nm, in the region's frame.
    faces:
        Each face is three or more vertex indices.
    edges:
        ``(a, b)`` vertex index pairs. Only edges a file states; those of the faces are implied.
    """

    vertices: Sequence[Sequence[float]]
    faces: Sequence[Sequence[int]] = ()
    edges: Sequence[Sequence[int]] = ()

    def __post_init__(self) -> None:
        count = len(self.vertices)
        for v in self.vertices:
            if len(v) != 3 or not all(
                isinstance(c, (int, float)) and not isinstance(c, bool) and math.isfinite(c)
                for c in v
            ):
                raise ValueError(f"A mesh vertex must be three finite numbers, got {v!r}")
        for f in self.faces:
            if len(f) < 3 or not all(_is_index(i, count) for i in f):
                raise ValueError(f"A mesh face must be three or more vertex indices, got {f!r}")
        for e in self.edges:
            if len(e) != 2 or not all(_is_index(i, count) for i in e):
                raise ValueError(f"A mesh edge must be two vertex indices, got {e!r}")
        object.__setattr__(self, "vertices", tuple(tuple(float(c) for c in v) for v in self.vertices))
        object.__setattr__(self, "faces", tuple(tuple(f) for f in self.faces))
        object.__setattr__(self, "edges", tuple(tuple(e) for e in self.edges))

    def all_edges(self) -> tuple[tuple[int, int], ...]:
        """Every distinct edge as a sorted ``(a, b)`` pair: ``edges`` plus the sides of ``faces``."""
        pairs = {tuple(sorted(e)) for e in self.edges}
        for face in self.faces:
            pairs.update(tuple(sorted(side)) for side in zip(face, (*face[1:], face[0])))
        return tuple(sorted(pair for pair in pairs if pair[0] != pair[1]))

    def to_ply(self) -> str:
        """The mesh as ASCII PLY text, in nm, for tools that read a mesh file."""
        lines = [
            "ply",
            "format ascii 1.0",
            "comment unit nm",
            f"element vertex {len(self.vertices)}",
            "property double x",
            "property double y",
            "property double z",
        ]
        if self.faces:
            lines += [f"element face {len(self.faces)}", "property list int int vertex_indices"]
        if self.edges:
            lines += [f"element edge {len(self.edges)}", "property int vertex1", "property int vertex2"]
        lines.append("end_header")
        lines += [" ".join(repr(c) for c in v) for v in self.vertices]
        lines += [" ".join(str(i) for i in (len(f), *f)) for f in self.faces]
        lines += [f"{a} {b}" for a, b in self.edges]
        return "\n".join(lines) + "\n"


@dataclass(frozen=True)
class ReferenceGeometry:
    """
    What a wireframe region was built from, kept with the design.

    Attributes
    ----------
    mesh:
        The mesh, or ``None``.
    unit:
        Always ``"nm"``.
    """

    mesh: ReferenceMesh | None = None
    unit: Literal["nm"] = "nm"

    def __post_init__(self) -> None:
        if self.unit != "nm":
            raise ValueError(f'Reference geometry unit must be "nm", got {self.unit!r}')

    @classmethod
    def _from_json(cls, j: dict[str, Any]) -> "ReferenceGeometry":
        mesh = j.get("mesh")
        return cls(
            unit=j["unit"],
            mesh=ReferenceMesh(mesh["vertices"], mesh["faces"], mesh["edges"]) if mesh else None,
        )

    def _to_json(self) -> dict[str, Any]:
        j: dict[str, Any] = {"unit": self.unit}
        if self.mesh is not None:
            j["mesh"] = {
                "vertices": [list(v) for v in self.mesh.vertices],
                "faces": [list(f) for f in self.mesh.faces],
                "edges": [list(e) for e in self.mesh.edges],
            }
        return j


@dataclass
class RegionProxy:
    """
    Read-only proxy for a DesignRegion parsed from a foldnano_json document.

    Attributes
    ----------
    id:
        Region UUID.
    name:
        Region display name.
    kind:
        ``"HONEYCOMB"`` | ``"SQUARE"`` | ``"FREEFORM"`` | ``"WIREFRAME"``.
    plane_id:
        UUID of the Plane this region lives on.
    vh_order:
        Ordered list of VirtualHelix IDs in this region (display order).
        Note: these are VH ``id`` strings, not ``index`` integers — match
        against ``VirtualHelixProxy.id`` (when exposed) or use
        ``PartData.vhs_in_region(region_id)`` for index-based access.
    step:
        Helical period in bp (21 for honeycomb, 32 for square, 21 for freeform default).
    turns_per_step, sub_step_size, twist_offset:
        Other geometry parameters; see DesignRegion on the JS side.
    min_base, default_max_base:
        Bounds for VHs newly added to this region.
    max_base:
        Length of every VH in this region.
    """

    id: str
    name: str
    kind: RegionKind
    plane_id: str
    vh_order: list[str] = field(default_factory=list)
    step: int = 21
    turns_per_step: int = 2
    sub_step_size: int = 7
    twist_offset: float = 0.0
    min_base: int = 0
    default_max_base: int = 42
    max_base: int = 42

    @classmethod
    def from_json(cls, region_json: dict[str, Any]) -> "RegionProxy":
        kind = region_json["kind"]
        if kind in ("HONEYCOMB", "SQUARE"):
            return LatticedRegionProxy._build(region_json)
        if kind == "FREEFORM":
            return FreeformRegionProxy._build(region_json)
        if kind == "WIREFRAME":
            return WireframeRegionProxy._build(region_json)
        # Forward-compatible: unknown kinds fall back to the base proxy.
        return cls._build(region_json)

    @classmethod
    def _build(cls, j: dict[str, Any]) -> "RegionProxy":
        return cls(
            id=j["id"],
            name=j.get("name", ""),
            kind=j["kind"],
            plane_id=j["planeId"],
            vh_order=list(j.get("vhOrder", [])),
            step=int(j.get("step", 21)),
            turns_per_step=int(j.get("turnsPerStep", 2)),
            sub_step_size=int(j.get("subStepSize", 7)),
            twist_offset=float(j.get("twistOffset", 0.0)),
            min_base=int(j.get("minBase", 0)),
            default_max_base=int(j.get("defaultMaxBase", 42)),
            max_base=int(j.get("maxBase") or j.get("defaultMaxBase", 42)),
        )

    @property
    def supports_lattice_grid(self) -> bool:
        return False


@dataclass
class LatticedRegionProxy(RegionProxy):
    """Lattice-backed region (HONEYCOMB or SQUARE).

    VHs in a lattice region carry ``latticeCoords`` (row/col); the host can
    place crossovers on a constrained grid. Use ``supports_lattice_grid``
    instead of ``isinstance`` to gate plugin logic.
    """

    @classmethod
    def _build(cls, j: dict[str, Any]) -> "LatticedRegionProxy":
        return cls(
            id=j["id"],
            name=j.get("name", ""),
            kind=j["kind"],
            plane_id=j["planeId"],
            vh_order=list(j.get("vhOrder", [])),
            step=int(j.get("step", 21)),
            turns_per_step=int(j.get("turnsPerStep", 2)),
            sub_step_size=int(j.get("subStepSize", 7)),
            twist_offset=float(j.get("twistOffset", 0.0)),
            min_base=int(j.get("minBase", 0)),
            default_max_base=int(j.get("defaultMaxBase", 42)),
            max_base=int(j.get("maxBase") or j.get("defaultMaxBase", 42)),
        )

    @property
    def supports_lattice_grid(self) -> bool:
        return True


@dataclass
class FreeformRegionProxy(RegionProxy):
    """Freeform region — VHs are placed by ``localFrame`` rather than lattice coords."""

    @classmethod
    def _build(cls, j: dict[str, Any]) -> "FreeformRegionProxy":
        return cls(
            id=j["id"],
            name=j.get("name", ""),
            kind=j["kind"],
            plane_id=j["planeId"],
            vh_order=list(j.get("vhOrder", [])),
            step=int(j.get("step", 21)),
            turns_per_step=int(j.get("turnsPerStep", 2)),
            sub_step_size=int(j.get("subStepSize", 7)),
            twist_offset=float(j.get("twistOffset", 0.0)),
            min_base=int(j.get("minBase", 0)),
            default_max_base=int(j.get("defaultMaxBase", 42)),
            max_base=int(j.get("maxBase") or j.get("defaultMaxBase", 42)),
        )


@dataclass
class WireframeRegionProxy(FreeformRegionProxy):
    """Wireframe region — a freeform region that can hold the geometry it was built from."""

    reference_geometry: ReferenceGeometry | None = None

    @classmethod
    def _build(cls, j: dict[str, Any]) -> "WireframeRegionProxy":
        proxy = super()._build(j)
        geometry = j.get("referenceGeometry")
        proxy.reference_geometry = ReferenceGeometry._from_json(geometry) if geometry else None
        return proxy
