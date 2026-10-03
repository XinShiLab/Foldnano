"""
foldnano_mini.invariants — local validation helpers.

These run *before* an op is recorded into the mutation log. They catch the
common authoring mistakes (bad hex color, out-of-range index, missing region)
with a clear Python exception, no JS round-trip needed.

Invariants here are intentionally a subset of what the JS-side ``Part``
methods enforce. They are *not* a substitute for JS-side validation; their
job is to fail fast in tests and at the keyboard.
"""

from __future__ import annotations

import re

_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def validate_hex_color(value: str) -> None:
    if not isinstance(value, str) or not _HEX_COLOR_RE.match(value):
        raise ValueError(
            f"Expected a 6-digit hex color string like '#aabbcc', got {value!r}"
        )


def validate_index_in_range(idx: int, lo: int, hi: int, name: str = "index") -> None:
    """Inclusive lower bound, exclusive upper bound."""
    if not isinstance(idx, int):
        raise TypeError(f"{name} must be int, got {type(idx).__name__}")
    if idx < lo or idx >= hi:
        raise ValueError(f"{name}={idx} out of range [{lo}, {hi})")


def validate_strand_set_index(ss_idx: int) -> None:
    if ss_idx not in (0, 1):
        raise ValueError(f"strandSetIndex must be 0 or 1, got {ss_idx!r}")


def validate_modification_end(end: str) -> None:
    if end not in ("5", "3"):
        raise ValueError(f"modification end must be '5' or '3', got {end!r}")


def validate_segment_endpoints(five: int, three: int) -> None:
    if not isinstance(five, int) or not isinstance(three, int):
        raise TypeError("five and three must be ints")
    if five == three:
        raise ValueError(
            f"Segment endpoints must differ (got five={five}, three={three})"
        )


def validate_lattice_coords(row: int, col: int) -> None:
    if not isinstance(row, int) or not isinstance(col, int):
        raise TypeError("lattice row/col must be ints")


def validate_lattice_parity(
    from_row: int, from_col: int, to_row: int, to_col: int
) -> None:
    """Ensure moving a VH preserves lattice parity.

    Moving by (delta_row, delta_col) is valid only when
    (delta_row + delta_col) is even — the same constraint enforced by
    ``previewLatticeMove`` on the JS side.
    """
    if (to_row - from_row + to_col - from_col) % 2 != 0:
        raise ValueError(
            f"move_to({to_col}, {to_row}) breaks lattice parity from ({from_col}, {from_row}): "
            f"(Δrow + Δcol) must be even"
        )
