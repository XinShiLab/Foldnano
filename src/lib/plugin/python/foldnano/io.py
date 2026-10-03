"""
foldnano.io — helpers for parsing plugin I/O formats.

Functions
---------
parse_cadnano_json(json_str)
    Parse a cadnano JSON string into a Python dict.

parse_foldnano_json(json_str, active_region_id=None)
    Parse a foldnano_json string (Part.toJSON() output) into a PartData object
    with typed proxy collections (planes, regions, virtual helices, oligos).
"""

from __future__ import annotations

import json
from typing import Optional

from .vh import VirtualHelixProxy
from .oligo import OligoProxy
from .region import RegionProxy
from .plane import PlaneProxy


class PartData:
    """
    Parsed representation of a part's foldnano_json (Part.toJSON() output).

    The ``_raw`` attribute holds the original dict so a plugin can modify it
    in-place and serialise it back::

        part = parse_foldnano_json(ctx.get_part_as_foldnano_json())
        part._raw["oligos"][0]["color"] = "#ff0000"
        ctx.set_result_foldnano_json(json.dumps(part._raw))

    Attributes
    ----------
    name, id:
        Part name and UUID.
    lattice_type:
        ``"HONEYCOMB"`` or ``"SQUARE"`` (legacy field; superseded by region kinds).
    max_base:
        Total number of base-pair slots per helix.
    virtual_helices:
        Parsed VirtualHelixProxy list (same order as the JSON array).
    oligos:
        Parsed OligoProxy list (same order as the JSON array).
    regions:
        Parsed RegionProxy list. Empty for documents predating the regions schema.
    planes:
        Parsed PlaneProxy list. Empty for documents predating the regions schema.
    active_region_id:
        ID of the region the host considered "active" when launching the
        plugin, or ``None``. Plugins targeting a single region (e.g.
        ``replaceRegion`` strategies) should use this to scope their work.
    """

    def __init__(
        self,
        name: str,
        id: str,
        lattice_type: str,
        max_base: int,
        virtual_helices: list[VirtualHelixProxy],
        oligos: list[OligoProxy],
        raw: dict,
        regions: Optional[list[RegionProxy]] = None,
        planes: Optional[list[PlaneProxy]] = None,
        active_region_id: Optional[str] = None,
    ) -> None:
        self.name = name
        self.id = id
        self.lattice_type = lattice_type
        self.max_base = max_base
        self.virtual_helices = virtual_helices
        self.oligos = oligos
        self.regions: list[RegionProxy] = regions or []
        self.planes: list[PlaneProxy] = planes or []
        self.active_region_id = active_region_id
        self._raw = raw

    def get_vh(self, index: int) -> VirtualHelixProxy | None:
        """Return the VirtualHelixProxy with the given VH index, or None."""
        for vh in self.virtual_helices:
            if vh.index == index:
                return vh
        return None

    def get_oligo(self, id: str) -> OligoProxy | None:
        """Return the OligoProxy with the given ID, or None."""
        for oligo in self.oligos:
            if oligo.id == id:
                return oligo
        return None

    # ------------------------------------------------------------------
    # Region / plane lookups
    # ------------------------------------------------------------------

    def get_region(self, region_id: str) -> RegionProxy | None:
        """Return the RegionProxy with the given ID, or None."""
        for region in self.regions:
            if region.id == region_id:
                return region
        return None

    def get_plane(self, plane_id: str) -> PlaneProxy | None:
        """Return the PlaneProxy with the given ID, or None."""
        for plane in self.planes:
            if plane.id == plane_id:
                return plane
        return None

    def region_for_vh(self, vh_index: int) -> RegionProxy | None:
        """Return the region a given VH belongs to, or None if unknown."""
        vh = self.get_vh(vh_index)
        if vh is None or vh.region_id is None:
            return None
        return self.get_region(vh.region_id)

    def vhs_in_region(self, region_id: str) -> list[VirtualHelixProxy]:
        """Return all VHs whose ``region_id`` matches the given region."""
        return [vh for vh in self.virtual_helices if vh.region_id == region_id]

    def oligos_in_region(self, region_id: str) -> list[OligoProxy]:
        """
        Return oligos whose every segment lives in the given region.

        Cross-region oligos are excluded. Use ``OligoProxy.touches_regions(part)``
        to detect oligos that span multiple regions.
        """
        result: list[OligoProxy] = []
        for oligo in self.oligos:
            touched = oligo.touches_regions(self)
            if touched == {region_id}:
                result.append(oligo)
        return result

    @property
    def active_region(self) -> RegionProxy | None:
        """The region the host marked active when this plugin was launched, or None."""
        if self.active_region_id is None:
            return None
        return self.get_region(self.active_region_id)

    def __repr__(self) -> str:
        return (
            f"PartData(name={self.name!r}, lattice={self.lattice_type}, "
            f"vhs={len(self.virtual_helices)}, oligos={len(self.oligos)}, "
            f"regions={len(self.regions)}, planes={len(self.planes)})"
        )


def parse_cadnano_json(json_str: str) -> dict:
    """
    Parse a cadnano JSON string into a Python dict.

    The returned dict has the structure::

        {
            "name": str,
            "vstrands": [
                {
                    "row": int, "col": int, "num": int,
                    "scaf": [[fVh, fBp, tVh, tBp], ...],   # length == maxBase
                    "stap": [[fVh, fBp, tVh, tBp], ...],
                    "loop": [int, ...],
                    "skip": [int, ...],
                    "stap_colors": [[fivePrimeIdx, colorInt], ...],
                    "scaf_colors": [[fivePrimeIdx, colorInt], ...],
                },
                ...
            ]
        }

    The ``[-1, -1, -1, -1]`` quadruple means "no nucleotide at this position".
    """
    return json.loads(json_str)


def parse_foldnano_json(
    json_str: str,
    active_region_id: Optional[str] = None,
) -> PartData:
    """
    Parse a foldnano_json string (Part.toJSON() output) into a PartData object.

    The returned PartData exposes ``virtual_helices``, ``oligos``, ``regions``,
    and ``planes`` as typed proxy objects. The ``._raw`` dict is preserved for
    round-trip serialisation.

    Parameters
    ----------
    json_str:
        Serialised Part.toJSON() output.
    active_region_id:
        Optional region UUID — the region the host considered "active" when
        launching the plugin. Region-scoped plugins (apply strategies
        ``replaceRegion`` / ``replaceRegionKeepAnnotationsWhereMatched``)
        should pass it through so plugin code can target the right region.
    """
    raw = json.loads(json_str)
    vhs = [VirtualHelixProxy.from_json(vh) for vh in raw.get("virtualHelices", [])]
    oligos = [OligoProxy.from_json(o) for o in raw.get("oligos", [])]
    regions = [RegionProxy.from_json(r) for r in raw.get("regions", [])]
    planes = [PlaneProxy.from_json(p) for p in raw.get("planes", [])]

    # Part.toJSON() no longer emits top-level latticeType / maxBase — they're
    # per-region (kind / defaultMaxBase). Derive from the first region when
    # regions are present; fall back to the legacy top-level fields for
    # documents predating the regions schema.
    if regions:
        lattice_type = regions[0].kind
        max_base = regions[0].default_max_base
    else:
        lattice_type = raw.get("latticeType", "")
        max_base = raw.get("maxBase", 0)

    return PartData(
        name=raw.get("name", ""),
        id=raw.get("id", ""),
        lattice_type=lattice_type,
        max_base=max_base,
        virtual_helices=vhs,
        oligos=oligos,
        raw=raw,
        regions=regions,
        planes=planes,
        active_region_id=active_region_id,
    )


## TODO: Some plugins require cadnano_json file to be saved to disk, so
#  we should add a helper for that too, save the json to a temp file and return the path.
#  We can use tempfile.NamedTemporaryFile for this.
#  Later this tem file will be in Pyodide's virtual filesystem, so we can read it back in after the plugin is done.

# ... implement this todo here:
