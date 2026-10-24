---
covers:
  - src/lib/model/io/simulationNtModel.ts
  - src/lib/model/checks/simulation.ts
---

# Simulation Nucleotide Model

`src/lib/model/io/simulationNtModel.ts` builds a reusable, format-agnostic
nucleotide-level model of a design in **nanometres**. Each downstream simulation
exporter (oxDNA, and future formats) converts from this model into its own units
and file layout.

The model is also consumed by the 3D view's "Show NT Model" toggle in
`helixGeometry.ts`.

---

## Public API

```typescript
// Build the full NT model for a part.
export function buildSimulationNtModel(
	part: Part,
	options?: { fallbackBase?: SimulationFallbackBase; includeMirrors?: boolean }
): SimulationNtModel;

// Returns part.getVirtualHelixFrame(vh) unchanged.
// Kept for semantic clarity; the 3D view now uses the same physical geometry as the NT model.
export function simulationFrameForVh(part: Part, vh: VirtualHelix): VirtualHelixFrame;

// nm constants derived from oxdnaConstants.ts (for callers that need them):
export const RISE_NM: number; // 0.332 nm — axial rise per base pair
export const CM_TO_BACKBONE_NM: number; // 0.341 nm — CM to phosphate backbone (along -a1)
```

`SimulationFallbackBase` is `'A' | 'T' | 'C' | 'G' | 'random'` (default `'T'`).

`includeMirrors` defaults to `true` here (the 3D "Show NT Model" toggle still renders mirror
copies), but the oxDNA/mrDNA exporters call this with `includeMirrors: false` by default and
expose an "Include mirror copies" toggle in the 3D Export menu when the part has repeat-unit
mirrors. See `docs/repeat-units.md`.

---

## Output Shape

```typescript
interface SimulationNtModel {
	nucleotides: SimulationNucleotide[];
	strandCount: number;
}

interface SimulationNucleotide {
	id: number; // 0-based global index; matches row in .dat / .top
	strandId: number; // 1-based strand index
	base: string; // A / T / C / G
	baseAssigned: boolean; // true if base came from an assigned seq char, not an auto-fill fallback
	segmentId: string; // source OligoSegment.id
	vhId: string; // source VirtualHelix.id
	vhIndex: number; // vh.index (display index)
	strandIdx: 0 | 1; // strand within the VH
	bpIndex: number; // cadnano bp index of the canonical slot
	loopIndex: number; // 0 for the canonical layer; ≥1 for inserted layers
	positionNm: Vec3; // CM position in nm (lab frame)
	a1: Vec3; // unit vector: backbone → base (inward toward helix axis)
	a3: Vec3; // unit vector: 5′ direction along backbone
	prev: number; // id of the 5′ neighbour; -1 if 5′ end; wraps for circular
	next: number; // id of the 3′ neighbour; -1 if 3′ end; wraps for circular
	pairKey: string; // shared key with the complementary strand nt at same layer
	spanId: string; // identifies the helix span this nt belongs to
	isFixed: boolean; // true if this layer is a constrained anchor endpoint
}
```

Nucleotides are ordered in 5′→3′ strand order, matching how `.dat`/`.top` rows
are written. Circular oligos have `prev`/`next` wrap-around instead of `-1`.

---

## Physical Geometry

All geometry — the 3D view, the NT model, the RBS, and the oxDNA export — uses
the same physical (oxDNA v2) constants. The canonical values live in
`src/lib/model/geometry3d/dnaGeometry.ts` and are consumed directly by every
downstream module.

| Constant             | Location               | Value    | Derivation                                             |
| -------------------- | ---------------------- | -------- | ------------------------------------------------------ |
| `BACKBONE_RISE_NM`   | `dnaGeometry.ts`       | 0.332 nm | `OXDNA_BASE_BASE × OXDNA_NM`                           |
| `BACKBONE_RADIUS_NM` | `dnaGeometry.ts`       | 0.852 nm | `(0.6 + 0.4) × OXDNA_NM` (backbone)                    |
| `SQ_INTERHELIX_NM`   | `dnaGeometry.ts`       | 2.215 nm | `OXDNA_SQ_DIST × OXDNA_NM`                             |
| `HEX_INTERHELIX_NM`  | `dnaGeometry.ts`       | 2.172 nm | `OXDNA_HEX_DIST × OXDNA_NM`                            |
| `RISE_NM`            | `simulationNtModel.ts` | 0.332 nm | same derivation; used internally for NT layer coords   |
| `CM_RADIUS_NM`       | `simulationNtModel.ts` | 0.511 nm | `OXDNA_CM_CENTER_DS × OXDNA_NM` — nucleotide CM radius |
| `CM_TO_BACKBONE_NM`  | `simulationNtModel.ts` | 0.341 nm | `0.4 × OXDNA_NM`                                       |

`BACKBONE_RADIUS_NM` is the phosphate backbone distance: CM (0.6 oxDNA units) plus
the CM-to-backbone offset (0.4 oxDNA units) in the outward radial direction = 1.0
oxDNA unit × 0.8518 nm. It is used for rendering strand tube lines and for RBS
attachment-point geometry.

### simulationFrameForVh

`simulationFrameForVh` is now a thin wrapper that returns
`part.getVirtualHelixFrame(vh)` for all VH types. Because `dnaGeometry.ts`
already uses physical inter-helix spacing (`SQ_INTERHELIX_NM` / `HEX_INTERHELIX_NM`)
for the lattice coordinate functions, the regular frame is already at the correct
physical position — no scale factor is applied.

### NT position formula

For a physical layer at coordinate `c` (bp units along the helix axis) and twist angle `θ`:

```
center    = vhFrame.origin + vhFrame.axis × c × RISE_NM
radial    = cos(θ) × vhFrame.radial0 + sin(θ) × (vhFrame.axis × vhFrame.radial0)
positionNm = center + radial × CM_RADIUS_NM
a1        = −radial
a3        = ±vhFrame.axis   (+ for strandIdx=1, − for strandIdx=0)
```

The phosphate backbone position (used by `helixGeometry.ts` for the backbone tubes/rungs) is:
`backbone = positionNm − CM_TO_BACKBONE_NM × a1`

---

## Algorithm

### 1 — Validation

`buildSimulationNtModel` first calls `assertSimulationReady(part)` (the simulation profile in
`src/lib/model/checks/simulation.ts`, see `design-guards.md`), which throws
`Cannot export simulation model: <issue>` on the first of:

- **Different skip/insert per strand** (`asymmetric-skip-insert`, an integrity rule): both strands
  have a slot at the base but with different `seq.length`.
- **Skip/insert on one strand only** (`unpaired-skip-insert`, simulation-only): a modified slot whose
  opposite strand has no segment there. The editor allows this (deleting the partner strand leaves
  it), so it is not an integrity issue. Single-stranded DNA itself simulates fine; what the NT model
  can't place is a one-sided skip/insert, so the message asks the user to make the ssDNA explicit
  (ordinary strand bases, a shorter strand for a skip) or remove the skip/insert. Don't model ssDNA
  with one-sided inserts.
- **Skip/insert at a constrained anchor** (`skip-insert-on-crossover`, an integrity rule).

oxDNA and mrDNA export and the 3D view's NT mode all build through here, so they share these
messages; the 3D view catches the throw and falls back to strand rendering.

### 2 — Physical layer expansion

Per BP:

| Slot state                | Physical layers emitted          |
| ------------------------- | -------------------------------- |
| Normal (`seq.length = 1`) | 1 layer (`loopIndex = 0`)        |
| Skip (`seq.length = 0`)   | 0 layers                         |
| Insert count `n`          | `1 + n` layers (`loopIndex` 0…n) |

### 3 — Span detection

`contiguousRanges` groups occupied bpIndices into unbroken runs. Adjacent runs are
then merged by `mergeAdjacentRanges` if they are bridged by an internal same-VH
segment connection: when a segment's 3′ end connects (via `connectTo`) to another
segment's 5′ end on the same VirtualHelix, the coverage gap between them is
treated as a physical gap in the helix (no nucleotide, but physical space) rather
than a true disconnection. Without this merge, an insert on one side of such a gap
would grow nucleotides past the gap and overlap with the other side.

Each merged run is then split at **constrained anchor** BPs (`isFixed = true`) by
`splitRangeByAnchors`, producing individual spans:

| Span type   | Both endpoints fixed? | Geometry rule                                                    |
| ----------- | --------------------- | ---------------------------------------------------------------- |
| fixed-fixed | yes                   | Natural bpIndex coords, linearly rescaled to the fixed endpoints |
| fixed-free  | one fixed             | Layers extend naturally from the fixed endpoint                  |
| free-free   | neither               | Layers placed at natural bpIndex positions                       |

For a fixed-fixed span, each layer's **natural coordinate**
`nat = bpIndex + Δ(bpIndex) + loopIndex` (the same value used for free-free spans)
is mapped linearly onto `[firstBp, lastBp]` via
`t = (nat − natFirst) / (natLast − natFirst)`. Because fixed anchors carry no
insert/skip (`assertSimulationReady` enforces this), `natFirst = firstBp` and
`natLast = lastBp + totalSpanNetOffset`.

- **No inserts/skips/gaps**: `nat = bpIndex`, so `coord = bpIndex` exactly — natural
  rise (`RISE_NM`) and twist (`twistPerBaseInDeg`) are reproduced.
- **Inserts/skips**: `natLast ≠ lastBp`, so layers are compressed (inserts) or
  stretched (skips) uniformly — total axial length and twist between the endpoints
  are conserved.
- **Physical gap inside the span** (a merged same-VH bridged gap): the missing
  bpIndices contribute no layers and no net offset, so `nat` jumps across them and
  the gap is preserved as empty axial space. **Do not** distribute by layer index
  (`t = i / (layers.length − 1)`) here — that ignores the gap and spreads
  nucleotides evenly across it, dropping them into the empty region (a past bug on a
  ~95 bp same-VH gap).

#### Coord formula for non-fixed-fixed spans

For each layer at `(bpIndex, loopIndex)`, the axial coordinate uses the cumulative
net offset `Δ(bp)` = Σ `(seqLen − 1)` for all bpIndices in the span strictly
before `bp` (inserts contribute `+n`, skips contribute `−1`, normal bps `0`):

| Case                   | Formula                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| firstFixed / free-free | `coord = bpIndex + Δ(bpIndex) + loopIndex`                                          |
| lastFixed              | `coord = lastBp − (lastBp − bpIndex) − Δ_after(bpIndex) − (seqLen − 1 − loopIndex)` |

where `Δ_after(bpIndex)` = total net offset for bpIndices strictly after `bpIndex` in the span.

This bpIndex-anchored formula handles physical gaps in merged ranges correctly: a
missing bpIndex (e.g., bp19 bridged by an internal same-VH connection) contributes
no layers and no net offset, so the gap is preserved as empty physical space with
the correct axial distance. The angle is `twistOffset + twistPerBase × coord` for
all non-fixed-fixed cases.

### 4 — Base resolution

`buildBaseCache` pre-scans all slots to collect assigned (A/T/C/G) bases and marks
occupied positions. `resolveBase` then fills each nucleotide in order:

1. Assigned base → use it.
2. Complement already in cache → return its Watson-Crick pair.
3. dsDNA, complement position occupied but not yet cached → generate random base,
   cache so partner can complement.
4. ssDNA (no complementary slot at this loopIndex) → use `fallbackBase`.

---

## Constrained Anchors

A BP is a constrained anchor (`isFixed = true`) when:

- The region has `supportsConstrainedXoverSites = true` (lattice regions only), **and**
- Either strand at that BP has a connected `End` where `!end.isFree && end.isConstrained`.

Unconstrained connections affect strand topology (`prev`/`next` linkage) but do
**not** pin geometry — they are not fixed anchors. Same-VH connections (a segment's
3′ end connected to another segment's 5′ end on the same VirtualHelix) are always
unconstrained; they cause `mergeAdjacentRanges` to join the two coverage ranges
rather than treating the gap as a span boundary.

---

## 3D View vs Export

Both the oxDNA exporter and `helixGeometry.ts` call `buildSimulationNtModel`.
The key difference is how the positions are used:

| Consumer           | Positions used as                                                                          | Helix frame source          |
| ------------------ | ------------------------------------------------------------------------------------------ | --------------------------- |
| `oxdnaExport.ts`   | nm → ÷ OXDNA_NM → oxDNA units written to `.dat`                                            | `part.getVirtualHelixFrame` |
| `helixGeometry.ts` | nm directly as Three.js world coords; backbone offset applied (`- CM_TO_BACKBONE_NM × a1`) | `part.getVirtualHelixFrame` |

All consumers share the same physical frame. The "Show NT Model" toggle no longer
repositions helices — it replaces the strand polylines with a soft, watercolor-style
overlay: one translucent backbone **tube** per strand run (`TubeGeometry` through the
backbone points, fresnel ShaderMaterial in a softened oligo colour) plus **base-pair
rungs** between complementary nucleotides (grouped by `pairKey`). Rungs are tinted by
pair type — A·T vs G·C — using `baseAssigned` to fall back to pale gray when the
sequence is unassigned. The backbone points trace the same helix axes as the regular
strand tubes (both at `BACKBONE_RADIUS_NM`).

---

## Boundaries / Don'ts

- **What the NT model can't place is decided in `checks/simulation.ts`, not here.** Keep `assertSimulationReady(part)` as the first call in `buildSimulationNtModel`, and when the model learns to place something new (or stops), update the profile; see `design-guards.md` § Changing the checks.

- **Don't add insert/skip support for single-stranded-only positions.** Inserts/skips
  are duplex-level edits; the NT model treats ssDNA-only slots as fixed geometry.
- **Don't add a separate lattice-vs-freeform branch inside `simulationFrameForVh`.**
  It always delegates to `part.getVirtualHelixFrame(vh)`; that function already
  handles all VH types correctly.
- **Don't bypass the symmetry and constrained-anchor validation.** Export should
  fail loudly on invalid saved/imported data rather than silently producing wrong
  geometry. The 3D **"Show NT Model"** toggle is the one exception in _surfacing_:
  `View3D.svelte` wraps the build in try/catch, toasts the error, reverts the toggle
  (`onNtModelError`), and falls back to the regular strand rendering — a thrown builder
  must never escape the geometry-rebuild `$effect` and freeze the app. The cadnano
  importer also pre-empts the most common trigger by relocating deletions off crossover
  sites (`relocateSkipsOffCrossovers`, see `docs/cadnano-import.md`).
- **Don't store oxDNA units in `positionNm`.** All fields on `SimulationNucleotide`
  are in nm; conversion is the exporter's responsibility.
- **Don't use layer-count arithmetic (`firstBp + i`, `lastBp − offsetFromEnd`,
  `t = i / (layers.length − 1)`) for _any_ coord calculation — including fixed-fixed.**
  These break when a span contains a physical gap (missing bpIndex from a merged
  same-VH connection): the layers get spread evenly and nucleotides land in the empty
  gap. Use the bpIndex-anchored natural coordinate (`bpIndex + cumNetOffsetAt + loopIndex`),
  and for fixed-fixed rescale it onto `[firstBp, lastBp]`.
