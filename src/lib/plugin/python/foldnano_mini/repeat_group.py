"""
foldnano_mini.repeat_group — repeat-group proxies.

A repeat group is a set of original oligos copied, as read-only mirror oligos, at each
of its instances' bp offsets along the same VHs (the editor's "Duplicate as linked mirror
copies"). Python rebuilds the mirrors after every edit to an original, as the host does,
so ``part.oligos`` and the occupancy queries always include them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, NamedTuple

from . import mutations as M
from . import repeat
from .checks import Check

if TYPE_CHECKING:
    from .oligo import MirrorOligo, MutableOligo
    from .part import MutablePart


class RepeatInstance(NamedTuple):
    """One copy of a repeat group: its id and its bp offset from the originals."""

    id: str
    bp_offset: int


class MirrorInfo(NamedTuple):
    """What a mirror oligo copies: ``oligo.mirror_of``."""

    group: "MutableRepeatGroup"
    instance: RepeatInstance
    source: "MutableOligo"


class MutableRepeatGroup:
    """A repeat group (the host's ``RepeatGroup``): originals plus one copy per instance."""

    __slots__ = ("_part", "_id")

    def __init__(self, part: "MutablePart", group_id: str) -> None:
        self._part = part
        self._id = group_id

    def _raw(self) -> dict[str, Any]:
        group = repeat.find_group(self._part._raw, self._id)
        if group is None:
            raise KeyError(f"No repeat group with id {self._id!r}")
        return group

    @property
    def id(self) -> str:
        return self._id

    @property
    def name(self) -> str:
        return self._raw()["name"]

    @property
    def instances(self) -> list[RepeatInstance]:
        """The copies, in the order the host places them."""
        return [RepeatInstance(i["id"], int(i["bpOffset"])) for i in self._raw().get("instances", [])]

    def get_instance(self, instance_id: str) -> RepeatInstance | None:
        return next((i for i in self.instances if i.id == instance_id), None)

    @property
    def originals(self) -> list["MutableOligo"]:
        """The oligos being repeated (``oligo.repeat_group is self``)."""
        from .oligo import MutableOligo

        return [
            MutableOligo(self._part, o["id"])
            for o in self._part._raw.get("oligos", [])
            if o.get("repeatGroupId") == self._id and not o.get("mirrorOf")
        ]

    @property
    def mirrors(self) -> list["MirrorOligo"]:
        """Every mirror oligo of this group, across all instances."""
        from .oligo import MirrorOligo

        return [
            MirrorOligo(self._part, o["id"])
            for o in self._part._raw.get("oligos", [])
            if (o.get("mirrorOf") or {}).get("groupId") == self._id
        ]

    def mirrors_of(self, instance: RepeatInstance | str) -> list["MirrorOligo"]:
        """The mirror oligos of one instance (one per original)."""
        instance_id = instance.id if isinstance(instance, RepeatInstance) else str(instance)
        return [m for m in self.mirrors if m._raw()["mirrorOf"]["instanceId"] == instance_id]

    def add_instance(self, bp_offset: int) -> RepeatInstance:
        """Add a copy ``bp_offset`` bp along the originals' VHs (the panel's **Add copy**).

        Its mirror oligos are built immediately; a region the copy runs past grows.
        Raises ``InvalidOperationError`` when :meth:`can_add_instance` refuses it.
        """
        op = self._add_instance_op(bp_offset)
        self._part._apply(op)
        return RepeatInstance(op["instanceId"], int(bp_offset))

    def can_add_instance(self, bp_offset: int) -> Check:
        """Whether :meth:`add_instance` accepts this offset: not 0 or an offset the group
        already has, and every copy placeable (no overlap, crossovers on matching lattice
        sites, skips/insertions paired)."""
        return self._part._predict(self._add_instance_op(bp_offset))

    def _add_instance_op(self, bp_offset: int) -> dict[str, Any]:
        if isinstance(bp_offset, bool) or not isinstance(bp_offset, int):
            raise TypeError(f"bp_offset must be int, got {type(bp_offset).__name__}")
        return {
            "op": M.OP_ADD_REPEAT_INSTANCE,
            "groupId": self._id,
            "instanceId": self._part._allocate_instance_id(),
            "bpOffset": int(bp_offset),
        }

    def remove_instance(self, instance: RepeatInstance | str) -> None:
        """Remove one copy and its mirror oligos (the ✕ on a copy's chip). Removing the
        last copy deletes the group; its originals become ordinary oligos."""
        instance_id = instance.id if isinstance(instance, RepeatInstance) else str(instance)
        self._part._apply(
            {"op": M.OP_REMOVE_REPEAT_INSTANCE, "groupId": self._id, "instanceId": instance_id}
        )

    def detach(self) -> None:
        """Dissolve the group, keeping the mirrors as independent, editable oligos."""
        self._part._apply({"op": M.OP_DETACH_REPEAT_GROUP, "groupId": self._id})

    def delete(self) -> None:
        """Remove the group and its mirror oligos; the originals stay as ordinary oligos."""
        self._part._apply({"op": M.OP_DELETE_REPEAT_GROUP, "groupId": self._id})

    def __eq__(self, other: object) -> bool:
        return isinstance(other, MutableRepeatGroup) and other._id == self._id

    def __hash__(self) -> int:
        return hash(self._id)

    def __repr__(self) -> str:
        return f"MutableRepeatGroup(id={self._id!r}, name={self.name!r}, instances={len(self.instances)})"
