"""
The three API reference pages on the doc site (Context, Parse, foldnano_mini) must match the code.

Each page lists its API in tables whose first column is ``API``. This test checks both ways:

- every public name in the code (module exports, class members, properties, dataclass fields and
  attributes set in ``__init__``) appears in some API cell, unless listed in ``ignore`` with why;
- every ``prefix.name`` in an API cell (``ctx.log``, ``seg.three_prime``) names a real member of
  that prefix's class, so renamed or removed APIs can't linger on the page.
"""

from __future__ import annotations

import ast
import dataclasses
import inspect
import pathlib
import re
import textwrap
from dataclasses import dataclass, field

import pytest

import foldnano
import foldnano.plugin
import foldnano_mini
from foldnano import (
    FreeformRegionProxy,
    LatticedRegionProxy,
    OligoProxy,
    OligoSegmentProxy,
    PartData,
    PlaneProxy,
    PluginContext,
    RegionProxy,
    VirtualHelixProxy,
)

PAGES_DIR = (
    pathlib.Path(__file__).resolve().parents[5] / "src" / "content" / "plugin-development"
)
IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
DOTTED = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)")


@dataclass
class PageSpec:
    slug: str
    module_names: list[str]
    prefixes: dict[str, list[type]]
    ignore: dict[str, str] = field(default_factory=dict)


def _ctor_attributes(cls: type) -> set[str]:
    """Names assigned as ``self.<name> = ...`` in a class's own ``__init__``."""
    init = cls.__dict__.get("__init__")
    if init is None:
        return set()
    try:
        source = inspect.getsource(init)
    except (OSError, TypeError):
        return set()  # dataclass-generated __init__: its fields are read separately
    tree = ast.parse(textwrap.dedent(source))
    names = set()
    for node in ast.walk(tree):
        targets = (
            node.targets
            if isinstance(node, ast.Assign)
            else [node.target]
            if isinstance(node, ast.AnnAssign)
            else []
        )
        for target in targets:
            if (
                isinstance(target, ast.Attribute)
                and isinstance(target.value, ast.Name)
                and target.value.id == "self"
            ):
                names.add(target.attr)
    return names


def members(cls: type, include_private: bool = False) -> set[str]:
    names: set[str] = set()
    for klass in cls.__mro__:
        if klass is object:
            continue
        names.update(klass.__dict__)
        names.update(_ctor_attributes(klass))
    if dataclasses.is_dataclass(cls):
        names.update(f.name for f in dataclasses.fields(cls))
    if include_private:
        return {n for n in names if not n.startswith("__")}
    return {n for n in names if not n.startswith("_")}


def api_cells(slug: str) -> list[str]:
    """First-column cells of the page's API tables, plus its headings (which name the class)."""
    page = next(
        (p for p in PAGES_DIR.glob("*.md") if re.search(rf"^slug: {slug}$", p.read_text(), re.M)),
        None,
    )
    assert page is not None, f"no doc page with slug {slug!r}"
    cells = []
    for line in page.read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            cells.append(line)
            continue
        if not line.startswith("| ") or line.startswith("| ---"):
            continue
        first = line.split(" | ")[0].removeprefix("| ").strip()
        if first != "API":
            cells.append(first)
    return cells


def backtick_spans(cells: list[str]) -> list[str]:
    return [span for cell in cells for span in re.findall(r"`([^`]+)`", cell)]


CONTEXT = PageSpec(
    slug="context-api",
    module_names=["PluginContext", "MAX_ARTIFACT_BYTES"],
    prefixes={"ctx": [PluginContext]},
)

PARSE = PageSpec(
    slug="plugin-api",
    module_names=[n for n in foldnano.__all__ if n != "PluginContext"],
    prefixes={
        "part": [PartData],
        "oligo": [OligoProxy],
        "seg": [OligoSegmentProxy],
        "vh": [VirtualHelixProxy],
        "region": [RegionProxy, LatticedRegionProxy, FreeformRegionProxy],
        "plane": [PlaneProxy],
    },
    ignore={"from_json": "classmethod the parser calls; plugins never build proxies"},
)

M = foldnano_mini
MINI = PageSpec(
    slug="foldnano-mini-api",
    module_names=list(M.__all__),
    prefixes={
        "part": [M.MutablePart],
        "MutablePart": [M.MutablePart],
        "oligo": [M.MutableOligo, M.OligoView],
        "mirror": [M.MirrorOligo],
        "seg": [M.MutableSegment, M.SegmentView],
        "end": [M.MutableSegmentEnd, M.SegmentEndView],
        "slot": [M.MutableSlot, M.SlotView],
        "vh": [M.MutableVirtualHelix],
        "ss": [M.MutableStrandSet],
        "region": [M.MutableRegion],
        "lattice_region": [M.LatticedRegion],
        "freeform_region": [M.FreeformRegion],
        "plane": [M.MutablePlane],
        "group": [M.MutableRepeatGroup],
    },
)

SPECS = [CONTEXT, PARSE, MINI]


@pytest.mark.parametrize("spec", SPECS, ids=lambda s: s.slug)
def test_every_public_name_is_documented(spec: PageSpec) -> None:
    documented = {w for span in backtick_spans(api_cells(spec.slug)) for w in IDENT.findall(span)}
    expected = set(spec.module_names)
    for classes in spec.prefixes.values():
        for cls in classes:
            expected |= members(cls)
    missing = sorted(expected - documented - set(spec.ignore))
    assert missing == [], f"{spec.slug}: public names missing from the API tables: {missing}"


@pytest.mark.parametrize("spec", SPECS, ids=lambda s: s.slug)
def test_every_documented_member_exists(spec: PageSpec) -> None:
    unknown = []
    for span in backtick_spans(api_cells(spec.slug)):
        match = DOTTED.match(span)
        if not match or match.group(1) not in spec.prefixes:
            continue
        prefix, name = match.groups()
        known = set().union(*(members(c, include_private=True) for c in spec.prefixes[prefix]))
        if name not in known:
            unknown.append(f"{prefix}.{name}")
    assert unknown == [], f"{spec.slug}: API cells name members that don't exist: {unknown}"


def test_ignore_lists_only_hold_real_names() -> None:
    for spec in SPECS:
        real = set(spec.module_names)
        for classes in spec.prefixes.values():
            for cls in classes:
                real |= members(cls)
        stale = sorted(set(spec.ignore) - real)
        assert stale == [], f"{spec.slug}: ignore entries no longer in the code: {stale}"
