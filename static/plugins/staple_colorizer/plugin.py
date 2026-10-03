"""
Staple Colorizer Plugin
=======================
Assigns an HSL color palette to all staple strands.

Parameters (all configurable via the Run dialog)
-------------------------------------------------
palette      select   "golden_ratio" | "rainbow" | "uniform"
             How hues are distributed across helices.
             golden_ratio (default) — each helix gets a maximally-distinct hue
             rainbow — hues evenly spaced 0°→360°
             uniform — every staple gets the same hue (use with hue_override)

hue          number   0–360, default 210  (used by "uniform"; also offsets the
             other palettes)

saturation   number   0–100, default 72   — HSL saturation %

lightness    number   0–100, default 52   — HSL lightness %

colorize_scaffold  boolean  default false
             When true, the scaffold color entry is also set.

Requires: no external packages (pure Python + stdlib).
"""

from __future__ import annotations

import json
import math

from foldnano.plugin import PluginContext


# ---------------------------------------------------------------------------
# Color utilities
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


def hsl_to_24bit(h: float, s: float, l: float) -> int:
    """Return a 24-bit integer (0xRRGGBB) for the given HSL color."""
    r, g, b = hsl_to_rgb(h, s, l)
    return (r << 16) | (g << 8) | b


def palette_color(index: int, total: int, palette: str, hue_offset: float, s: float, l: float) -> int:
    """Return a 24-bit color for *index* out of *total* helices."""
    if palette == "uniform":
        hue = hue_offset
    elif palette == "rainbow":
        hue = (hue_offset + index / max(total, 1)) % 1.0
    else:  # golden_ratio (default)
        golden_ratio = 0.618033988749895
        hue = (hue_offset + index * golden_ratio) % 1.0
    return hsl_to_24bit(hue, s, l)


# ---------------------------------------------------------------------------
# Staple 5' end detection
# ---------------------------------------------------------------------------

def find_staple_five_prime_indices(stap: list[list[int]]) -> list[int]:
    """Return bp indices of all staple 5' ends in a vstrand."""
    five_primes = []
    for i, nt in enumerate(stap):
        if nt[2] == -1:
            continue
        if nt[0] == -1:
            five_primes.append(i)
    return five_primes


# ---------------------------------------------------------------------------
# Plugin entry point
# ---------------------------------------------------------------------------

def run(ctx: PluginContext) -> None:
    # -----------------------------------------------------------------------
    # 1. Read parameters
    # -----------------------------------------------------------------------
    palette           = ctx.get_param("palette", "golden_ratio")
    hue_deg           = float(ctx.get_param("hue", 210))
    saturation_pct    = float(ctx.get_param("saturation", 72))
    lightness_pct     = float(ctx.get_param("lightness", 52))
    colorize_scaffold = bool(ctx.get_param("colorize_scaffold", False))

    # Normalise to [0, 1]
    hue_offset = (hue_deg % 360) / 360.0
    s = max(0.0, min(1.0, saturation_pct / 100.0))
    l = max(0.0, min(1.0, lightness_pct / 100.0))

    ctx.log("=== Staple Colorizer Plugin ===")
    ctx.log(f"  palette={palette!r}  hue={hue_deg}°  saturation={saturation_pct}%  lightness={lightness_pct}%  colorize_scaffold={colorize_scaffold}")

    # -----------------------------------------------------------------------
    # 2. Load the current design
    # -----------------------------------------------------------------------
    try:
        raw_json = ctx.get_part_as_cadnano_json()
    except RuntimeError as exc:
        ctx.log(f"ERROR: could not read design — {exc}")
        return

    data = json.loads(raw_json)
    vstrands = data.get("vstrands", [])
    if not vstrands:
        ctx.log("No virtual helices found — nothing to colorize.")
        return

    ctx.log(f"Design: '{data.get('name', '<unnamed>')}', {len(vstrands)} virtual helices")

    # -----------------------------------------------------------------------
    # 3. Assign palette colors to staples
    # -----------------------------------------------------------------------
    total_helices = len(vstrands)
    total_staples_colored = 0

    for vh_idx, vs in enumerate(vstrands):
        stap = vs.get("stap", [])
        five_primes = find_staple_five_prime_indices(stap)

        new_stap_colors: list[list[int]] = []
        for bp_idx in five_primes:
            color_int = palette_color(vh_idx, total_helices, palette, hue_offset, s, l)
            new_stap_colors.append([bp_idx, color_int])
            total_staples_colored += 1

        vs["stap_colors"] = new_stap_colors

        # Optionally colorize scaffold
        if colorize_scaffold:
            scaf = vs.get("scaf", [])
            scaf_five_primes = []
            for i, nt in enumerate(scaf):
                if nt[2] != -1 and nt[0] == -1:
                    scaf_five_primes.append(i)
            if scaf_five_primes:
                scaffold_color = hsl_to_24bit(hue_offset, s * 0.5, l * 0.8)
                vs["scaf_colors"] = [[bp_idx, scaffold_color] for bp_idx in scaf_five_primes]

    ctx.log(f"Assigned palette to {total_staples_colored} staple 5' end(s) across {total_helices} helix/helices.")

    # -----------------------------------------------------------------------
    # 4. Return modified design
    # -----------------------------------------------------------------------
    ctx.set_result_cadnano_json(json.dumps(data))
    ctx.set_result({
        "helices": total_helices,
        "staple_ends_colored": total_staples_colored,
        "palette": palette,
    })
    ctx.log("Done — sequences and modifications will be preserved by the host.")
