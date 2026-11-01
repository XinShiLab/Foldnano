"""Deprecated plugin API names keep working, warn, and the warning reaches the plugin log."""

from __future__ import annotations

import json
import subprocess
import sys
import warnings
from pathlib import Path

import pytest

from foldnano.edit import load_part
from foldnano.io import parse_foldnano_json

PYTHON_ROOT = Path(__file__).resolve().parents[1]


def region(kind: str, max_base: int) -> dict:
    return {
        "id": kind,
        "name": kind,
        "kind": kind,
        "planeId": "plane",
        "vhOrder": [],
        "step": 21,
        "turnsPerStep": 2,
        "subStepSize": 7,
        "twistOffset": 0,
        "minBase": 0,
        "maxBase": max_base,
    }


DOC = json.dumps(
    {
        "name": "mixed",
        "id": "part",
        "planes": [],
        "regions": [region("SQUARE", 64), region("WIREFRAME", 210)],
        "virtualHelices": [],
        "oligos": [],
    }
)


@pytest.mark.parametrize("load", [load_part, parse_foldnano_json])
def test_part_level_names_warn_and_read_the_first_region(load) -> None:
    part = load(DOC)

    with pytest.warns(FutureWarning, match=r"region\.kind"):
        assert part.lattice_type == "SQUARE"
    with pytest.warns(FutureWarning, match=r"region\.max_base"):
        assert part.max_base == 64


@pytest.mark.parametrize("load", [load_part, parse_foldnano_json])
def test_the_replacements_describe_each_region_without_warning(load) -> None:
    part = load(DOC)

    with warnings.catch_warnings():
        warnings.simplefilter("error")
        assert [(r.kind, r.max_base) for r in part.regions] == [("SQUARE", 64), ("WIREFRAME", 210)]
        repr(part)


def run_like_the_worker(plugin_code: str, runs: int = 1) -> list[str]:
    """Plugin output under Python's default warning filters, which pytest would replace."""
    script = f"""
import json, sys, types
from foldnano._log_capture import LogCapture
capture = LogCapture()
sys.stderr = capture
code = compile({plugin_code!r}, '<plugin>', 'exec')
for _ in range({runs}):
    module = types.ModuleType('_plugin')
    exec(code, module.__dict__)
print(json.dumps(capture.get_lines()))
"""
    done = subprocess.run(
        [sys.executable, "-c", script],
        cwd=PYTHON_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(done.stdout)


def warnings_in(lines: list[str]) -> list[str]:
    return [line for line in lines if "FutureWarning" in line]


def test_a_read_in_a_loop_logs_once_per_run_with_the_plugin_line() -> None:
    code = f"""from foldnano.edit import load_part
part = load_part({DOC!r})
for _ in range(3):
    part.lattice_type
"""
    logged = warnings_in(run_like_the_worker(code, runs=2))

    assert len(logged) == 2
    assert logged[0].startswith("<plugin>:4: FutureWarning: part.lattice_type")


def test_importing_foldnano_mini_logs_a_warning_at_the_plugin_import() -> None:
    logged = warnings_in(run_like_the_worker("import foldnano_mini\n"))

    assert len(logged) == 1
    assert logged[0].startswith("<plugin>:1: FutureWarning: foldnano_mini")
