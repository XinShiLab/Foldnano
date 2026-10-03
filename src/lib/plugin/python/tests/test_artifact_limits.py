"""write_artifact refuses output that would exceed the per-run artifact limit."""

from __future__ import annotations

import pytest

import foldnano.plugin as plugin_module
from foldnano.plugin import PluginContext, artifact_size


def test_artifact_size_counts_utf8_bytes():
    assert artifact_size(b"abc") == 3
    assert artifact_size("é") == 2


def test_write_artifact_rejects_output_over_the_limit(monkeypatch):
    monkeypatch.setattr(plugin_module, "MAX_ARTIFACT_BYTES", 10)
    ctx = PluginContext(format="foldnano_json", foldnano_json_in="{}")
    ctx.write_artifact("a.txt", "12345")
    with pytest.raises(ValueError, match="over the"):
        ctx.write_artifact("b.txt", "123456")
    assert "b.txt" not in ctx.artifacts


def test_rewriting_an_artifact_counts_only_its_new_size(monkeypatch):
    monkeypatch.setattr(plugin_module, "MAX_ARTIFACT_BYTES", 10)
    ctx = PluginContext(format="foldnano_json", foldnano_json_in="{}")
    ctx.write_artifact("a.txt", "1234567890")
    ctx.write_artifact("a.txt", "0987654321")
    assert ctx.artifacts["a.txt"] == "0987654321"
