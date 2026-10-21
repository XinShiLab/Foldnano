"""
Self-consistency: replay a captured mutation log into a fresh OfflineTransport
and assert the result matches ``part.to_json()``.

This catches op-encoding bugs and replay determinism issues without touching
JS. It does NOT verify that the offline mirror's semantics match the JS model
exactly — that's the job of the Phase C JS-side replay strategy.

Run from project root::

    cd src/lib/plugin/python
    uv run pytest tests/test_foldnano_mini_replay_self.py -v
"""

from __future__ import annotations

import pytest

from foldnano_mini import MutablePart, load_part


def _replay_matches_mirror(json_str: str, log: list[dict], mirror: dict) -> None:
    replayed = MutablePart.replay_log_into_fresh_mirror(json_str, log)
    assert replayed == mirror


def test_replay_empty_log_is_identity(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    _replay_matches_mirror(multi_region_part_foldnano_json, part.mutation_log, part.to_json())


def test_replay_after_color_change(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    part.get_oligo("oligo-honey-only").color = "#abcdef"
    _replay_matches_mirror(multi_region_part_foldnano_json, part.mutation_log, part.to_json())


def test_replay_after_mixed_simple_ops(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    o = part.get_oligo("oligo-honey-only")
    o.color = "#112233"
    o.name = "renamed-staple"
    o.is_scaffold = True
    seg = o.segments[0]
    seg.five_modification = "/5Bio/"
    seg.slot_at(3).seq = "G"
    part.create_segment(vh=0, five_index=20, three_index=0)
    seg.slot_at(7).set_skip(True)

    _replay_matches_mirror(multi_region_part_foldnano_json, part.mutation_log, part.to_json())


def test_replay_after_create_segment_and_connect(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    a = part.create_segment(vh=2, five_index=40, three_index=50, color="#00ff00")
    b = part.create_segment(vh=2, five_index=51, three_index=60, color="#00ff00")
    part.connect(a, b)

    _replay_matches_mirror(multi_region_part_foldnano_json, part.mutation_log, part.to_json())


def test_replay_after_remove_oligo(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    part.get_oligo("oligo-honey-only").remove()
    _replay_matches_mirror(multi_region_part_foldnano_json, part.mutation_log, part.to_json())


def test_replay_after_remove_vhs(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    part.remove_vhs([3])
    _replay_matches_mirror(multi_region_part_foldnano_json, part.mutation_log, part.to_json())


def test_replay_after_add_vh_at_coords(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    region = part.get_region("region-honey")
    region.add_vh_at(row=1, col=0)
    _replay_matches_mirror(multi_region_part_foldnano_json, part.mutation_log, part.to_json())


def test_replay_full_kitchen_sink(multi_region_part_foldnano_json: str) -> None:
    """One pass that exercises a representative slice of the op vocabulary."""
    part = load_part(multi_region_part_foldnano_json)

    part.get_oligo("oligo-honey-only").color = "#aabbcc"
    part.get_oligo("oligo-honey-only").name = "honey"
    part.get_region("region-honey").add_vh_at(row=2, col=2)
    new_seg = part.create_segment(vh=2, five_index=50, three_index=40)
    new_seg.five_modification = "/5Cy3/"
    new_seg.slot_at(45).seq = "T"
    part.get_vh(0).local_frame = {
        "origin": {"x": 0, "y": 0, "z": 0},
        "axis": {"x": 0, "y": 0, "z": 1},
        "radial0": {"x": 1, "y": 0, "z": 0},
    }

    _replay_matches_mirror(multi_region_part_foldnano_json, part.mutation_log, part.to_json())


# ---------------------------------------------------------------------------
# PluginContext integration
# ---------------------------------------------------------------------------


def test_set_result_mutation_log_round_trip(multi_region_part_foldnano_json: str) -> None:
    from foldnano import PluginContext

    ctx = PluginContext(
        format="foldnano_mini",
        foldnano_json_in=multi_region_part_foldnano_json,
        active_region_id="region-honey",
    )
    part = load_part(ctx.get_part_as_foldnano_json(), active_region_id=ctx.active_region_id)
    part.get_oligo("oligo-honey-only").color = "#ff0000"
    ctx.set_result_mutation_log(part.mutation_log)

    assert ctx.mutation_log == [
        {"op": "set_oligo_color", "oligoId": "oligo-honey-only", "color": "#ff0000"}
    ]


def test_set_result_mutation_log_rejects_wrong_format(
    multi_region_part_foldnano_json: str,
) -> None:
    from foldnano import PluginContext

    ctx = PluginContext(
        format="foldnano_json",
        foldnano_json_in=multi_region_part_foldnano_json,
    )
    with pytest.raises(RuntimeError, match="foldnano_mini"):
        ctx.set_result_mutation_log([])


def test_set_result_mutation_log_rejects_bad_log_shape(
    multi_region_part_foldnano_json: str,
) -> None:
    from foldnano import PluginContext

    ctx = PluginContext(
        format="foldnano_mini",
        foldnano_json_in=multi_region_part_foldnano_json,
    )
    with pytest.raises(TypeError):
        ctx.set_result_mutation_log("not-a-list")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        ctx.set_result_mutation_log([{"missing-op-key": True}])
