---
title: Parse API Reference
description: Every name in foldnano.io, the read-only view of a Foldnano JSON design, with PartData and its oligo, segment, helix, region and plane proxies
category: plugin-development
order: 6
slug: plugin-api
covers:
  - src/lib/plugin/python/foldnano/io.py
  - src/lib/plugin/python/foldnano/oligo.py
  - src/lib/plugin/python/foldnano/vh.py
  - src/lib/plugin/python/foldnano/region.py
  - src/lib/plugin/python/foldnano/plane.py
---

# Parse API Reference

`parse_foldnano_json()` turns the JSON string from `ctx.get_part_as_foldnano_json()` into read-only Python objects, so you can walk the design instead of indexing raw dicts. It is the reading half of the `foldnano_json` format: to change the design, edit `part._raw` and hand it back with `ctx.set_result_foldnano_json(json.dumps(part._raw))` (see the [round-trip pattern](/docs/plugin-development/plugin-patterns#round-trip-mutation-pattern)). For an API you edit directly, use [foldnano_mini](/docs/plugin-development/foldnano-mini-api).

```python
from foldnano.io import parse_foldnano_json

part = parse_foldnano_json(ctx.get_part_as_foldnano_json(), active_region_id=ctx.active_region_id)
```

**Kind** says what each name does:

- **read-only**: a value parsed from the JSON. Assigning to it changes only the Python object, never the result; edit `part._raw` instead.
- **query**: a method that only reads.
- **function**, **class**: module-level names.

The proxies are snapshots of the JSON at parse time. Bases (`bp`) are 0-based indices along a helix; strand 0 runs 5' to 3' with increasing index, strand 1 with decreasing index.

## Module

| API | Kind | Behaviour |
| --- | --- | --- |
| `parse_foldnano_json(json_str, active_region_id=None)` | function | Parse a Foldnano JSON string into a `PartData`. Pass `ctx.active_region_id` through for region-scoped plugins. |
| `parse_cadnano_json(json_str)` | function | Parse a cadnano JSON string into a plain dict (`name`, `vstrands`). cadnano designs have no proxies. |
| `PartData` | class | The parsed part ([below](#partdata)). |
| `OligoProxy`, `OligoSegmentProxy` | class | An oligo and one of its segments. |
| `VirtualHelixProxy` | class | A helix. |
| `RegionProxy`, `LatticedRegionProxy`, `FreeformRegionProxy` | class | A region; lattice and freeform regions are subclasses. Test `region.supports_lattice_grid` rather than the class. |
| `PlaneProxy` | class | The plane a region lives on. |

All of these import from `foldnano` (and the two functions from `foldnano.io`).

## `PartData`

| API | Kind | Behaviour |
| --- | --- | --- |
| `part.name`, `part.id` | read‑only | The part's name and id. |
| `part.virtual_helices`, `part.oligos`, `part.regions`, `part.planes` | read‑only | Everything in the part, in JSON order. |
| `part.lattice_type` | read‑only | `'HONEYCOMB'`, `'SQUARE'` or `'FREEFORM'`: the first region's kind. Check `region.kind` in multi-region parts. |
| `part.max_base` | read‑only | The first region's default length. |
| `part.active_region_id`, `part.active_region` | read‑only | The region passed to `parse_foldnano_json` (id, and its proxy or `None`). |
| `part._raw` | read‑only | The parsed JSON dict itself. Change it and serialise it back to return an edited design. |
| `part.get_vh(index)`, `part.get_oligo(id)`, `part.get_region(id)`, `part.get_plane(id)` | query | The proxy with that index or id, or `None`. |
| `part.region_for_vh(vh_index)` | query | The region a helix belongs to, or `None`. |
| `part.vhs_in_region(region_id)` | query | Helices in a region. |
| `part.oligos_in_region(region_id)` | query | Oligos whose segments all lie in that region (oligos crossing into another region are left out). |

## `OligoProxy`

| API | Kind | Behaviour |
| --- | --- | --- |
| `oligo.id`, `oligo.name` | read‑only | Id, and the name (or `None`). |
| `oligo.color` | read‑only | Hex color, e.g. `'#0066cc'`. |
| `oligo.is_scaffold`, `oligo.is_sequence_locked` | read‑only | Whether it is a scaffold, and whether its sequence is locked against overwriting. |
| `oligo.segments` | read‑only | Its segments, 5' to 3'. |
| `oligo.sequence` | read‑only | The bases of all segments, 5' to 3'; empty where none are assigned. |
| `oligo.is_circular` | read‑only | True when the last segment's 3' end joins the first one's 5' end. |
| `oligo.touches_regions(part)` | query | The ids of the regions its segments visit. More than one means it crosses regions. |

## `OligoSegmentProxy`

| API | Kind | Behaviour |
| --- | --- | --- |
| `seg.id` | read‑only | The segment's id. |
| `seg.vh_index` | read‑only | The helix it lies on. |
| `seg.five_prime_index`, `seg.three_prime_index` | read‑only | Its 5' and 3' bases on that helix. |
| `seg.length` | read‑only | Bases spanned, both ends included. |
| `seg.five_prime_modification`, `seg.three_prime_modification` | read‑only | Modification codes (e.g. `'/5Alex488N/'`), or `None`. |
| `seg.connected_from_segment_id`, `seg.connected_to_segment_id` | read‑only | The segment joined to its 5' end and to its 3' end, or `None` at a free end. |
| `seg.is_free_five_prime`, `seg.is_free_three_prime` | read‑only | Whether its 5' / 3' end is free (the oligo's own end). |
| `seg.slots` | read‑only | One dict per base, 5' to 3': `{"bpIndex": int, "seq": str}`. `seq` is empty for a skip and longer than one base for an insertion. |
| `seg.sequence` | read‑only | Its bases, 5' to 3'. |

## `VirtualHelixProxy`

| API | Kind | Behaviour |
| --- | --- | --- |
| `vh.index`, `vh.id` | read‑only | Its index in the part, and its stable id (regions list helices by `id`). |
| `vh.region_id` | read‑only | The region it belongs to. |
| `vh.length` | read‑only | Bases along the helix. |
| `vh.row`, `vh.col` | read‑only | Lattice position, or `None` for a freeform helix. |
| `vh.is_freeform` | read‑only | True when it has no lattice position. |
| `vh.parity_is_even` | read‑only | True when `row % 2 == col % 2`. Raises `ValueError` on a freeform helix. |
| `vh.local_frame` | read‑only | A freeform helix's placement (`origin`, `axis`, `radial0`), or `None`. |
| `vh.roll_deg` | read‑only | A freeform helix's rotation about its own axis, in degrees (-180 to 180], or `None`. 0 points `radial0` along the region plane's normal; positive turns right-handed about the axis. |
| `vh.list_row` | read‑only | Its row in the strand view, or `None`. |
| `vh.strand_set_segment_ids` | read‑only | `[strand 0 ids, strand 1 ids]`: the segments on each strand. |

## `RegionProxy`

| API | Kind | Behaviour |
| --- | --- | --- |
| `region.id`, `region.name`, `region.kind`, `region.plane_id` | read‑only | Identity, name, `'HONEYCOMB'` / `'SQUARE'` / `'FREEFORM'`, and its plane. |
| `region.vh_order` | read‑only | Its helices' `id`s in display order (ids, not indices; use `part.vhs_in_region` for helices). |
| `region.step`, `region.turns_per_step`, `region.sub_step_size`, `region.twist_offset` | read‑only | Helical geometry: bases per step (21 honeycomb, 32 square), turns per step, crossover sub-step, and twist offset. |
| `region.min_base`, `region.default_max_base` | read‑only | Its first base, and the default length of new helices. |
| `region.supports_lattice_grid` | read‑only | True for honeycomb and square regions. |

## `PlaneProxy`

| API | Kind | Behaviour |
| --- | --- | --- |
| `plane.id`, `plane.name` | read‑only | Identity and name. |
| `plane.origin`, `plane.u`, `plane.v`, `plane.normal` | read‑only | Its origin and basis vectors in the lab frame, each with `.x`, `.y`, `.z`. `u` and `v` span the plane. |
