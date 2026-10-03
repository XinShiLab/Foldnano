"""
foldnano_mini.loader — entry point for plugin authors.

``load_part(json_str, active_region_id=...)`` parses a foldnano_json string
into a :class:`MutablePart` wired to an :class:`OfflineTransport`. Plugin
authors then mutate the part directly and read ``part.mutation_log`` when
they're done.

Phase 6 (Live mode, not in this PR) will add a parallel ``load_part_live()``
that injects a ``LiveTransport`` instead.
"""

from __future__ import annotations

import json

from .part import MutablePart
from .transport import OfflineTransport


def load_part(json_str: str, active_region_id: str | None = None) -> MutablePart:
    """Parse a foldnano_json string and return a mutable view onto it.

    Parameters
    ----------
    json_str:
        Serialised ``Part.toJSON()`` output.
    active_region_id:
        Optional UUID of the region the host considered "active" when the
        plugin was launched. Region-scoped plugins should respect this.
    """
    raw = json.loads(json_str)
    transport = OfflineTransport(raw)
    return MutablePart(transport, active_region_id=active_region_id)
