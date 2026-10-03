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
from typing import Any, Callable

from . import invariants, mutations as M
from .mutations import MutationLog
from .oligo import MutableOligo, MutableSegment
from .plane import MutablePlane
from .region import FreeformRegion, LatticedRegion, MutableRegion
from .transport import OfflineTransport, Transport
from .vh import MutableVirtualHelix


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

    def _apply(self, op: dict[str, Any]) -> None:
        """Validate, route to transport, then accept the op into the log."""
        kind = op.get("op")
        if kind not in M.KNOWN_OPS:
            raise ValueError(f"Unknown op kind {kind!r}")
        self._transport.apply(op)

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
    def oligos(self) -> list[MutableOligo]:
        return [MutableOligo(self, o["id"]) for o in self._raw.get("oligos", [])]

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

    def get_oligo(self, oligo_id: str) -> MutableOligo | None:
        for o in self._raw.get("oligos", []):
            if o["id"] == oligo_id:
                return MutableOligo(self, oligo_id)
        return None

    def vhs_in_region(self, region_id: str) -> list[MutableVirtualHelix]:
        return [vh for vh in self.virtual_helices if vh.region_id == region_id]

    def oligos_in_region(self, region_id: str) -> list[MutableOligo]:
        """Oligos whose every segment lives in ``region_id`` (cross-region oligos excluded)."""
        out: list[MutableOligo] = []
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

        Returns the newly-created segment proxy.
        """
        if isinstance(vh, MutableVirtualHelix):
            vh_id = vh.id
        else:
            # Look up the stable id from the mirror so the op carries the same
            # identifier the JS side uses for this VH.
            vh_id = self._raw_vh(int(vh))["id"]
        invariants.validate_segment_endpoints(five_index, three_index)
        invariants.validate_hex_color(color)

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

        If the segments live in different oligos, the offline mirror merges
        them (see :mod:`foldnano_mini.transport`). The JS replayer is the
        authoritative source for merge semantics.
        """
        if not isinstance(from_segment, MutableSegment) or not isinstance(to_segment, MutableSegment):
            raise TypeError("connect() takes two MutableSegment instances")
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
        """Break the oligo containing ``segment`` at ``at_index``.

        The 3′ half of the break (from ``at_index`` onwards) is moved into a
        new oligo. Returns a proxy for that new oligo.

        The break is a no-op (returns the same oligo) if ``at_index`` equals
        the 5′ or 3′ terminus of the segment, or if the oligo is circular.
        """
        if not isinstance(segment, MutableSegment):
            raise TypeError("break_oligo() takes a MutableSegment")
        seg_raw = segment._raw()
        three = int(seg_raw["threePrime"]["index"])
        ascending = int(seg_raw["fivePrime"]["index"]) < three

        new_oligo_id = self.allocate_oligo_id()
        op: dict[str, Any] = {
            "op": M.OP_BREAK_OLIGO,
            "oligoId": segment.oligo_id,
            "segmentId": segment.id,
            "atIndex": int(at_index),
            "newOligoId": new_oligo_id,
        }
        # Include a newSegmentId for mid-segment splits (used by the mirror only)
        if at_index != three:
            op["newSegmentId"] = self.allocate_segment_id()
        self._apply(op)
        return MutableOligo(self, new_oligo_id)

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
