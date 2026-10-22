---
title: foldnano_mini API Reference
description: Every public name in foldnano_mini, what it does, and whether it reads or changes the design
category: plugin-development
order: 6
slug: foldnano-mini-api
---

# foldnano_mini API Reference

For how these fit together (loading a part, checking before you edit, crossovers, drawing paths), see [Plugin Patterns](/docs/plugin-development/plugin-patterns#writing-plugins-with-foldnano_mini). The same names, with signatures and docstrings, are in the type stubs and in Script Lab's autocomplete.

Every public name in `foldnano_mini`, with what it does. Reads come from the in-worker mirror and always reflect earlier edits in the same run. Each edit records one or more ops in `part.mutation_log` (named in the **Records** notes) and updates the mirror at once. Where an edit has a `can_*` twin, the edit runs that check first and raises `InvalidOperationError` with its reason before recording anything (see [Asking before you edit](/docs/plugin-development/plugin-patterns#asking-before-you-edit)).

**Kind** says what each name does to the design:

- **read-only**: a property you read; assigning to it is an error.
- **settable**: a property you can assign to; the assignment records an op.
- **edit**: a method that changes the design and records ops.
- **query**: a method that only reads (lookups and `can_*` checks); nothing is recorded.
- **helper**, **function**, **constant**, **class**: module-level names and utilities; they don't change the design.

Arguments named `vh` take a helix object or its index. `strand_index` is 0 (bases run 5' to 3' with increasing index) or 1 (decreasing). Bases (`bp`) are 0-based indices along the helix.

## Module

| API | Kind | Behaviour |
| --- | --- | --- |
| `load_part(json_str, active_region_id=None)` | function | Parse a foldnano_json string (from `ctx.get_part_as_foldnano_json()`) into a `MutablePart` with an empty log. Pass `ctx.active_region_id` through. |
| `KNOWN_OPS` | constant | The set of op kinds the host can replay. |
| `MutationLog`, `Transport`, `OfflineTransport` | class | The log and transport behind `MutablePart`. Plugins don't need them; `part.mutation_log` is the log to return. |

## `MutablePart`: contents and lookups

| API | Kind | Behaviour |
| --- | --- | --- |
| `part.name`, `part.id` | read‑only | The part's name and id. |
| `part.regions`, `part.virtual_helices`, `part.oligos`, `part.planes` | read‑only | Lists of proxies for everything in the part, current as of the last edit. `part.oligos` includes repeat groups' mirror oligos, as read-only `MirrorOligo`s. |
| `part.real_oligos` | read‑only | Every oligo except mirror oligos: the ones you can edit, and what the app's oligo list and exports show. |
| `part.repeat_groups` | read‑only | The part's repeat groups (`MutableRepeatGroup`). |
| `part.active_region_id`, `part.active_region` | read‑only | The region passed to `load_part` (id, and its proxy or `None`). |
| `part.lattice_type` | read‑only | `'HONEYCOMB'`, `'SQUARE'` or `'FREEFORM'`: the first region's kind. Check `region.kind` in multi-region parts. |
| `part.max_base` | read‑only | The first region's default length. |
| `part.get_region(id)`, `part.get_vh(index)`, `part.get_oligo(id)`, `part.get_repeat_group(id)` | query | The proxy with that id or index, or `None`. |
| `part.vhs_in_region(region_id)` | query | Helices in a region. |
| `part.oligos_in_region(region_id)` | query | Oligos whose segments all lie in that region (oligos crossing into another region are left out). |
| `part.get_segment_at(vh, strand_index, bp)` | query | The segment covering that base on that strand, or `None`. |
| `part.get_oligo_at(vh, strand_index, bp)` | query | The oligo covering that base, or `None`. |
| `part.get_end_at(vh, strand_index, bp)` | query | The 5' or 3' end sitting exactly at that base (free or connected), or `None`. |
| `part.get_slot_at(vh, strand_index, bp)` | query | The slot at that base of that strand (its sequence, skip or insertion), or `None` where no strand covers it. |
| `part.potential_xover_sites(vh)` | query | `[strand 0 sites, strand 1 sites]`, as `vh.potential_xover_sites`. |
| `part.mutation_log` | read‑only | The ops recorded so far, as JSON-ready dicts. Return it with `ctx.set_result_mutation_log(...)`. |
| `part.to_json()`, `part.to_json_string()` | query | The whole mirror as a dict (a copy) or a JSON string, e.g. for `ctx.set_result_foldnano_json(...)`. |
| `MutablePart.replay_log_into_fresh_mirror(json_str, log)` | query | Replay a log onto a fresh copy of `json_str` and return the result; for testing that a log reproduces `part.to_json()`. |
| `part.allocate_vh_id()`, `allocate_oligo_id()`, `allocate_segment_id()`, `allocate_plane_id()`, `allocate_region_id()` | helper | A new unique id. The edits call these themselves; you rarely need them. |

## `MutablePart`: edits

| API | Kind | Behaviour |
| --- | --- | --- |
| `part.create_segment(vh, five_index, three_index, color="#888888", is_scaffold=False, name=None)` | **edit** | A new oligo with one segment. It runs on strand 0 when `five_index < three_index`, otherwise strand 1. Both ends must be inside the region's bases and the range free. Returns the segment. **Records** `create_segment`. Check: `can_create_segment`. |
| `part.create_oligo(segments, color="#888888", name=None, is_scaffold=False, circular=False)` | **edit** | One oligo from a path: `segments` lists `(vh, five, three)` tuples or `SegmentSpec`s from 5' to 3', and each segment's 3' end joins the next one's 5' end. Consecutive entries that continue each other on the same strand become one segment; `circular=True` also joins the last 3' end to the first 5' end. The whole path is checked first, so nothing is recorded if any part is refused. Returns the oligo; `oligo.segments` is in 5' to 3' order. **Records** `create_segment` per segment and `connect` per junction. Check: `can_create_oligo`. |
| `part.fill_empty_strand_set(vh, strand_index, color="#888888")` | **edit** | One segment along a whole empty strand, covering every base inside both the region and the helix, 5' to 3' in that strand's direction. Returns the segment. **Records** `create_segment`. Check: `can_fill_empty_strand_set`. |
| `part.connect(seg_from, seg_to)` | **edit** | Join `seg_from`'s 3' end to `seg_to`'s 5' end; both must be free and on different segments. If the ends are on the same helix and strand one base apart, the segments **merge** into one (`seg_to` is gone afterwards) instead of crossing over. If the segments were in different oligos, `seg_from`'s oligo absorbs the other. **Records** `connect`. Check: `can_connect`. |
| `part.connect_oligos(from_oligo, to_oligo)` | **edit** | Join `from_oligo`'s free 3' end to `to_oligo`'s free 5' end, like dragging one end onto the other in the editor. The same oligo twice closes it into a ring. Adjacent ends merge as with `connect`. Clears modifications on the two joined ends. **Records** `connect` (and `set_segment_modification` when clearing). Check: `can_connect_oligos`. |
| `part.create_crossover(from_oligo, vh, strand_index, bp)` | **edit** | Like dragging `from_oligo`'s 3' end onto a strand: break the target strand just before `bp` and join the 3' end to it at `bp`. If the target oligo's free 5' end is at `bp`, it is joined without a break. Refused onto a 3' end, onto the base right after a free 5' end (it would leave a 1-nt piece), within one segment, or from a circular oligo. **Records** `break_oligo` and `connect`. Check: `can_create_crossover`. |
| `part.make_crossover(vh, strand_index, bp, to_vh)` | **edit** | Like clicking a potential crossover site: `(vh, strand_index, bp)` and `to_vh` must name a site from `vh.potential_xover_sites(strand_index)`. The strand whose 3' end leaves at the site is broken there and joined to the other helix's strand at the same base. Both strands must be present, and the receiving strand must not end at or 1 nt before its 3' end there. **Records** `break_oligo` and `connect`. Check: `can_make_crossover`. |
| `part.break_at(vh, strand_index, bp)` | **edit** | The break tool: break the strand at that base so its new 3' end is at `bp`. Returns the oligo holding the 3' side. Same behaviour as `break_oligo`. Check: `can_break_at`. |
| `part.break_oligo(seg, at_index)` | **edit** | Break `seg`'s oligo so the new 3' end is at `at_index`, which must be inside the segment. Breaking at the oligo's own free 5'/3' end, or one base before a free 3' end, does nothing. Breaking a circular oligo opens it into one linear oligo (same id). Otherwise the 3' side becomes a new staple oligo (green, not scaffold), and a mid-segment break drops the segment's 3' modification. Refused if it would leave a 1-nt segment before a connected 3' end. Returns the oligo holding the 3' side. **Records** `break_oligo`. Check: `can_break_oligo`. |
| `part.add_skip_at(vh, bp)` | **edit** | The skip tool: skip that base on **both** strands. Refused at a segment end on both strands, at a crossover site, without a complementary strand, or where either strand already has a skip or insertion. **Records** `add_skip_or_insertion`. Check: `can_add_skip_at`. |
| `part.add_insert_at(vh, bp, count=1)` | **edit** | The insert tool: add `count` inserted bases at that base on **both** strands, keeping the existing bases. Calling it again adds more. Refused on a skip and in the places a skip is. **Records** `add_skip_or_insertion`. Check: `can_add_insert_at`. |
| `part.remove_skip_or_insertion_at(vh, bp)` | **edit** | Turn a skip or insertion back into one base on both strands; nothing happens on a plain base. **Records** `set_slot_skip`. |
| `part.remove_segment(seg)` | **edit** | Remove one segment. Segments before it stay in the oligo; those after it become a new oligo, which is returned (`None` if there were none). Removing an oligo's first segment removes that oligo id. **Records** `remove_segment`. |
| `part.remove_oligo(oligo)` | **edit** | Remove the oligo and all its segments. **Records** `remove_oligo`. |
| `part.remove_vhs([vh, ...])` | **edit** | Remove helices and everything on them; oligos passing through are split where they lose segments. **Records** `remove_vhs`. |
| `part.reorder_vh(vh, target_region_row)` | **edit** | Move a helix to another row (0-based) within its region's list. **Records** `reorder_vh`. |
| `part.add_region(kind, name, max_base, *, min_base=0, plane_origin=..., plane_u=..., plane_v=..., plane_normal=..., plane_name=None, step=None, turns_per_step=None, sub_step_size=None, twist_offset=None)` | **edit** | A new region (`'HONEYCOMB'`, `'SQUARE'` or `'FREEFORM'`) on its own new plane; lattice settings default per kind. Returns the region. **Records** `add_region_and_plane`. |
| `part.split_region(region, split_after_vh)` | **edit** | Split a region after the given helix; the helices after it move to a new region with a copy of the plane. Returns the new region. **Records** `split_region`. |
| `part.set_plane_transform(plane_id, origin, u, v, normal)` | **edit** | Move a plane: each vector is `(x, y, z)` or `{x, y, z}`. **Records** `transform_plane`. |
| `part.create_repeat_group(oligos, bp_offset)` | **edit** | Make `oligos` the originals of a new repeat group with one copy `bp_offset` bases along the same helices, like the editor's **Duplicate as linked mirror copies**. The copy's mirror oligos appear at once; a region the copy runs past grows. Returns the group. **Records** `create_repeat_group`. Check: `can_create_repeat_group`. |

## `MutablePart`: checks

Each returns a `Check`: truthy when the edit would be accepted, with `.reason` when not. They never record anything.

| API | Kind | Checks |
| --- | --- | --- |
| `part.can_create_segment(vh, five_index, three_index)` | query | Both ends inside the region's bases; the range free on its strand. |
| `part.can_create_oligo(segments, circular=False)` | query | Every segment as above, no two entries overlapping, no junction on a skip or insertion. |
| `part.can_fill_empty_strand_set(vh, strand_index)` | query | The strand is empty and the helix has room. |
| `part.can_connect(seg_from, seg_to)` | query | Different segments, both ends free, neither end on a skip or insertion. |
| `part.can_connect_oligos(from_oligo, to_oligo)` | query | A free 3' end and a free 5' end, not on one segment, not on a skip or insertion. |
| `part.can_create_crossover(from_oligo, vh, strand_index, bp)` | query | The rules listed for `create_crossover`. |
| `part.can_make_crossover(vh, strand_index, bp, to_vh)` | query | The rules listed for `make_crossover`. |
| `part.can_add_skip_at(vh, bp)`, `part.can_add_insert_at(vh, bp)` | query | The rules listed for `add_skip_at` / `add_insert_at`. |
| `part.can_break_at(vh, strand_index, bp)`, `part.can_break_oligo(seg, at_index)` | query | A strand at that base; the base inside the segment; no 1-nt piece; a mid-segment break not leaving an end on a skip or insertion. |
| `part.can_create_repeat_group(oligos, bp_offset)` | query | At least one oligo, none a mirror or already in a group, and the copy placeable (see [Repeat groups](#repeat-groups)). |

Each edit check above also refuses an edit to a mirror oligo, and an edit to a repeat group's original whose rebuilt copies wouldn't fit (the reason starts "Copy N of Repeat M").

## `MutableOligo`

| API | Kind | Behaviour |
| --- | --- | --- |
| `oligo.id` | read‑only | Stable id, shared with the app. |
| `oligo.color` | **settable** | Hex color `'#rrggbb'`. **Records** `set_oligo_color`. |
| `oligo.name` | **settable** | Optional free-form label, or `None`. Not unique and never used for identity (use `oligo.id`); it shows in the editor, the oligo report and the CSV `Name` column. **Records** `set_oligo_name`. |
| `oligo.is_scaffold` | **settable** | Scaffold flag. **Records** `set_oligo_is_scaffold`. |
| `oligo.is_sequence_locked` | read‑only | Whether the sequence is locked (read-only). |
| `oligo.segments` | read‑only | Its segments. |
| `oligo.get_segment(segment_id)` | query | One of its segments by id, or `None`. |
| `oligo.is_circular` | read‑only | True when it has no free ends. |
| `oligo.five_prime`, `oligo.three_prime` | read‑only | Its free 5' / 3' end (`MutableSegmentEnd`), or `None` when circular. |
| `oligo.five_modification`, `oligo.three_modification` | **settable** | The modification on its free 5' / 3' end; `None` clears. Refused on a circular oligo. **Records** `set_segment_modification`. |
| `oligo.touches_regions()` | query | The set of region ids its segments lie in. |
| `oligo.is_mirror` | read‑only | False for a `MutableOligo` (mirror oligos are `MirrorOligo`s). |
| `oligo.repeat_group` | read‑only | The repeat group this oligo is an original of, or `None`. |
| `oligo.remove()` | **edit** | Same as `part.remove_oligo(oligo)`. |

## `MutableSegment`

| API | Kind | Behaviour |
| --- | --- | --- |
| `seg.id` | read‑only | Stable id, shared with the app. |
| `seg.oligo`, `seg.oligo_id` | read‑only | Its oligo (looked up fresh, so still right after merges). |
| `seg.in_virtual_helix`, `seg.vh_index` | read‑only | Its helix (proxy / index). |
| `seg.in_strand_index` | read‑only | 0 or 1. |
| `seg.five_index`, `seg.three_index` | read‑only | Base of its 5' / 3' end. |
| `seg.low_index`, `seg.high_index` | read‑only | Its base range regardless of direction. |
| `seg.length` | read‑only | Number of bases. |
| `seg.five_prime`, `seg.three_prime` | read‑only | Its ends (`MutableSegmentEnd`). |
| `seg.five_modification`, `seg.three_modification` | **settable** | Shorthand for `seg.five_prime.modification` / `seg.three_prime.modification`. |
| `seg.connected_from_segment_id`, `seg.connected_to_segment_id` | read‑only | Id of the segment joined to its 5' / 3' end, or `None`. |
| `seg.slots` | read‑only | Its stored slots: one per base for a segment loaded from the app, only the written ones for a segment made in this run. |
| `seg.slot_at(bp)` | query | The slot at a base of this segment (created on first write). |
| `seg.move_five_prime_to(bp)`, `seg.move_three_prime_to(bp)` | **edit** | Same as setting `seg.five_prime.index` / `seg.three_prime.index`. |
| `seg.remove()` | **edit** | Same as `part.remove_segment(seg)`. |

## `MutableSegmentEnd`

| API | Kind | Behaviour |
| --- | --- | --- |
| `end.segment`, `end.is_three_prime` | read‑only | The segment it belongs to, and which end it is. |
| `end.in_virtual_helix`, `end.in_strand_index` | read‑only | Where it sits. |
| `end.index` | **settable** | Its base. Setting it moves the end: within the helix, not over another segment, without reversing the segment, not onto a skip or insertion; an end on a lattice crossover may only move to another matching site. Content outside the new range is dropped. **Records** `move_terminus`. |
| `end.can_move_to(bp)` | query | The check for setting `end.index`. |
| `end.modification` | **settable** | Its modification or `None`. Can be set on a free end only (`None` clears). **Records** `set_segment_modification`. |
| `end.is_free` | read‑only | Not connected. |
| `end.connected_segment`, `end.connected_end` | read‑only | The segment / end on the other side of its connection, or `None`. |
| `end.is_constrained` | read‑only | Connected across a lattice crossover site: the two ends are on different strand indices at the same base, and the helix has a site there toward the other helix. Freeform connections never are. |
| `end.is_adjacent_to(other_end)` | query | Same helix and strand, one base apart (connecting them would merge the segments). |

## `MutableSlot`

| API | Kind | Behaviour |
| --- | --- | --- |
| `slot.bp_index` | read‑only | Its base. |
| `slot.seq` | **settable** | Its sequence: one base normally, empty for a skip, longer for an insertion. Settable with the **same length** only, so it can't make the two strands differ; change the length with `part.add_insert_at` / `add_skip_at` / `remove_skip_or_insertion_at`. **Records** `set_slot_sequence`. |
| `slot.skip` | read‑only | True when it is a skip. |
| `slot.set_skip(True)` | **edit** | Make it a skip on both strands (same as `part.add_skip_at`, through this slot). **Records** `set_slot_skip`. Check: `slot.can_set_skip()`. |
| `slot.set_insertion(sequence)` | **edit** | Replace the whole slot with `sequence` (e.g. `'AT'` is one inserted base); the complementary slot becomes that many `N`s, losing its base. Prefer `part.add_insert_at`, which works like the editor. **Records** `set_slot_insertion`. Check: `slot.can_set_insertion()`. |
| `slot.can_set_skip()`, `slot.can_set_insertion()` | query | Inside the segment, not at its end, the complementary strand present, not at a crossover site; a skip needs both strands plain, an insertion can't go on a skip. |
| `slot.remove_skip_or_insertion()`, `slot.set_skip(False)` | **edit** | Back to a plain base on both strands; a plain slot is left alone. **Records** `set_slot_skip`. |

## `MutableVirtualHelix`

| API | Kind | Behaviour |
| --- | --- | --- |
| `vh.index`, `vh.id` | read‑only | Its index and stable id. A helix added in this run has a provisional index; use `vh.id` to refer to it reliably. |
| `vh.region_id` | read‑only | Its region's id. |
| `vh.length` | **settable** | Number of bases (at least 2 when set). **Records** `set_vh_length`. |
| `vh.row`, `vh.col` | read‑only | Lattice position, or `None` for a freeform helix. |
| `vh.is_freeform` | read‑only | True when it has no lattice position. |
| `vh.parity_is_even`, `vh.is_even_parity` | read‑only | Lattice parity (`row % 2 == col % 2`). |
| `vh.local_frame` | **settable** | A freeform helix's frame (`origin`, `axis`, `radial0`). **Records** `set_vh_local_frame`. |
| `vh.move_to(col, row)` | **edit** | Move a lattice helix; refused if it would change parity. **Records** `move_lattice_vh`. |
| `vh.strand_sets` | read‑only | `[strand 0, strand 1]` as `MutableStrandSet`s. |
| `vh.segments_at(bp, strand_index=None)` | query | Segments covering a base, on one strand or both. |
| `vh.potential_xover_sites(strand_index)` | query | Potential crossover sites from that strand, as `CrossoverSite(bp_index, to_vh_index, right)`; only sites whose neighbour position holds a helix in the same region. Freeform helices have none. |
| `vh.strand_set_segment_ids` | read‑only | Segment ids on each strand, as stored. |

## `MutableStrandSet`

| API | Kind | Behaviour |
| --- | --- | --- |
| `ss.strand_index`, `ss.virtual_helix` | read‑only | Which strand, and its helix. |
| `ss.segments`, `ss.segment_ids` | read‑only | Its segments, ordered by base. |
| `ss.is_empty` | read‑only | No segments. |
| `ss.is_index_occupied(bp)`, `ss.is_index_occupied_by(bp)` | query | Whether a segment covers that base / which one (or `None`). |
| `ss.is_range_occupied(a, b)`, `ss.segments_in_range(a, b)` | query | Whether any segment overlaps the inclusive range (either order) / which ones. |
| `ss.free_ranges()` | query | Free `(low, high)` ranges within the region's bases: where a new segment fits. |

## Regions and planes

| API | Kind | Behaviour |
| --- | --- | --- |
| `region.id`, `region.name`, `region.kind`, `region.plane_id` | read‑only | Identity, name, `'HONEYCOMB'` / `'SQUARE'` / `'FREEFORM'`, and its plane. |
| `region.step`, `region.min_base`, `region.max_base`, `region.default_max_base` | read‑only | Lattice step (21 honeycomb, 32 square); its first base; one past its last base; the stored default length. |
| `region.vh_order`, `region.virtual_helices` | read‑only | Helix ids in display order / its helices. |
| `region.supports_lattice_grid` | read‑only | True for honeycomb and square regions. |
| `region.set_max_base(n)` | **edit** | Lengthen or shorten every helix in the region so it ends at `n`. The change must be a multiple of `step`; shortening is refused while strands reach that far. **Records** `set_region_max_base`. Check: `region.can_set_max_base(n)`. |
| `region.increase_length_by(delta)` | **edit** | Lengthen by a positive multiple of `step`. |
| `region.reduce_unused_length()` | **edit** | Shorten to the strands it holds, rounded up to `step` and at least two steps, like the strand view's reduce button. |
| `region.remove_all_skips()`, `region.remove_all_insertions()` | **edit** | Turn every skip / insertion in the region back into a plain base; returns how many. |
| `lattice_region.add_vh_at(row, col, length=None)` | **edit** | A new helix at a lattice position (`LatticedRegion`). **Records** `add_vh_at_coords`. |
| `freeform_region.add_vh_at(origin, direction=(0, 0, 1), length=None)` | **edit** | A new helix at a 3D position in nm (`FreeformRegion`). **Records** `add_freeform_vh`. |
| `plane.id`, `plane.name`, `plane.origin`, `plane.u`, `plane.v`, `plane.normal` | read‑only | A plane's placement (read-only; move it with `part.set_plane_transform`). |

## Repeat groups

A repeat group copies its original oligos at each instance's offset along the same helices. The copies, **mirror oligos**, are rebuilt from their originals after every edit, here and in the app, and can't be edited themselves. Edit an original and its mirrors follow: color, name, scaffold flag, modifications and bases at once, anything else by rebuilding them. If a rebuilt copy wouldn't fit (it would overlap a strand, lose a lattice crossover site, or leave a skip or insertion unpaired), the edit raises `InvalidOperationError` and nothing is recorded.

| API | Kind | Behaviour |
| --- | --- | --- |
| `group.id`, `group.name` | read‑only | Stable id and display name (`Repeat 1`, `Repeat 2`, ...). |
| `group.instances` | read‑only | Its copies, as `RepeatInstance(id, bp_offset)`, in the order they are placed. |
| `group.get_instance(id)` | query | One instance by id, or `None`. |
| `group.originals` | read‑only | The oligos being repeated. |
| `group.mirrors`, `group.mirrors_of(instance)` | read‑only / query | All its mirror oligos, or one instance's. |
| `group.add_instance(bp_offset)` | **edit** | Add a copy at that offset (not 0 or one the group already has); its mirrors appear at once. Returns the `RepeatInstance`. **Records** `add_repeat_instance`. Check: `group.can_add_instance(bp_offset)`. |
| `group.remove_instance(instance)` | **edit** | Remove one copy and its mirrors. Removing the last copy deletes the group. **Records** `remove_repeat_instance`. |
| `group.detach()` | **edit** | Dissolve the group, keeping its mirrors as ordinary, editable oligos. **Records** `detach_repeat_group`. |
| `group.delete()` | **edit** | Remove the group and its mirrors; the originals stay as ordinary oligos. **Records** `delete_repeat_group`. |
| `MirrorOligo` | class | A mirror oligo: the same reads as `MutableOligo`, with no setters or edits. Its segments, ends and slots are `SegmentView`, `SegmentEndView` and `SlotView`: read-only versions of the mutable proxies. Assigning to any of them raises `InvalidOperationError`. |
| `mirror.is_mirror` | read‑only | True. |
| `mirror.mirror_of` | read‑only | `MirrorInfo(group, instance, source)`: what it copies. |
| `mirror.source` | read‑only | The original it copies, as a `MutableOligo`. |

Joining an ordinary oligo to an original (with `connect` or a crossover) pulls it into the group; both halves of a broken original stay in it; two groups can't be joined. A mirror's id is `<source id>@<instance id>` here, stable across rebuilds, but the app gives its mirrors its own ids, so don't keep a mirror id after the run. To edit every oligo, loop over `part.real_oligos`.

## Values and errors

| API | Kind | Behaviour |
| --- | --- | --- |
| `Check` | class | Result of a `can_*` call: truthy when allowed; `.ok`, `.reason`, and `.raise_if_failed()`. |
| `InvalidOperationError` | class | Raised by an edit its check refuses (a `ValueError`). Nothing is recorded. |
| `MIRROR_EDIT_ERROR` | constant | The message an edit to a mirror oligo fails with. |
| `RepeatInstance(id, bp_offset)`, `MirrorInfo(group, instance, source)` | class | A repeat group's copy, and what a mirror oligo copies. |
| `SegmentSpec(vh, five, three)` | class | A named `(vh, five, three)` entry for `create_oligo`. |
| `CrossoverSite(bp_index, to_vh_index, right)` | class | One potential crossover site. |

The proxies follow Foldnano's own model, so if you know `Part`, `Oligo`, `OligoSegment`, `SegmentEnd` and `StrandSet`, the names carry over in snake_case: `seg.three_prime.connected_end`, `vh.strand_sets[0].is_range_occupied(10, 30)`.
