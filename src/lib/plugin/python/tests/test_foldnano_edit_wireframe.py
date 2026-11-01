"""
Wireframe regions in the plugin API, and a Python → host replay golden:
``src/lib/plugin/foldnanoEditWireframeReplay.spec.ts`` replays the scenario on the real ``Part``.

Regenerate after changing the scenario or the API with
``UPDATE_FOLDNANO_EDIT_WIREFRAME=1 pnpm test:python``, then run the spec.
"""

from __future__ import annotations

import dataclasses
import itertools
import json
import math
import os
import uuid
from pathlib import Path

import pytest

from foldnano import (
    FreeformRegionProxy,
    ReferenceGeometry,
    ReferenceMesh,
    RegionProxy,
    WireframeRegionProxy,
)
from foldnano.edit import FreeformRegion, MutablePart, WireframeRegion, load_part

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN_PATH = FIXTURES / "foldnano_edit_wireframe.golden.json"
UPDATING = os.environ.get("UPDATE_FOLDNANO_EDIT_WIREFRAME") == "1"
NM_PER_BP = 0.34

# An octahedron stretched along z, so its edges have two lengths: 21 bp around the middle
# and 42 bp to the two tips.
OCTAHEDRON = ReferenceMesh(
    vertices=[(5, 0, 0), (0, 5, 0), (-5, 0, 0), (0, -5, 0), (0, 0, 13.4), (0, 0, -13.4)],
    faces=[
        (0, 1, 4),
        (1, 2, 4),
        (2, 3, 4),
        (3, 0, 4),
        (1, 0, 5),
        (2, 1, 5),
        (3, 2, 5),
        (0, 3, 5),
    ],
)
OCTAHEDRON_EDGES = sorted({tuple(sorted(pair)) for f in OCTAHEDRON.faces for pair in zip(f, (*f[1:], f[0]))})
GEOMETRY = ReferenceGeometry(mesh=OCTAHEDRON)


def base_part() -> MutablePart:
    scene = json.loads((FIXTURES / "foldnano_edit_parity.golden.json").read_text())["scenes"][0]
    return load_part(json.dumps(scene["part"]))


def wireframe_region(part: MutablePart | None = None) -> WireframeRegion:
    part = part or base_part()
    return part.add_region("WIREFRAME", "octahedron", 42)


def edge_bp(a: int, b: int) -> int:
    return round(math.dist(OCTAHEDRON.vertices[a], OCTAHEDRON.vertices[b]) / NM_PER_BP)


def build_octahedron(part: MutablePart) -> WireframeRegion:
    """One helix per edge. Every helix has the region's length; each edge's strands cover only
    the bases that edge needs, which is how a region holds edges of different lengths."""
    region = wireframe_region(part)
    region.set_reference_geometry(GEOMETRY)
    for a, b in OCTAHEDRON_EDGES:
        start, end = OCTAHEDRON.vertices[a], OCTAHEDRON.vertices[b]
        vh = region.add_vh_at(start, tuple(e - s for s, e in zip(start, end)))
        bp = edge_bp(a, b)
        part.create_oligo([(vh.index, 0, bp - 1)], color="#3366cc")
        part.create_oligo([(vh.index, bp - 1, 0)], color="#cc3366")
    return region


def scenario(part: MutablePart) -> None:
    region = build_octahedron(part)
    vhs = region.virtual_helices

    first, second = part.get_segment_at(vhs[0].index, 0, 0), part.get_segment_at(vhs[1].index, 0, 0)
    part.connect_oligos(first.oligo, second.oligo)

    # Whole-region length edits keep every helix at the region's length.
    region.increase_length_by(region.step)
    region.reduce_unused_length()
    assert region.max_base == 42

    other = part.split_region(region, vhs[5])
    assert isinstance(other, WireframeRegion) and other.reference_geometry == GEOMETRY

    other.set_reference_geometry(None)
    assert other.reference_geometry is None and region.reference_geometry == GEOMETRY


def summary(raw: dict) -> dict:
    """What the replay spec compares. Mirrored by ``summary()`` in the spec."""
    return {
        "regions": sorted(
            [r["id"], r["kind"], r.get("maxBase"), r["vhOrder"], r.get("referenceGeometry")]
            for r in raw["regions"]
        ),
        "vhs": sorted(
            [
                vh["index"],
                vh["id"],
                vh["regionId"],
                vh["length"],
                [
                    round(vh["localFrame"][key][c], 6)
                    for key in ("origin", "axis", "radial0")
                    for c in "xyz"
                ]
                if vh.get("localFrame")
                else None,
            ]
            for vh in raw["virtualHelices"]
        ),
        "segments": sorted(
            [
                o["id"],
                s["id"],
                s["inVirtualHelixIndex"],
                s["fivePrime"]["index"],
                s["threePrime"]["index"],
                s["fivePrime"]["connectedSegmentId"],
                s["threePrime"]["connectedSegmentId"],
            ]
            for o in raw["oligos"]
            for s in o["segments"]
        ),
    }


@pytest.fixture
def seeded_uuids(monkeypatch: pytest.MonkeyPatch) -> None:
    counter = itertools.count()
    monkeypatch.setattr(uuid, "uuid4", lambda: uuid.UUID(int=next(counter)))


def test_scenario_log_matches_golden(seeded_uuids: None) -> None:
    part = base_part()
    start = part.to_json()
    scenario(part)
    golden = {"part": start, "log": part.mutation_log, "expected": summary(part.to_json())}
    if UPDATING or not GOLDEN_PATH.exists():
        GOLDEN_PATH.write_text(json.dumps(golden) + "\n")
    assert golden == json.loads(GOLDEN_PATH.read_text())


def test_log_replays_into_the_mirror() -> None:
    part = base_part()
    start = part.to_json_string()
    scenario(part)
    assert MutablePart.replay_log_into_fresh_mirror(start, part.mutation_log) == part.to_json()


def test_edges_of_different_lengths_share_one_helix_length() -> None:
    part = base_part()
    region = build_octahedron(part)

    assert {vh.length for vh in region.virtual_helices} == {region.max_base}
    highest = {
        max(seg.five_prime.index, seg.three_prime.index) + 1
        for vh in region.virtual_helices
        for seg in vh.strand_sets[0].segments
    }
    assert highest == {21, 42}


def test_add_region_returns_a_freeform_style_wireframe_region() -> None:
    region = wireframe_region()

    assert isinstance(region, WireframeRegion) and isinstance(region, FreeformRegion)
    assert region.kind == "WIREFRAME"
    assert region.step == 21
    assert not region.supports_lattice_grid
    assert region.reference_geometry is None


def test_a_region_looked_up_again_is_a_wireframe_region() -> None:
    part = base_part()
    region = wireframe_region(part)

    assert isinstance(part.get_region(region.id), WireframeRegion)
    assert isinstance(load_part(part.to_json_string()).get_region(region.id), WireframeRegion)


def test_set_reference_geometry_records_one_op_and_can_clear() -> None:
    part = base_part()
    region = wireframe_region(part)
    before = len(part.mutation_log)

    region.set_reference_geometry(GEOMETRY)
    op = part.mutation_log[before]
    assert op["op"] == "set_region_reference_geometry"
    assert op["geometry"]["unit"] == "nm"
    assert len(op["geometry"]["mesh"]["vertices"]) == 6
    assert region.reference_geometry == GEOMETRY

    region.set_reference_geometry(None)
    assert part.mutation_log[-1]["geometry"] is None
    assert "referenceGeometry" not in part._raw_region(region.id)


def test_set_reference_geometry_refuses_anything_else() -> None:
    with pytest.raises(TypeError):
        wireframe_region().set_reference_geometry({"unit": "nm"})


def test_geometry_can_hold_no_mesh() -> None:
    region = wireframe_region()
    region.set_reference_geometry(ReferenceGeometry())

    assert region.reference_geometry == ReferenceGeometry()
    assert region.reference_geometry.mesh is None


def test_geometry_is_a_copy_the_plugin_cannot_change() -> None:
    mesh = ReferenceMesh([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]])

    assert mesh.vertices[1] == (1.0, 0.0, 0.0)
    assert isinstance(mesh.faces, tuple)
    with pytest.raises(dataclasses.FrozenInstanceError):
        mesh.vertices = ()


@pytest.mark.parametrize(
    "vertices, faces, edges",
    [
        ([(0, 0)], (), ()),
        ([(0, 0, math.nan)], (), ()),
        ([(0, 0, True)], (), ()),
        ([(0, 0, 0)] * 3, [(0, 1)], ()),
        ([(0, 0, 0)] * 3, [(0, 1, 3)], ()),
        ([(0, 0, 0)] * 3, [(0, 1, 1.0)], ()),
        ([(0, 0, 0)] * 3, (), [(0, 9)]),
        ([(0, 0, 0)] * 3, (), [(0, 1, 2)]),
    ],
)
def test_mesh_rejects_bad_values(vertices, faces, edges) -> None:
    with pytest.raises(ValueError):
        ReferenceMesh(vertices, faces, edges)


def test_geometry_rejects_another_unit() -> None:
    with pytest.raises(ValueError):
        ReferenceGeometry(unit="bp")


def test_to_ply_writes_every_element() -> None:
    ply = ReferenceMesh([(0, 0, 0), (1.5, 0, 0), (0, 2, 0)], [(0, 1, 2)], [(0, 1)]).to_ply()

    assert ply.splitlines() == [
        "ply",
        "format ascii 1.0",
        "comment unit nm",
        "element vertex 3",
        "property double x",
        "property double y",
        "property double z",
        "element face 1",
        "property list int int vertex_indices",
        "element edge 1",
        "property int vertex1",
        "property int vertex2",
        "end_header",
        "0.0 0.0 0.0",
        "1.5 0.0 0.0",
        "0.0 2.0 0.0",
        "3 0 1 2",
        "0 1",
    ]


def test_to_ply_leaves_out_empty_elements() -> None:
    ply = ReferenceMesh([(0, 0, 0)]).to_ply()

    assert "element face" not in ply and "element edge" not in ply


def test_parse_proxy_reads_wireframe_regions() -> None:
    region = wireframe_region()
    region.set_reference_geometry(GEOMETRY)

    proxy = RegionProxy.from_json(region._raw())

    assert isinstance(proxy, WireframeRegionProxy) and isinstance(proxy, FreeformRegionProxy)
    assert proxy.kind == "WIREFRAME"
    assert proxy.reference_geometry == GEOMETRY
    assert not proxy.supports_lattice_grid


def test_parse_proxy_without_geometry() -> None:
    proxy = RegionProxy.from_json(wireframe_region()._raw())

    assert isinstance(proxy, WireframeRegionProxy)
    assert proxy.reference_geometry is None
