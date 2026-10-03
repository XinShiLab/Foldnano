"""
RegionProxy — read-only views of DesignRegions from foldnano_json.

A DesignRegion owns an ordered list of VirtualHelix IDs and lives on a Plane.
Subclasses mirror the JS hierarchy:

  - LatticedRegionProxy  (kind == "HONEYCOMB" or "SQUARE")
  - FreeformRegionProxy  (kind == "FREEFORM")

Constructed by ``foldnano.io.parse_foldnano_json()``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


RegionKind = Literal["HONEYCOMB", "SQUARE", "FREEFORM"]


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
        ``"HONEYCOMB"`` | ``"SQUARE"`` | ``"FREEFORM"``.
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

    @classmethod
    def from_json(cls, region_json: dict) -> "RegionProxy":
        kind = region_json["kind"]
        if kind in ("HONEYCOMB", "SQUARE"):
            return LatticedRegionProxy._build(region_json)
        if kind == "FREEFORM":
            return FreeformRegionProxy._build(region_json)
        # Forward-compatible: unknown kinds fall back to the base proxy.
        return cls._build(region_json)

    @classmethod
    def _build(cls, j: dict) -> "RegionProxy":
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
    def _build(cls, j: dict) -> "LatticedRegionProxy":
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
        )

    @property
    def supports_lattice_grid(self) -> bool:
        return True


@dataclass
class FreeformRegionProxy(RegionProxy):
    """Freeform region — VHs are placed by ``localFrame`` rather than lattice coords."""

    @classmethod
    def _build(cls, j: dict) -> "FreeformRegionProxy":
        return cls(
            id=j["id"],
            name=j.get("name", ""),
            kind="FREEFORM",
            plane_id=j["planeId"],
            vh_order=list(j.get("vhOrder", [])),
            step=int(j.get("step", 21)),
            turns_per_step=int(j.get("turnsPerStep", 2)),
            sub_step_size=int(j.get("subStepSize", 7)),
            twist_offset=float(j.get("twistOffset", 0.0)),
            min_base=int(j.get("minBase", 0)),
            default_max_base=int(j.get("defaultMaxBase", 42)),
        )
