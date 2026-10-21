"""
foldnano_mini.transport — transport abstraction + offline mirror.

The transport sits between the mutable proxies and the underlying part state.
``OfflineTransport`` mutates an in-worker mirror dict and appends each op to
its log, so plugin code can interleave reads and writes naturally.

The mirror update is intentionally a *plausible* projection of what the JS
side would do — it is not the authoritative semantic source. The JS-side
replayer (Phase C) is the source of truth for op semantics. The mirror's
job is just to keep ``part.to_json()`` self-consistent so plugin authors can
test their logic in pure CPython.

Phase 6 (out of scope here) adds ``LiveTransport`` — same protocol, but each
``apply()`` routes the op to the JS side via sync RPC.
"""

from __future__ import annotations

import copy
import uuid
from typing import Any, Callable, Protocol

from . import mutations as M
from .checks import InvalidOperationError


class Transport(Protocol):
    """Common interface for offline (mirror) and live (JS RPC) transports."""

    def apply(self, op: dict[str, Any]) -> None: ...
    def read_part(self) -> dict[str, Any]: ...

    @property
    def log(self) -> list[dict[str, Any]]: ...


class OfflineTransport:
    """In-process transport.

    Mutates a mirror dict and appends each op to the log. The mirror is a
    deep copy of the input dict — it is never aliased back to caller state.
    """

    def __init__(self, raw: dict[str, Any]) -> None:
        self._raw = copy.deepcopy(raw)
        self._log: list[dict[str, Any]] = []

    @property
    def raw(self) -> dict[str, Any]:
        return self._raw

    @property
    def log(self) -> list[dict[str, Any]]:
        return self._log

    def read_part(self) -> dict[str, Any]:
        return self._raw

    def apply(self, op: dict[str, Any]) -> None:
        kind = op.get("op")
        handler = _HANDLERS.get(kind)
        if handler is None:
            raise ValueError(f"OfflineTransport: unknown op kind {kind!r}")
        handler(self._raw, op)
        self._log.append(op)


# ---------------------------------------------------------------------------
# Mirror lookup helpers
# ---------------------------------------------------------------------------


def _find_oligo(raw: dict, oligo_id: str) -> dict:
    for o in raw.get("oligos", []):
        if o["id"] == oligo_id:
            return o
    raise KeyError(f"No oligo with id {oligo_id!r}")


def _find_oligo_index(raw: dict, oligo_id: str) -> int:
    for i, o in enumerate(raw.get("oligos", [])):
        if o["id"] == oligo_id:
            return i
    raise KeyError(f"No oligo with id {oligo_id!r}")


def _find_segment(oligo: dict, segment_id: str) -> dict:
    for s in oligo.get("segments", []):
        if s["id"] == segment_id:
            return s
    raise KeyError(f"Oligo {oligo['id']!r} has no segment {segment_id!r}")


def _find_segment_in_part(raw: dict, segment_id: str) -> tuple[dict, dict]:
    """Locate (oligo, segment) by segment id across the whole part."""
    for o in raw.get("oligos", []):
        for s in o.get("segments", []):
            if s["id"] == segment_id:
                return o, s
    raise KeyError(f"No segment with id {segment_id!r}")


def _find_vh(raw: dict, vh_index: int) -> dict:
    for vh in raw.get("virtualHelices", []):
        if vh["index"] == vh_index:
            return vh
    raise KeyError(f"No virtualHelix with index {vh_index!r}")


def _find_vh_by_id(raw: dict, vh_id: str) -> dict:
    for vh in raw.get("virtualHelices", []):
        if vh.get("id") == vh_id:
            return vh
    raise KeyError(f"No virtualHelix with id {vh_id!r}")


def _find_region(raw: dict, region_id: str) -> dict:
    for r in raw.get("regions", []):
        if r["id"] == region_id:
            return r
    raise KeyError(f"No region with id {region_id!r}")


def _next_vh_index(raw: dict) -> int:
    used = [vh["index"] for vh in raw.get("virtualHelices", [])]
    return (max(used) + 1) if used else 0


def _find_slot(segment: dict, bp_index: int) -> dict | None:
    for slot in segment.get("slots", []):
        if slot.get("bpIndex") == bp_index:
            return slot
    return None


def _slot_at(segment: dict, bp_index: int) -> dict:
    """Find or create a slot at bpIndex in segment.slots."""
    slots = segment.setdefault("slots", [])
    for slot in slots:
        if slot.get("bpIndex") == bp_index:
            return slot
    slot = {"bpIndex": bp_index, "seq": ""}
    slots.append(slot)
    return slot


# ---------------------------------------------------------------------------
# Op handlers
# ---------------------------------------------------------------------------


def _h_set_oligo_color(raw: dict, op: dict) -> None:
    oligo = _find_oligo(raw, op["oligoId"])
    oligo["color"] = op["color"]


def _h_set_oligo_name(raw: dict, op: dict) -> None:
    oligo = _find_oligo(raw, op["oligoId"])
    oligo["name"] = op["name"]


def _h_set_oligo_is_scaffold(raw: dict, op: dict) -> None:
    oligo = _find_oligo(raw, op["oligoId"])
    oligo["isScaffold"] = bool(op["isScaffold"])


def _h_set_segment_modification(raw: dict, op: dict) -> None:
    oligo = _find_oligo(raw, op["oligoId"])
    seg = _find_segment(oligo, op["segmentId"])
    end_key = "fivePrime" if op["end"] == "5" else "threePrime"
    seg[end_key]["modification"] = op["modification"]


def _h_set_slot_sequence(raw: dict, op: dict) -> None:
    oligo = _find_oligo(raw, op["oligoId"])
    seg = _find_segment(oligo, op["segmentId"])
    slot = _slot_at(seg, op["bpIndex"])
    slot["seq"] = op["seq"]


def _complementary_segment(raw: dict, seg: dict, bp_index: int) -> dict | None:
    """The other strand's segment covering ``bp_index`` on ``seg``'s VH, if any."""
    vh_index = int(seg["inVirtualHelixIndex"])
    own_strand = _strand_index_of(raw, seg)
    for o in raw.get("oligos", []):
        for s in o.get("segments", []):
            if int(s["inVirtualHelixIndex"]) != vh_index or s is seg:
                continue
            if _strand_index_of(raw, s) == own_strand:
                continue
            lo, hi = sorted((int(s["fivePrime"]["index"]), int(s["threePrime"]["index"])))
            if lo <= bp_index <= hi:
                return s
    return None


def _h_set_slot_skip(raw: dict, op: dict) -> None:
    # The host's addSkipOrInsertion / removeSkipOrInsertion change both strands' slots.
    oligo = _find_oligo(raw, op["oligoId"])
    seg = _find_segment(oligo, op["segmentId"])
    comp = _complementary_segment(raw, seg, op["bpIndex"])
    for target in (seg, comp):
        if target is None:
            continue
        slot = _slot_at(target, op["bpIndex"])
        if op["skip"]:
            slot["seq"] = ""
        elif len(slot.get("seq", "")) != 1:
            slot["seq"] = (slot.get("seq") or "N")[0]
        slot["skip"] = bool(op["skip"])


def _h_set_slot_insertion(raw: dict, op: dict) -> None:
    oligo = _find_oligo(raw, op["oligoId"])
    seg = _find_segment(oligo, op["segmentId"])
    slot = _slot_at(seg, op["bpIndex"])
    slot["seq"] = op["insertion"]
    slot["skip"] = False
    comp = _complementary_segment(raw, seg, op["bpIndex"])
    if comp is not None:
        comp_slot = _slot_at(comp, op["bpIndex"])
        comp_slot["seq"] = "N" * len(op["insertion"])
        comp_slot["skip"] = False


def _h_add_skip_or_insertion(raw: dict, op: dict) -> None:
    """Port of ``OligoSegment.addSkipOrInsertion`` (the skip and insert tools): a skip
    empties both strands' slots; an insertion appends ``count`` Ns to both, keeping
    their bases. A slot the mirror hasn't stored yet is a plain ``N``."""
    _, seg = _find_segment_in_part(raw, op["segmentId"])
    bp = int(op["bpIndex"])
    count = int(op["count"])
    comp = _complementary_segment(raw, seg, bp)
    for target in (seg, comp):
        if target is None:
            continue
        slot = _find_slot(target, bp)
        if slot is None:
            slot = {"bpIndex": bp, "seq": "N"}
            target.setdefault("slots", []).append(slot)
        if count < 0:
            slot["seq"] = ""
            slot["skip"] = True
        else:
            slot["seq"] = (slot.get("seq") or "") + "N" * count
            slot["skip"] = False


def _h_create_segment(raw: dict, op: dict) -> None:
    new_oligo_id = op["newOligoId"]
    new_seg_id = op["newSegmentId"]
    five = int(op["fiveIndex"])
    three = int(op["threeIndex"])
    vh = _find_vh_by_id(raw, op["vhId"])
    vh_index = int(vh["index"])
    # Strand set is derived from endpoint ordering — same rule as
    # Part.createOligo on the JS side (Part.svelte.ts:880). Both sides
    # agree by construction.
    ss_idx = 0 if five < three else 1
    color = op.get("color", "#888888")

    # 1. New oligo holding one segment.
    new_segment = {
        "id": new_seg_id,
        "inVirtualHelixIndex": vh_index,
        "fivePrime": {
            "segmentId": new_seg_id,
            "isThreePrime": False,
            "index": five,
            "connectedSegmentId": None,
            "modification": None,
            "isConstrained": False,
        },
        "threePrime": {
            "segmentId": new_seg_id,
            "isThreePrime": True,
            "index": three,
            "connectedSegmentId": None,
            "modification": None,
            "isConstrained": False,
        },
        "sequence": "",
        "slots": [],
    }
    new_oligo = {
        "id": new_oligo_id,
        "color": color,
        "isScaffold": bool(op.get("isScaffold", False)),
        "isSequenceLocked": False,
        "name": op.get("name"),
        "segments": [new_segment],
    }
    raw.setdefault("oligos", []).append(new_oligo)

    # 2. Register the segment id on the right strand set of its VH.
    strand_sets = vh.setdefault("strandSets", [{"segmentIds": []}, {"segmentIds": []}])
    while len(strand_sets) <= ss_idx:
        strand_sets.append({"segmentIds": []})
    strand_sets[ss_idx].setdefault("segmentIds", []).append(new_seg_id)


def _strand_index_of(raw: dict, seg: dict) -> int:
    vh_index = int(seg["inVirtualHelixIndex"])
    for vh in raw.get("virtualHelices", []):
        if int(vh["index"]) != vh_index:
            continue
        for ss_idx, ss in enumerate(vh.get("strandSets", [])[:2]):
            if seg["id"] in ss.get("segmentIds", []):
                return ss_idx
    return 0 if int(seg["fivePrime"]["index"]) < int(seg["threePrime"]["index"]) else 1


def _is_adjacent(raw: dict, seg_a: dict, seg_b: dict) -> bool:
    """Port of ``SegmentEnd.isAdjacentTo`` for seg_a's 3' end and seg_b's 5' end."""
    if int(seg_a["inVirtualHelixIndex"]) != int(seg_b["inVirtualHelixIndex"]):
        return False
    if _strand_index_of(raw, seg_a) != _strand_index_of(raw, seg_b):
        return False
    return abs(int(seg_a["threePrime"]["index"]) - int(seg_b["fivePrime"]["index"])) == 1


def _h_connect(raw: dict, op: dict) -> None:
    """Connect seg_a's 3' end to seg_b's 5' end, as ``Part.connectSegmentEnds``.

    Adjacent ends (same VH and strand, 1 bp apart) merge: seg_a extends to seg_b's
    3' end, takes over its slots and its 3' connection, and seg_b is removed.
    Otherwise it's a crossover. If the segments were in different oligos, the
    segments downstream of the junction move into seg_a's oligo, which survives.
    """
    from_seg_id = op["fromSegmentId"]
    to_seg_id = op["toSegmentId"]
    oligo_a, seg_a = _find_segment_in_part(raw, from_seg_id)
    oligo_b, seg_b = _find_segment_in_part(raw, to_seg_id)

    if _is_adjacent(raw, seg_a, seg_b):
        next_id = seg_b["threePrime"].get("connectedSegmentId")
        seg_a["threePrime"]["index"] = int(seg_b["threePrime"]["index"])
        seg_a["threePrime"]["connectedSegmentId"] = next_id
        seg_a.setdefault("slots", []).extend(seg_b.get("slots", []))
        if next_id:
            _, nxt = _find_segment_in_part(raw, next_id)
            nxt["fivePrime"]["connectedSegmentId"] = from_seg_id
        oligo_b["segments"] = [s for s in oligo_b["segments"] if s["id"] != to_seg_id]
        for vh in raw.get("virtualHelices", []):
            for ss in vh.get("strandSets", []):
                if to_seg_id in ss.get("segmentIds", []):
                    ss["segmentIds"] = [sid for sid in ss["segmentIds"] if sid != to_seg_id]
    else:
        seg_a["threePrime"]["connectedSegmentId"] = to_seg_id
        seg_b["fivePrime"]["connectedSegmentId"] = from_seg_id

    if oligo_a is oligo_b:
        return  # circularised or already same oligo

    # Insert oligo_b's remaining segments after seg_a in oligo_a, drop oligo_b.
    a_segs = oligo_a["segments"]
    a_pos = next(i for i, s in enumerate(a_segs) if s["id"] == from_seg_id)
    a_segs[a_pos + 1 : a_pos + 1] = oligo_b["segments"]
    raw["oligos"].remove(oligo_b)


def _h_remove_segment(raw: dict, op: dict) -> None:
    """Port of ``Part.removeSegmentFromOligo``: break at the segment's 3' end, then at
    its 5' end, and remove the oligo left holding only the segment."""
    oligo = _find_oligo(raw, op["oligoId"])
    seg = _find_segment(oligo, op["segmentId"])
    _break_oligo_at(raw, oligo, seg, int(seg["threePrime"]["index"]), op.get("newOligoId"), None)
    owner, seg = _find_segment_in_part(raw, op["segmentId"])
    detached = _break_oligo_at(
        raw, owner, seg, int(seg["fivePrime"]["index"]), f"py-oligo-{uuid.uuid4()}", None
    )
    _h_remove_oligo(raw, {"oligoId": detached["id"]})


def _h_remove_oligo(raw: dict, op: dict) -> None:
    oligo = _find_oligo(raw, op["oligoId"])
    seg_ids = {s["id"] for s in oligo.get("segments", [])}
    raw["oligos"].remove(oligo)
    # Strip from VH strand sets.
    for vh in raw.get("virtualHelices", []):
        for ss in vh.get("strandSets", []):
            ids = ss.get("segmentIds", [])
            if any(sid in seg_ids for sid in ids):
                ss["segmentIds"] = [sid for sid in ids if sid not in seg_ids]


def _h_add_vh_at_coords(raw: dict, op: dict) -> None:
    region = _find_region(raw, op["regionId"])
    new_vh_id = op["newVhId"]
    new_vh_index = _next_vh_index(raw)
    length = int(op.get("length", region.get("defaultMaxBase", 42)))
    vh = {
        "id": new_vh_id,
        "index": new_vh_index,
        "regionId": region["id"],
        "listRow": len(raw.get("virtualHelices", [])),
        "latticeCoords": {"row": int(op["row"]), "col": int(op["col"])},
        "length": length,
        "strandSets": [{"segmentIds": []}, {"segmentIds": []}],
    }
    raw.setdefault("virtualHelices", []).append(vh)
    region.setdefault("vhOrder", []).append(new_vh_id)


def _h_set_vh_local_frame(raw: dict, op: dict) -> None:
    vh = _find_vh_by_id(raw, op["vhId"])
    vh["localFrame"] = op["localFrame"]
    # If the VH had latticeCoords, drop them — a freeform frame supersedes them.
    vh.pop("latticeCoords", None)


def _h_remove_vhs(raw: dict, op: dict) -> None:
    """Remove the listed VHs and re-split surviving oligos by connectivity.

    Mirrors :py:meth:`Part.removeVirtualHelicesByIndex` semantics: dropping a
    VH may break an oligo's chain in the middle, in which case the surviving
    pieces become independent oligos. We compute connected components over
    the surviving segments using ``fivePrime/threePrime.connectedSegmentId``
    and clone the host oligo's metadata into a new oligo per component.
    """
    removed_ids: set[str] = set(op["vhIds"])
    indices: set[int] = set()
    keep_vhs: list[dict] = []
    for vh in raw.get("virtualHelices", []):
        if vh.get("id") in removed_ids:
            indices.add(int(vh["index"]))
        else:
            keep_vhs.append(vh)
    raw["virtualHelices"] = keep_vhs

    # Strip from regions' vhOrder.
    for r in raw.get("regions", []):
        r["vhOrder"] = [vid for vid in r.get("vhOrder", []) if vid not in removed_ids]

    # Strip removed segment ids from any surviving VH strand sets.
    removed_seg_ids: set[str] = set()
    for o in raw.get("oligos", []):
        for s in o.get("segments", []):
            if int(s.get("inVirtualHelixIndex", -1)) in indices:
                removed_seg_ids.add(s["id"])
    for vh in raw["virtualHelices"]:
        for ss in vh.get("strandSets", []):
            ids = ss.get("segmentIds", [])
            if any(sid in removed_seg_ids for sid in ids):
                ss["segmentIds"] = [sid for sid in ids if sid not in removed_seg_ids]

    new_oligos: list[dict] = []
    for o in raw.get("oligos", []):
        live_segs = [
            s for s in o.get("segments", []) if int(s.get("inVirtualHelixIndex", -1)) not in indices
        ]
        if not live_segs:
            continue

        # Clear neighbour links that pointed into removed segments.
        live_ids = {s["id"] for s in live_segs}
        for s in live_segs:
            five = s.get("fivePrime", {})
            three = s.get("threePrime", {})
            if five.get("connectedSegmentId") not in live_ids:
                five["connectedSegmentId"] = None
            if three.get("connectedSegmentId") not in live_ids:
                three["connectedSegmentId"] = None

        # Connected-component split across live_segs (undirected walk over
        # 5' and 3' connections).
        by_id = {s["id"]: s for s in live_segs}
        unvisited = set(live_ids)
        components: list[list[dict]] = []
        while unvisited:
            seed_id = next(iter(unvisited))
            stack = [seed_id]
            comp: list[dict] = []
            while stack:
                sid = stack.pop()
                if sid not in unvisited:
                    continue
                unvisited.remove(sid)
                seg = by_id[sid]
                comp.append(seg)
                for neighbor in (
                    seg["fivePrime"].get("connectedSegmentId"),
                    seg["threePrime"].get("connectedSegmentId"),
                ):
                    if neighbor and neighbor in unvisited:
                        stack.append(neighbor)
            components.append(comp)

        if len(components) == 1:
            o["segments"] = components[0]
            new_oligos.append(o)
            continue

        # Split: first component keeps the original oligo metadata; the rest
        # become fresh oligos cloned from this one with new ids.
        first, *rest = components
        o["segments"] = first
        new_oligos.append(o)
        for comp in rest:
            split = {
                "id": f"py-oligo-{uuid.uuid4()}",
                "color": o.get("color", "#888888"),
                "isScaffold": bool(o.get("isScaffold", False)),
                "isSequenceLocked": False,
                "name": o.get("name"),
                "segments": comp,
            }
            new_oligos.append(split)

    raw["oligos"] = new_oligos


def _h_break_oligo(raw: dict, op: dict) -> None:
    oligo = _find_oligo(raw, op["oligoId"])
    seg = _find_segment(oligo, op["segmentId"])
    _break_oligo_at(raw, oligo, seg, int(op["atIndex"]), op["newOligoId"], op.get("newSegmentId"))


def _break_oligo_at(
    raw: dict,
    oligo: dict,
    seg: dict,
    index: int,
    new_oligo_id: str | None,
    new_segment_id: str | None,
) -> dict:
    """Port of ``Oligo.breakOligoAt``; returns the oligo holding the 3' side (``oligo``
    itself when nothing splits off).

    A break at the oligo's own free 5'/3' end, or one bp before a free 3' end, is a
    no-op. Breaking a circular oligo opens it without creating a second oligo.
    """
    segs = oligo["segments"]
    five_end = next((s for s in segs if s["fivePrime"].get("connectedSegmentId") is None), None)
    three_end = next((s for s in segs if s["threePrime"].get("connectedSegmentId") is None), None)
    circular = five_end is None and three_end is None
    five = int(seg["fivePrime"]["index"])
    three = int(seg["threePrime"]["index"])
    if (
        (seg is five_end and index == five)
        or (seg is three_end and index == three)
        or (abs(three - index) == 1 and seg["threePrime"].get("connectedSegmentId") is None)
    ):
        return oligo

    new_seg = _break_segment_at(raw, seg, index, new_segment_id)
    if new_seg is None:
        return oligo
    if circular:
        if all(s is not new_seg for s in segs):
            segs.append(new_seg)
        return oligo

    # The new oligo takes new_seg and everything downstream of it (addConnectedSegmentsFrom3Prime).
    by_id = {s["id"]: s for o in raw.get("oligos", []) for s in o.get("segments", [])}
    by_id[new_seg["id"]] = new_seg
    chain = [new_seg]
    cursor = new_seg["threePrime"].get("connectedSegmentId")
    while cursor and all(c["id"] != cursor for c in chain):
        chain.append(by_id[cursor])
        cursor = by_id[cursor]["threePrime"].get("connectedSegmentId")
    chain_ids = {c["id"] for c in chain}
    oligo["segments"] = [s for s in segs if s["id"] not in chain_ids]
    new_oligo: dict = {
        "id": new_oligo_id or f"py-oligo-{uuid.uuid4()}",
        "color": "#26bf40",
        "isScaffold": False,
        "isSequenceLocked": False,
        "name": "",
        "segments": chain,
    }
    raw.setdefault("oligos", []).append(new_oligo)
    return new_oligo


def _break_segment_at(raw: dict, seg: dict, index: int, new_segment_id: str | None) -> dict | None:
    """Port of ``OligoSegment.breakSegmentAt``: the segment that starts the 3' side, if any."""
    five = int(seg["fivePrime"]["index"])
    three = int(seg["threePrime"]["index"])
    if not min(five, three) <= index <= max(five, three):
        raise InvalidOperationError(f"Index {index} out of range for segment {seg['id']!r}")
    if index == three:
        next_id = seg["threePrime"].get("connectedSegmentId")
        if not next_id:
            return None
        seg["threePrime"]["connectedSegmentId"] = None
        _, nxt = _find_segment_in_part(raw, next_id)
        nxt["fivePrime"]["connectedSegmentId"] = None
        return nxt
    if index == five:
        prev_id = seg["fivePrime"].get("connectedSegmentId")
        if prev_id:
            seg["fivePrime"]["connectedSegmentId"] = None
            _, prev = _find_segment_in_part(raw, prev_id)
            prev["threePrime"]["connectedSegmentId"] = None
        return seg

    ascending = _strand_index_of(raw, seg) == 0
    if (index + 1 if ascending else index - 1) == three:
        # VirtualHelix.createNewSegment refuses a 1-nt segment.
        raise InvalidOperationError(f"Breaking at bp {index} would leave a 1-nt segment")
    new_id = new_segment_id or f"py-seg-{uuid.uuid4()}"
    next_id = seg["threePrime"].get("connectedSegmentId")
    new_seg: dict = {
        "id": new_id,
        "inVirtualHelixIndex": seg["inVirtualHelixIndex"],
        "fivePrime": {
            "segmentId": new_id,
            "isThreePrime": False,
            "index": index + 1 if ascending else index - 1,
            "connectedSegmentId": None,
            "modification": None,
            "isConstrained": False,
        },
        # Both new 3' ends are fresh on the host, so the old 3' modification is dropped.
        "threePrime": {
            "segmentId": new_id,
            "isThreePrime": True,
            "index": three,
            "connectedSegmentId": next_id,
            "modification": None,
            "isConstrained": False,
        },
        "sequence": "",
        "slots": [
            s for s in seg.get("slots", [])
            if (s.get("bpIndex", 0) > index if ascending else s.get("bpIndex", 0) < index)
        ],
    }
    seg["slots"] = [
        s for s in seg.get("slots", [])
        if (s.get("bpIndex", 0) <= index if ascending else s.get("bpIndex", 0) >= index)
    ]
    seg["threePrime"] = {
        "segmentId": seg["id"],
        "isThreePrime": True,
        "index": index,
        "connectedSegmentId": None,
        "modification": None,
        "isConstrained": False,
    }
    if next_id:
        _, nxt = _find_segment_in_part(raw, next_id)
        nxt["fivePrime"]["connectedSegmentId"] = new_id
    for vh in raw.get("virtualHelices", []):
        if int(vh.get("index", -1)) != int(seg["inVirtualHelixIndex"]):
            continue
        for ss in vh.get("strandSets", []):
            ids = ss.get("segmentIds", [])
            if seg["id"] in ids:
                ids.insert(ids.index(seg["id"]) + 1, new_id)
    return new_seg


def _h_move_terminus(raw: dict, op: dict) -> None:
    oligo, seg = _find_segment_in_part(raw, op["segmentId"])
    end_key = "fivePrime" if op["end"] == "5" else "threePrime"
    seg[end_key]["index"] = int(op["toIndex"])
    # The host re-derives slots for the new range; content outside it is gone.
    lo, hi = sorted((int(seg["fivePrime"]["index"]), int(seg["threePrime"]["index"])))
    kept: list[dict] = []
    for slot in seg.get("slots", []):
        bp = int(slot.get("bpIndex", lo))
        if lo <= bp <= hi:
            kept.append(slot)
            continue
        # A dropped skip/insertion also clears its complementary slot, as on the host.
        if len(slot.get("seq", "")) != 1 or slot.get("skip"):
            comp = _complementary_segment(raw, seg, bp)
            comp_slot = _find_slot(comp, bp) if comp is not None else None
            if comp_slot is not None:
                comp_slot["seq"] = (comp_slot.get("seq") or "N")[0]
                comp_slot["skip"] = False
    seg["slots"] = kept


def _h_set_vh_length(raw: dict, op: dict) -> None:
    vh = _find_vh_by_id(raw, op["vhId"])
    vh["length"] = int(op["length"])


def _h_set_region_max_base(raw: dict, op: dict) -> None:
    region = _find_region(raw, op["regionId"])
    new_max = int(op["newMaxBase"])
    old_max = region.get("maxBase")
    if old_max is None:
        old_max = region.get("defaultMaxBase", new_max)
    delta = new_max - int(old_max)
    region["maxBase"] = new_max
    region["defaultMaxBase"] = new_max
    # As DesignRegion.increaseVhsLengthBy: every VH in the region changes by the same delta.
    for vh in raw.get("virtualHelices", []):
        if vh.get("regionId") == region["id"]:
            vh["length"] = int(vh["length"]) + delta


def _h_move_lattice_vh(raw: dict, op: dict) -> None:
    vh = _find_vh_by_id(raw, op["vhId"])
    vh["latticeCoords"] = {"col": int(op["col"]), "row": int(op["row"])}


def _h_add_freeform_vh(raw: dict, op: dict) -> None:
    region = _find_region(raw, op["regionId"])
    new_vh_id = op["newVhId"]
    new_vh_index = _next_vh_index(raw)
    length = int(op.get("length") or region.get("maxBase") or region.get("defaultMaxBase", 42))
    origin = op["origin"]
    axis = op["axis"]
    radial0 = op["radial0"]
    vh: dict = {
        "id": new_vh_id,
        "index": new_vh_index,
        "regionId": region["id"],
        "listRow": len(raw.get("virtualHelices", [])),
        "localFrame": {
            "origin": {"x": float(origin[0]), "y": float(origin[1]), "z": float(origin[2])},
            "axis": {"x": float(axis[0]), "y": float(axis[1]), "z": float(axis[2])},
            "radial0": {"x": float(radial0[0]), "y": float(radial0[1]), "z": float(radial0[2])},
        },
        "length": length,
        "strandSets": [{"segmentIds": []}, {"segmentIds": []}],
    }
    raw.setdefault("virtualHelices", []).append(vh)
    region.setdefault("vhOrder", []).append(new_vh_id)


def _h_reorder_vh(raw: dict, op: dict) -> None:
    vh = _find_vh_by_id(raw, op["vhId"])
    region_id = vh.get("regionId")
    if not region_id:
        return
    region = _find_region(raw, region_id)
    vh_order = region.setdefault("vhOrder", [])
    vh_id = vh["id"]
    if vh_id not in vh_order:
        return
    target = int(op["targetRegionRow"])
    vh_order.remove(vh_id)
    clamped = max(0, min(len(vh_order), target))
    vh_order.insert(clamped, vh_id)


def _h_transform_plane(raw: dict, op: dict) -> None:
    for p in raw.get("planes", []):
        if p["id"] == op["planeId"]:
            p["origin"] = dict(op["origin"])
            p["u"] = dict(op["u"])
            p["v"] = dict(op["v"])
            p["normal"] = dict(op["normal"])
            return
    raise KeyError(f"No plane with id {op['planeId']!r}")


def _h_add_region_and_plane(raw: dict, op: dict) -> None:
    new_plane: dict = {
        "id": op["planeId"],
        "name": op["planeName"],
        "origin": dict(op["planeOrigin"]),
        "u": dict(op["planeU"]),
        "v": dict(op["planeV"]),
        "normal": dict(op["planeNormal"]),
    }
    raw.setdefault("planes", []).append(new_plane)
    new_region: dict = {
        "id": op["regionId"],
        "name": op["regionName"],
        "kind": op["regionKind"],
        "planeId": op["planeId"],
        "vhOrder": [],
        "step": int(op["regionStep"]),
        "turnsPerStep": int(op["regionTurnsPerStep"]),
        "subStepSize": int(op["regionSubStepSize"]),
        "twistOffset": float(op["regionTwistOffset"]),
        "minBase": int(op["regionMinBase"]),
        "maxBase": int(op["regionMaxBase"]),
        "defaultMaxBase": int(op["regionMaxBase"]),
    }
    raw.setdefault("regions", []).append(new_region)


def _h_split_region(raw: dict, op: dict) -> None:
    import copy as _copy

    region = _find_region(raw, op["regionId"])
    vh_order = list(region.get("vhOrder", []))
    split_after_id = op["splitAfterVhId"]
    try:
        split_idx = vh_order.index(split_after_id)
    except ValueError:
        raise KeyError(f"split_region: VH {split_after_id!r} not in region {op['regionId']!r}")
    top_ids = vh_order[: split_idx + 1]
    bottom_ids = vh_order[split_idx + 1 :]

    # Clone the existing plane for the new region
    existing_plane: dict | None = None
    for p in raw.get("planes", []):
        if p["id"] == region.get("planeId"):
            existing_plane = p
            break
    new_plane = _copy.deepcopy(existing_plane) if existing_plane else {}
    new_plane["id"] = op["newPlaneId"]
    raw.setdefault("planes", []).append(new_plane)

    # Clone the region for the bottom half
    new_region = _copy.deepcopy(region)
    new_region["id"] = op["newRegionId"]
    new_region["planeId"] = op["newPlaneId"]
    new_region["vhOrder"] = bottom_ids

    # Update existing region
    region["vhOrder"] = top_ids

    # Update VH regionId for bottom VHs
    bottom_ids_set = set(bottom_ids)
    for vh in raw.get("virtualHelices", []):
        if vh.get("id") in bottom_ids_set:
            vh["regionId"] = op["newRegionId"]

    # Insert new region after the original in the regions list
    regions = raw.setdefault("regions", [])
    orig_idx = next(i for i, r in enumerate(regions) if r["id"] == op["regionId"])
    regions.insert(orig_idx + 1, new_region)


_HandlersT = dict[str, Callable[[dict, dict], None]]
_HANDLERS: _HandlersT = {
    M.OP_SET_OLIGO_COLOR: _h_set_oligo_color,
    M.OP_SET_OLIGO_NAME: _h_set_oligo_name,
    M.OP_SET_OLIGO_IS_SCAFFOLD: _h_set_oligo_is_scaffold,
    M.OP_SET_SEGMENT_MODIFICATION: _h_set_segment_modification,
    M.OP_SET_SLOT_SEQUENCE: _h_set_slot_sequence,
    M.OP_SET_SLOT_SKIP: _h_set_slot_skip,
    M.OP_SET_SLOT_INSERTION: _h_set_slot_insertion,
    M.OP_ADD_SKIP_OR_INSERTION: _h_add_skip_or_insertion,
    M.OP_CREATE_SEGMENT: _h_create_segment,
    M.OP_CONNECT: _h_connect,
    M.OP_REMOVE_SEGMENT: _h_remove_segment,
    M.OP_REMOVE_OLIGO: _h_remove_oligo,
    M.OP_ADD_VH_AT_COORDS: _h_add_vh_at_coords,
    M.OP_SET_VH_LOCAL_FRAME: _h_set_vh_local_frame,
    M.OP_REMOVE_VHS: _h_remove_vhs,
    M.OP_BREAK_OLIGO: _h_break_oligo,
    M.OP_MOVE_TERMINUS: _h_move_terminus,
    M.OP_SET_VH_LENGTH: _h_set_vh_length,
    M.OP_SET_REGION_MAX_BASE: _h_set_region_max_base,
    M.OP_MOVE_LATTICE_VH: _h_move_lattice_vh,
    M.OP_ADD_FREEFORM_VH: _h_add_freeform_vh,
    M.OP_REORDER_VH: _h_reorder_vh,
    M.OP_TRANSFORM_PLANE: _h_transform_plane,
    M.OP_ADD_REGION_AND_PLANE: _h_add_region_and_plane,
    M.OP_SPLIT_REGION: _h_split_region,
}
