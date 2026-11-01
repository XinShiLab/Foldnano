"""The example plugins on the Wireframe Plugins doc page must run against the current API."""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import pytest

from foldnano import BACKBONE_RISE_NM, PluginContext, ReferenceGeometry, ReferenceMesh
from foldnano.edit import load_part

REPO = Path(__file__).resolve().parents[5]
PAGE = REPO / "src/content/plugin-development/12-wireframe-plugins.md"
FIXTURES = Path(__file__).parent / "fixtures"

S = 3.5355339 * 4  # a tetrahedron with 40 nm edges
TETRAHEDRON = ReferenceMesh(
    vertices=[(S, S, S), (-S, -S, S), (-S, S, -S), (S, -S, -S)],
    faces=[(0, 1, 2), (0, 3, 1), (0, 2, 3), (1, 3, 2)],
)


def examples() -> dict[str, str]:
    """Each full plugin on the page, keyed by the manifest id printed just before it."""
    text = PAGE.read_text()
    pairs = re.findall(r'"id": "([a-z-]+)",\s+"name".*?```python\n(.*?)```', text, flags=re.S)
    return dict(pairs)


def run_example(code: str, part_json: str, region_id: str | None, params: dict | None = None):
    namespace: dict = {}
    exec(compile(code, str(PAGE), "exec"), namespace)
    ctx = PluginContext(
        format="foldnano_edit",
        foldnano_json_in=part_json,
        active_region_id=region_id,
        params_json=json.dumps(params or {}),
    )
    namespace["run"](ctx)
    return ctx


def part_with_region(mesh: ReferenceMesh | None = TETRAHEDRON) -> tuple[str, str]:
    part = load_part((FIXTURES / "multi_region_part.foldnano.json").read_text())
    region = part.add_region("WIREFRAME", "w", 42)
    if mesh:
        region.set_reference_geometry(ReferenceGeometry(mesh=mesh))
    return part.to_json_string(), region.id


def ops(ctx: PluginContext) -> Counter:
    return Counter(op["op"] for op in ctx.mutation_log)


def test_page_has_the_three_examples() -> None:
    assert set(examples()) == {"wireframe-mesh-report", "helix-per-edge", "wireframe-cube"}


def test_mesh_report() -> None:
    ctx = run_example(examples()["wireframe-mesh-report"], *part_with_region())

    assert ctx.plugin_result == {"vertices": 4, "edges": 6}
    assert not ctx.mutation_log


def test_helix_per_edge_lengthens_the_region_to_fit() -> None:
    ctx = run_example(examples()["helix-per-edge"], *part_with_region())

    assert ctx.plugin_result == {"helices": 6, "longest_bp": 111}
    assert ops(ctx) == {"set_region_max_base": 1, "add_freeform_vh": 6, "create_segment": 12}


def test_helix_per_edge_refuses_a_region_without_a_mesh() -> None:
    with pytest.raises(ValueError, match="no reference mesh"):
        run_example(examples()["helix-per-edge"], *part_with_region(None))


def test_cube_builds_its_own_region() -> None:
    part_json, _ = part_with_region()
    ctx = run_example(examples()["wireframe-cube"], part_json, None, {"edge_nm": 30})

    assert ctx.plugin_result == {"helices": 12, "bp_per_edge": 81}
    assert ops(ctx) == {
        "add_region_and_plane": 1,
        "set_region_reference_geometry": 1,
        "add_freeform_vh": 12,
        "create_segment": 24,
    }


def test_all_edges_lists_each_edge_once() -> None:
    mesh = ReferenceMesh(
        vertices=[(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)],
        faces=[(0, 1, 2), (2, 1, 0)],
        edges=[(3, 0), (0, 3)],
    )

    assert mesh.all_edges() == ((0, 1), (0, 2), (0, 3), (1, 2))
    assert TETRAHEDRON.edges == ()
    assert len(TETRAHEDRON.all_edges()) == 6


def test_rise_matches_the_app() -> None:
    source = (REPO / "src/lib/model/geometry3d/dnaGeometry.ts").read_text()
    oxdna_nm = float(re.search(r"const _OXDNA_NM = ([\d.]+);", source).group(1))
    units = float(re.search(r"BACKBONE_RISE_NM = ([\d.]+) \* _OXDNA_NM", source).group(1))

    assert BACKBONE_RISE_NM == units * oxdna_nm
