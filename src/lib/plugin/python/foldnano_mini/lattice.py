"""
foldnano_mini.lattice — potential crossover sites, ported from the host.

Pure functions over the mirror dict. A line-for-line port of
``src/lib/model/Part/latticeOffsets.ts`` (``getOffsets_honeycomb`` /
``getOffsets_square`` / ``toCoord``) and
``LatticedDesignRegion.calcPotentialXoverSites``; the parity tests in
``tests/test_foldnano_mini_parity.py`` compare the two against a golden file
written by the host.
"""

from __future__ import annotations

from typing import Any, NamedTuple

LATTICE_KINDS = ("HONEYCOMB", "SQUARE")


class CrossoverSite(NamedTuple):
    """One potential crossover site, as the host's ``CrossoverSite``."""

    bp_index: int
    to_vh_index: int
    right: bool


# (offset, d_col, d_row) per (is_even_parity, strand_index); same order as the host tables.
_HONEYCOMB: dict[tuple[bool, int], tuple[tuple[int, int, int], ...]] = {
    (True, 0): ((1, 1, 0), (11, 1, 0), (4, -1, 0), (15, -1, 0), (8, 0, -1), (18, 0, -1)),
    (True, 1): ((-1, -1, 0), (6, 1, 0), (13, 0, -1)),
    (False, 0): ((-1, 1, 0), (6, -1, 0), (13, 0, 1)),
    (False, 1): ((1, -1, 0), (11, -1, 0), (4, 1, 0), (15, 1, 0), (8, 0, 1), (18, 0, 1)),
}

_SQUARE: dict[tuple[bool, int], tuple[tuple[int, int, int], ...]] = {
    (True, 0): (
        (4, 1, 0), (26, 1, 0), (15, 1, 0), (18, 0, 1), (28, 0, 1), (7, 0, 1),
        (10, -1, 0), (20, -1, 0), (-1, -1, 0), (2, 0, -1), (12, 0, -1), (23, 0, -1),
    ),
    (True, 1): ((-1, 1, 0), (23, 0, 1), (15, -1, 0), (7, 0, -1)),
    (False, 0): ((-1, -1, 0), (23, 0, -1), (15, 1, 0), (7, 0, 1)),
    (False, 1): (
        (4, -1, 0), (26, -1, 0), (15, -1, 0), (18, 0, -1), (28, 0, -1), (7, 0, -1),
        (10, 1, 0), (20, 1, 0), (-1, 1, 0), (2, 0, 1), (12, 0, 1), (23, 0, 1),
    ),
}


def is_even_parity(row: int, col: int) -> bool:
    # Lattice coords are non-negative (docs/dna-model.md § Parity), so Python's
    # `%` agrees with the host's JS `%` here.
    return row % 2 == col % 2


def to_coord(
    kind: str,
    step: int,
    even: bool,
    strand_index: int,
    col: int,
    row: int,
    bp_index: int,
    right: bool = False,
) -> tuple[int, int] | None:
    """Lattice ``(col, row)`` the site at ``bp_index`` points to, or ``None``.

    First matching offset wins, as in the host's ``toCoord``.
    """
    table = _SQUARE if kind == "SQUARE" else _HONEYCOMB
    for offset, d_col, d_row in table[(even, strand_index)]:
        effective = offset + 1 if right else offset
        # Only a zero remainder matters, so JS and Python `%` agree for negatives.
        if (bp_index - effective) % step == 0:
            return (col + d_col, row + d_row)
    return None


def region_for_vh(raw: dict[str, Any], vh: dict[str, Any]) -> dict[str, Any] | None:
    region_id = vh.get("regionId")
    for region in raw.get("regions", []):
        if region["id"] == region_id:
            return region
    return None


def region_kind_and_step(raw: dict[str, Any], vh: dict[str, Any]) -> tuple[str, int]:
    region = region_for_vh(raw, vh)
    if region is not None:
        kind = region.get("kind", "")
        default_step = 32 if kind == "SQUARE" else 21
        return kind, int(region.get("step") or default_step)
    # Pre-regions documents carry the lattice kind at the top level.
    kind = raw.get("latticeType", "")
    return kind, 32 if kind == "SQUARE" else 21


def vh_index_by_coords(raw: dict[str, Any], region_id: str | None) -> dict[tuple[int, int], int]:
    """``(col, row) -> vh index`` for the lattice VHs of one region."""
    out: dict[tuple[int, int], int] = {}
    for vh in raw.get("virtualHelices", []):
        coords = vh.get("latticeCoords")
        if coords is None or vh.get("regionId") != region_id:
            continue
        out.setdefault((int(coords["col"]), int(coords["row"])), int(vh["index"]))
    return out


def potential_xover_sites(
    raw: dict[str, Any],
    vh: dict[str, Any],
    coords_lookup: dict[tuple[int, int], int] | None = None,
) -> list[list[CrossoverSite]]:
    """Both strand sets' potential crossover sites for one VH, as the host computes them."""
    coords = vh.get("latticeCoords")
    kind, step = region_kind_and_step(raw, vh)
    if coords is None or kind not in LATTICE_KINDS:
        return [[], []]
    if coords_lookup is None:
        coords_lookup = vh_index_by_coords(raw, vh.get("regionId"))
    col, row = int(coords["col"]), int(coords["row"])
    even = is_even_parity(row, col)
    length = int(vh["length"])
    out: list[list[CrossoverSite]] = []
    for strand_index in (0, 1):
        sites: list[CrossoverSite] = []
        for bp in range(length):
            for right in (False, True):
                target = to_coord(kind, step, even, strand_index, col, row, bp, right)
                if target is None:
                    continue
                to_vh = coords_lookup.get(target)
                if to_vh is not None:
                    sites.append(CrossoverSite(bp, to_vh, right))
        out.append(sites)
    return out


def site_at(
    raw: dict[str, Any], vh: dict[str, Any], strand_index: int, bp_index: int, to_vh_index: int
) -> CrossoverSite | None:
    """The site at one bp pointing at ``to_vh_index``, without building the full list."""
    coords = vh.get("latticeCoords")
    kind, step = region_kind_and_step(raw, vh)
    if coords is None or kind not in LATTICE_KINDS:
        return None
    if not 0 <= bp_index < int(vh["length"]):
        return None
    col, row = int(coords["col"]), int(coords["row"])
    even = is_even_parity(row, col)
    lookup = vh_index_by_coords(raw, vh.get("regionId"))
    for right in (False, True):
        target = to_coord(kind, step, even, strand_index, col, row, bp_index, right)
        if target is not None and lookup.get(target) == to_vh_index:
            return CrossoverSite(bp_index, to_vh_index, right)
    return None
