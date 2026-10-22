"""
foldnano_mini.repeat — repeat groups and their mirror oligos, over the mirror dict.

Port of the host's ``src/lib/model/Part/repeatGroups.ts`` and
``Part.canDuplicateOligosBy`` / ``Part.duplicateOligos``. A repeat group's originals
(``oligo["repeatGroupId"]``) are copied at each instance's ``bpOffset`` as mirror
oligos (``oligo["mirrorOf"]``), which are regenerated, never edited.

:func:`apply_op` is the single entry point every op goes through (the offline
transport, composite edits on a scratch copy, and log replay), so Python rebuilds
mirrors after the same ops the host does:

- an edit to a mirror (or to a strand opposite one) raises ``MIRROR_EDIT_ERROR``;
- colour / name / scaffold / modification / sequence writes on an original are copied
  onto its mirrors in place (the host rebuilds them; the result is the same);
- any other op touching a group, and every group op, runs on a working copy followed by
  a full sync, and is committed only if the mirrors could be rebuilt.

``mirrorOf["structure"]`` holds Python's own fingerprint: :func:`normalize` rewrites the
host's at load, so the mirror-edit test only ever compares Python with Python.
"""

from __future__ import annotations

import copy
import uuid
from typing import Any, Callable, Iterable

from . import lattice, mutations as M
from .checks import InvalidOperationError
from .topology import TopologyIndex, slot_kind, slot_length

MIRROR_EDIT_ERROR = "Mirror oligos can't be edited. Edit the original instead."

GROUP_OPS = frozenset(
    {
        M.OP_CREATE_REPEAT_GROUP,
        M.OP_ADD_REPEAT_INSTANCE,
        M.OP_REMOVE_REPEAT_INSTANCE,
        M.OP_DETACH_REPEAT_GROUP,
        M.OP_DELETE_REPEAT_GROUP,
    }
)

# Ops that change an oligo's attributes or bases, never positions: a mirror can't fail to
# follow them, so they are copied over directly instead of rebuilding.
ATTRIBUTE_OPS = frozenset(
    {
        M.OP_SET_OLIGO_COLOR,
        M.OP_SET_OLIGO_NAME,
        M.OP_SET_OLIGO_IS_SCAFFOLD,
        M.OP_SET_SEGMENT_MODIFICATION,
        M.OP_SET_SLOT_SEQUENCE,
    }
)

_SLOT_OPS = frozenset({M.OP_SET_SLOT_SKIP, M.OP_SET_SLOT_INSERTION, M.OP_ADD_SKIP_OR_INSERTION})


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def has_repeats(raw: dict[str, Any]) -> bool:
    return bool(raw.get("repeatGroups"))


def find_group(raw: dict[str, Any], group_id: str) -> dict[str, Any] | None:
    return next((g for g in raw.get("repeatGroups", []) if g["id"] == group_id), None)


def find_instance(group: dict[str, Any] | None, instance_id: str) -> dict[str, Any] | None:
    if group is None:
        return None
    return next((i for i in group.get("instances", []) if i["id"] == instance_id), None)


def is_mirror(oligo: dict[str, Any]) -> bool:
    return bool(oligo.get("mirrorOf"))


def mirrored_skip_insert_seq(current: str, length: int) -> str:
    """Port of ``mirroredSkipInsertSeq``: a complementary slot resized to ``length``."""
    return "" if length == 0 else (current[:1] or "N") + "N" * (length - 1)


def _strand_of(raw: dict[str, Any]) -> dict[str, int]:
    out: dict[str, int] = {}
    for vh in raw.get("virtualHelices", []):
        for ss_idx, ss in enumerate(vh.get("strandSets", [])[:2]):
            for seg_id in ss.get("segmentIds", []):
                out[seg_id] = ss_idx
    return out


def _segment_strand(seg: dict[str, Any], strand_of: dict[str, int]) -> int:
    found = strand_of.get(seg["id"])
    if found is not None:
        return found
    return 0 if int(seg["fivePrime"]["index"]) < int(seg["threePrime"]["index"]) else 1


def _region_max_base(region: dict[str, Any]) -> int:
    max_base = region.get("maxBase")
    if max_base is None:
        max_base = region.get("defaultMaxBase", 0)
    return int(max_base)


def _new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4()}"


# ---------------------------------------------------------------------------
# Fingerprints
# ---------------------------------------------------------------------------


def _ordered_segments(oligo: dict[str, Any]) -> list[dict[str, Any]]:
    """Segments 5'→3'; a circular oligo starts at its lowest (VH, bp) segment, which is
    shift-invariant, so an oligo and its shifted mirror order identically."""
    segs = oligo.get("segments", [])
    by_id = {s["id"]: s for s in segs}
    ordered_all = sorted(
        segs,
        key=lambda s: (
            int(s["inVirtualHelixIndex"]),
            min(int(s["fivePrime"]["index"]), int(s["threePrime"]["index"])),
        ),
    )
    start = next((s for s in segs if s["fivePrime"].get("connectedSegmentId") not in by_id), None)
    if start is None and ordered_all:
        start = ordered_all[0]
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    cur = start
    while cur is not None and cur["id"] not in seen:
        out.append(cur)
        seen.add(cur["id"])
        cur = by_id.get(cur["threePrime"].get("connectedSegmentId") or "")
    out.extend(s for s in ordered_all if s["id"] not in seen)
    return out


def _slot_values(seg: dict[str, Any], shift: int, with_sequence: bool) -> str:
    """Stored slots that differ from a plain unassigned base, by shifted bp. A missing slot
    is a plain ``N``, so sparse (Python-made) and dense (host) slot lists compare equal."""
    out: list[str] = []
    for slot in sorted(seg.get("slots", []), key=lambda s: int(s["bpIndex"])):
        bp = int(slot["bpIndex"])
        if with_sequence:
            value = "" if slot_kind(seg, bp) == "skip" else (slot.get("seq") or "N")
            if value != "N":
                out.append(f"{bp - shift}={value}")
        else:
            length = slot_length(seg, bp)
            if length != 1:
                out.append(f"{bp - shift}#{length}")
    return ",".join(out)


def fingerprint(
    oligo: dict[str, Any], strand_of: dict[str, int], shift: int = 0, with_sequence: bool = True
) -> str:
    """Port of ``oligoFingerprint``: everything that defines an oligo's content, with bp
    positions shifted back by ``shift``, so a mirror at ``shift`` matches its source.
    Without ``with_sequence``, assigned bases are ignored (skip/insert lengths still count)."""
    head = f"{'S' if oligo.get('isScaffold') else 's'}|{oligo.get('color')}|{oligo.get('name') or ''}"
    parts = [head]
    for seg in _ordered_segments(oligo):
        five, three = seg["fivePrime"], seg["threePrime"]
        parts.append(
            f"{seg['inVirtualHelixIndex']}/{_segment_strand(seg, strand_of)}:"
            f"{int(five['index']) - shift}>{int(three['index']) - shift}"
            f"[{_slot_values(seg, shift, with_sequence)}]"
            f"{five.get('modification') or ''}/{three.get('modification') or ''}"
            f"{'~' if three.get('connectedSegmentId') else ''}"
        )
    return ";".join(parts)


def structure(oligo: dict[str, Any], strand_of: dict[str, int], shift: int = 0) -> str:
    return fingerprint(oligo, strand_of, shift, with_sequence=False)


def normalize(raw: dict[str, Any]) -> None:
    """Rewrite each mirror's ``structure`` tag as Python's fingerprint of the mirror itself
    (shifted back), so later comparisons never mix host and Python fingerprints. The host
    keeps mirrors in sync, so this equals the source's structure at generation."""
    if not raw.get("oligos"):
        return
    strand_of = None
    for oligo in raw["oligos"]:
        tag = oligo.get("mirrorOf")
        if not tag:
            continue
        instance = find_instance(find_group(raw, tag.get("groupId", "")), tag.get("instanceId", ""))
        if instance is None:
            continue
        if strand_of is None:
            strand_of = _strand_of(raw)
        oligo["mirrorOf"] = {**tag, "structure": structure(oligo, strand_of, int(instance["bpOffset"]))}


# ---------------------------------------------------------------------------
# Duplicate (Part.canDuplicateOligosBy / Part.duplicateOligos)
# ---------------------------------------------------------------------------


def _segments_of(oligos: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for oligo in oligos:
        for seg in oligo.get("segments", []):
            if seg["id"] not in seen:
                seen.add(seg["id"])
                out.append(seg)
    return out


def _has_matching_xover_site(
    raw: dict[str, Any], topo: TopologyIndex, seg_id: str, is_three_prime: bool, new_index: int
) -> bool:
    """Port of ``Part.hasMatchingXoverSiteAt``: sites are only computed up to the VH's
    length, so positions past it are checked whole ``step``s back (sites are periodic)."""
    info = topo.segment(seg_id)
    raw_seg = topo.raw_segment(seg_id)
    if info is None or raw_seg is None:
        return False
    partner_id = raw_seg["threePrime" if is_three_prime else "fivePrime"].get("connectedSegmentId")
    partner = topo.segment(partner_id) if partner_id else None
    if partner is None:
        return False
    vh = topo.vh(info.vh_index)
    if vh is None:
        return False
    sites = topo.potential_xover_sites(info.vh_index)[info.strand_index]
    current = info.three if is_three_prime else info.five
    current_right = next((s.right for s in sites if s.bp_index == current), None)
    length = int(vh["length"])
    _, step = lattice.region_kind_and_step(raw, vh)
    idx = new_index if new_index < length else new_index - -(-(new_index - length + 1) // step) * step
    return any(
        s.bp_index == idx and s.to_vh_index == partner.vh_index and s.right == current_right
        for s in sites
    )


def _is_mirror_segment(raw: dict[str, Any], topo: TopologyIndex, seg_id: str) -> bool:
    info = topo.segment(seg_id)
    return info is not None and any(
        o["id"] == info.oligo_id and o.get("mirrorOf") for o in raw.get("oligos", [])
    )


def check_duplicate(raw: dict[str, Any], oligos: list[dict[str, Any]], delta: int) -> str | None:
    """Port of ``Part.canDuplicateOligosBy``; returns the refusal reason, or ``None``.

    Copies may run past a region's end (:func:`duplicate` grows it) but must not overlap an
    existing strand, must keep every constrained crossover on a matching lattice site, and
    must keep the skip/insert pairing with whatever strand ends up complementary.
    """
    if delta == 0:
        return "The copy would sit on top of the original."
    copied = _segments_of(oligos)
    if not copied:
        return "Nothing to duplicate."
    topo = TopologyIndex(raw)

    copy_slot_len: dict[tuple[int, int, int], int] = {}
    for seg in copied:
        info = topo.segment(seg["id"])
        for bp in range(info.low, info.high + 1):
            copy_slot_len[(info.vh_index, info.strand_index, bp + delta)] = slot_length(seg, bp)

    for seg in copied:
        info = topo.segment(seg["id"])
        vh_raw = topo.vh(info.vh_index)
        lo, hi = info.low + delta, info.high + delta
        region = lattice.region_for_vh(raw, vh_raw) if vh_raw is not None else None
        min_base = int(region.get("minBase", 0)) if region is not None else 0
        if lo < min_base:
            return f"The copy on VH {info.vh_index} would start before bp {min_base}."
        if topo.segments_overlapping(info.vh_index, info.strand_index, lo, hi):
            return f"The copy would overlap an existing strand on VH {info.vh_index} (bp {lo}–{hi})."
        for is_three in (False, True):
            end_bp = info.three if is_three else info.five
            if topo.is_end_constrained(seg["id"], is_three) and not _has_matching_xover_site(
                raw, topo, seg["id"], is_three, end_bp + delta
            ):
                return (
                    f"VH {info.vh_index} has no matching crossover site at bp {end_bp + delta} "
                    f"for the crossover at bp {end_bp}."
                )

        comp_strand = 1 - info.strand_index
        for bp in range(info.low, info.high + 1):
            new_bp = bp + delta
            length = slot_length(seg, bp)
            copy_len = copy_slot_len.get((info.vh_index, comp_strand, new_bp))
            if copy_len is not None:
                if copy_len != length:
                    return (
                        f"Copies on VH {info.vh_index} would pair a skip or insertion with a "
                        f"mismatched strand at bp {new_bp}."
                    )
                continue
            target_id = topo.segment_at(info.vh_index, comp_strand, new_bp)
            target_len = slot_length(topo.raw_segment(target_id), new_bp) if target_id else None
            # A kept mirror of a sibling original already carries the matching skip/insertion.
            paired_mirror = (
                target_len == length and target_len != 1 and _is_mirror_segment(raw, topo, target_id)
            )
            if target_len is not None and target_len != 1 and not paired_mirror:
                return (
                    f"The copy on VH {info.vh_index} would land opposite a skip or insertion "
                    f"at bp {new_bp}."
                )
            if length != 1 and target_id is None:
                return (
                    f"A skip or insertion on VH {info.vh_index} at bp {bp} needs a "
                    f"complementary strand at bp {new_bp}."
                )
    return None


def _clone(
    oligo: dict[str, Any], delta: int, strand_of: dict[str, int], suffix: str | None
) -> tuple[dict[str, Any], list[tuple[dict[str, Any], int]]]:
    """Port of ``cloneOligoJsonWithOffset``: a deep copy with fresh ids, shifted by ``delta``,
    without repeat-group membership. Also returns each new segment with its strand index.

    With ``suffix`` (a mirror's instance id) the ids are ``<source id>@<suffix>``: the same on
    every rebuild and every replay of the log, so proxies and ``replay_log_into_fresh_mirror``
    stay stable. The host gives its mirrors fresh ids; nothing in a log refers to them."""

    def new_id(prefix: str, source_id: str) -> str:
        return f"{source_id}@{suffix}" if suffix is not None else _new_id(prefix)

    seg_map = {s["id"]: new_id("py-seg-", s["id"]) for s in oligo.get("segments", [])}

    def remap(seg_id: str | None) -> str | None:
        if seg_id is None:
            return None
        if seg_id not in seg_map:
            raise InvalidOperationError(f"Segment {seg_id} is connected outside the copied oligo")
        return seg_map[seg_id]

    out = {
        k: copy.deepcopy(v)
        for k, v in oligo.items()
        if k not in ("id", "segments", "repeatGroupId", "mirrorOf")
    }
    out["id"] = new_id("py-oligo-", oligo["id"])
    segments: list[dict[str, Any]] = []
    placed: list[tuple[dict[str, Any], int]] = []
    for seg in oligo.get("segments", []):
        new_id = seg_map[seg["id"]]
        new_seg = copy.deepcopy(seg)
        new_seg["id"] = new_id
        for key in ("fivePrime", "threePrime"):
            end = seg[key]
            new_seg[key] = {
                **copy.deepcopy(end),
                "segmentId": new_id,
                "index": int(end["index"]) + delta,
                "connectedSegmentId": remap(end.get("connectedSegmentId")),
            }
        new_seg["slots"] = [{**slot, "bpIndex": int(slot["bpIndex"]) + delta} for slot in seg.get("slots", [])]
        segments.append(new_seg)
        placed.append((new_seg, _segment_strand(seg, strand_of)))
    out["segments"] = segments
    return out, placed


def duplicate(
    raw: dict[str, Any], oligos: list[dict[str, Any]], delta: int, id_suffix: str | None = None
) -> list[dict[str, Any]]:
    """Port of ``Part.duplicateOligos``: adds copies of these whole oligos ``delta`` bp along
    the same VHs, growing any region they run past, and mirrors copied skips/insertions onto
    existing complementary strands. Returns the new oligo dicts (already in ``raw``)."""
    reason = check_duplicate(raw, oligos, delta)
    if reason is not None:
        raise InvalidOperationError(reason)
    topo = TopologyIndex(raw)
    strand_of = _strand_of(raw)

    # Resolve existing complementary slots before any copy exists to shadow the lookup.
    complement_syncs: list[tuple[str, int, int]] = []
    needed_max: dict[str, tuple[dict[str, Any], int]] = {}
    for seg in _segments_of(oligos):
        info = topo.segment(seg["id"])
        vh_raw = topo.vh(info.vh_index)
        region = lattice.region_for_vh(raw, vh_raw) if vh_raw is not None else None
        if region is not None:
            prev = needed_max.get(region["id"], (region, 0))[1]
            needed_max[region["id"]] = (region, max(prev, info.high + delta + 1))
        for slot in seg.get("slots", []):
            bp = int(slot["bpIndex"])
            length = slot_length(seg, bp)
            if length == 1:
                continue
            target_id = topo.segment_at(info.vh_index, 1 - info.strand_index, bp + delta)
            if target_id is None:
                continue
            if slot_length(topo.raw_segment(target_id), bp + delta) == length and _is_mirror_segment(
                raw, topo, target_id
            ):
                continue
            complement_syncs.append((target_id, bp + delta, length))

    for region, needed in needed_max.values():
        max_base = _region_max_base(region)
        if needed <= max_base:
            continue
        step = int(region.get("step") or 21)
        grow = -(-(needed - max_base) // step) * step
        region["maxBase"] = max_base + grow
        for vh in raw.get("virtualHelices", []):
            if vh.get("regionId") == region["id"]:
                vh["length"] = int(vh["length"]) + grow

    copies: list[dict[str, Any]] = []
    vhs = {int(vh["index"]): vh for vh in raw.get("virtualHelices", [])}
    for oligo in oligos:
        clone, placed = _clone(oligo, delta, strand_of, id_suffix)
        raw.setdefault("oligos", []).append(clone)
        for new_seg, strand in placed:
            vh = vhs[int(new_seg["inVirtualHelixIndex"])]
            strand_sets = vh.setdefault("strandSets", [{"segmentIds": []}, {"segmentIds": []}])
            while len(strand_sets) <= strand:
                strand_sets.append({"segmentIds": []})
            strand_sets[strand].setdefault("segmentIds", []).append(new_seg["id"])
        copies.append(clone)

    by_id = {s["id"]: s for o in raw["oligos"] for s in o.get("segments", [])}
    for target_id, bp, length in complement_syncs:
        target = by_id[target_id]
        current = next((s for s in target.get("slots", []) if int(s["bpIndex"]) == bp), None)
        seq = "N" if current is None else ("" if slot_kind(target, bp) == "skip" else current.get("seq") or "N")
        new_slot = {"bpIndex": bp, "seq": mirrored_skip_insert_seq(seq, length), "skip": length == 0}
        target["slots"] = [s for s in target.get("slots", []) if int(s["bpIndex"]) != bp] + [new_slot]
    return copies


# ---------------------------------------------------------------------------
# Sync (syncRepeatGroups)
# ---------------------------------------------------------------------------


def _remove_oligos(raw: dict[str, Any], doomed: list[dict[str, Any]]) -> None:
    if not doomed:
        return
    doomed_ids = {id(o) for o in doomed}
    seg_ids = {s["id"] for o in doomed for s in o.get("segments", [])}
    raw["oligos"] = [o for o in raw["oligos"] if id(o) not in doomed_ids]
    for vh in raw.get("virtualHelices", []):
        for ss in vh.get("strandSets", []):
            ids = ss.get("segmentIds", [])
            if any(sid in seg_ids for sid in ids):
                ss["segmentIds"] = [sid for sid in ids if sid not in seg_ids]


def sync(raw: dict[str, Any]) -> bool:
    """Port of ``syncRepeatGroups``: bring every mirror in line with its source. Raises
    :class:`InvalidOperationError` if a mirror was edited directly or a rebuilt copy can't
    be placed. Returns whether anything changed."""
    groups = {g["id"]: g for g in raw.get("repeatGroups", [])}
    sources: dict[str, dict[str, Any]] = {}
    mirrors: list[dict[str, Any]] = []
    changed = False
    for oligo in raw.get("oligos", []):
        if oligo.get("mirrorOf"):
            mirrors.append(oligo)
        elif oligo.get("repeatGroupId"):
            if oligo["repeatGroupId"] in groups:
                sources[oligo["id"]] = oligo
            else:
                oligo.pop("repeatGroupId", None)
                changed = True
    if not groups and not mirrors:
        return changed

    strand_of = _strand_of(raw)
    source_structure: dict[str, str] = {}

    def structure_of_source(src: dict[str, Any]) -> str:
        if src["id"] not in source_structure:
            source_structure[src["id"]] = structure(src, strand_of)
        return source_structure[src["id"]]

    up_to_date: set[tuple[str, str]] = set()
    doomed: list[dict[str, Any]] = []
    for mirror in mirrors:
        tag = mirror["mirrorOf"]
        instance = find_instance(groups.get(tag["groupId"]), tag["instanceId"])
        source = sources.get(tag["sourceOligoId"])
        key = (tag["sourceOligoId"], tag["instanceId"])
        if (
            instance is None
            or source is None
            or source.get("repeatGroupId") != tag["groupId"]
            or key in up_to_date
        ):
            doomed.append(mirror)
            continue
        offset = int(instance["bpOffset"])
        mirror_edited = structure(mirror, strand_of, offset) != tag.get("structure")
        source_changed = structure_of_source(source) != tag.get("structure")
        if mirror_edited and not source_changed:
            raise InvalidOperationError(MIRROR_EDIT_ERROR)
        if (
            not mirror_edited
            and not source_changed
            and fingerprint(mirror, strand_of, offset) == fingerprint(source, strand_of)
        ):
            up_to_date.add(key)
            continue
        doomed.append(mirror)
    if doomed:
        _remove_oligos(raw, doomed)
        changed = True

    # Instances are rebuilt in order so each validates against copies placed before it.
    for group in raw.get("repeatGroups", []):
        group_sources = [s for s in sources.values() if s.get("repeatGroupId") == group["id"]]
        for idx, instance in enumerate(group.get("instances", [])):
            stale = [s for s in group_sources if (s["id"], instance["id"]) not in up_to_date]
            if not stale:
                continue
            reason = check_duplicate(raw, stale, int(instance["bpOffset"]))
            if reason is not None:
                raise InvalidOperationError(f"Copy {idx + 1} of {group['name']}: {reason}")
            copies = duplicate(raw, stale, int(instance["bpOffset"]), instance["id"])
            for clone, src in zip(copies, stale):
                clone["mirrorOf"] = {
                    "groupId": group["id"],
                    "instanceId": instance["id"],
                    "sourceOligoId": src["id"],
                    "structure": structure_of_source(src),
                }
            changed = True
    return changed


# ---------------------------------------------------------------------------
# Copying attribute writes onto mirrors
# ---------------------------------------------------------------------------


def _mirrors_of(raw: dict[str, Any], source_id: str) -> list[tuple[dict[str, Any], int]]:
    out: list[tuple[dict[str, Any], int]] = []
    for oligo in raw.get("oligos", []):
        tag = oligo.get("mirrorOf")
        if not tag or tag.get("sourceOligoId") != source_id:
            continue
        instance = find_instance(find_group(raw, tag["groupId"]), tag["instanceId"])
        if instance is not None:
            out.append((oligo, int(instance["bpOffset"])))
    return out


def _mirror_segment(mirror: dict[str, Any], src_seg: dict[str, Any], offset: int) -> dict[str, Any] | None:
    vh = int(src_seg["inVirtualHelixIndex"])
    five = int(src_seg["fivePrime"]["index"]) + offset
    return next(
        (
            s
            for s in mirror.get("segments", [])
            if int(s["inVirtualHelixIndex"]) == vh and int(s["fivePrime"]["index"]) == five
        ),
        None,
    )


def _propagate(raw: dict[str, Any], op: dict[str, Any], source: dict[str, Any]) -> None:
    """What a rebuild would produce after an attribute write on ``source``, done in place."""
    kind = op["op"]
    mirrors = _mirrors_of(raw, source["id"])
    if not mirrors:
        return
    strand_of = _strand_of(raw) if kind != M.OP_SET_SLOT_SEQUENCE else {}
    src_seg = None
    if "segmentId" in op:
        src_seg = next((s for s in source.get("segments", []) if s["id"] == op["segmentId"]), None)
    for mirror, offset in mirrors:
        if kind == M.OP_SET_OLIGO_COLOR:
            mirror["color"] = op["color"]
        elif kind == M.OP_SET_OLIGO_NAME:
            mirror["name"] = op["name"]
        elif kind == M.OP_SET_OLIGO_IS_SCAFFOLD:
            mirror["isScaffold"] = bool(op["isScaffold"])
        elif src_seg is not None:
            seg = _mirror_segment(mirror, src_seg, offset)
            if seg is None:
                continue
            if kind == M.OP_SET_SEGMENT_MODIFICATION:
                key = "fivePrime" if op["end"] == "5" else "threePrime"
                seg[key] = {**seg[key], "modification": op["modification"]}
            else:
                bp = int(op["bpIndex"]) + offset
                kept = [s for s in seg.get("slots", []) if int(s["bpIndex"]) != bp]
                seg["slots"] = kept + [{"bpIndex": bp, "seq": op["seq"]}]
        if kind != M.OP_SET_SLOT_SEQUENCE:
            mirror["mirrorOf"] = {**mirror["mirrorOf"], "structure": structure(source, strand_of)}


# ---------------------------------------------------------------------------
# Which oligos an op touches
# ---------------------------------------------------------------------------


def _owner_index(raw: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    by_oligo = {o["id"]: o for o in raw.get("oligos", [])}
    by_segment = {s["id"]: o for o in raw.get("oligos", []) for s in o.get("segments", [])}
    return by_oligo, by_segment


def touched_oligos(raw: dict[str, Any], op: dict[str, Any]) -> list[dict[str, Any]]:
    """The oligos an op may change, before it runs: the ones it names, plus the strand
    opposite a slot edit (both strands' slots change) and every oligo on removed VHs."""
    kind = op["op"]
    by_oligo, by_segment = _owner_index(raw)
    out: dict[int, dict[str, Any]] = {}

    def add(oligo: dict[str, Any] | None) -> None:
        if oligo is not None:
            out[id(oligo)] = oligo

    if kind in GROUP_OPS or kind == M.OP_CREATE_SEGMENT:
        return []
    if kind == M.OP_REMOVE_VHS:
        removed = {int(vh["index"]) for vh in raw.get("virtualHelices", []) if vh.get("id") in set(op["vhIds"])}
        for oligo in raw.get("oligos", []):
            if any(int(s["inVirtualHelixIndex"]) in removed for s in oligo.get("segments", [])):
                add(oligo)
        return list(out.values())
    add(by_oligo.get(op.get("oligoId", "")))
    for key in ("segmentId", "fromSegmentId", "toSegmentId"):
        add(by_segment.get(op.get(key) or ""))

    seg_id = op.get("segmentId")
    if seg_id and (kind in _SLOT_OPS or kind == M.OP_MOVE_TERMINUS):
        topo = TopologyIndex(raw)
        info = topo.segment(seg_id)
        if info is not None:
            if kind == M.OP_MOVE_TERMINUS:
                lo = min(info.low, int(op["toIndex"]))
                hi = max(info.high, int(op["toIndex"]))
            else:
                lo = hi = int(op["bpIndex"])
            for comp_id in topo.segments_overlapping(info.vh_index, 1 - info.strand_index, lo, hi):
                add(by_segment.get(comp_id))
    return list(out.values())


def connect_conflict(from_oligo: dict[str, Any], to_oligo: dict[str, Any]) -> str | None:
    """The host's join rules (``Part.connectSegmentEnds`` / ``connectTwoOligos``)."""
    if is_mirror(from_oligo) or is_mirror(to_oligo):
        return MIRROR_EDIT_ERROR
    a, b = from_oligo.get("repeatGroupId"), to_oligo.get("repeatGroupId")
    if a and b and a != b:
        return "Can't join oligos from two different repeat groups."
    return None


# ---------------------------------------------------------------------------
# Group op handlers (createRepeatGroup / addRepeatInstance / ...)
# ---------------------------------------------------------------------------


def next_group_name(raw: dict[str, Any]) -> str:
    used = {g.get("name") for g in raw.get("repeatGroups", [])}
    n = 1
    while f"Repeat {n}" in used:
        n += 1
    return f"Repeat {n}"


def _require_group(raw: dict[str, Any], group_id: str) -> dict[str, Any]:
    group = find_group(raw, group_id)
    if group is None:
        raise InvalidOperationError("Repeat group not found.")
    return group


def _drop_group(raw: dict[str, Any], group_id: str) -> None:
    raw["repeatGroups"] = [g for g in raw.get("repeatGroups", []) if g["id"] != group_id]
    if not raw["repeatGroups"]:
        del raw["repeatGroups"]


def _h_create_repeat_group(raw: dict[str, Any], op: dict[str, Any]) -> None:
    by_id = {o["id"]: o for o in raw.get("oligos", [])}
    oligos = [by_id.get(oid) for oid in op["oligoIds"]]
    if not oligos:
        raise InvalidOperationError("Select oligos to mirror.")
    if any(o is None for o in oligos):
        missing = next(oid for oid, o in zip(op["oligoIds"], oligos) if o is None)
        raise InvalidOperationError(f"No oligo with id {missing!r}")
    if any(is_mirror(o) for o in oligos):
        raise InvalidOperationError("Mirrors can only be made from original oligos.")
    if any(o.get("repeatGroupId") for o in oligos):
        raise InvalidOperationError("Some selected oligos already belong to a repeat group.")
    if find_group(raw, op["groupId"]) is not None:
        raise InvalidOperationError(f"Repeat group id {op['groupId']!r} already exists")
    raw.setdefault("repeatGroups", []).append(
        {
            "id": op["groupId"],
            "name": op["name"],
            "instances": [{"id": op["instanceId"], "bpOffset": int(op["bpOffset"])}],
        }
    )
    for oligo in oligos:
        oligo["repeatGroupId"] = op["groupId"]


def _h_add_repeat_instance(raw: dict[str, Any], op: dict[str, Any]) -> None:
    group = _require_group(raw, op["groupId"])
    offset = int(op["bpOffset"])
    if offset == 0 or any(int(i["bpOffset"]) == offset for i in group.get("instances", [])):
        raise InvalidOperationError(f"{group['name']} already has a copy at that offset.")
    group["instances"] = [*group.get("instances", []), {"id": op["instanceId"], "bpOffset": offset}]


def _h_remove_repeat_instance(raw: dict[str, Any], op: dict[str, Any]) -> None:
    group = _require_group(raw, op["groupId"])
    group["instances"] = [i for i in group.get("instances", []) if i["id"] != op["instanceId"]]
    if not group["instances"]:
        _drop_group(raw, group["id"])


def _h_detach_repeat_group(raw: dict[str, Any], op: dict[str, Any]) -> None:
    _require_group(raw, op["groupId"])
    for oligo in raw.get("oligos", []):
        if (oligo.get("mirrorOf") or {}).get("groupId") == op["groupId"]:
            oligo.pop("mirrorOf", None)
        if oligo.get("repeatGroupId") == op["groupId"]:
            oligo.pop("repeatGroupId", None)
    _drop_group(raw, op["groupId"])


def _h_delete_repeat_group(raw: dict[str, Any], op: dict[str, Any]) -> None:
    _require_group(raw, op["groupId"])
    _drop_group(raw, op["groupId"])


GROUP_HANDLERS: dict[str, Callable[[dict, dict], None]] = {
    M.OP_CREATE_REPEAT_GROUP: _h_create_repeat_group,
    M.OP_ADD_REPEAT_INSTANCE: _h_add_repeat_instance,
    M.OP_REMOVE_REPEAT_INSTANCE: _h_remove_repeat_instance,
    M.OP_DETACH_REPEAT_GROUP: _h_detach_repeat_group,
    M.OP_DELETE_REPEAT_GROUP: _h_delete_repeat_group,
}


# ---------------------------------------------------------------------------
# The one entry point for applying an op
# ---------------------------------------------------------------------------

_COPIED_KEYS = ("oligos", "virtualHelices", "regions", "repeatGroups")


def apply_op(raw: dict[str, Any], op: dict[str, Any], handler: Callable[[dict, dict], None]) -> None:
    """Run ``handler`` for ``op`` on ``raw`` and keep mirrors in step, as the host's replay
    does after each op. Leaves ``raw`` unchanged when it raises."""
    kind = op["op"]
    if kind not in GROUP_OPS and not has_repeats(raw):
        handler(raw, op)
        return

    touched = touched_oligos(raw, op)
    if kind != M.OP_REMOVE_VHS and any(is_mirror(o) for o in touched):
        raise InvalidOperationError(MIRROR_EDIT_ERROR)
    if kind == M.OP_CONNECT:
        by_segment = _owner_index(raw)[1]
        a, b = by_segment.get(op["fromSegmentId"]), by_segment.get(op["toSegmentId"])
        conflict = connect_conflict(a, b) if a is not None and b is not None else None
        if conflict is not None:
            raise InvalidOperationError(conflict)

    if kind in ATTRIBUTE_OPS:
        handler(raw, op)
        target = touched[0] if touched else None
        if target is not None and target.get("repeatGroupId") and find_group(raw, target["repeatGroupId"]):
            _propagate(raw, op, target)
        return

    if kind not in GROUP_OPS and not any(o.get("repeatGroupId") or is_mirror(o) for o in touched):
        handler(raw, op)
        return

    work = {**raw, **{k: copy.deepcopy(raw[k]) for k in _COPIED_KEYS if k in raw}}
    handler(work, op)
    sync(work)
    for key in _COPIED_KEYS:
        if key in work:
            raw[key] = work[key]
        else:
            raw.pop(key, None)
