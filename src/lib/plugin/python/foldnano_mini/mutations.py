"""
foldnano_mini.mutations — op vocabulary and mutation log.

Each op is a plain JSON-serialisable dict shaped like::

    {"op": "<kind>", ...payload}

Plain dicts (rather than dataclasses) are used as the wire format so the log
can be transported across the worker→main boundary without custom encoders.
The constants here are the canonical op-kind strings; the JS-side replayer
keys off the same names.

Newly-created entities (oligos, segments, virtual helices) get a Python-side
UUID stamped into the op as ``newOligoId`` / ``newSegmentId`` / ``newVhId``.
The replayer maintains an id-map from these placeholder IDs to the real
JS-assigned IDs so subsequent ops can reference the new entity unambiguously.
"""

from __future__ import annotations

from typing import Any


# --- Op kinds (stable wire identifiers) --------------------------------------

OP_SET_OLIGO_COLOR = "set_oligo_color"
OP_SET_OLIGO_NAME = "set_oligo_name"
OP_SET_OLIGO_IS_SCAFFOLD = "set_oligo_is_scaffold"
OP_SET_SEGMENT_MODIFICATION = "set_segment_modification"
OP_SET_SLOT_SEQUENCE = "set_slot_sequence"
OP_SET_SLOT_SKIP = "set_slot_skip"
OP_SET_SLOT_INSERTION = "set_slot_insertion"
OP_ADD_SKIP_OR_INSERTION = "add_skip_or_insertion"
OP_CREATE_SEGMENT = "create_segment"
OP_CONNECT = "connect"
OP_REMOVE_SEGMENT = "remove_segment"
OP_REMOVE_OLIGO = "remove_oligo"
OP_ADD_VH_AT_COORDS = "add_vh_at_coords"
OP_SET_VH_LOCAL_FRAME = "set_vh_local_frame"
OP_REMOVE_VHS = "remove_vhs"
OP_BREAK_OLIGO = "break_oligo"
OP_MOVE_TERMINUS = "move_terminus"
OP_SET_VH_LENGTH = "set_vh_length"
OP_SET_REGION_MAX_BASE = "set_region_max_base"
OP_MOVE_LATTICE_VH = "move_lattice_vh"
OP_ADD_FREEFORM_VH = "add_freeform_vh"
OP_REORDER_VH = "reorder_vh"
OP_TRANSFORM_PLANE = "transform_plane"
OP_ADD_REGION_AND_PLANE = "add_region_and_plane"
OP_SPLIT_REGION = "split_region"
OP_CREATE_REPEAT_GROUP = "create_repeat_group"
OP_ADD_REPEAT_INSTANCE = "add_repeat_instance"
OP_REMOVE_REPEAT_INSTANCE = "remove_repeat_instance"
OP_DETACH_REPEAT_GROUP = "detach_repeat_group"
OP_DELETE_REPEAT_GROUP = "delete_repeat_group"


KNOWN_OPS: frozenset[str] = frozenset(
    {
        OP_SET_OLIGO_COLOR,
        OP_SET_OLIGO_NAME,
        OP_SET_OLIGO_IS_SCAFFOLD,
        OP_SET_SEGMENT_MODIFICATION,
        OP_SET_SLOT_SEQUENCE,
        OP_SET_SLOT_SKIP,
        OP_SET_SLOT_INSERTION,
        OP_ADD_SKIP_OR_INSERTION,
        OP_CREATE_SEGMENT,
        OP_CONNECT,
        OP_REMOVE_SEGMENT,
        OP_REMOVE_OLIGO,
        OP_ADD_VH_AT_COORDS,
        OP_SET_VH_LOCAL_FRAME,
        OP_REMOVE_VHS,
        OP_BREAK_OLIGO,
        OP_MOVE_TERMINUS,
        OP_SET_VH_LENGTH,
        OP_SET_REGION_MAX_BASE,
        OP_MOVE_LATTICE_VH,
        OP_ADD_FREEFORM_VH,
        OP_REORDER_VH,
        OP_TRANSFORM_PLANE,
        OP_ADD_REGION_AND_PLANE,
        OP_SPLIT_REGION,
        OP_CREATE_REPEAT_GROUP,
        OP_ADD_REPEAT_INSTANCE,
        OP_REMOVE_REPEAT_INSTANCE,
        OP_DETACH_REPEAT_GROUP,
        OP_DELETE_REPEAT_GROUP,
    }
)


class MutationLog:
    """
    Append-only ordered log of ops.

    The log is the contract surface to the JS replayer: a list of JSON dicts.
    Plugin authors usually do not interact with the MutationLog directly —
    they call mutating methods on the proxies, and read ``part.mutation_log``
    when they're done.
    """

    def __init__(self) -> None:
        self._ops: list[dict[str, Any]] = []

    def append(self, op: dict[str, Any]) -> None:
        kind = op.get("op")
        if kind not in KNOWN_OPS:
            raise ValueError(f"MutationLog: unknown op kind {kind!r}")
        self._ops.append(op)

    def to_list(self) -> list[dict[str, Any]]:
        """Return a shallow copy of the op list — safe to JSON-encode."""
        return list(self._ops)

    def clear(self) -> None:
        self._ops.clear()

    def __len__(self) -> int:
        return len(self._ops)

    def __iter__(self):
        return iter(self._ops)

    def __getitem__(self, idx):
        return self._ops[idx]

    def __repr__(self) -> str:
        return f"MutationLog(len={len(self._ops)})"
