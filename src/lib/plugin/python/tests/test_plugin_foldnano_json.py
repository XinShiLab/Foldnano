"""
Phase 2 tests — foldnano_json mode.

Verifies that PluginContext correctly delivers foldnano_json to the plugin,
that the parse_foldnano_json helper produces correct proxy objects, and that
plugins can mutate and round-trip the Part JSON.
"""

from __future__ import annotations

import json

import pytest

from foldnano.plugin import PluginContext
from foldnano.io import parse_foldnano_json, PartData
from foldnano.vh import VirtualHelixProxy
from foldnano.oligo import OligoProxy, OligoSegmentProxy


# ---------------------------------------------------------------------------
# Helpers / simple plugins
# ---------------------------------------------------------------------------

def plugin_passthrough(ctx: PluginContext) -> None:
    """Return the part unchanged."""
    raw = ctx.get_part_as_foldnano_json()
    ctx.set_result_foldnano_json(raw)


def plugin_recolor_first_oligo(ctx: PluginContext) -> None:
    """Change the first oligo's color to '#ff0000' and return the modified part."""
    part = parse_foldnano_json(ctx.get_part_as_foldnano_json())
    if part._raw["oligos"]:
        part._raw["oligos"][0]["color"] = "#ff0000"
    ctx.set_result_foldnano_json(json.dumps(part._raw))


def plugin_log_summary(ctx: PluginContext) -> None:
    """Log a summary of the part and set a structured result."""
    part = parse_foldnano_json(ctx.get_part_as_foldnano_json())
    ctx.log(f"Part: {part.name!r}")
    ctx.log(f"VHs: {len(part.virtual_helices)}")
    ctx.log(f"Oligos: {len(part.oligos)}")
    ctx.set_result({
        "name": part.name,
        "vh_count": len(part.virtual_helices),
        "oligo_count": len(part.oligos),
    })
    ctx.set_result_foldnano_json(ctx.get_part_as_foldnano_json())


# ---------------------------------------------------------------------------
# PluginContext — format enforcement
# ---------------------------------------------------------------------------

class TestPluginContextFoldnanoFormat:
    def test_foldnano_format_accepted(self, minimal_part_foldnano_json):
        ctx = PluginContext(format="foldnano_json", foldnano_json_in=minimal_part_foldnano_json)
        assert ctx.format == "foldnano_json"

    def test_wrong_format_raises(self, minimal_part_foldnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=minimal_part_foldnano_json)
        with pytest.raises(RuntimeError, match="plugin format is 'cadnano_json'"):
            ctx.get_part_as_foldnano_json()

    def test_missing_input_raises(self):
        ctx = PluginContext(format="foldnano_json")  # no foldnano_json_in
        with pytest.raises(RuntimeError, match="No Foldnano JSON input"):
            ctx.get_part_as_foldnano_json()

    def test_set_result_requires_str(self, minimal_part_foldnano_json):
        ctx = PluginContext(format="foldnano_json", foldnano_json_in=minimal_part_foldnano_json)
        with pytest.raises(TypeError):
            ctx.set_result_foldnano_json({"not": "a string"})  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# parse_foldnano_json — PartData structure
# ---------------------------------------------------------------------------

class TestParseFoldnanoJson:
    def test_returns_part_data(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        assert isinstance(part, PartData)

    def test_part_name(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        assert part.name == "minimal-test-part"

    def test_part_id(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        assert part.id == "test-part-001"

    def test_lattice_type(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        assert part.lattice_type == "HONEYCOMB"

    def test_max_base(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        assert part.max_base == 21

    def test_raw_preserved(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        assert part._raw == json.loads(minimal_part_foldnano_json)


# ---------------------------------------------------------------------------
# VirtualHelixProxy
# ---------------------------------------------------------------------------

class TestVirtualHelixProxy:
    def test_vh_count(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        assert len(part.virtual_helices) == 2

    def test_vh_types(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        for vh in part.virtual_helices:
            assert isinstance(vh, VirtualHelixProxy)

    def test_vh_indices(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        indices = [vh.index for vh in part.virtual_helices]
        assert 0 in indices
        assert 1 in indices

    def test_vh_row_col(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        vh0 = part.get_vh(0)
        assert vh0 is not None
        assert vh0.row == 0
        assert vh0.col == 0

    def test_vh_length(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        vh0 = part.get_vh(0)
        assert vh0.length == 21

    def test_strand_set_segment_ids(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        vh0 = part.get_vh(0)
        assert len(vh0.strand_set_segment_ids) == 2
        assert "seg-scaffold-0" in vh0.strand_set_segment_ids[0]
        assert "seg-staple-0" in vh0.strand_set_segment_ids[1]

    def test_parity_even(self, minimal_part_foldnano_json):
        # VH0: row=0, col=0 → 0%2 == 0%2 → even parity
        part = parse_foldnano_json(minimal_part_foldnano_json)
        vh0 = part.get_vh(0)
        assert vh0.parity_is_even is True

    def test_parity_odd(self, minimal_part_foldnano_json):
        # VH1: row=0, col=1 → 0%2 != 1%2 → odd parity
        part = parse_foldnano_json(minimal_part_foldnano_json)
        vh1 = part.get_vh(1)
        assert vh1.parity_is_even is False

    def test_get_vh_missing_returns_none(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        assert part.get_vh(99) is None


# ---------------------------------------------------------------------------
# OligoProxy
# ---------------------------------------------------------------------------

class TestOligoProxy:
    def test_oligo_count(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        assert len(part.oligos) == 2

    def test_oligo_types(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        for oligo in part.oligos:
            assert isinstance(oligo, OligoProxy)

    def test_scaffold_flag(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        scaffold = part.get_oligo("oligo-scaffold")
        staple = part.get_oligo("oligo-staple")
        assert scaffold is not None
        assert staple is not None
        assert scaffold.is_scaffold is True
        assert staple.is_scaffold is False

    def test_color(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        scaffold = part.get_oligo("oligo-scaffold")
        assert scaffold.color == "#0066cc"

    def test_oligo_name(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        staple = part.get_oligo("oligo-staple")
        assert staple.name == "staple-1"

    def test_scaffold_name_none(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        scaffold = part.get_oligo("oligo-scaffold")
        assert scaffold.name is None

    def test_get_oligo_missing_returns_none(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        assert part.get_oligo("nonexistent") is None


# ---------------------------------------------------------------------------
# OligoSegmentProxy
# ---------------------------------------------------------------------------

class TestOligoSegmentProxy:
    def test_segment_count_scaffold(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        scaffold = part.get_oligo("oligo-scaffold")
        assert len(scaffold.segments) == 2

    def test_segment_count_staple(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        staple = part.get_oligo("oligo-staple")
        assert len(staple.segments) == 1

    def test_segment_types(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        for oligo in part.oligos:
            for seg in oligo.segments:
                assert isinstance(seg, OligoSegmentProxy)

    def test_segment_vh_index(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        scaffold = part.get_oligo("oligo-scaffold")
        assert scaffold.segments[0].vh_index == 0
        assert scaffold.segments[1].vh_index == 1

    def test_five_prime_indices(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        seg0 = part.get_oligo("oligo-scaffold").segments[0]
        assert seg0.five_prime_index == 0
        assert seg0.three_prime_index == 10

    def test_segment_sequence(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        seg0 = part.get_oligo("oligo-scaffold").segments[0]
        assert seg0.sequence == "ATCGATCGATC"

    def test_oligo_sequence_concatenated(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        scaffold = part.get_oligo("oligo-scaffold")
        assert scaffold.sequence == "ATCGATCGATCGATCGATCGAT"

    def test_five_prime_modification(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        staple = part.get_oligo("oligo-staple")
        assert staple.segments[0].five_prime_modification == "/5Alex488N/"

    def test_three_prime_modification_none(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        staple = part.get_oligo("oligo-staple")
        assert staple.segments[0].three_prime_modification is None

    def test_crossover_connection(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        scaffold = part.get_oligo("oligo-scaffold")
        seg0 = scaffold.segments[0]
        seg1 = scaffold.segments[1]
        # seg0's 3' connects to seg1
        assert seg0.connected_to_segment_id == seg1.id
        # seg1's 5' comes from seg0
        assert seg1.connected_from_segment_id == seg0.id

    def test_free_ends(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        scaffold = part.get_oligo("oligo-scaffold")
        first_seg = scaffold.segments[0]
        last_seg = scaffold.segments[-1]
        assert first_seg.is_free_five_prime is True
        assert last_seg.is_free_three_prime is True

    def test_segment_length(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        seg0 = part.get_oligo("oligo-scaffold").segments[0]
        # indices 0..10 inclusive → length 11
        assert seg0.length == 11

    def test_is_circular_false(self, minimal_part_foldnano_json):
        part = parse_foldnano_json(minimal_part_foldnano_json)
        scaffold = part.get_oligo("oligo-scaffold")
        assert scaffold.is_circular is False


# ---------------------------------------------------------------------------
# Round-trip via plugin
# ---------------------------------------------------------------------------

class TestFoldnanoJsonRoundTrip:
    def test_passthrough_preserves_part_name(self, minimal_part_foldnano_json):
        ctx = PluginContext(format="foldnano_json", foldnano_json_in=minimal_part_foldnano_json)
        plugin_passthrough(ctx)
        result = json.loads(ctx.primary_artifact)
        assert result["name"] == "minimal-test-part"

    def test_passthrough_preserves_oligo_count(self, minimal_part_foldnano_json):
        ctx = PluginContext(format="foldnano_json", foldnano_json_in=minimal_part_foldnano_json)
        plugin_passthrough(ctx)
        result = json.loads(ctx.primary_artifact)
        original = json.loads(minimal_part_foldnano_json)
        assert len(result["oligos"]) == len(original["oligos"])

    def test_passthrough_preserves_vh_count(self, minimal_part_foldnano_json):
        ctx = PluginContext(format="foldnano_json", foldnano_json_in=minimal_part_foldnano_json)
        plugin_passthrough(ctx)
        result = json.loads(ctx.primary_artifact)
        original = json.loads(minimal_part_foldnano_json)
        assert len(result["virtualHelices"]) == len(original["virtualHelices"])


# ---------------------------------------------------------------------------
# Mutation
# ---------------------------------------------------------------------------

class TestFoldnanoJsonMutation:
    def test_recolor_first_oligo(self, minimal_part_foldnano_json):
        ctx = PluginContext(format="foldnano_json", foldnano_json_in=minimal_part_foldnano_json)
        plugin_recolor_first_oligo(ctx)
        result = json.loads(ctx.primary_artifact)
        assert result["oligos"][0]["color"] == "#ff0000"

    def test_recolor_does_not_affect_other_oligos(self, minimal_part_foldnano_json):
        ctx = PluginContext(format="foldnano_json", foldnano_json_in=minimal_part_foldnano_json)
        plugin_recolor_first_oligo(ctx)
        result = json.loads(ctx.primary_artifact)
        original = json.loads(minimal_part_foldnano_json)
        for i in range(1, len(original["oligos"])):
            assert result["oligos"][i]["color"] == original["oligos"][i]["color"]

    def test_mutation_preserves_segment_ids(self, minimal_part_foldnano_json):
        ctx = PluginContext(format="foldnano_json", foldnano_json_in=minimal_part_foldnano_json)
        plugin_recolor_first_oligo(ctx)
        result = json.loads(ctx.primary_artifact)
        original = json.loads(minimal_part_foldnano_json)
        for r_oligo, o_oligo in zip(result["oligos"], original["oligos"]):
            r_ids = [s["id"] for s in r_oligo["segments"]]
            o_ids = [s["id"] for s in o_oligo["segments"]]
            assert r_ids == o_ids


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

class TestFoldnanoJsonLogging:
    def test_summary_logs_three_messages(self, minimal_part_foldnano_json):
        ctx = PluginContext(format="foldnano_json", foldnano_json_in=minimal_part_foldnano_json)
        plugin_log_summary(ctx)
        assert len(ctx.logs) == 3

    def test_summary_result_dict(self, minimal_part_foldnano_json):
        ctx = PluginContext(format="foldnano_json", foldnano_json_in=minimal_part_foldnano_json)
        plugin_log_summary(ctx)
        assert ctx.plugin_result["name"] == "minimal-test-part"
        assert ctx.plugin_result["vh_count"] == 2
        assert ctx.plugin_result["oligo_count"] == 2
