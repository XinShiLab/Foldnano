"""
foldnano_mini — mutable, ergonomic Python API for Foldnano plugins.

Mirrors the ``cadnano2_5_mini`` ergonomics: plugin authors operate
directly on a part object, and each mutation is recorded as a structured
op in ``part.mutation_log``. The host re-applies the log against the real
``Part`` model on the JS side under one undo step (the ``replayMutationLog``
apply strategy).

Example::

    from foldnano_mini import load_part

    def run(ctx):
        part = load_part(
            ctx.get_part_as_foldnano_json(),
            active_region_id=ctx.active_region_id,
        )
        for oligo in part.oligos_in_region(part.active_region_id):
            oligo.color = "#ff8800"
        ctx.set_result_mutation_log(part.mutation_log)
"""

from .checks import Check, InvalidOperationError
from .lattice import CrossoverSite
from .loader import load_part
from .mutations import KNOWN_OPS, MutationLog
from .oligo import (
    MirrorOligo,
    MutableOligo,
    MutableSegment,
    MutableSegmentEnd,
    MutableSlot,
    OligoView,
    SegmentEndView,
    SegmentView,
    SlotView,
)
from .part import MutablePart, SegmentSpec
from .plane import MutablePlane
from .region import FreeformRegion, LatticedRegion, MutableRegion
from .repeat import MIRROR_EDIT_ERROR
from .repeat_group import MirrorInfo, MutableRepeatGroup, RepeatInstance
from .transport import OfflineTransport, Transport
from .vh import MutableStrandSet, MutableVirtualHelix

__all__ = [
    "load_part",
    "MutablePart",
    "MutablePlane",
    "MutableRegion",
    "LatticedRegion",
    "FreeformRegion",
    "MutableVirtualHelix",
    "MutableStrandSet",
    "MutableOligo",
    "MutableSegment",
    "MutableSegmentEnd",
    "MutableSlot",
    "MirrorOligo",
    "OligoView",
    "SegmentView",
    "SegmentEndView",
    "SlotView",
    "MutableRepeatGroup",
    "RepeatInstance",
    "MirrorInfo",
    "MIRROR_EDIT_ERROR",
    "SegmentSpec",
    "CrossoverSite",
    "Check",
    "InvalidOperationError",
    "MutationLog",
    "KNOWN_OPS",
    "Transport",
    "OfflineTransport",
]
