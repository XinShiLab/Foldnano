---
covers:
  - src/lib/model/io/cadnanoJSON.ts
  - src/lib/components/Editor/Toolbar/parsers/**
  - src/lib/components/Editor/Toolbar/LoadCadnanoAsRegionDialog.svelte
---

# cadnanoJSON Import & Export — `src/lib/model/io/cadnanoJSON.ts`

---

## cadnano JSON format primer

A cadnano `.json` file looks like:

```json
{
  "name": "my_design",
  "vstrands": [
    {
      "row": 0, "col": 1, "num": 0,
      "scaf": [[-1,-1,0,1], [0,0,0,2], ..., [0,N-2,-1,-1]],
      "stap": [[-1,-1,-1,-1], [-1,-1,1,0], ...],
      "loop": [0, 0, 1, 0, ...],
      "skip": [0, -1, 0, 0, ...],
      "scaf_loop": [...], "stap_loop": [...],
      "stap_colors": [[5, 11184640]],
      "scaf_colors": []
    },
    ...
  ]
}
```

Each `vstrand` is a **virtual helix**. Its `scaf` and `stap` arrays have one entry per backbone position. Each entry is a **4-tuple `[fromVhIdx, fromBpIdx, toVhIdx, toBpIdx]`** encoding the connectivity of that nucleotide:

| Field                       | Meaning                                             |
| --------------------------- | --------------------------------------------------- |
| `fromVhIdx, fromBpIdx`      | where the backbone **comes from** (the previous nt) |
| `toVhIdx, toBpIdx`          | where the backbone **goes to** (the next nt)        |
| `-1, -1` on the "from" side | free 5' end                                         |
| `-1, -1` on the "to" side   | free 3' end                                         |

`loop` and `skip` are parallel arrays: `loop[i] = 1` means an insertion at position `i`; `skip[i] = -1` means a deletion (skip) at position `i`.

`stap_colors` is an array of `[fivePrimeIndex, 24bitColorInt]` pairs marking the 5' end of each staple strand's color.

### Lattice detection from base count

The number of positions in `scaf`/`stap` reveals the lattice type:

- `numBases % 21 === 0` → **HONEYCOMB** (21 bases/repeat)
- `numBases % 32 === 0` → **SQUARE** (32 bases/repeat)

---

## Strand/StrandSet index convention

The mapping between cadnano's `scaf`/`stap` arrays and the model's `strandSets[0/1]` is **purely a directional adapter at the file boundary**. The Foldnano `Oligo.isScaffold` flag is **not consulted on either import or export** — it is a Foldnano-internal annotation and has no role in cadnano IO.

The mapping has to flip per VH parity because both sides have hard-pinned, but mismatched, directional conventions:

| Side                                              | strand 0 / `scaf` direction                          | strand 1 / `stap` direction      |
| ------------------------------------------------- | ---------------------------------------------------- | -------------------------------- |
| **Foldnano model** (`VirtualHelix.strandSets[i]`) | `[0]` is always 5'→3' L→R (ascending bp)             | `[1]` is always 5'→3' R→L (desc) |
| **cadnano file** (vstrand `scaf[]` / `stap[]`)    | even VH: `scaf` ascending; odd VH: `scaf` descending | inverse on `stap`                |

Direction must round-trip, so model strand 0 lands in whichever cadnano array runs in the matching direction on that VH:

| VH index parity   | model `strandSets[0]` ↔    | model `strandSets[1]` ↔     |
| ----------------- | -------------------------- | --------------------------- |
| Even (0, 2, 4, …) | `scaf` array (both ascend) | `stap` array (both descend) |
| Odd (1, 3, 5, …)  | `stap` array (both ascend) | `scaf` array (both descend) |

The helper `isScafToStrandSetIdx(vhIdx, isScaf)` encodes exactly this table:

```ts
const isScafToStrandSetIdx = (vhIdx: number, isScaf: boolean): number =>
	vhIdx % 2 === 0 ? Number(!isScaf) : Number(isScaf);
```

The name is historical and misleading — `isScaf` here means "the file's `scaf` slot", not "this strand is the design's scaffold". A cadnano file's `scaf`/`stap` partition is a rendering convention of the cadnano2 UI, not a semantic claim that gets carried into the Foldnano model.

---

## Import pipeline: `CadnanoJSON.toPart()`

### Step 1: Parse raw JSON → `VStrand` objects

Each raw vstrand JSON is wrapped in a `VStrand` class. The constructor clones the `skip`
array, runs `relocateSkipsOffCrossovers()`, then calls `buildSegments()`.

**`relocateSkipsOffCrossovers()`** — a deletion (`skip[i] = -1`) sitting on a bp that carries a
crossover to a _different_ VH can't be represented by the NT / oxDNA model (it's a deletion at a
constrained anchor; see `isConnectionConstrained` and `docs/simulation-nt-model.md`). Cadnano
permits it, so on import each such skip is moved to the nearest adjacent occupied, non-crossover bp
on the same helix (always available — a crossover base has an interior neighbour within its
segment). The shift operates on the column-wide `skip` array so both strands stay mirrored, and is
sequence-neutral (deleting either of two adjacent path positions removes the same letter). Each
relocation pushes a `VStrand.warnings` entry, surfaced to the user as an import toast. If no
adjacent slot qualifies it warns and leaves the skip in place (the 3D NT view then degrades
gracefully rather than freezing).

### Step 2: `buildSegments()` — nucleotide array → `SegmentInfo`

This is the most complex part. For each of `scaf` and `stap` arrays, it walks the array in the direction of the strand (ascending for strand 0, descending for strand 1) and identifies **segment boundaries**:

**A segment starts when:**

- `isFreeStart`: `from = [-1,-1]` and `to = [curVh, nextIndex]` — free 5' end
- `isXoverEntryStart`: `from ≠ [-1,-1]` and `from[1] ≠ prevIndex` and `to = [curVh, nextIndex]` — the "from" comes from a non-adjacent position (crossover arrival)

**A segment ends when:**

- `isFreeEnd`: `to = [-1,-1]` and `from = [curVh, prevIndex]` — free 3' end
- `isXoverExitEnd`: `to ≠ [-1,-1]` and `from[1] = prevIndex` and `to[3] ≠ nextIndex` — the "to" goes to a non-adjacent position (crossover departure)

Each `SegmentInfo` captures:

```ts
{
  startBpIdx: number,  // 5' position of this segment
  endBpIdx: number,    // 3' position of this segment
  from: Pos | null,    // where this segment's 5' came from (null = free)
  to: Pos | null,      // where this segment's 3' goes to (null = free)
  skipsAndLoops: Map<number, number>  // bp → -1 (skip) or 1 (loop)
}
```

All segments from both strands are stored in `VStrand.segments: [Set<SegmentInfo>, Set<SegmentInfo>]` indexed by strandSetIdx.

A non-empty base that can't start a segment while none is open is a **1-nt strand** (neither neighbour on this helix links to it, e.g. a single base between two crossovers). It never becomes a segment, so its index is recorded in `VStrand.singleNtBpIndices`. `toPart`, `replaceRegionInPart` and `toRegionInPart` call `_assertNoSingleNtStrands()` before mutating anything and reject the file with the helix[base] positions. Otherwise those bases would be silently dropped and their crossovers left dangling. Foldnano doesn't allow 1-bp segments (see `dna-model.md`).

### Step 3: Create VirtualHelices and Part

```ts
const newPart = new HoneycombPart(name, id, numBases); // or SquarePart
const vhs = vstrands.map(
	(vs, listRow) => new VirtualHelix(newPart, vs.num, listRow, vs.row, vs.col, numBases)
);
newPart.virtualHelices = vhs;
```

Lookup maps are built for O(1) access: `vhByIndex: Map<number, VirtualHelix>` and `vsByNum: Map<number, VStrand>`.

### Step 4: First pass — linear (non-circular) oligos

Iterates all `(vstrand, strandIdx, segInfo)` triples. Processes only segments with `segInfo.from === null` (free 5' ends = start of a linear strand):

```
for each segInfo with from === null:
  create Oligo
  create OligoSegment(part, vh, startBpIdx, endBpIdx)
  apply skipsAndLoops → segment.skipsAndInserts
  assign color from stap_colors / scaf_colors
  delete segInfo from set  ← mark visited
  if segInfo.to:
    extendThreePrime(...)  ← follow the chain
  add oligo to oligoSet
```

### Step 5: `extendThreePrime()` — recursive chain following

```
function extendThreePrime(part, vhByIndex, vsByNum, oligo, thisSegment, segInfo, tempStart?):
  if segInfo.to === tempStart: return   ← circular stop condition

  nextVh   = vhByIndex[segInfo.to.vhIdx]
  nextVs   = vsByNum[segInfo.to.vhIdx]
  nextInfo = nextVs.getSegmentStartAt(segInfo.to.strandIdx, segInfo.to.bpIdx)

  if !nextInfo: return   ← already visited or missing

  newSegment = new OligoSegment(part, nextVh, nextInfo.startBpIdx, nextInfo.endBpIdx)
  newSegment.skipsAndInserts = nextInfo.skipsAndLoops
  thisSegment.threePrime.connectTo(newSegment.fivePrime)
  oligo.addSegment(newSegment)
  delete nextInfo from nextVs.segments[strandIdx]   ← mark visited

  if nextInfo.to && !wouldReturnToTempStart:
    extendThreePrime(part, ..., newSegment, nextInfo, tempStart)
```

### Step 6: Second pass — circular oligos

All `SegmentInfo` objects remaining in the sets after the first pass are parts of **circular oligos** (no free 5' end).

```
for each remaining segInfo:
  tempStart = {vhIdx, bpIdx: segInfo.startBpIdx, strandIdx}
  create Oligo + OligoSegment (same as first pass)
  delete segInfo from set
  if segInfo.to:
    extendThreePrime(..., tempStart)   ← tempStart prevents infinite loop

  // close the circle
  firstSegment = oligo.segments.first
  lastSegment  = oligo.segments.last
  lastSegment.threePrime.connectTo(firstSegment.fivePrime)
```

### Step 7: Finalize

```ts
newPart.addOligosFromArray(Array.from(oligoSet));
newPart.rebuildRspCaches(); // rebuild spatial index
return newPart;
```

---

## Export pipeline: `CadnanoJSON.fromPart()`

**Names.** The top-level `"name"` is not trusted on import: the importer
(`createDocumentFromImportedPart`, the URL loader) renames the Part to the
document name, which comes from the file name. On export the toolbar writes the
exported file name into `"name"` (cadnano2's own convention). See
`dna-model.md` § Names.

The inverse of import. For each VirtualHelix:

1. Allocate `scaf[L]` and `stap[L]` arrays filled with `[-1,-1,-1,-1]`
2. For each segment on each strandSet:
   - Walk positions `lo..hi`
   - At each position, fill `[fromVh, fromBp, toVh, toBp]`:
     - Internal positions: `from = [curVh, prevBp]`, `to = [curVh, nextBp]`
     - 5' base: `from = [-1,-1]` if free, else `[conn.inVh, conn.threePrime.index]`
     - 3' base: `to = [-1,-1]` if free, else `[conn.inVh, conn.fivePrime.index]`
   - Record skips/loops in `loop[]` and `skip[]` arrays
3. Collect colors: for each oligo with a segment on this VH/strand, record the 5' end position and color

Mirror oligos (repeat-unit copies, see `docs/repeat-units.md`) are skipped entirely — cadnano has
no representation for them, so only the canonical (non-mirror) oligos are written.

`scafLoop`/`stapLoop` are written as `[]` unconditionally, matching upstream cadnano2/cadnano2.5's own
behavior: their encoders always emit these two fields empty, and none of their decoders (legacy or v2/v3)
ever read them back on import. They're dead write-only legacy fields in the original format itself, not
something we chose to drop — round-tripping them correctly would require populating both, and no known
consumer would notice either way. The importer (`VStrand` constructor) still accepts either spelling
(`scafLoop`/`stapLoop` or `scaf_loop`/`stap_loop`) defensively, in case a plugin or older export uses the
other form.

---

## Known Bug: Segment Connecting to Itself in Second Pass

### Symptom

During circular-oligo import (second pass), an `OligoSegment` can inadvertently have its `threePrime.connectTo(…fivePrime)` called with the same segment, triggering the error:

```
Cannot connect segment end to another end on the same segment
```

Or — if the guard fires at a different point — producing a malformed circular oligo with a single segment that points to itself.

### Root Cause

The second pass iterates over a **snapshot** of the segment set:

```ts
for (const segInfo of Array.from(segs)) {   // ← snapshot at this moment
  ...
  if (segInfo.to) {
    extendThreePrime(...);  // ← may delete OTHER segInfos from `segs`
  }
  // close the circle
  const firstSegment = ...;
  const lastSegment  = ...;
  lastSegment.threePrime.connectTo(firstSegment.fivePrime);  // ← BUG if only one segment
}
```

`extendThreePrime` calls `nextVStrand.segments[strandIdx].delete(nextSegmentInfo)` on the **live** set — not the snapshot. If two `segInfo` entries in the snapshot belong to the same circular oligo, the second one will be reached in the outer loop even though it was already consumed (deleted from the live set) while processing the first.

When the outer loop reaches this already-consumed `segInfo`:

1. A new (redundant) `Oligo` and `OligoSegment` are created at the same position
2. `extendThreePrime` finds no `nextSegmentInfo` (already deleted) and returns immediately
3. `newOligo` has exactly one segment: `firstSegment === lastSegment`
4. `lastSegment.threePrime.connectTo(firstSegment.fivePrime)` → self-connection!

### Fix

Add a guard at the top of the second-pass inner loop to skip already-consumed entries:

```ts
for (const segInfo of Array.from(segs)) {
  if (!segs.has(segInfo)) continue;   // ← already consumed by extendThreePrime
  ...
}
```

This is safe because `extendThreePrime` removes consumed entries from the live `segs` set, so `segs.has(segInfo)` will be false for already-visited segments.

### Why first pass doesn't have this bug

The first pass only processes segments where `segInfo.from === null`. All segments consumed by `extendThreePrime` during the first pass have `from !== null` (they are continuation segments, not free 5' ends), so even if they remain in the snapshot, they are skipped by the `if (segInfo.from !== null) continue;` guard.

---

## Data structures summary

| Class / Type  | Role                                                                           |
| ------------- | ------------------------------------------------------------------------------ |
| `VStrandJSON` | raw JSON shape for one virtual helix                                           |
| `VStrand`     | wraps `VStrandJSON`; runs `buildSegments()` on construction                    |
| `SegmentInfo` | one contiguous run of nts within a vstrand/strand, with connectivity pointers  |
| `Pos`         | `{vhIdx, bpIdx, strandIdx}` — a position reference used in `from`/`to`         |
| `Nt`          | `[fromVhIdx, fromBpIdx, toVhIdx, toBpIdx]` — per-nucleotide connectivity tuple |
| `Color`       | `[fivePrimeIdx, 24bitColorInt]`                                                |
| `SkipORLoop`  | `Map<bpIdx, -1 \| 1>`                                                          |
| `CadnanoJSON` | top-level class: `toPart()` for import, `fromPart()` for export                |

---

## File Parser System

Import is handled by a pluggable parser registry in `src/lib/components/Editor/Toolbar/parsers/`.

**`index.ts`** defines the `DesignFileParser` interface and holds the registry:

```typescript
interface DesignFileParser {
	id: string;
	priority?: number; // higher runs earlier
	canParse(raw: Record<string, unknown>, meta: FileMeta): boolean;
	parse(raw: Record<string, unknown>, meta: FileMeta): Part | FoldnanoDocument | PluginManifestFile;
}
```

Three parsers are registered (`fpluginParser` only recognizes plugin manifests in order to refuse
them with a clear message, and is out of scope for this doc; the two cadnano-relevant ones are):

| Parser               | File: `id`      | Extension heuristic                                                   | Parse path                                                                                                                                                                      |
| -------------------- | --------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cadnanoParser`      | `cadnano-json`  | `raw.vstrands` array present                                          | `CadnanoJSON.toPart()` → returns a `Part`, wrapped in a `FoldnanoDocument` by the caller                                                                                        |
| `foldnanojsonParser` | `foldnano-json` | `format: 'foldnano'` or a top-level `parts` array; usually `.fn.json` | `FoldnanoDocument.fromJSON()` — restores the full document directly; a `DocumentFormatError` (e.g. file from a newer app) is rethrown unwrapped so its message reaches the user |

Native Foldnano files use `.fn.json`. Older `.cweb.json` files are still accepted when their JSON shape has a top-level `parts` array.

The `.fn.json` format is the application's own serialization (`FoldnanoDocument.toJSON()`) and contains the full document tree including part, oligos, segments, and all connections — it does not go through the cadnano nucleotide-array reconstruction logic.

---

## Edge cases handled

| Case                      | Handling                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| Circular scaffold         | second pass + `tempStart` prevents infinite recursion                                             |
| Crossovers within same VH | `isXoverExitEnd` / `isXoverEntryStart` match non-adjacent "to"/"from" even when `vhIdx === curVh` |
| Missing color entry       | falls back to `Oligo`'s randomly-generated color                                                  |
| Color value sanitization  | `colorNum = thisColor[1] & 0xFFFFFF` masks to 24 bits                                             |
| Unknown lattice type      | throws `Unsupported lattice type`                                                                 |
| 1-nt strand               | throws, listing each helix[base]; see Step 2                                                      |

---

## Boundaries / Don'ts

- **Cadnano export is region-scoped.** `CadnanoJSON.fromRegion(region)` exports a single `LatticedDesignRegion`; cross-region oligo connections are dropped and surfaced via the returned `droppedCrossRegionConnections` list. Don't try to round-trip multi-region parts through cadnano JSON.
- **Don't export freeform parts as cadnano.** Cadnano has no representation for freeform geometry; `supportsCadnanoJson` is `false` for freeform regions.
- **Don't bypass `isScafToStrandSetIdx` at the file boundary.** The cadnano `scaf`/`stap` array assignment is parity-dependent for directional round-trip; reading `scaf`/`stap` directly without this helper inverts directionality on odd VHs. Despite the name, this helper is a _file-format adapter only_ — it does not (and must not) consult or mutate `Oligo.isScaffold`. Outside `cadnanoJSON.ts` no code should look at "scaf vs stap"; use the model's `strandSets[0]` / `strandSets[1]` directly.
- **Lattice detection is by base count** (`% 32` square, `% 21` honeycomb). Don't infer lattice from filename or other metadata.
- **Don't add a parser without registering it.** `parsers/index.ts` dispatches by `priority` order; new formats need both `parse()` and `canParse()` plus a registration entry.
- **Native files use `.fn.json` and skip the cadnano reconstruction path.** Don't run `.fn.json` content through `CadnanoJSON.toPart()`.
