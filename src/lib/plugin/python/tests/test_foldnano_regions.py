"""
Phase A regression tests: Plane / DesignRegion exposure in the foldnano adaptor.

Run from project root:
    python -m pytest src/lib/plugin/python/tests/test_foldnano_regions.py -v
"""

from __future__ import annotations

import pytest

from foldnano import (
    FreeformRegionProxy,
    LatticedRegionProxy,
    PartData,
    PlaneProxy,
    RegionProxy,
    parse_foldnano_json,
)


# ---------------------------------------------------------------------------
# Multi-region parsing
# ---------------------------------------------------------------------------


def test_parse_multi_region_planes_and_regions(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)

    assert isinstance(part, PartData)
    assert len(part.planes) == 2
    assert len(part.regions) == 3

    # Plane proxies
    plane_a = part.get_plane("plane-A")
    assert isinstance(plane_a, PlaneProxy)
    assert plane_a.name == "Plane A"
    assert plane_a.origin.x == 0.0
    assert plane_a.normal.z == 1.0

    plane_b = part.get_plane("plane-B")
    assert plane_b is not None and plane_b.origin.x == 100.0


def test_region_proxy_subclasses(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)

    honey = part.get_region("region-honey")
    square = part.get_region("region-square")
    free = part.get_region("region-free")

    assert isinstance(honey, LatticedRegionProxy)
    assert honey.kind == "HONEYCOMB"
    assert honey.step == 21
    assert honey.supports_lattice_grid is True
    assert honey.plane_id == "plane-A"

    assert isinstance(square, LatticedRegionProxy)
    assert square.kind == "SQUARE"
    assert square.step == 32
    assert square.supports_lattice_grid is True

    assert isinstance(free, FreeformRegionProxy)
    assert free.kind == "FREEFORM"
    assert free.supports_lattice_grid is False


def test_region_proxy_is_subclass_of_base(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)
    for region in part.regions:
        assert isinstance(region, RegionProxy)


# ---------------------------------------------------------------------------
# Region / plane lookups
# ---------------------------------------------------------------------------


def test_region_for_vh(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)

    assert part.region_for_vh(0).id == "region-honey"
    assert part.region_for_vh(1).id == "region-honey"
    assert part.region_for_vh(2).id == "region-square"
    assert part.region_for_vh(3).id == "region-free"
    assert part.region_for_vh(99) is None


def test_vhs_in_region(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)

    honey_vhs = part.vhs_in_region("region-honey")
    assert sorted(vh.index for vh in honey_vhs) == [0, 1]

    square_vhs = part.vhs_in_region("region-square")
    assert [vh.index for vh in square_vhs] == [2]

    free_vhs = part.vhs_in_region("region-free")
    assert [vh.index for vh in free_vhs] == [3]

    assert part.vhs_in_region("does-not-exist") == []


def test_oligos_in_region_excludes_cross_region(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)

    # honey-only oligo: both segments are on region-honey VHs.
    honey_oligos = part.oligos_in_region("region-honey")
    assert [o.id for o in honey_oligos] == ["oligo-honey-only"]

    # cross-region oligo touches square + freeform — not contained in either alone.
    assert part.oligos_in_region("region-square") == []
    assert part.oligos_in_region("region-free") == []


def test_oligo_touches_regions(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)

    honey = part.get_oligo("oligo-honey-only")
    cross = part.get_oligo("oligo-cross-region")

    assert honey.touches_regions(part) == {"region-honey"}
    assert cross.touches_regions(part) == {"region-square", "region-free"}


# ---------------------------------------------------------------------------
# VH proxy: regionId, localFrame, freeform parity guard
# ---------------------------------------------------------------------------


def test_vh_carries_region_id(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)

    vh0 = part.get_vh(0)
    assert vh0.id == "vh-id-0"
    assert vh0.region_id == "region-honey"
    assert vh0.row == 0 and vh0.col == 0
    assert vh0.is_freeform is False


def test_freeform_vh_has_local_frame_and_no_lattice_coords(
    multi_region_part_foldnano_json: str,
) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)

    vh3 = part.get_vh(3)
    assert vh3.region_id == "region-free"
    assert vh3.row is None and vh3.col is None
    assert vh3.is_freeform is True
    assert vh3.local_frame is not None
    assert vh3.local_frame["origin"] == {"x": 0, "y": 0, "z": 0}


def test_parity_guard_raises_for_freeform(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)
    vh3 = part.get_vh(3)
    with pytest.raises(ValueError, match="freeform"):
        _ = vh3.parity_is_even


def test_parity_works_for_lattice_vhs(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)
    # row=0, col=0 → even. row=0, col=1 → odd.
    assert part.get_vh(0).parity_is_even is True
    assert part.get_vh(1).parity_is_even is False


# ---------------------------------------------------------------------------
# active_region_id plumbing
# ---------------------------------------------------------------------------


def test_active_region_id_threaded_through(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(
        multi_region_part_foldnano_json, active_region_id="region-square"
    )
    assert part.active_region_id == "region-square"
    assert part.active_region is not None
    assert part.active_region.id == "region-square"


def test_active_region_none_when_unset(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)
    assert part.active_region_id is None
    assert part.active_region is None


# ---------------------------------------------------------------------------
# Backward compatibility: documents predating the regions schema must still parse
# ---------------------------------------------------------------------------


def test_minimal_fixture_without_regions_still_parses(minimal_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(minimal_part_foldnano_json)
    assert part.regions == []
    assert part.planes == []
    # Lookups gracefully return None / empty list rather than raising.
    assert part.get_region("anything") is None
    assert part.region_for_vh(0) is None
    assert part.vhs_in_region("anything") == []


# ---------------------------------------------------------------------------
# Top-level lattice_type / max_base are derived from regions when present
# (Part.toJSON() no longer emits these as top-level fields).
# ---------------------------------------------------------------------------


def test_lattice_type_and_max_base_derive_from_regions() -> None:
    """A Part.toJSON()-shaped input has no top-level latticeType / maxBase."""
    import json

    doc = {
        "name": "no-legacy-fields",
        "id": "p1",
        "planes": [
            {
                "id": "plane-A",
                "name": "P",
                "origin": {"x": 0, "y": 0, "z": 0},
                "u": {"x": 1, "y": 0, "z": 0},
                "v": {"x": 0, "y": 1, "z": 0},
                "normal": {"x": 0, "y": 0, "z": 1},
            }
        ],
        "regions": [
            {
                "id": "r1",
                "name": "R",
                "kind": "SQUARE",
                "planeId": "plane-A",
                "vhOrder": [],
                "step": 32,
                "turnsPerStep": 3,
                "subStepSize": 8,
                "twistOffset": 0,
                "minBase": 0,
                "defaultMaxBase": 64,
            }
        ],
        "virtualHelices": [],
        "oligos": [],
    }
    part = parse_foldnano_json(json.dumps(doc))
    assert part.lattice_type == "SQUARE"
    assert part.max_base == 64
