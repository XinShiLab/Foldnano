"""
GC Colorizer Plugin
===================
Colors each staple strand by its GC content using a blue→red gradient:

  GC = 100%  →  blue   (#0044cc-ish)
  GC =  50%  →  neutral grey
  GC =   0%  →  red    (#cc3300-ish)

This is impossible with ``cadnano_json`` because that format carries no
sequence data.  This plugin demonstrates a ``foldnano_json`` round-trip
mutation: parse → mutate ``_raw`` → return via ``set_result_foldnano_json``.

Oligos with no sequence assigned are skipped (their color is unchanged).
Scaffold strands are always skipped.

applyStrategy is ``replacePartKeepAnnotationsWhereMatched`` so the host
re-grafts sequences and modifications from the pre-run snapshot; because
only ``color`` is changed the round-trip is lossless.

Requires: no external packages (pure Python + stdlib).
"""

from __future__ import annotations

import json

from foldnano.io import parse_foldnano_json
from foldnano.plugin import PluginContext


# ---------------------------------------------------------------------------
# Color utilities (same pattern as staple_colorizer)
# ---------------------------------------------------------------------------

def hsl_to_rgb(h: float, s: float, l: float) -> tuple[int, int, int]:
    """Convert HSL (all in [0, 1]) to RGB tuple with values in [0, 255]."""
    if s == 0.0:
        v = int(l * 255)
        return v, v, v

    def hue_to_rgb(p: float, q: float, t: float) -> float:
        if t < 0:
            t += 1
        if t > 1:
            t -= 1
        if t < 1 / 6:
            return p + (q - p) * 6 * t
        if t < 1 / 2:
            return q
        if t < 2 / 3:
            return p + (q - p) * (2 / 3 - t) * 6
        return p

    q = l * (1 + s) if l < 0.5 else l + s - l * s
    p = 2 * l - q
    r = hue_to_rgb(p, q, h + 1 / 3)
    g = hue_to_rgb(p, q, h)
    b = hue_to_rgb(p, q, h - 1 / 3)
    return int(r * 255), int(g * 255), int(b * 255)


def gc_to_color(gc: float) -> str:
    """
    Map GC fraction [0, 1] to a hex color string.

    The hue range 0° (red) → 220° (blue) is traversed linearly with gc.
    Saturation 72%, lightness 48% — matches the existing plugin palette style.
    """
    hue = gc * (220 / 360)   # 0.0 = red, ~0.611 = blue
    r, g, b = hsl_to_rgb(hue, 0.72, 0.48)
    return f"#{r:02x}{g:02x}{b:02x}"


# ---------------------------------------------------------------------------
# Plugin entry point
# ---------------------------------------------------------------------------

def run(ctx: PluginContext) -> None:
    ctx.log("=== GC Colorizer Plugin ===")

    # -----------------------------------------------------------------------
    # 1. Parse foldnano JSON
    # -----------------------------------------------------------------------
    try:
        raw_json = ctx.get_part_as_foldnano_json()
    except RuntimeError as exc:
        ctx.log(f"ERROR: could not read design — {exc}")
        return

    part = parse_foldnano_json(raw_json)

    # -----------------------------------------------------------------------
    # 2. Build a lookup from oligo id → index in _raw["oligos"]
    # -----------------------------------------------------------------------
    raw_oligos: list[dict] = part._raw.get("oligos", [])
    id_to_raw_index: dict[str, int] = {o["id"]: i for i, o in enumerate(raw_oligos)}

    # -----------------------------------------------------------------------
    # 3. Color staples by GC content
    # -----------------------------------------------------------------------
    colored = 0
    skipped_no_seq = 0
    skipped_scaffold = 0

    for oligo in part.oligos:
        if oligo.is_scaffold:
            skipped_scaffold += 1
            continue

        seq = oligo.sequence or ""
        # Strip placeholder N nucleotides — an all-N sequence means no real
        # sequence has been applied yet and should be treated as unsequenced.
        real_seq = seq.replace("N", "")
        if not real_seq:
            skipped_no_seq += 1
            continue

        gc = (real_seq.count("G") + real_seq.count("C")) / len(real_seq)
        color_hex = gc_to_color(gc)

        raw_idx = id_to_raw_index.get(oligo.id)
        if raw_idx is not None:
            raw_oligos[raw_idx]["color"] = color_hex
            colored += 1

    # -----------------------------------------------------------------------
    # 4. Return modified foldnano JSON
    # -----------------------------------------------------------------------
    ctx.log(f"Colored {colored} staple(s) by GC content.")
    if skipped_no_seq:
        ctx.log(f"Skipped {skipped_no_seq} staple(s) with no sequence assigned.")
    if skipped_scaffold:
        ctx.log(f"Skipped {skipped_scaffold} scaffold strand(s).")

    if colored == 0:
        ctx.log("Nothing to apply — run 'Apply Scaffold Sequence' first to assign sequences.")
        # Still return the unmodified JSON so the diff preview appears (empty diff)

    ctx.set_result_foldnano_json(json.dumps(part._raw))
    ctx.set_result({
        "colored": colored,
        "skipped_no_sequence": skipped_no_seq,
    })
