"""
Staple Colorizer (mini)
=======================
foldnano_mini port of staple_colorizer. Operates on the active region;
recolors every non-scaffold oligo whose segments live entirely inside the
active region.

Result is delivered as a mutation log of `set_oligo_color` ops; the host
replays the log via `replayMutationLogInRegion`, producing one undo step.
"""

from __future__ import annotations

from foldnano.plugin import PluginContext
from foldnano_mini import load_part


def hsl_to_rgb(h: float, s: float, l: float) -> tuple[int, int, int]:
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


def hsl_hex(h: float, s: float, l: float) -> str:
    r, g, b = hsl_to_rgb(h, s, l)
    return f"#{r:02x}{g:02x}{b:02x}"


def palette_color(index: int, total: int, palette: str, hue_offset: float, s: float, l: float) -> str:
    if palette == "uniform":
        hue = hue_offset
    elif palette == "rainbow":
        hue = (hue_offset + index / max(total, 1)) % 1.0
    else:
        golden = 0.618033988749895
        hue = (hue_offset + index * golden) % 1.0
    return hsl_hex(hue, s, l)


def run(ctx: PluginContext) -> None:
    palette = ctx.get_param("palette", "golden_ratio")
    hue_deg = float(ctx.get_param("hue", 210))
    saturation_pct = float(ctx.get_param("saturation", 72))
    lightness_pct = float(ctx.get_param("lightness", 52))

    hue_offset = (hue_deg % 360) / 360.0
    s = max(0.0, min(1.0, saturation_pct / 100.0))
    l = max(0.0, min(1.0, lightness_pct / 100.0))

    ctx.log("=== Staple Colorizer (mini) ===")
    ctx.log(
        f"  palette={palette!r} hue={hue_deg}° saturation={saturation_pct}% "
        f"lightness={lightness_pct}%"
    )

    active_region_id = ctx.active_region_id
    if not active_region_id:
        ctx.log("ERROR: no active region. Click a region in the StrandView first.")
        return

    part = load_part(ctx.get_part_as_foldnano_json(), active_region_id=active_region_id)

    region = part.get_region(active_region_id)
    if region is None:
        ctx.log(f"ERROR: active region {active_region_id!r} not found in part.")
        return

    targets = [o for o in part.oligos_in_region(active_region_id) if not o.is_scaffold]
    ctx.log(f"Region {region.kind} '{region.name}' — {len(targets)} non-scaffold oligo(s).")

    for i, oligo in enumerate(targets):
        oligo.color = palette_color(i, len(targets), palette, hue_offset, s, l)

    ctx.set_result_mutation_log(part.mutation_log)
    ctx.set_result(
        {
            "region_id": active_region_id,
            "oligos_recolored": len(targets),
            "palette": palette,
            "ops_emitted": len(part.mutation_log),
        }
    )
    ctx.log(f"Done — emitted {len(part.mutation_log)} op(s).")
