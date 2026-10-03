"""
Shared pytest fixtures for foldnano plugin tests.

Run these tests with:
    cd src/lib/plugin/python
    python -m pytest tests/ -v

or from the project root:
    python -m pytest src/lib/plugin/python/tests/ -v
"""

from __future__ import annotations

import json
import pathlib
import sys

import pytest

# Make the foldnano package importable from this tests directory.
_PYTHON_ROOT = pathlib.Path(__file__).parent.parent
if str(_PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(_PYTHON_ROOT))

# Project root (for locating test_files/).
_PROJECT_ROOT = pathlib.Path(__file__).parent.parent.parent.parent.parent.parent


@pytest.fixture()
def only_scaf_cadnano_json() -> str:
    """Return the 'only_scaf.json' cadnano fixture as a JSON string."""
    fixture_path = _PROJECT_ROOT / "test_files" / "only_scaf.json"
    return fixture_path.read_text(encoding="utf-8")


@pytest.fixture()
def minimal_part_foldnano_json() -> str:
    """Return the minimal foldnano_json fixture as a JSON string."""
    fixture_path = pathlib.Path(__file__).parent / "fixtures" / "minimal_part.foldnano.json"
    return fixture_path.read_text(encoding="utf-8")


@pytest.fixture()
def multi_region_part_foldnano_json() -> str:
    """Return the multi-region foldnano_json fixture (honeycomb + square + freeform)."""
    fixture_path = pathlib.Path(__file__).parent / "fixtures" / "multi_region_part.foldnano.json"
    return fixture_path.read_text(encoding="utf-8")
