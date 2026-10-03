---
covers:
  - src/lib/model/Part/SpatialIndexService.ts
---

# Spatial Index

The spatial index in `src/lib/model/Part/SpatialIndexService.ts` provides O(1)
lookup from a VH position to the segment, ends, and parent oligo at that
position. The important recent change is that the cache is now keyed by
**virtual-helix identity**, not by display row.

---

## Why It Changed

Older code treated row order as part of topology:

```text
(listRow, strandIdx, bpIdx) -> segment / ends / oligo
```

That no longer works well now that the strand viewer can:

- flatten region headers plus VH rows
- collapse regions
- reorder VHs inside a region

Display rows are now a view concern. The spatial index now treats topology as:

```text
(vhId, strandIdx, bpIdx) -> segment / ends / oligo
```

`drawingDimensions` and `strandRowLayout` translate visible rows to VHs; the
spatial index answers topology queries once the VH is known.

---

## Data Structures

The cache is split into three maps:

| Map                      | Key                                 | Value                              |
| ------------------------ | ----------------------------------- | ---------------------------------- |
| `_vhCoordToSegmentCache` | `vhId -> Map<number, OligoSegment>` | segment occupying a strand/bp slot |
| `_vhCoordToEndsCache`    | `vhId -> Map<number, SegmentEnd[]>` | ends exactly at a strand/bp slot   |
| `_segmentIdToOligo`      | `segmentId`                         | parent oligo                       |

The inner numeric key packs strand and bp:

```ts
strandIdx * 1_000_000 + bpIdx;
```

So the full lookup path is:

```text
vhId -> packed(strandIdx, bpIdx)
```

---

## Cache Maintenance

### `cacheSegmentRange(oligo, segment)`

When a segment is created or re-cached:

1. store `segment.id -> oligo`
2. cache every bp in the segment range for that VH/strand
3. cache both termini in the end map

### `uncacheSegmentRange(segment)`

When a segment is removed:

1. delete its segment range from the VH-specific segment map
2. remove both ends from the VH-specific ends map
3. delete `segment.id -> oligo`

### `cacheOligo(oligo)` / `uncacheOligo(oligo)`

These just forward to every segment in the oligo.

### `rebuildFromOligos(oligos)`

Full rebuild:

1. clear all caches
2. re-cache every oligo and segment

`Part.rebuildRspCaches()` is the public wrapper.

---

## Query API

`SpatialIndexService` exposes:

```ts
getSegmentAt(vhId, strandIdx, bpIdx): OligoSegment | null
getEndsAt(vhId, strandIdx, bpIdx): SegmentEnd[]
getOligoBySegmentId(segmentId): Oligo | null
setOligoForSegment(segmentId, oligo): void
clear(): void
```

`Part` wraps that service with view-friendly helpers:

```ts
getEntitiesAtVh(vhId, strandIdx, bpIdx);
getEntitiesAt(vhRow, strandIdx, bpIdx);
getOligoByVh(vhId, strandIdx, bpIdx);
getOligoByIndices(vhRow, strandIdx, bpIdx);
queryEntitiesInVhRange(vhIds, strands, startBpIdx, endBpIdx);
queryEntitiesInGridRange(range);
```

The first two are the most important:

- `getEntitiesAtVh(...)` is the identity-based lookup
- `getEntitiesAt(...)` is the row-based adapter used by 2D hit testing

---

## Interaction With Strand Layout

The strand viewer does not talk to the spatial index with raw rows anymore.
Instead:

1. `drawingDimensions.getHitGridByXY(...)` returns a visible display row
2. `drawingDimensions.getVisibleVhByDisplayRow(...)` resolves that row to a VH
3. `part.getEntitiesAtVh(vh.id, strandIdx, bpIdx)` hits the cache

This means:

- collapsing a region does not invalidate topology caches
- inserting a region header row does not invalidate topology caches
- reordering region sections in the view does not invalidate topology caches

Only real topology changes do.

---

## When Full Rebuilds Are Needed

A rebuild is still required for bulk or restore-like operations, for example:

- part import / document load
- `FoldnanoDocument.fromJSON()`
- localized history replay after structural memento restore
- any code path that reconstructs many oligos or VHs at once

A rebuild is **not** required for:

- region collapse / expand
- strand-view row layout changes
- region-local VH display reordering by itself
- plane translation / rotation

Those operations change how the design is shown, not which nucleotides occupy
which VH/strand/bp coordinates.

### Staleness check

Invalidation is by convention, so a forgotten update would only show as wrong
hit-testing. In tests (and in dev with `VITE_VERIFY_UNDO=true`), `HistoryStack`
runs `findDerivedStateMismatch` (`commands/historyVerification.ts`) after every
committed edit, undo and redo: it rebuilds a scratch `SpatialIndexService` from
`part.oligos` and requires the live index to return the same segment, oligo and
end at every VH, strand and bp. A mismatch throws. See
`commands-and-history.md` § Verifying Undo / Redo.

---

## Performance Notes

The current structure is tuned for the hot paths:

- pointer hover and click hit testing
- marquee selection
- rapid redraw while panning / zooming

The tradeoff is still O(segment length) cache population on segment insert, but
that is acceptable compared to repeated O(all segments) scans during normal
interaction.

The service is still sometimes called the "RSP cache" in comments and older
docs, but `SpatialIndexService` is the canonical implementation name.

The outer `vhId` maps are `SvelteMap` (so derived view code re-runs when a VH
appears or disappears). The inner per-VH bp maps are plain `Map` — they are
read through `getEntitiesAt*` queries that already track the outer map, so the
inner map mutations don't need their own reactivity layer.

---

## Boundaries / Don'ts

- **Don't query the cache by `listRow`.** Use `getEntitiesAtVh(vhId, ...)` for identity lookups; the row-based `getEntitiesAt(vhRow, ...)` is a thin adapter for the strand viewer's hit-test path only.
- **Don't mutate cache maps from outside the service.** All maintenance goes through `cacheSegmentRange` / `uncacheSegmentRange` / `cacheOligo` / `uncacheOligo` / `rebuildFromOligos`.
- **Don't trigger a full rebuild for view-only changes.** Region collapse/expand, row reordering inside a region, and plane transforms do not need it. `Part.rebuildRspCaches()` is reserved for structural events (import, document load, history restore of structural mementos).
- **Don't read the cache during construction.** It is populated _after_ segments are inserted via `Part` methods. If you build a part directly, call `rebuildRspCaches()` once everything is in place.
