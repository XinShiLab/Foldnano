"""
foldnano — Python API for Foldnano plugins.

Plugin authors receive a PluginContext as the ``ctx`` argument to their
``run(ctx)`` function. The context provides format-specific I/O methods,
logging, and artifact storage.

Example (cadnano_json mode)::

    def run(ctx):
        import json
        data = json.loads(ctx.get_part_as_cadnano_json())
        # ... modify data ...
        ctx.set_result_cadnano_json(json.dumps(data))

Example (foldnano_json mode)::

    def run(ctx):
        from foldnano.io import parse_foldnano_json
        part = parse_foldnano_json(
            ctx.get_part_as_foldnano_json(),
            active_region_id=ctx.active_region_id,
        )
        for oligo in part.oligos_in_region(part.active_region_id):
            ctx.log(f"{oligo.id}: {oligo.color}")
        # ... modify part._raw and return ...
        import json
        ctx.set_result_foldnano_json(json.dumps(part._raw))
"""
from .plugin import PluginContext
from .io import PartData, parse_cadnano_json, parse_foldnano_json
from .vh import VirtualHelixProxy
from .oligo import OligoProxy, OligoSegmentProxy
from .region import RegionProxy, LatticedRegionProxy, FreeformRegionProxy
from .plane import PlaneProxy

__all__ = [
    "PluginContext",
    "PartData",
    "parse_cadnano_json",
    "parse_foldnano_json",
    "VirtualHelixProxy",
    "OligoProxy",
    "OligoSegmentProxy",
    "RegionProxy",
    "LatticedRegionProxy",
    "FreeformRegionProxy",
    "PlaneProxy",
]
