"""
foldnano_mini.part — MutablePart, the top-level mutable façade.

Holds a Transport (offline mirror by default) and exposes typed proxy
collections (regions, vhs, oligos). Reads pass through to the mirror dict;
writes are emitted via ``_apply()`` which validates locally then routes to
the transport for mirror update + log append.
"""

from __future__ import annotations

import copy
import json
import uuid
from typing import Any, Callable, NamedTuple, Sequence, Union

from . import invariants, lattice, mutations as M
from . import editing, repeat
from .checks import Check, InvalidOperationError
from .editing import Scratch
from .lattice import CrossoverSite
from .mutations import MutationLog
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
from .plane import MutablePlane
from .region import FreeformRegion, LatticedRegion, MutableRegion
from .repeat import MIRROR_EDIT_ERROR
from .repeat_group import MirrorInfo, MutableRepeatGroup, RepeatInstance
from .topology import TopologyIndex, slot_length, strand_index_from_direction, with_article
from .transport import _HANDLERS, OfflineTransport, Transport
from .vh import MutableVirtualHelix


class SegmentSpec(NamedTuple):
    """One segment of a :meth:`MutablePart.create_oligo` path: a VH and its 5′/3′ bp.

    A plain ``(vh, five, three)`` tuple works the same; this just names the fields.
    ``vh`` is a :class:`MutableVirtualHelix` or a VH index.
    """

    vh: Union[MutableVirtualHelix, int]
    five: int
    three: int


class _PlannedSegment(NamedTuple):
    vh: dict[str, Any]
    five: int
    three: int

    @property
    def strand_index(self) -> int:
        return strand_index_from_direction(self.five, self.three)


class MutablePart:
    """Top-level mutable view onto a foldnano_json part.

    Constructed by :func:`foldnano_mini.load_part`. Plugin authors interact
    with the ``regions`` / ``virtual_helices`` / ``oligos`` collections and
    the ``create_segment`` / ``connect`` mutation methods, then read
    ``part.mutation_log`` to hand the log back to the host.
    """

    def __init__(
        self,
        transport: Transport,
        active_region_id: str | None = None,
    ) -> None:
        self._transport = transport
        self._active_region_id = active_region_id
        # Bumped by every op; derived caches rebuild when it has moved.
        self._generation = 0
        self._topology_cache: TopologyIndex | None = None
        self._topology_generation = -1

    # ------------------------------------------------------------------
    # Internal mirror access
    # ------------------------------------------------------------------

    @property
    def _raw(self) -> dict[str, Any]:
        return self._transport.read_part()

    def _raw_oligo(self, oligo_id: str) -> dict[str, Any]:
        for o in self._raw.get("oligos", []):
            if o["id"] == oligo_id:
                return o
        raise KeyError(f"No oligo with id {oligo_id!r}")

    def _raw_segment(self, oligo_id: str, segment_id: str) -> dict[str, Any]:
        # Try the cached oligo first, then fall back to a part-wide search
        # (a connect() can move a segment from one oligo to another via merge).
        try:
            oligo = self._raw_oligo(oligo_id)
            for s in oligo.get("segments", []):
                if s["id"] == segment_id:
                    return s
        except KeyError:
            pass
        for o in self._raw.get("oligos", []):
            for s in o.get("segments", []):
                if s["id"] == segment_id:
                    return s
        raise KeyError(f"No segment with id {segment_id!r}")

    def _resolve_oligo_id_for_segment(self, segment_id: str) -> str | None:
        for o in self._raw.get("oligos", []):
            for s in o.get("segments", []):
                if s["id"] == segment_id:
                    return o["id"]
        return None

    def _raw_vh(self, vh_index: int) -> dict[str, Any]:
        for vh in self._raw.get("virtualHelices", []):
            if vh["index"] == vh_index:
                return vh
        raise KeyError(f"No virtualHelix with index {vh_index!r}")

    def _raw_region(self, region_id: str) -> dict[str, Any]:
        for r in self._raw.get("regions", []):
            if r["id"] == region_id:
                return r
        raise KeyError(f"No region with id {region_id!r}")

    def _next_vh_index(self) -> int:
        used = [vh["index"] for vh in self._raw.get("virtualHelices", [])]
        return (max(used) + 1) if used else 0

    def _vh_id_exists(self, vh_id: str) -> bool:
        return any(vh.get("id") == vh_id for vh in self._raw.get("virtualHelices", []))

    def _oligo_id_exists(self, oligo_id: str) -> bool:
        return any(o["id"] == oligo_id for o in self._raw.get("oligos", []))

    def _segment_id_exists(self, segment_id: str) -> bool:
        for oligo in self._raw.get("oligos", []):
            for segment in oligo.get("segments", []):
                if segment["id"] == segment_id:
                    return True
        return False

    def _allocate_unique_id(self, prefix: str, exists: Callable[[str], bool]) -> str:
        while True:
            candidate = f"{prefix}{uuid.uuid4()}"
            if not exists(candidate):
                return candidate

    def allocate_vh_id(self) -> str:
        return self._allocate_unique_id("py-vh-", self._vh_id_exists)

    def allocate_oligo_id(self) -> str:
        return self._allocate_unique_id("py-oligo-", self._oligo_id_exists)

    def allocate_segment_id(self) -> str:
        return self._allocate_unique_id("py-seg-", self._segment_id_exists)

    def _allocate_group_id(self) -> str:
        return self._allocate_unique_id(
            "py-repeat-", lambda gid: repeat.find_group(self._raw, gid) is not None
        )

    def _allocate_instance_id(self) -> str:
        used = {i["id"] for g in self._raw.get("repeatGroups", []) for i in g.get("instances", [])}
        return self._allocate_unique_id("py-instance-", used.__contains__)

    def _apply(self, op: dict[str, Any]) -> None:
        """Validate, route to transport, then accept the op into the log.

        The transport also rebuilds repeat-group mirrors the op affects; an op that edits a
        mirror, or whose mirrors can't be rebuilt, raises ``InvalidOperationError`` and is
        neither applied nor logged.
        """
        kind = op.get("op")
        if kind not in M.KNOWN_OPS:
            raise ValueError(f"Unknown op kind {kind!r}")
        try:
            self._transport.apply(op)
        finally:
            self._generation += 1

    def _topology(self) -> TopologyIndex:
        if self._topology_cache is None or self._topology_generation != self._generation:
            self._topology_cache = TopologyIndex(self._raw)
            self._topology_generation = self._generation
        return self._topology_cache

    def _segment_proxy(self, segment_id: str) -> MutableSegment | SegmentView:
        oligo_id = self._resolve_oligo_id_for_segment(segment_id)
        if oligo_id is not None and self._raw_oligo(oligo_id).get("mirrorOf"):
            return SegmentView(self, oligo_id, segment_id)
        return MutableSegment(self, "", segment_id)

    def _oligo_proxy(self, raw_oligo: dict[str, Any]) -> MutableOligo | MirrorOligo:
        cls = MirrorOligo if raw_oligo.get("mirrorOf") else MutableOligo
        return cls(self, raw_oligo["id"])

    def _predict(self, op: dict[str, Any]) -> Check:
        """Run ``op`` (with its mirror rebuild) on a throwaway copy: the reason it fails."""
        raw = self._raw
        work = {**raw, **{k: copy.deepcopy(raw[k]) for k in repeat._COPIED_KEYS if k in raw}}
        try:
            repeat.apply_op(work, op, _HANDLERS[op["op"]])
        except InvalidOperationError as e:
            return Check.failed(str(e))
        return Check.passed()

    def _predict_repeats(self, op: dict[str, Any]) -> Check:
        """Like :meth:`_predict`, but only when the op touches a repeat group's oligo:
        a mirror (refused) or an original (its mirrors must still fit after the edit)."""
        raw = self._raw
        if not repeat.has_repeats(raw):
            return Check.passed()
        touched = repeat.touched_oligos(raw, op)
        if not any(o.get("repeatGroupId") or o.get("mirrorOf") for o in touched):
            return Check.passed()
        return self._predict(op)

    @staticmethod
    def _require_editable(obj: object, cls: type, message: str) -> None:
        """``TypeError`` unless ``obj`` is a ``cls``; a mirror's view raises the mirror error."""
        if isinstance(obj, cls):
            return
        if isinstance(obj, (OligoView, SegmentView, SegmentEndView, SlotView)):
            raise InvalidOperationError(MIRROR_EDIT_ERROR)
        raise TypeError(message)

    @staticmethod
    def _is_mirror_view(obj: object) -> bool:
        return isinstance(obj, (MirrorOligo, SegmentView, SegmentEndView, SlotView)) and not isinstance(
            obj, (MutableOligo, MutableSegment, MutableSegmentEnd, MutableSlot)
        )

    def _resolve_vh_raw(self, vh: MutableVirtualHelix | int) -> dict[str, Any]:
        if isinstance(vh, MutableVirtualHelix):
            return self._raw_vh(vh.index)
        if isinstance(vh, bool) or not isinstance(vh, int):
            raise TypeError(f"vh must be a MutableVirtualHelix or int index, got {type(vh).__name__}")
        return self._raw_vh(vh)

    def _create_bounds(self, vh_raw: dict[str, Any]) -> tuple[int, int]:
        """``[min_base, max_base)`` from the VH's region, as ``Part.createOligo`` checks."""
        region = lattice.region_for_vh(self._raw, vh_raw)
        if region is None:
            return 0, int(vh_raw["length"])
        max_base = region.get("maxBase")
        if max_base is None:
            max_base = region.get("defaultMaxBase", vh_raw["length"])
        return int(region.get("minBase", 0)), int(max_base)

    # ------------------------------------------------------------------
    # Top-level metadata
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        return self._raw.get("name", "")

    @property
    def id(self) -> str:
        return self._raw.get("id", "")

    @property
    def lattice_type(self) -> str:
        """Kind of the first region (HONEYCOMB / SQUARE / FREEFORM).

        Part.toJSON() no longer emits a top-level ``latticeType`` — lattice
        kind lives per-region. This property falls back to a legacy
        top-level field for documents predating the regions schema; for
        multi-region documents, query ``region.kind`` directly.
        """
        regions = self._raw.get("regions") or []
        if regions:
            return regions[0].get("kind", "")
        return self._raw.get("latticeType", "")

    @property
    def max_base(self) -> int:
        """Default-region ``defaultMaxBase``.

        Part.toJSON() no longer emits a top-level ``maxBase``; it's derived
        from the default region. Falls back to a legacy top-level field for
        pre-regions documents.
        """
        regions = self._raw.get("regions") or []
        if regions:
            return int(regions[0].get("defaultMaxBase", 0))
        return int(self._raw.get("maxBase", 0))

    @property
    def active_region_id(self) -> str | None:
        return self._active_region_id

    @property
    def active_region(self) -> MutableRegion | None:
        if self._active_region_id is None:
            return None
        return self.get_region(self._active_region_id)

    # ------------------------------------------------------------------
    # Collections
    # ------------------------------------------------------------------

    def _raw_plane(self, plane_id: str) -> dict[str, Any]:
        for p in self._raw.get("planes", []):
            if p["id"] == plane_id:
                return p
        raise KeyError(f"No plane with id {plane_id!r}")

    def _plane_id_exists(self, plane_id: str) -> bool:
        return any(p["id"] == plane_id for p in self._raw.get("planes", []))

    def _region_id_exists(self, region_id: str) -> bool:
        return any(r["id"] == region_id for r in self._raw.get("regions", []))

    def allocate_plane_id(self) -> str:
        return self._allocate_unique_id("py-plane-", self._plane_id_exists)

    def allocate_region_id(self) -> str:
        return self._allocate_unique_id("py-region-", self._region_id_exists)

    @property
    def regions(self) -> list[MutableRegion]:
        return [self._build_region_proxy(r) for r in self._raw.get("regions", [])]

    @property
    def virtual_helices(self) -> list[MutableVirtualHelix]:
        return [
            MutableVirtualHelix(self, vh["index"]) for vh in self._raw.get("virtualHelices", [])
        ]

    @property
    def planes(self) -> list[MutablePlane]:
        return [MutablePlane(self, p["id"]) for p in self._raw.get("planes", [])]

    @property
    def oligos(self) -> list[MutableOligo | MirrorOligo]:
        """Every oligo, including repeat groups' read-only mirror oligos. Use
        :attr:`real_oligos` for the ones you can edit."""
        return [self._oligo_proxy(o) for o in self._raw.get("oligos", [])]

    @property
    def real_oligos(self) -> list[MutableOligo]:
        """Every oligo except mirror oligos (the host's ``Part.realOligos``): what the
        oligo list and exports show."""
        return [MutableOligo(self, o["id"]) for o in self._raw.get("oligos", []) if not o.get("mirrorOf")]

    # ------------------------------------------------------------------
    # Repeat groups
    # ------------------------------------------------------------------

    @property
    def repeat_groups(self) -> list[MutableRepeatGroup]:
        return [MutableRepeatGroup(self, g["id"]) for g in self._raw.get("repeatGroups", [])]

    def get_repeat_group(self, group_id: str) -> MutableRepeatGroup | None:
        return MutableRepeatGroup(self, group_id) if repeat.find_group(self._raw, group_id) else None

    def create_repeat_group(self, oligos: Sequence[MutableOligo], bp_offset: int) -> MutableRepeatGroup:
        """Make ``oligos`` the originals of a new repeat group with one copy ``bp_offset``
        bp along the same VHs (the editor's "Duplicate as linked mirror copies").

        The copy's mirror oligos are built immediately and rebuilt after every later edit
        to an original; a region the copy runs past grows. Add more copies with
        ``group.add_instance``. Raises ``InvalidOperationError`` when
        :meth:`can_create_repeat_group` refuses it.
        """
        op = self._create_repeat_group_op(oligos, bp_offset)
        self._apply(op)
        return MutableRepeatGroup(self, op["groupId"])

    def can_create_repeat_group(self, oligos: Sequence[MutableOligo], bp_offset: int) -> Check:
        """Whether :meth:`create_repeat_group` accepts this: at least one oligo, none a
        mirror or already in a group, and the copy placeable (no overlap, crossovers on
        matching lattice sites, skips/insertions paired)."""
        return self._predict(self._create_repeat_group_op(oligos, bp_offset))

    def _create_repeat_group_op(self, oligos: Sequence[MutableOligo], bp_offset: int) -> dict[str, Any]:
        if isinstance(oligos, (str, bytes)) or not isinstance(oligos, Sequence):
            raise TypeError("create_repeat_group() takes a list of oligos")
        if any(not isinstance(o, OligoView) for o in oligos):
            raise TypeError("create_repeat_group() takes a list of oligos")
        if isinstance(bp_offset, bool) or not isinstance(bp_offset, int):
            raise TypeError(f"bp_offset must be int, got {type(bp_offset).__name__}")
        return {
            "op": M.OP_CREATE_REPEAT_GROUP,
            "groupId": self._allocate_group_id(),
            "instanceId": self._allocate_instance_id(),
            "name": repeat.next_group_name(self._raw),
            "oligoIds": [o.id for o in oligos],
            "bpOffset": int(bp_offset),
        }

    def _mirror_info(self, raw_oligo: dict[str, Any]) -> MirrorInfo | None:
        tag = raw_oligo.get("mirrorOf")
        if not tag:
            return None
        group = self.get_repeat_group(tag["groupId"])
        instance = group.get_instance(tag["instanceId"]) if group is not None else None
        if group is None or instance is None:
            return None
        return MirrorInfo(group, instance, MutableOligo(self, tag["sourceOligoId"]))

    def _build_region_proxy(self, raw_region: dict[str, Any]) -> MutableRegion:
        kind = raw_region.get("kind")
        if kind in ("HONEYCOMB", "SQUARE"):
            return LatticedRegion(self, raw_region["id"])
        if kind == "FREEFORM":
            return FreeformRegion(self, raw_region["id"])
        return MutableRegion(self, raw_region["id"])

    def get_region(self, region_id: str) -> MutableRegion | None:
        for r in self._raw.get("regions", []):
            if r["id"] == region_id:
                return self._build_region_proxy(r)
        return None

    def get_vh(self, index: int) -> MutableVirtualHelix | None:
        for vh in self._raw.get("virtualHelices", []):
            if vh["index"] == index:
                return MutableVirtualHelix(self, index)
        return None

    def get_oligo(self, oligo_id: str) -> MutableOligo | MirrorOligo | None:
        for o in self._raw.get("oligos", []):
            if o["id"] == oligo_id:
                return self._oligo_proxy(o)
        return None

    def potential_xover_sites(self, vh: MutableVirtualHelix | int) -> list[list[CrossoverSite]]:
        """``[strand 0 sites, strand 1 sites]`` for one VH, as the host's
        ``Part.potentialXoverSites``. See :meth:`MutableVirtualHelix.potential_xover_sites`."""
        vh_raw = self._resolve_vh_raw(vh)
        sites = self._topology().potential_xover_sites(int(vh_raw["index"]))
        return [list(sites[0]), list(sites[1])]

    def vhs_in_region(self, region_id: str) -> list[MutableVirtualHelix]:
        return [vh for vh in self.virtual_helices if vh.region_id == region_id]

    def oligos_in_region(self, region_id: str) -> list[MutableOligo | MirrorOligo]:
        """Oligos whose every segment lives in ``region_id`` (cross-region oligos excluded),
        mirror oligos included."""
        out: list[MutableOligo | MirrorOligo] = []
        for o in self.oligos:
            if o.touches_regions() == {region_id}:
                out.append(o)
        return out

    # ------------------------------------------------------------------
    # Mutation methods (top-level)
    # ------------------------------------------------------------------

    def create_segment(
        self,
        vh: MutableVirtualHelix | int,
        five_index: int,
        three_index: int,
        color: str = "#888888",
        is_scaffold: bool = False,
        name: str | None = None,
    ) -> MutableSegment:
        """Create a new oligo containing one fresh segment.

        The strand set is derived from endpoint ordering (``5' < 3'`` → strand
        set 0, otherwise strand set 1) — the same convention ``Part.createOligo``
        uses on the JS side. Both sides agree by construction.

        Raises :class:`InvalidOperationError` when :meth:`can_create_segment` refuses
        it. Returns the newly-created segment proxy.
        """
        vh_raw = self._resolve_vh_raw(vh)
        invariants.validate_segment_endpoints(five_index, three_index)
        invariants.validate_hex_color(color)
        self._check_create_segment(vh_raw, five_index, three_index).raise_if_failed()
        return self._emit_create_segment(vh_raw, five_index, three_index, color, is_scaffold, name)

    def _emit_create_segment(
        self,
        vh_raw: dict[str, Any],
        five_index: int,
        three_index: int,
        color: str,
        is_scaffold: bool,
        name: str | None,
    ) -> MutableSegment:
        # The op carries the VH's stable id, which the host resolves.
        vh_id = vh_raw["id"]
        new_oligo_id = self.allocate_oligo_id()
        new_seg_id = self.allocate_segment_id()
        op: dict[str, Any] = {
            "op": M.OP_CREATE_SEGMENT,
            "vhId": vh_id,
            "fiveIndex": int(five_index),
            "threeIndex": int(three_index),
            "color": color,
            "isScaffold": bool(is_scaffold),
            "name": name,
            "newOligoId": new_oligo_id,
            "newSegmentId": new_seg_id,
        }
        self._apply(op)
        return MutableSegment(self, new_oligo_id, new_seg_id)

    def connect(self, from_segment: MutableSegment, to_segment: MutableSegment) -> None:
        """Connect ``from_segment``'s 3' end to ``to_segment``'s 5' end.

        Any free 3′ end may join any free 5′ end, as on the host; check
        ``seg.three_prime.is_constrained`` afterwards (or pick a bp from
        ``vh.potential_xover_sites(...)`` first) for a lattice crossover site.
        Adjacent ends (same VH and strand, 1 bp apart) merge into one segment
        instead: ``from_segment`` extends over ``to_segment``, which is removed.
        If the segments were in different oligos, ``from_segment``'s oligo absorbs
        the other.

        Raises :class:`InvalidOperationError` when :meth:`can_connect` refuses it.
        """
        for seg in (from_segment, to_segment):
            self._require_editable(seg, MutableSegment, "connect() takes two MutableSegment instances")
        self.can_connect(from_segment, to_segment).raise_if_failed()
        self._apply(
            {
                "op": M.OP_CONNECT,
                "fromSegmentId": from_segment.id,
                "toSegmentId": to_segment.id,
            }
        )

    def remove_vhs(self, vhs: list[int | MutableVirtualHelix]) -> None:
        """Remove the listed virtual helices.

        Accepts ints (existing VH indices) or :class:`MutableVirtualHelix`
        proxies. The op carries the stable VH ``id`` strings so JS-side
        resolution never depends on the python-predicted index matching the
        JS-assigned index.
        """
        if not isinstance(vhs, list):
            raise TypeError("remove_vhs() takes a list")
        ids: list[str] = []
        for v in vhs:
            if isinstance(v, MutableVirtualHelix):
                ids.append(v.id)
            elif isinstance(v, int):
                ids.append(self._raw_vh(int(v))["id"])
            else:
                raise TypeError(
                    f"remove_vhs() entries must be int or MutableVirtualHelix, got {type(v).__name__}"
                )
        self._apply({"op": M.OP_REMOVE_VHS, "vhIds": ids})

    def break_oligo(self, segment: MutableSegment, at_index: int) -> MutableOligo:
        """Break the oligo containing ``segment`` so its new 3′ end is at ``at_index``
        (``Part.breakOligoAt``).

        Returns the oligo holding the 3′ side: a new oligo, or the same one when nothing
        splits off. As on the host, a break at the oligo's own free 5′/3′ end or one bp
        before a free 3′ end does nothing, and breaking a circular oligo opens it into one
        linear oligo. A mid-segment break drops the segment's 3′ modification (both new 3′
        ends are fresh). Raises :class:`InvalidOperationError` when
        :meth:`can_break_oligo` refuses it.
        """
        self._require_editable(segment, MutableSegment, "break_oligo() takes a MutableSegment")
        self.can_break_oligo(segment, at_index).raise_if_failed()
        new_oligo_id = self.allocate_oligo_id()
        self._apply(
            {
                "op": M.OP_BREAK_OLIGO,
                "oligoId": segment.oligo_id,
                "segmentId": segment.id,
                "atIndex": int(at_index),
                "newOligoId": new_oligo_id,
                "newSegmentId": self.allocate_segment_id(),
            }
        )
        if self._oligo_id_exists(new_oligo_id):
            return MutableOligo(self, new_oligo_id)
        return segment.oligo

    def break_at(self, vh: MutableVirtualHelix | int, strand_index: int, bp_index: int) -> MutableOligo:
        """The break tool: break the strand at ``(vh, strand_index, bp_index)`` so its new 3′
        end is at ``bp_index``. Same as :meth:`break_oligo` on the segment found there."""
        segment = self.get_segment_at(vh, strand_index, bp_index)
        if segment is None:
            raise InvalidOperationError(self._no_strand(vh, strand_index, bp_index))
        return self.break_oligo(segment, bp_index)

    def can_break_at(self, vh: MutableVirtualHelix | int, strand_index: int, bp_index: int) -> Check:
        segment = self.get_segment_at(vh, strand_index, bp_index)
        if segment is None:
            return Check.failed(self._no_strand(vh, strand_index, bp_index))
        return self.can_break_oligo(segment, bp_index)  # a mirror's segment fails there

    # ------------------------------------------------------------------
    # Lookups by position (the editor's hit test)
    # ------------------------------------------------------------------

    def get_segment_at(
        self, vh: MutableVirtualHelix | int, strand_index: int, bp_index: int
    ) -> MutableSegment | None:
        """The segment covering ``bp_index`` on one strand of ``vh``, or ``None``."""
        invariants.validate_strand_set_index(strand_index)
        vh_index = int(self._resolve_vh_raw(vh)["index"])
        seg_id = self._topology().segment_at(vh_index, strand_index, bp_index)
        return self._segment_proxy(seg_id) if seg_id else None

    def get_oligo_at(
        self, vh: MutableVirtualHelix | int, strand_index: int, bp_index: int
    ) -> MutableOligo | None:
        """The oligo covering ``bp_index`` on one strand of ``vh`` (``Part.getOligoByVh``)."""
        segment = self.get_segment_at(vh, strand_index, bp_index)
        return segment.oligo if segment is not None else None

    def get_end_at(
        self, vh: MutableVirtualHelix | int, strand_index: int, bp_index: int
    ) -> MutableSegmentEnd | None:
        """The 5′ or 3′ end sitting at ``bp_index`` on one strand of ``vh``, free or connected."""
        segment = self.get_segment_at(vh, strand_index, bp_index)
        if segment is None:
            return None
        if segment.five_index == bp_index:
            return segment.five_prime
        if segment.three_index == bp_index:
            return segment.three_prime
        return None

    def _no_strand(self, vh: MutableVirtualHelix | int, strand_index: int | None, bp_index: int) -> str:
        vh_index = vh.index if isinstance(vh, MutableVirtualHelix) else vh
        strand = "" if strand_index is None else f" strand {strand_index}"
        return f"No strand at VH {vh_index}{strand} bp {bp_index}"

    # ------------------------------------------------------------------
    # Oligo-level connections and crossovers
    # ------------------------------------------------------------------

    def _run_composite(self, plan: Callable[[Scratch], None]) -> tuple[Check, list[dict[str, Any]]]:
        scratch = Scratch(self._raw, self.allocate_oligo_id, self.allocate_segment_id)
        try:
            plan(scratch)
        except InvalidOperationError as e:
            return Check.failed(str(e)), []
        return Check.passed(), scratch.ops

    def _commit_composite(self, plan: Callable[[Scratch], None]) -> None:
        check, ops = self._run_composite(plan)
        check.raise_if_failed()
        for op in ops:
            self._apply(op)

    def _scratch_oligo(self, oligo: MutableOligo) -> Callable[[Scratch], dict[str, Any]]:
        # A mirror passes here; its edit is refused when the plan runs, so can_* reports it.
        if not isinstance(oligo, OligoView):
            raise TypeError(f"expected a MutableOligo, got {type(oligo).__name__}")
        oligo_id = oligo.id

        def resolve(sc: Scratch) -> dict[str, Any]:
            found = sc.oligo(oligo_id)
            if found is None:
                raise InvalidOperationError(f"No oligo with id {oligo_id!r}")
            return found

        return resolve

    def connect_oligos(self, from_oligo: MutableOligo, to_oligo: MutableOligo) -> None:
        """Join ``from_oligo``'s free 3′ end to ``to_oligo``'s free 5′ end
        (``Part.connectTwoOligos``); the same oligo twice makes it circular.

        Adjacent ends merge into one segment, as with :meth:`connect`. A modification
        on either joined end is cleared, like the editor's connect.
        """
        self._commit_composite(self._connect_oligos_plan(from_oligo, to_oligo))

    def can_connect_oligos(self, from_oligo: MutableOligo, to_oligo: MutableOligo) -> Check:
        return self._run_composite(self._connect_oligos_plan(from_oligo, to_oligo))[0]

    def _connect_oligos_plan(self, from_oligo: MutableOligo, to_oligo: MutableOligo):
        src, dst = self._scratch_oligo(from_oligo), self._scratch_oligo(to_oligo)
        return lambda sc: editing.connect_oligos(sc, src(sc), dst(sc))

    def create_crossover(
        self, from_oligo: MutableOligo, vh: MutableVirtualHelix | int, strand_index: int, bp_index: int
    ) -> None:
        """Join ``from_oligo``'s free 3′ end to the strand at ``(vh, strand_index, bp_index)``,
        breaking that strand just before ``bp_index`` (``Part.createCrossover``; the editor's
        drag from a 3′ end onto a strand).

        If the target oligo's free 5′ end is at ``bp_index`` it is joined directly.
        Refused onto a 3′ end, onto the bp right after a free 5′ end (a 1-nt leftover),
        within one segment, or from a circular oligo.
        """
        self._commit_composite(self._create_crossover_plan(from_oligo, vh, strand_index, bp_index))

    def can_create_crossover(
        self, from_oligo: MutableOligo, vh: MutableVirtualHelix | int, strand_index: int, bp_index: int
    ) -> Check:
        return self._run_composite(self._create_crossover_plan(from_oligo, vh, strand_index, bp_index))[0]

    def _create_crossover_plan(self, from_oligo, vh, strand_index, bp_index):
        invariants.validate_strand_set_index(strand_index)
        src = self._scratch_oligo(from_oligo)
        vh_index = int(self._resolve_vh_raw(vh)["index"])
        return lambda sc: editing.create_crossover(sc, src(sc), vh_index, strand_index, int(bp_index))

    def make_crossover(
        self,
        vh: MutableVirtualHelix | int,
        strand_index: int,
        bp_index: int,
        to_vh: MutableVirtualHelix | int,
    ) -> None:
        """Cross over at a potential crossover site, like clicking one in the editor
        (``makeCrossoverCmd``): the strand whose 3′ end leaves at the site is broken there
        and joined to the other strand at the same bp.

        ``(vh, strand_index, bp_index)`` and ``to_vh`` must name a site from
        ``vh.potential_xover_sites(strand_index)``; both strands must be there, and the
        receiving strand must not end at or 1 nt before its 3′ end at the site.
        """
        self._commit_composite(self._make_crossover_plan(vh, strand_index, bp_index, to_vh))

    def can_make_crossover(
        self,
        vh: MutableVirtualHelix | int,
        strand_index: int,
        bp_index: int,
        to_vh: MutableVirtualHelix | int,
    ) -> Check:
        return self._run_composite(self._make_crossover_plan(vh, strand_index, bp_index, to_vh))[0]

    def _make_crossover_plan(self, vh, strand_index, bp_index, to_vh):
        invariants.validate_strand_set_index(strand_index)
        vh_index = int(self._resolve_vh_raw(vh)["index"])
        to_vh_index = int(self._resolve_vh_raw(to_vh)["index"])
        return lambda sc: editing.make_crossover(sc, vh_index, strand_index, int(bp_index), to_vh_index)

    # ------------------------------------------------------------------
    # Removal and fill
    # ------------------------------------------------------------------

    def remove_oligo(self, oligo: MutableOligo) -> None:
        """Remove ``oligo`` and all its segments (``Part.removeOligo``)."""
        self._require_editable(oligo, MutableOligo, "remove_oligo() takes a MutableOligo")
        self._apply({"op": M.OP_REMOVE_OLIGO, "oligoId": oligo.id})

    def remove_segment(self, segment: MutableSegment) -> MutableOligo | None:
        """Remove one segment from its oligo (``Part.removeSegmentFromOligo``).

        Segments upstream stay in the oligo; those downstream split off into a new oligo,
        which is returned (``None`` when nothing was downstream). Removing an oligo's only
        or first segment removes that oligo id.
        """
        self._require_editable(segment, MutableSegment, "remove_segment() takes a MutableSegment")
        new_oligo_id = self.allocate_oligo_id()
        self._apply(
            {
                "op": M.OP_REMOVE_SEGMENT,
                "oligoId": segment.oligo_id,
                "segmentId": segment.id,
                "newOligoId": new_oligo_id,
            }
        )
        return MutableOligo(self, new_oligo_id) if self._oligo_id_exists(new_oligo_id) else None

    def fill_empty_strand_set(
        self, vh: MutableVirtualHelix | int, strand_index: int, color: str = "#888888"
    ) -> MutableSegment:
        """Draw one segment over the whole of an empty strand (``Part.fillEmptyStrandSet``),
        from the region's ``min_base`` to ``min(vh.length, max_base) - 1``, 5′ → 3′ in the
        strand's direction."""
        check, span = self._fill_plan(vh, strand_index)
        check.raise_if_failed()
        invariants.validate_hex_color(color)
        vh_raw = self._resolve_vh_raw(vh)
        return self._emit_create_segment(vh_raw, span[0], span[1], color, False, None)

    def can_fill_empty_strand_set(self, vh: MutableVirtualHelix | int, strand_index: int) -> Check:
        return self._fill_plan(vh, strand_index)[0]

    def _fill_plan(self, vh: MutableVirtualHelix | int, strand_index: int) -> tuple[Check, tuple[int, int]]:
        invariants.validate_strand_set_index(strand_index)
        vh_raw = self._resolve_vh_raw(vh)
        vh_index = int(vh_raw["index"])
        if self._topology().intervals(vh_index, strand_index):
            return Check.failed(f"Strand {strand_index} of VH {vh_index} is not empty"), (0, 0)
        min_base, max_base = self._create_bounds(vh_raw)
        start, end = min_base, min(int(vh_raw["length"]), max_base) - 1
        if end <= start:
            return Check.failed(f"VH {vh_index} has no room for a strand"), (0, 0)
        return Check.passed(), ((start, end) if strand_index == 0 else (end, start))

    def create_oligo(
        self,
        segments: Sequence[SegmentSpec | tuple[MutableVirtualHelix | int, int, int]],
        color: str = "#888888",
        name: str | None = None,
        is_scaffold: bool = False,
        circular: bool = False,
    ) -> MutableOligo:
        """Create one oligo from a path of segments listed 5′ → 3′.

        Each entry is ``(vh, five, three)`` (or a :class:`SegmentSpec`); each
        segment's 3′ end joins the next one's 5′ end. Junctions are unrestricted,
        like :meth:`connect`. Consecutive entries that are adjacent on the same VH
        and strand become one segment (the host would merge them).
        ``circular=True`` also joins the last 3′ end to the first 5′ end.

        The whole path is checked first (:meth:`can_create_oligo`), so an invalid
        path raises :class:`InvalidOperationError` before anything is recorded.
        Returns the oligo; ``oligo.segments`` lists its segments 5′ → 3′.
        """
        invariants.validate_hex_color(color)
        check, plan = self._plan_oligo(segments, circular)
        check.raise_if_failed()
        created = [
            self._emit_create_segment(p.vh, p.five, p.three, color, is_scaffold, name) for p in plan
        ]
        links = list(zip(created, created[1:]))
        if circular:
            links.append((created[-1], created[0]))
        for from_seg, to_seg in links:
            self._apply(
                {"op": M.OP_CONNECT, "fromSegmentId": from_seg.id, "toSegmentId": to_seg.id}
            )
        return MutableOligo(self, created[0].oligo_id)

    def can_create_oligo(
        self,
        segments: Sequence[SegmentSpec | tuple[MutableVirtualHelix | int, int, int]],
        circular: bool = False,
    ) -> Check:
        """Whether :meth:`create_oligo` accepts this path: every segment in its
        region's bounds and on free bases, no two entries overlapping, and no
        junction on a skip or insertion."""
        return self._plan_oligo(segments, circular)[0]

    def _plan_oligo(
        self,
        segments: Sequence[SegmentSpec | tuple[MutableVirtualHelix | int, int, int]],
        circular: bool,
    ) -> tuple[Check, list[_PlannedSegment]]:
        if isinstance(segments, (str, bytes)) or not isinstance(segments, Sequence):
            raise TypeError("create_oligo() takes a list of (vh, five, three) entries")
        plan: list[_PlannedSegment] = []
        for i, entry in enumerate(segments):
            try:
                vh, five, three = entry
            except (TypeError, ValueError):
                raise TypeError(
                    f"segment {i}: expected (vh, five, three) or SegmentSpec, got {entry!r}"
                ) from None
            invariants.validate_segment_endpoints(five, three)
            try:
                vh_raw = self._resolve_vh_raw(vh)
            except KeyError as e:
                return Check.failed(f"segment {i}: {e.args[0]}"), []
            plan.append(_PlannedSegment(vh_raw, int(five), int(three)))
        if not plan:
            return Check.failed("create_oligo() needs at least one segment"), []

        def continues(a: _PlannedSegment, b: _PlannedSegment) -> bool:
            # b's 5' end sits right after a's 3' end on the same strand.
            step = 1 if a.strand_index == 0 else -1
            return (
                a.vh is b.vh
                and a.strand_index == b.strand_index
                and b.five == a.three + step
            )

        merged: list[_PlannedSegment] = [plan[0]]
        for p in plan[1:]:
            last = merged[-1]
            if continues(last, p):
                merged[-1] = _PlannedSegment(last.vh, last.five, p.three)
            else:
                merged.append(p)
        if circular and len(merged) > 1 and continues(merged[-1], merged[0]):
            last = merged.pop()
            merged[0] = _PlannedSegment(last.vh, last.five, merged[0].three)
        if circular and len(merged) < 2:
            return Check.failed("A circular oligo needs at least two segments"), []

        for i, p in enumerate(merged):
            check = self._check_create_segment(p.vh, p.five, p.three)
            if not check:
                return Check.failed(f"segment {i}: {check.reason}"), []
            lo, hi = sorted((p.five, p.three))
            for j, q in enumerate(merged[:i]):
                q_lo, q_hi = sorted((q.five, q.three))
                if q.vh is p.vh and q.strand_index == p.strand_index and q_lo <= hi and lo <= q_hi:
                    return Check.failed(f"segments {j} and {i} overlap"), []

        topo = self._topology()
        junctions = list(zip(merged, merged[1:]))
        if circular:
            junctions.append((merged[-1], merged[0]))
        for a, b in junctions:
            for vh_raw, bp in ((a.vh, a.three), (b.vh, b.five)):
                kind = topo.slot_kind_at(int(vh_raw["index"]), bp)
                if kind is not None:
                    return Check.failed(
                        f"Cannot connect at VH {vh_raw['index']} bp {bp}: it is {with_article(kind)}"
                    ), []
        return Check.passed(), merged

    # ------------------------------------------------------------------
    # Checks (predictions of what the host accepts on replay)
    # ------------------------------------------------------------------

    def can_create_segment(self, vh: MutableVirtualHelix | int, five_index: int, three_index: int) -> Check:
        """Whether :meth:`create_segment` accepts this segment, as ``Part.createOligo``
        checks it: both ends inside the VH region's ``[min_base, max_base)`` and the
        range free on its strand set (``5' < 3'`` → strand set 0, else 1)."""
        try:
            vh_raw = self._resolve_vh_raw(vh)
        except KeyError as e:
            return Check.failed(str(e.args[0]))
        invariants.validate_segment_endpoints(five_index, three_index)
        return self._check_create_segment(vh_raw, five_index, three_index)

    def _check_create_segment(self, vh_raw: dict[str, Any], five: int, three: int) -> Check:
        vh_index = int(vh_raw["index"])
        min_base, max_base = self._create_bounds(vh_raw)
        if not (min_base <= five < max_base and min_base <= three < max_base):
            return Check.failed(
                f"Cannot create segment {five}->{three} on VH {vh_index}: "
                f"indices must be within bounds ({min_base}-{max_base - 1})"
            )
        ss = strand_index_from_direction(five, three)
        hits = self._topology().segments_overlapping(vh_index, ss, five, three)
        if hits:
            return Check.failed(
                f"Cannot create segment {five}->{three} on VH {vh_index}: "
                f"space occupied on strand set {ss} by segment {hits[0]!r}"
            )
        return Check.passed()

    def can_connect(self, from_segment: MutableSegment, to_segment: MutableSegment) -> Check:
        """Whether :meth:`connect` accepts joining ``from_segment``'s 3′ end to
        ``to_segment``'s 5′ end: different segments, both ends free, and neither end
        on a skip or insertion."""
        if self._is_mirror_view(from_segment) or self._is_mirror_view(to_segment):
            return Check.failed(MIRROR_EDIT_ERROR)
        if not isinstance(from_segment, MutableSegment) or not isinstance(to_segment, MutableSegment):
            raise TypeError("can_connect() takes two MutableSegment instances")
        topo = self._topology()
        a = topo.segment(from_segment.id)
        b = topo.segment(to_segment.id)
        if a is None or b is None:
            missing = from_segment.id if a is None else to_segment.id
            return Check.failed(f"No segment with id {missing!r}")
        if a.segment_id == b.segment_id:
            return Check.failed("Cannot connect a segment's 3' end to its own 5' end")
        if not from_segment.three_prime.is_free:
            return Check.failed(f"The 3' end of segment {a.segment_id!r} is already connected")
        if not to_segment.five_prime.is_free:
            return Check.failed(f"The 5' end of segment {b.segment_id!r} is already connected")
        for info, bp in ((a, a.three), (b, b.five)):
            kind = topo.slot_kind_at(info.vh_index, bp)
            if kind is not None:
                return Check.failed(f"Cannot connect at VH {info.vh_index} bp {bp}: it is {with_article(kind)}")
        return self._predict_repeats(
            {"op": M.OP_CONNECT, "fromSegmentId": a.segment_id, "toSegmentId": b.segment_id}
        )

    def can_break_oligo(self, segment: MutableSegment, at_index: int) -> Check:
        """Whether :meth:`break_oligo` accepts this break: ``at_index`` inside the
        segment, and a mid-segment break not leaving a new end on a skip or insertion."""
        if self._is_mirror_view(segment):
            return Check.failed(MIRROR_EDIT_ERROR)
        if not isinstance(segment, MutableSegment):
            raise TypeError("can_break_oligo() takes a MutableSegment")
        if isinstance(at_index, bool) or not isinstance(at_index, int):
            raise TypeError(f"at_index must be int, got {type(at_index).__name__}")
        topo = self._topology()
        info = topo.segment(segment.id)
        if info is None:
            return Check.failed(f"No segment with id {segment.id!r}")
        if not info.low <= at_index <= info.high:
            return Check.failed(
                f"Cannot break at bp {at_index}: outside segment {info.low}-{info.high}"
            )
        if at_index == info.three:
            return self._predict_break(info.oligo_id, info.segment_id, at_index)
        next_bp = at_index + (1 if info.strand_index == 0 else -1)
        three_is_free = topo.raw_segment(segment.id)["threePrime"].get("connectedSegmentId") is None
        if next_bp == info.three and not three_is_free:
            # Next to a free 3' end the host does nothing; next to a connected one it refuses.
            return Check.failed(f"Breaking at bp {at_index} would leave a 1-nt segment")
        for bp in (at_index, next_bp):
            kind = self._topology().slot_kind_at(info.vh_index, bp)
            if kind is not None:
                return Check.failed(f"Cannot break at VH {info.vh_index} bp {bp}: it is {with_article(kind)}")
        return self._predict_break(info.oligo_id, info.segment_id, at_index)

    def _predict_break(self, oligo_id: str, segment_id: str, at_index: int) -> Check:
        # Ids are only allocated when there is something to predict.
        if not repeat.has_repeats(self._raw):
            return Check.passed()
        return self._predict_repeats(
            {
                "op": M.OP_BREAK_OLIGO,
                "oligoId": oligo_id,
                "segmentId": segment_id,
                "atIndex": int(at_index),
                "newOligoId": self.allocate_oligo_id(),
                "newSegmentId": self.allocate_segment_id(),
            }
        )

    def _check_move_end(self, segment_id: str, is_three_prime: bool, new_index: int) -> Check:
        """Port of ``SegmentEnd.canMoveTo``, plus refusing a skip/insertion bp."""
        if isinstance(new_index, bool) or not isinstance(new_index, int):
            raise TypeError(f"new_index must be int, got {type(new_index).__name__}")
        topo = self._topology()
        info = topo.segment(segment_id)
        if info is None:
            return Check.failed(f"No segment with id {segment_id!r}")
        vh_raw = topo.vh(info.vh_index)
        length = int(vh_raw["length"]) if vh_raw is not None else 0
        where = f"VH {info.vh_index} bp {new_index}"
        if not 0 <= new_index < length:
            return Check.failed(f"Cannot move to {where}: out of bounds (0-{length - 1})")
        current = info.three if is_three_prime else info.five
        other = info.five if is_three_prime else info.three
        blockers = [
            s
            for s in topo.segments_overlapping(info.vh_index, info.strand_index, current, new_index)
            if s != segment_id
        ]
        if blockers:
            return Check.failed(f"Cannot move to {where}: occupied by segment {blockers[0]!r}")
        ascending = info.strand_index == 0
        keeps_direction = new_index > other if is_three_prime == ascending else new_index < other
        if not keeps_direction:
            return Check.failed(f"Cannot move to {where}: the segment would reverse direction")
        if topo.is_end_constrained(segment_id, is_three_prime):
            raw_end = topo.raw_segment(segment_id)["threePrime" if is_three_prime else "fivePrime"]
            partner = topo.segment(raw_end["connectedSegmentId"])
            sites = topo.potential_xover_sites(info.vh_index)[info.strand_index]
            # As the host: the first site at the current bp decides left/right.
            current_right = next((site.right for site in sites if site.bp_index == current), None)
            if not any(
                site.bp_index == new_index
                and site.to_vh_index == partner.vh_index
                and site.right == current_right
                for site in sites
            ):
                return Check.failed(
                    f"Cannot move to {where}: a constrained crossover end may only move to a "
                    f"matching crossover site toward VH {partner.vh_index}"
                )
        kind = topo.slot_kind_at(info.vh_index, new_index)
        if kind is not None:
            return Check.failed(f"Cannot move to {where}: it is {with_article(kind)}")
        return self._predict_repeats(
            {
                "op": M.OP_MOVE_TERMINUS,
                "segmentId": segment_id,
                "end": "3" if is_three_prime else "5",
                "toIndex": new_index,
            }
        )

    def _check_skip_or_insertion(self, segment_id: str, bp: int, skip: bool) -> Check:
        topo = self._topology()
        info = topo.segment(segment_id)
        if info is None:
            return Check.failed(f"No segment with id {segment_id!r}")
        what = "a skip" if skip else "an insertion"
        where = f"VH {info.vh_index} bp {bp}"
        if not info.low <= bp <= info.high:
            return Check.failed(f"Cannot add {what} at {where}: outside the segment")
        if bp in (info.five, info.three):
            return Check.failed(f"Cannot add {what} at {where}: it is a segment end")
        if topo.has_constrained_end_at(info.vh_index, bp):
            return Check.failed(f"Cannot add {what} at {where}: constrained crossover site")
        if topo.segment_at(info.vh_index, 1 - info.strand_index, bp) is None:
            return Check.failed(f"Cannot add {what} at {where}: complementary slot is missing")
        kind = topo.slot_kind_at(info.vh_index, bp)
        if kind == "skip" or (skip and kind is not None):
            return Check.failed(f"Cannot add {what} at {where}: it is already {with_article(kind)}")
        comp_id = topo.segment_at(info.vh_index, 1 - info.strand_index, bp)
        lengths = {slot_length(topo.raw_segment(s), bp) for s in (segment_id, comp_id)}
        if len(lengths) > 1:
            return Check.failed(f"Cannot add {what} at {where}: the two strands are out of sync")
        return self._predict_repeats(
            {
                "op": M.OP_ADD_SKIP_OR_INSERTION,
                "segmentId": segment_id,
                "bpIndex": int(bp),
                "count": -1 if skip else 1,
            }
        )

    # ------------------------------------------------------------------
    # Skips and insertions, as the editor's skip / insert tools
    # ------------------------------------------------------------------

    def get_slot_at(self, vh: MutableVirtualHelix | int, strand_index: int, bp_index: int) -> MutableSlot | None:
        """The slot at one base of one strand (``None`` where no segment covers it)."""
        segment = self.get_segment_at(vh, strand_index, bp_index)
        return segment.slot_at(bp_index) if segment is not None else None

    def add_skip_at(self, vh: MutableVirtualHelix | int, bp_index: int) -> None:
        """The skip tool: skip ``bp_index`` on both strands of ``vh``
        (``OligoSegment.addSkipOrInsertion(bp, -1)``)."""
        check, segment = self._skip_insert_target(vh, bp_index, skip=True)
        check.raise_if_failed()
        self._emit_skip_or_insertion(segment, bp_index, -1)

    def can_add_skip_at(self, vh: MutableVirtualHelix | int, bp_index: int) -> Check:
        return self._skip_insert_target(vh, bp_index, skip=True)[0]

    def add_insert_at(self, vh: MutableVirtualHelix | int, bp_index: int, count: int = 1) -> None:
        """The insert tool: add ``count`` inserted bases at ``bp_index`` on both strands of
        ``vh``, keeping their bases. Calling it again adds more
        (``OligoSegment.addSkipOrInsertion(bp, count)``)."""
        if isinstance(count, bool) or not isinstance(count, int) or count < 1:
            raise ValueError(f"count must be a positive int, got {count!r}")
        check, segment = self._skip_insert_target(vh, bp_index, skip=False)
        check.raise_if_failed()
        self._emit_skip_or_insertion(segment, bp_index, count)

    def can_add_insert_at(self, vh: MutableVirtualHelix | int, bp_index: int) -> Check:
        return self._skip_insert_target(vh, bp_index, skip=False)[0]

    def remove_skip_or_insertion_at(self, vh: MutableVirtualHelix | int, bp_index: int) -> None:
        """Remove a skip or insertion at ``bp_index``: both strands go back to one base each
        (``OligoSegment.removeSkipOrInsertion``). Does nothing on a plain base."""
        for strand_index in (0, 1):
            slot = self.get_slot_at(vh, strand_index, bp_index)
            if slot is None:
                continue
            vh_index = int(self._resolve_vh_raw(vh)["index"])
            if self._topology().slot_kind_at(vh_index, bp_index) is not None:
                slot.remove_skip_or_insertion()
            return
        raise InvalidOperationError(self._no_strand(vh, None, bp_index))

    def _skip_insert_target(
        self, vh: MutableVirtualHelix | int, bp_index: int, skip: bool
    ) -> tuple[Check, MutableSegment | None]:
        """The strand to apply the tool through. As in the editor, either strand may be
        clicked, so one where ``bp_index`` isn't a segment end is enough."""
        first: Check | None = None
        for strand_index in (0, 1):
            segment = self.get_segment_at(vh, strand_index, bp_index)
            if segment is None:
                continue
            check = self._check_skip_or_insertion(segment.id, bp_index, skip)
            if check:
                return check, segment
            if first is None:
                first = check
        if first is None:
            first = Check.failed(self._no_strand(vh, None, bp_index))
        return first, None

    def _emit_skip_or_insertion(self, segment: MutableSegment, bp_index: int, count: int) -> None:
        self._apply(
            {
                "op": M.OP_ADD_SKIP_OR_INSERTION,
                "segmentId": segment.id,
                "bpIndex": int(bp_index),
                "count": int(count),
            }
        )

    def reorder_vh(self, vh: MutableVirtualHelix | int, target_region_row: int) -> None:
        """Reorder ``vh`` within its region to ``target_region_row`` (0-based)."""
        if isinstance(vh, int):
            vh = self.get_vh(vh)
            if vh is None:
                raise KeyError(f"No VH with index {vh}")
        if not isinstance(vh, MutableVirtualHelix):
            raise TypeError("reorder_vh() takes a MutableVirtualHelix or int")
        self._apply(
            {
                "op": M.OP_REORDER_VH,
                "vhId": vh.id,
                "targetRegionRow": int(target_region_row),
            }
        )

    def set_plane_transform(
        self,
        plane_id: str,
        origin: tuple[float, float, float] | list[float] | dict,
        u: tuple[float, float, float] | list[float] | dict,
        v: tuple[float, float, float] | list[float] | dict,
        normal: tuple[float, float, float] | list[float] | dict,
    ) -> None:
        """Update the 3D pose of the plane identified by ``plane_id``.

        Each vector can be a ``(x, y, z)`` tuple/list or a ``{x, y, z}`` dict.
        """
        def _to_vec3(val: Any) -> dict[str, float]:
            if isinstance(val, dict):
                return {"x": float(val["x"]), "y": float(val["y"]), "z": float(val["z"])}
            x, y, z = val
            return {"x": float(x), "y": float(y), "z": float(z)}

        self._apply(
            {
                "op": M.OP_TRANSFORM_PLANE,
                "planeId": plane_id,
                "origin": _to_vec3(origin),
                "u": _to_vec3(u),
                "v": _to_vec3(v),
                "normal": _to_vec3(normal),
            }
        )

    _REGION_DEFAULTS: dict[str, dict[str, Any]] = {
        "HONEYCOMB": {"step": 21, "turnsPerStep": 2, "subStepSize": 7, "twistOffset": 340},
        "SQUARE": {"step": 32, "turnsPerStep": 3, "subStepSize": 8, "twistOffset": 195},
        "FREEFORM": {"step": 21, "turnsPerStep": 2, "subStepSize": 7, "twistOffset": 0},
    }

    def add_region(
        self,
        kind: str,
        name: str,
        max_base: int,
        *,
        min_base: int = 0,
        plane_origin: tuple[float, float, float] = (0.0, 0.0, 0.0),
        plane_u: tuple[float, float, float] = (1.0, 0.0, 0.0),
        plane_v: tuple[float, float, float] = (0.0, 1.0, 0.0),
        plane_normal: tuple[float, float, float] = (0.0, 0.0, 1.0),
        plane_name: str | None = None,
        step: int | None = None,
        turns_per_step: int | None = None,
        sub_step_size: int | None = None,
        twist_offset: float | None = None,
    ) -> MutableRegion:
        """Create a new region + plane and append them to the part.

        ``kind`` must be ``"HONEYCOMB"``, ``"SQUARE"``, or ``"FREEFORM"``.
        Returns a proxy for the new region.
        """
        if kind not in self._REGION_DEFAULTS:
            raise ValueError(f"Unknown region kind {kind!r}; must be HONEYCOMB, SQUARE or FREEFORM")
        defaults = self._REGION_DEFAULTS[kind]
        plane_id = self.allocate_plane_id()
        region_id = self.allocate_region_id()
        self._apply(
            {
                "op": M.OP_ADD_REGION_AND_PLANE,
                "planeId": plane_id,
                "planeName": plane_name or name,
                "planeOrigin": {"x": float(plane_origin[0]), "y": float(plane_origin[1]), "z": float(plane_origin[2])},
                "planeU": {"x": float(plane_u[0]), "y": float(plane_u[1]), "z": float(plane_u[2])},
                "planeV": {"x": float(plane_v[0]), "y": float(plane_v[1]), "z": float(plane_v[2])},
                "planeNormal": {"x": float(plane_normal[0]), "y": float(plane_normal[1]), "z": float(plane_normal[2])},
                "regionId": region_id,
                "regionName": name,
                "regionKind": kind,
                "regionStep": step if step is not None else defaults["step"],
                "regionTurnsPerStep": turns_per_step if turns_per_step is not None else defaults["turnsPerStep"],
                "regionSubStepSize": sub_step_size if sub_step_size is not None else defaults["subStepSize"],
                "regionTwistOffset": twist_offset if twist_offset is not None else defaults["twistOffset"],
                "regionMinBase": int(min_base),
                "regionMaxBase": int(max_base),
            }
        )
        return self._build_region_proxy({"id": region_id, "kind": kind})

    def split_region(self, region: MutableRegion | str, split_after_vh: MutableVirtualHelix | str) -> MutableRegion:
        """Split ``region`` into two at the given VH boundary.

        The VHs up to and including ``split_after_vh`` stay in the original
        region; those after it move to a new region (with its own plane).
        Returns a proxy for the new region.
        """
        region_id = region._id if isinstance(region, MutableRegion) else str(region)
        split_after_vh_id = split_after_vh.id if isinstance(split_after_vh, MutableVirtualHelix) else str(split_after_vh)
        region_kind = self._raw_region(region_id).get("kind", "HONEYCOMB")
        new_plane_id = self.allocate_plane_id()
        new_region_id = self.allocate_region_id()
        self._apply(
            {
                "op": M.OP_SPLIT_REGION,
                "regionId": region_id,
                "splitAfterVhId": split_after_vh_id,
                "newPlaneId": new_plane_id,
                "newRegionId": new_region_id,
            }
        )
        return self._build_region_proxy({"id": new_region_id, "kind": region_kind})

    # ------------------------------------------------------------------
    # Output / introspection
    # ------------------------------------------------------------------

    @property
    def mutation_log(self) -> list[dict[str, Any]]:
        """The op log captured so far. JSON-serialisable."""
        return list(self._transport.log)

    def to_json(self) -> dict[str, Any]:
        """Return a deep copy of the current mirror dict."""
        return copy.deepcopy(self._raw)

    def to_json_string(self) -> str:
        """Return the current mirror serialised to JSON."""
        return json.dumps(self._raw)

    @staticmethod
    def replay_log_into_fresh_mirror(
        json_str: str, log: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """
        Self-consistency helper: replay a log into a fresh OfflineTransport
        deserialised from ``json_str``, returning the final mirror dict.

        Plugin tests can assert::

            replay_log_into_fresh_mirror(orig_json, part.mutation_log) == part.to_json()
        """
        raw = json.loads(json_str)
        transport = OfflineTransport(raw)
        for op in log:
            transport.apply(op)
        return copy.deepcopy(transport.read_part())

    def __repr__(self) -> str:
        return (
            f"MutablePart(name={self.name!r}, "
            f"vhs={len(self._raw.get('virtualHelices', []))}, "
            f"oligos={len(self._raw.get('oligos', []))}, "
            f"regions={len(self._raw.get('regions', []))}, "
            f"log={len(self.mutation_log)})"
        )
