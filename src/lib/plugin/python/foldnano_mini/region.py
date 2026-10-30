"""
foldnano_mini.region — mutable region proxies.

Lattice regions support ``add_vh_at(row, col)``; freeform regions don't (the
`supports_lattice_grid` flag mirrors the JS-side capability flag).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from foldnano._frame import reference_radial0

from . import invariants, mutations as M
from .checks import Check
from .topology import slot_kind

if TYPE_CHECKING:
    from .part import MutablePart
    from .vh import MutableVirtualHelix


class MutableRegion:
    __slots__ = ("_part", "_id")

    def __init__(self, part: "MutablePart", region_id: str) -> None:
        self._part = part
        self._id = region_id

    def _raw(self) -> dict[str, Any]:
        return self._part._raw_region(self._id)

    @property
    def id(self) -> str:
        return self._id

    @property
    def name(self) -> str:
        return self._raw().get("name", "")

    @property
    def kind(self) -> str:
        return self._raw()["kind"]

    @property
    def plane_id(self) -> str:
        return self._raw()["planeId"]

    @property
    def vh_order(self) -> list[str]:
        return list(self._raw().get("vhOrder", []))

    @property
    def step(self) -> int:
        return int(self._raw().get("step", 21))

    @property
    def default_max_base(self) -> int:
        return int(self._raw().get("defaultMaxBase", 42))

    @property
    def max_base(self) -> int:
        raw = self._raw()
        return int(raw.get("maxBase") or raw.get("defaultMaxBase", self.step * 2))

    @property
    def min_base(self) -> int:
        return int(self._raw().get("minBase", 0))

    def set_max_base(self, new_max_base: int) -> None:
        """Lengthen or shorten every VH in this region so the region ends at ``new_max_base``.

        The change must be a multiple of ``step``. Shortening is refused while any
        segment in the region reaches ``new_max_base`` or beyond.
        """
        self.can_set_max_base(new_max_base).raise_if_failed()
        self._part._apply(
            {
                "op": M.OP_SET_REGION_MAX_BASE,
                "regionId": self._id,
                "newMaxBase": int(new_max_base),
            }
        )

    def can_set_max_base(self, new_max_base: int) -> Check:
        if isinstance(new_max_base, bool) or not isinstance(new_max_base, int):
            raise TypeError(f"new_max_base must be int, got {type(new_max_base).__name__}")
        delta = new_max_base - self.max_base
        if delta == 0:
            return Check.failed(f"Region {self.name!r} already ends at {new_max_base}")
        if delta % self.step != 0:
            return Check.failed(f"The change ({delta}) must be a multiple of step ({self.step})")
        if new_max_base <= self.min_base:
            return Check.failed(f"max_base must stay above min_base ({self.min_base})")
        used = self._used_length()
        if new_max_base < used:
            return Check.failed(
                f"Cannot shorten region {self.name!r} to {new_max_base}: strands reach bp {used - 1}"
            )
        return Check.passed()

    def increase_length_by(self, delta: int) -> None:
        """Extend all VHs in this region by ``delta`` bases.

        ``delta`` must be a positive multiple of ``step``.
        """
        if not isinstance(delta, int) or delta <= 0:
            raise ValueError(f"increase_length_by: delta must be a positive int, got {delta!r}")
        self.set_max_base(self.max_base + delta)

    def reduce_unused_length(self) -> None:
        """Shorten the region to the strands it holds, rounded up to ``step`` and at least
        two steps, like the strand view's reduce-length button. Does nothing when already
        that short."""
        target = max(-(-self._used_length() // self.step) * self.step, 2 * self.step)
        if target != self.max_base:
            self.set_max_base(target)

    def _used_length(self) -> int:
        """One past the highest bp any segment in the region covers (0 when empty)."""
        topo = self._part._topology()
        used = 0
        for vh in self.virtual_helices:
            for ss in (0, 1):
                intervals = topo.intervals(vh.index, ss)
                if intervals:
                    used = max(used, max(high for _, high, _ in intervals) + 1)
        return used

    def remove_all_skips(self) -> int:
        """Turn every skip in this region back into a plain base; returns how many."""
        return self._remove_all("skip")

    def remove_all_insertions(self) -> int:
        """Turn every insertion in this region back into a plain base; returns how many."""
        return self._remove_all("insertion")

    def _remove_all(self, kind: str) -> int:
        topo = self._part._topology()
        targets: list[tuple[str, int]] = []
        seen: set[tuple[int, int]] = set()
        # A mirror's skips follow its original, so only originals and ordinary strands are cleared.
        mirror_oligos = {o["id"] for o in self._part._raw.get("oligos", []) if o.get("mirrorOf")}
        for vh in self.virtual_helices:
            for ss in (0, 1):
                for _, _, seg_id in topo.intervals(vh.index, ss):
                    if topo.segment(seg_id).oligo_id in mirror_oligos:
                        continue
                    for slot in topo.raw_segment(seg_id).get("slots", []):
                        bp = int(slot["bpIndex"])
                        # One op clears both strands, so visit each bp once.
                        comp_id = topo.segment_at(vh.index, 1 - ss, bp)
                        if comp_id is not None and topo.segment(comp_id).oligo_id in mirror_oligos:
                            continue
                        if (vh.index, bp) not in seen and slot_kind(topo.raw_segment(seg_id), bp) == kind:
                            seen.add((vh.index, bp))
                            targets.append((seg_id, bp))
        for seg_id, bp in targets:
            self._part._segment_proxy(seg_id).slot_at(bp).remove_skip_or_insertion()
        return len(targets)

    @property
    def supports_lattice_grid(self) -> bool:
        return self.kind in ("HONEYCOMB", "SQUARE")

    @property
    def virtual_helices(self) -> list["MutableVirtualHelix"]:
        return [vh for vh in self._part.virtual_helices if vh.region_id == self._id]

    def __repr__(self) -> str:
        return f"MutableRegion(id={self._id!r}, kind={self.kind})"


class LatticedRegion(MutableRegion):
    """HONEYCOMB / SQUARE region — supports adding VHs at lattice coordinates."""

    def add_vh_at(self, row: int, col: int, length: int | None = None) -> "MutableVirtualHelix":
        """Add a VH to the offline mirror.

        The returned proxy exposes the mirror's local ``index`` value. For
        newly added lattice VHs that index is not guaranteed to match the
        eventual host-side JS index after replay; ``vh.id`` is the only stable
        cross-runtime identifier.
        """
        from .vh import MutableVirtualHelix

        invariants.validate_lattice_coords(row, col)
        new_vh_id = self._part.allocate_vh_id()
        new_vh_index = self._part._next_vh_index()
        op: dict[str, Any] = {
            "op": M.OP_ADD_VH_AT_COORDS,
            "regionId": self._id,
            "row": int(row),
            "col": int(col),
            "newVhId": new_vh_id,
        }
        if length is not None:
            op["length"] = int(length)
        self._part._apply(op)
        return MutableVirtualHelix(self._part, new_vh_index)


class FreeformRegion(MutableRegion):
    """Freeform region — VHs placed by ``localFrame`` rather than lattice coords."""

    def add_vh_at(
        self,
        origin: tuple[float, float, float],
        direction: tuple[float, float, float] = (0.0, 0.0, 1.0),
        length: int | None = None,
    ) -> "MutableVirtualHelix":
        """Add a new VH to this freeform region at the given 3D position.

        ``origin`` and ``direction`` are ``(x, y, z)`` tuples in nanometres.
        ``length`` defaults to the region's ``max_base``.
        """
        from .vh import MutableVirtualHelix

        if len(origin) != 3 or len(direction) != 3:
            raise ValueError("origin and direction must be (x, y, z) 3-tuples")
        # Normalise direction
        dx, dy, dz = float(direction[0]), float(direction[1]), float(direction[2])
        mag = (dx**2 + dy**2 + dz**2) ** 0.5
        if mag < 1e-10:
            raise ValueError("direction vector must be non-zero")
        axis = (dx / mag, dy / mag, dz / mag)
        r0 = reference_radial0(axis)

        new_vh_id = self._part.allocate_vh_id()
        new_vh_index = self._part._next_vh_index()
        op: dict = {
            "op": M.OP_ADD_FREEFORM_VH,
            "regionId": self._id,
            "newVhId": new_vh_id,
            "origin": [float(origin[0]), float(origin[1]), float(origin[2])],
            "axis": list(axis),
            "radial0": list(r0),
        }
        if length is not None:
            op["length"] = int(length)
        self._part._apply(op)
        return MutableVirtualHelix(self._part, new_vh_index)

