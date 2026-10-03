"""
Phase 2 tests — cadnano_json mode.

Verifies that PluginContext correctly delivers cadnano JSON to the plugin,
that a plugin can round-trip the data unmodified, and that plugins that mutate
topology produce the expected output structure.
"""

from __future__ import annotations

import json

import pytest

from foldnano.plugin import PluginContext
from foldnano.io import parse_cadnano_json


# ---------------------------------------------------------------------------
# Helpers / simple plugins
# ---------------------------------------------------------------------------

def plugin_passthrough(ctx: PluginContext) -> None:
    """Return the part unchanged."""
    raw = ctx.get_part_as_cadnano_json()
    ctx.set_result_cadnano_json(raw)


def plugin_log_vhs(ctx: PluginContext) -> None:
    """Log VH count and set a structured result."""
    data = parse_cadnano_json(ctx.get_part_as_cadnano_json())
    n = len(data["vstrands"])
    ctx.log(f"VH count: {n}")
    ctx.set_result({"vh_count": n})
    ctx.set_result_cadnano_json(ctx.get_part_as_cadnano_json())


def plugin_recolor_stap(ctx: PluginContext) -> None:
    """Assign a fixed color (#aabbcc = 0xaabbcc = 11189196) to every staple 5' end."""
    data = parse_cadnano_json(ctx.get_part_as_cadnano_json())
    fixed_color_int = 0xAABBCC
    for vs in data["vstrands"]:
        stap_colors = vs.get("stap_colors", [])
        recolored = [[entry[0], fixed_color_int] for entry in stap_colors]
        vs["stap_colors"] = recolored
    ctx.set_result_cadnano_json(json.dumps(data))


# ---------------------------------------------------------------------------
# PluginContext construction
# ---------------------------------------------------------------------------

class TestPluginContextConstruction:
    def test_cadnano_json_format_accepted(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        assert ctx.format == "cadnano_json"

    def test_unknown_format_raises(self):
        with pytest.raises(ValueError, match="Unknown plugin format"):
            PluginContext(format="bad_format")

    def test_wrong_format_for_cadnano_raises(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="foldnano_json", foldnano_json_in=only_scaf_cadnano_json)
        with pytest.raises(RuntimeError, match="plugin format is 'foldnano_json'"):
            ctx.get_part_as_cadnano_json()

    def test_missing_input_raises(self):
        ctx = PluginContext(format="cadnano_json")  # no cadnano_json_in
        with pytest.raises(RuntimeError, match="No cadnano JSON input"):
            ctx.get_part_as_cadnano_json()

    def test_part_index_nonzero_raises(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        with pytest.raises(NotImplementedError):
            ctx.get_part_as_cadnano_json(part_index=1)


# ---------------------------------------------------------------------------
# Round-trip
# ---------------------------------------------------------------------------

class TestCadnanoJsonRoundTrip:
    def test_passthrough_preserves_name(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        plugin_passthrough(ctx)
        result = json.loads(ctx.primary_artifact)
        original = json.loads(only_scaf_cadnano_json)
        assert result["name"] == original["name"]

    def test_passthrough_preserves_vstrand_count(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        plugin_passthrough(ctx)
        result = json.loads(ctx.primary_artifact)
        original = json.loads(only_scaf_cadnano_json)
        assert len(result["vstrands"]) == len(original["vstrands"])

    def test_passthrough_scaf_array_unchanged(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        plugin_passthrough(ctx)
        result = json.loads(ctx.primary_artifact)
        original = json.loads(only_scaf_cadnano_json)
        for r_vs, o_vs in zip(result["vstrands"], original["vstrands"]):
            assert r_vs["scaf"] == o_vs["scaf"]

    def test_set_result_requires_str(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        with pytest.raises(TypeError):
            ctx.set_result_cadnano_json({"not": "a string"})  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Mutation
# ---------------------------------------------------------------------------

class TestCadnanoJsonMutation:
    def test_recolor_changes_stap_colors(self, only_scaf_cadnano_json):
        # only_scaf.json has at least one vstrand with a scaf_color
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        plugin_recolor_stap(ctx)
        result = json.loads(ctx.primary_artifact)
        # Every non-empty stap_colors entry should use 0xAABBCC
        for vs in result["vstrands"]:
            for entry in vs.get("stap_colors", []):
                assert entry[1] == 0xAABBCC

    def test_mutation_does_not_affect_original(self, only_scaf_cadnano_json):
        original = json.loads(only_scaf_cadnano_json)
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        plugin_recolor_stap(ctx)
        # parse_cadnano_json should not mutate the original input string
        original_after = json.loads(only_scaf_cadnano_json)
        for o_vs, a_vs in zip(original["vstrands"], original_after["vstrands"]):
            assert o_vs["stap_colors"] == a_vs["stap_colors"]


# ---------------------------------------------------------------------------
# Logging and artifacts
# ---------------------------------------------------------------------------

class TestLoggingAndArtifacts:
    def test_log_appends_messages(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        plugin_log_vhs(ctx)
        assert len(ctx.logs) == 1
        assert "VH count:" in ctx.logs[0]

    def test_set_result_stores_dict(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        plugin_log_vhs(ctx)
        assert ctx.plugin_result is not None
        assert "vh_count" in ctx.plugin_result
        assert ctx.plugin_result["vh_count"] == len(json.loads(only_scaf_cadnano_json)["vstrands"])

    def test_write_artifact_stores_string(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        ctx.write_artifact("report.txt", "VH summary\n")
        assert ctx.artifacts["report.txt"] == "VH summary\n"

    def test_write_artifact_stores_bytes(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        ctx.write_artifact("data.bin", b"\x00\x01\x02")
        assert ctx.artifacts["data.bin"] == b"\x00\x01\x02"

    def test_write_artifact_empty_name_raises(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        with pytest.raises(ValueError, match="non-empty string"):
            ctx.write_artifact("", "data")

    def test_write_artifact_invalid_type_raises(self, only_scaf_cadnano_json):
        ctx = PluginContext(format="cadnano_json", cadnano_json_in=only_scaf_cadnano_json)
        with pytest.raises(TypeError):
            ctx.write_artifact("f.txt", 123)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# parse_cadnano_json helper
# ---------------------------------------------------------------------------

class TestParseCadnanoJson:
    def test_returns_dict(self, only_scaf_cadnano_json):
        data = parse_cadnano_json(only_scaf_cadnano_json)
        assert isinstance(data, dict)

    def test_has_vstrands_key(self, only_scaf_cadnano_json):
        data = parse_cadnano_json(only_scaf_cadnano_json)
        assert "vstrands" in data

    def test_vstrands_have_required_keys(self, only_scaf_cadnano_json):
        data = parse_cadnano_json(only_scaf_cadnano_json)
        for vs in data["vstrands"]:
            for key in ("row", "col", "num", "scaf", "stap", "loop", "skip"):
                assert key in vs, f"Missing key {key!r} in vstrand"

    def test_scaf_quadruples_are_lists_of_4(self, only_scaf_cadnano_json):
        data = parse_cadnano_json(only_scaf_cadnano_json)
        for vs in data["vstrands"]:
            for nt in vs["scaf"]:
                assert len(nt) == 4
