---
covers:
  - src/lib/model/io/oxdnaExport.ts
  - src/lib/model/io/oxdnaConstants.ts
  - src/lib/components/Editor/View3D/OxDnaExportDialog.svelte
---

# oxDNA Export

Foldnano can export any design to the oxDNA configuration format (`.dat` + `.top`), enabling downstream molecular-dynamics simulation in [oxDNA](https://oxdna.org) or visualisation in [oxView](https://sulcgroup.github.io/oxdna-viewer/).

---

## File Format Overview

oxDNA uses two plain-text files together:

| File   | Content                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------- |
| `.dat` | Configuration file: simulation box, and per-nucleotide position + orientation vectors + velocity     |
| `.top` | Topology file: total nucleotide / strand count, and per-nucleotide base identity + neighbour indices |

### `.dat` structure

```
t = 0
b = <L> <L> <L>             # simulation box — must be cubic (equal sides)
E = 0 0 0                    # total / potential / kinetic energy
<r.x> <r.y> <r.z>  <a1.x> <a1.y> <a1.z>  <a3.x> <a3.y> <a3.z>  0 0 0  0 0 0
...one line per nucleotide...
```

### `.top` structure — classic (per-nucleotide) format

Foldnano writes the **classic oxDNA topology format**, the same format produced by [tacoxDNA](https://github.com/lorenzo-rovigatti/tacoxDNA). This keeps the output diff-comparable against tacoxDNA reference files and works with all oxDNA builds (no version requirement):

```
<N_nucleotides> <N_strands>
<strandId> <base> <next> <prev>
...one line per nucleotide, in the same order as the .dat file...
```

Per-nucleotide fields:

| Field      | Meaning                                                      |
| ---------- | ------------------------------------------------------------ |
| `strandId` | 1-based strand index                                         |
| `base`     | A / T / C / G                                                |
| `next`     | row index of the 3′ neighbour, or `-1` if this is the 3′ end |
| `prev`     | row index of the 5′ neighbour, or `-1` if this is the 5′ end |

The nucleotide order in the `.top` file matches the row order in the `.dat` file: strand 1 occupies rows 0…(len₁−1), strand 2 occupies rows len₁…(len₁+len₂−1), and so on. Within each strand, rows are written in 5′→3′ order, so `prev = row − 1` and `next = row + 1` for interior nucleotides; circular oligos wrap `prev`/`next` around the strand's first and last rows.

**Note:** The `.top` file encodes only intra-strand sequence and connectivity. There is no explicit cross-strand pairing field in either file. Watson–Crick base-pairing in oxDNA is purely emergent from geometry: the force field applies base-pairing potentials based on spatial proximity and antiparallel `a1` vectors.

---

## Coordinate System

The NT model computes all geometry in **nanometres**. `oxdnaExport.ts` divides every
position by `OXDNA_NM = 0.8518` before writing, so the `.dat` file contains values
in **oxDNA units** (not nm).

Orientation vectors (`a1`, `a3`) are dimensionless unit vectors and require no
conversion.

| Vector | Meaning                                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------- |
| `r`    | Centre-of-mass (CM) position of the nucleotide                                                                       |
| `a1`   | Unit vector pointing from the backbone (sugar/phosphate) **toward the base** — i.e. **inward** toward the helix axis |
| `a3`   | Unit vector pointing in the **5′ direction** along the backbone (away from the 3′ neighbour)                         |

oxDNA places interaction sites relative to `r`:

| Site                                 | Offset        |
| ------------------------------------ | ------------- |
| Hydrogen-bonding (base-pairing face) | `r + 0.4 a1`  |
| Stacking face                        | `r + 0.34 a1` |
| Backbone repulsion (phosphate)       | `r − 0.4 a1`  |

Because the HB site is in the `+a1` direction, **`a1` must point toward where the
partner base is** — i.e. inward toward the helix axis for B-DNA. An outward-pointing
`a1` would place the HB site on the outer face of each strand so the two
complementary strands could never pair.

### Physical constants (oxDNA v2)

All constants are defined in `src/lib/model/io/oxdnaConstants.ts` and used by
both `simulationNtModel.ts` (converted to nm) and `oxdnaExport.ts` (unit conversion).

| Constant             | Value              | Meaning                                |
| -------------------- | ------------------ | -------------------------------------- |
| `OXDNA_NM`           | 0.8518             | nm per oxDNA unit                      |
| `OXDNA_BASE_BASE`    | 0.3898 oxDNA units | rise per base pair                     |
| `OXDNA_CM_CENTER_DS` | 0.6 oxDNA units    | CM distance from helix axis (dsDNA)    |
| `OXDNA_HEX_DIST`     | 2.55 oxDNA units   | honeycomb inter-helix centre-to-centre |
| `OXDNA_SQ_DIST`      | 2.60 oxDNA units   | square inter-helix centre-to-centre    |

In nanometres: CM sits at **0.511 nm** from the helix axis; the phosphate backbone
(`r − 0.4 a1`) sits at **0.852 nm** from the axis; rise per bp is **0.332 nm**.

For a B-DNA double helix:

- Strand 0 (5′→3′ in the +Z direction): `a3 = (0, 0, +1)`.
- Strand 1 (antiparallel, 5′→3′ in the −Z direction): `a3 = (0, 0, −1)`.
- `a1` is the **negated outward radial** for both strands.

The backbone twist angle for a nucleotide at physical layer coordinate `c` is:

```
θ(c) = strandIndex × 180° + region.twistOffsetInDeg + region.twistPerBaseInDeg × c
a1 = (−cos θ, −sin θ, 0)   [before plane transform]
```

`twistOffsetInDeg` per lattice type (from `DesignRegion` defaults):

| Lattice   | `twistOffsetInDeg` |
| --------- | ------------------ |
| Honeycomb | 340°               |
| Square    | 195°               |
| Freeform  | region default     |

`c` is the physical layer coordinate within a helix span — equal to `bpIndex` for
normal slots, distributed between fixed endpoint frames when inserts/skips are
present (see Insert / Skip Handling below).

---

## Export Code Location

```
src/lib/model/io/oxdnaConstants.ts      — physical constants (oxDNA units)
src/lib/model/io/simulationNtModel.ts   — NT model builder (outputs nm)
src/lib/model/io/oxdnaExport.ts         — nm → oxDNA units, .dat/.top formatter
```

`simulationNtModel.ts` builds the reusable nucleotide-level model in nanometres,
used by both the oxDNA exporter and the 3D "Show NT Model" view.
`oxdnaExport.ts` converts nm positions to oxDNA units and writes classic `.dat` / `.top` text.

Key public API in `oxdnaExport.ts`:

```typescript
// Returns true if any nucleotide slot contains a real (non-N) base.
export function hasRealSequence(part: Part): boolean;

// Returns true if any nucleotide slot lacks a real base (triggers the export dialog).
export function hasUnassignedSequence(part: Part): boolean;

// Collect all nucleotides as structured objects (used by the 3D view and tests).
export function collectOxDnaNucleotides(
	part: Part,
	segPositionOverrides?: Map<string, BlockTransformOverride>,
	fallbackBase?: OxDnaFallbackBase, // default 'T'
	includeMirrors?: boolean // default false — export the assembled multimer
): OxDnaNucleotide[];

// Main entry point: returns { dat, top, nucleotideCount, strandCount }.
export function exportPartToOxDna(
	part: Part,
	segPositionOverrides?: Map<string, BlockTransformOverride>,
	fallbackBase?: OxDnaFallbackBase, // default 'T'
	includeMirrors?: boolean // default false
): OxDnaExportResult;
```

`OxDnaFallbackBase` is `'A' | 'T' | 'C' | 'G' | 'random'`.

Mirror oligos (repeat-unit copies, see `docs/repeat-units.md`) are excluded unless
`includeMirrors` is set — the 3D Export menu shows an "Include mirror copies" toggle
when the part has mirrors.

Key public API in `simulationNtModel.ts`:

```typescript
// Build the nucleotide-level model in nanometres.
export function buildSimulationNtModel(
	part: Part,
	options?: { fallbackBase?: SimulationFallbackBase; includeMirrors?: boolean }
): SimulationNtModel;

// Per-VH simulation frame (oxDNA inter-helix spacing, plane-transformed).
// Used by both the NT model builder and the 3D view cylinder positioning.
export function simulationFrameForVh(part: Part, vh: VirtualHelix): VirtualHelixFrame;

// Exported nm constants (derived from oxdnaConstants.ts):
export const RISE_NM: number; // 0.332 nm — rise per base pair
export const CM_TO_BACKBONE_NM: number; // 0.341 nm — CM to phosphate backbone (along -a1)
```

---

## Sequence Handling

The `.top` file requires a base letter (A/T/C/G) for every nucleotide. cadnano designs may have no sequence assigned (slots hold `'N'`), or may be only partially assigned.

### Export flow in `View3D.svelte`

1. User clicks the Export oxDNA button.
2. `hasUnassignedSequence(part)` is called.
3. **All positions assigned** → export runs immediately with no dialog.
4. **Any unassigned position** (no sequence at all, or partially filled design) → `OxDnaExportDialog.svelte` opens and explains:
   - Unassigned dsDNA positions will be filled with random sequences, with Watson-Crick complementary constraints applied automatically.
   - The user chooses what to fill remaining **ssDNA** positions with: A / **T** / C / G / Random. Default is **T**, a common ssDNA placeholder in oxDNA simulations.
5. On confirm, `exportPartToOxDna` is called with the chosen `fallbackBase`.

### Base resolution rules (`resolveBase`)

`resolveBase` and `buildBaseCache` now live in `simulationNtModel.ts` (shared with the mrDNA
exporter and the 3D NT model), not in `oxdnaExport.ts`. For every nucleotide `buildSimulationNtModel`
calls `resolveBase`. All nucleotides — normal, insert anchor, and insert loop — use the **same**
complement-caching logic, applied in order:

1. **Real base already assigned** (A/T/C/G in the slot) → use it as-is.
2. **Complement already cached** → return its Watson-Crick complement; store the result.
3. **dsDNA** (complement position occupied at the same `loopIndex`) → generate a random base and cache it so the partner can complement it.
4. **ssDNA** (no partner at this `loopIndex`) → use `ssDnaFallback`; store in cache.

Insert loop nts (loopIndex ≥ 1) pair with the corresponding loop nt at the same `loopIndex` on the other strand if one exists; otherwise they are treated as ssDNA.

### dsDNA complement mechanism and loopIndex keys

`buildBaseCache` makes a single pass over all oligos and returns:

- `cache` — real (ACGT) bases from every nucleotide, keyed by position.
- `occupied` — every nucleotide position using the same key scheme.

**Key scheme.** Because `slot.seq` is stored in 5′→3′ order for each strand, the position of the canonical nt within the slot differs by strand direction:

| Strand            | Canonical nt in `slot.seq` | Loop nts           |
| ----------------- | -------------------------- | ------------------ |
| si=0 (ascending)  | j=0 (first)                | j=1, 2, …, count−1 |
| si=1 (descending) | j=count−1 (last)           | j=0, 1, …, count−2 |

`loopIndex` = distance from the canonical in the insert-loop direction:  
`loopIndex = j` (si=0) or `count − 1 − j` (si=1).

Keys:

- **Canonical nt**: `${vhIdx}:${si}:${bpIndex}` (no suffix).
- **Loop nt with loopIndex k**: `${vhIdx}:${si}:${bpIndex}:${k}`.

The complement key swaps `si` ↔ `1−si` with the same suffix. This ensures the canonical on si=0 always pairs with the canonical on si=1 (`bpIndex` key, no suffix), and loop-k on si=0 always pairs with loop-k on si=1 (`:k` suffix). Whichever strand is processed first writes a random base; the second reads its WC complement.

---

## Geometry Source

Per-nucleotide positions and orientation vectors are computed by `simulationNtModel.ts`
in nanometres. `oxdnaExport.ts` divides every position by `OXDNA_NM = 0.8518` before
writing the `.dat` file.

Geometry is always recomputed from the current model state at export time.

### Visual mismatch between the 3D view and oxView

The in-app 3D view and the exported structure viewed in
[oxView](https://sulcgroup.github.io/oxdna-viewer/) are topologically identical but
**not geometrically identical** for latticed parts. Two reasons:

**1. Simulation inter-helix spacing**

Both the 3D "Show NT Model" view and the oxDNA export use `simulationFrameForVh`,
which places helix centres at oxDNA rest distances (~2.172 nm for honeycomb,
~2.215 nm for square). The normal 3D view uses visual positions (2.6 nm for both),
so switching to NT model mode shifts the rendered helix positions.

**2. Box placement**

The `.dat` writer calls `anchorNucleotidesInBox` before writing, which shifts the
structure's mean nucleotide position to `(side/2, side/2, side/2)`. The 3D view is not
shifted. This changes the overall position in the oxDNA file but does not affect
relative positions within the structure.

**3. Minor / major groove**

The exported CM positions of complementary nucleotides at the same base pair are
placed exactly **180° apart** around the helix axis — no groove asymmetry is encoded
in `r` itself. This is intentional and correct.

The oxDNA2 paper (Šulc et al., J. Chem. Phys. 142, 234901, 2015) introduced groove
asymmetry by shifting the **backbone interaction site** tangentially, not by shifting
the CM position:

```
backbone_site = r − 0.4·a1 + 0.3408·a2     (a2 = a3 × a1)
```

The CM position `r` sits on a circular helix; the groove geometry is baked into the
force-field interaction-site offsets. The oxDNA2 force field drives any starting
configuration toward groove-correct B-DNA geometry during MD relaxation — symmetric
CM positions are fine as a starting point.

The groove also appears in **oxView rendering** for the same reason: oxView draws the
backbone sphere at `r − 0.34·a1 + 0.3408·a2`, so the tangential offset is applied
visually. Because `a3` and `a1` both flip sign for the complementary strand, their
cross product `a2 = a3 × a1` is the **same direction for both strands** in a base
pair. Both backbone spheres are therefore displaced by the same tangential amount,
breaking bilateral symmetry and producing the characteristic minor / major groove
appearance in oxView. Numerically this moves the visual backbone-to-backbone angle
from 180° to approximately **140°**.

tacoxDNA (the reference converter we test against) also places CM positions
symmetrically — no tangential groove offset on `r`.

The "Show NT Model" toggle in the 3D view renders backbone dots at
`pos − CM_TO_BACKBONE · a1` (no `a2` term), so it shows no groove. This is a
rendering difference only — the underlying oxDNA positions and force-field geometry
are the same in both views.

## Relaxed Positions

When the rigid-body simulation (RBS) has been run and the _Use relaxed positions_ toggle is on, `exportOxDnaFn` passes the current `simOverrides` (a `Map<segmentId, BlockTransformOverride>`) to `exportPartToOxDna`. Each override rotates and translates the segment's nucleotides from their flat-lattice positions into the relaxed 3D layout.

The stale-positions warning (yellow Export button) appears when the topology has changed since the last simulation run — the exported coordinates are then from a previous solve that may not match the current design.

---

## Insert / Skip Handling

Inserts/skips are treated as duplex-level edits and must be symmetric on both
strands. Export fails with a clear validation error if saved/imported data has an
insert or skip on only one strand, or if the two complementary slots have
different inserted counts.

The NT model first expands each VH into physical BP layers:

- normal slot: one physical layer
- symmetric skip: zero physical layers
- symmetric insertion count `n`: `1 + n` paired physical layers

Constrained lattice crossovers are fixed geometry anchors. If either strand at a
BP participates in a constrained crossover, the whole BP frame is fixed. Inserts
and skips at constrained crossover sites are invalid.

Helix spans are split by constrained anchors and occupied-range boundaries:

- fixed-fixed spans distribute all physical layers between the fixed endpoint frames
- one-fixed spans extend naturally away from the fixed endpoint
- free-free spans extend naturally toward increasing bp index

Unconstrained connections affect strand topology only; they do not pin geometry.

### Parity vs tacoxDNA

The spec at `src/lib/model/io/oxdnaExportFiles.spec.ts` writes every test design
under `test_files/fixtures/oxdna_export/Foldnano/` and compares the count of

> 1.5-oxDNA backbone bonds against the matching `Taco/<design>.{dat,top}` reference.

**Test-fixture layout** (under `test_files/fixtures/oxdna_export/`):

| Path        | Committed? | Purpose                                                            |
| ----------- | ---------- | ------------------------------------------------------------------ |
| `Taco/`     | yes        | tacoxDNA `.dat`/`.top` references — frozen ground truth            |
| `Foldnano/` | no         | regenerated by `oxdnaExportFiles.spec.ts` on every run; gitignored |

Source cadnano designs live under `test_files/published_cadnano_designs/`.

**Regenerating Taco references.** The pinned upstream version:

```
repo:    https://github.com/lorenzo-rovigatti/tacoxDNA
commit:  01f93f74d162ab48f35d8793411c8ddba8bc8852  (2026-04-09)
```

```bash
cd test_files/fixtures/oxdna_export
git clone https://github.com/lorenzo-rovigatti/tacoxDNA.git
cd tacoxDNA && git checkout 01f93f74d162ab48f35d8793411c8ddba8bc8852 && cd ..
for f in ../../published_cadnano_designs/*.json; do
    python3 tacoxDNA/src/cadnano_oxDNA.py "$f" sq  # or 'he' for honeycomb
    base=$(basename "${f%.json}")
    mv "${base}.oxdna.top" "Taco/${base}.top"
    mv "${base}.oxdna.dat" "Taco/${base}.dat"
done
```

Pick `sq` or `he` to match the design's lattice. Current long-bond counts:

| Design                          | Foldnano | Taco | Notes                                    |
| ------------------------------- | -------- | ---- | ---------------------------------------- |
| 8hb_2ab_8f                      | 30       | 12   |                                          |
| Force clamp                     | 371      | 0    |                                          |
| LargeTetrascaffold-B-3          | 318      | 36   |                                          |
| NRs_antenna                     | 348      | 116  |                                          |
| N_nanobase                      | 297      | 0    |                                          |
| slottedcross                    | 410      | 4    |                                          |
| 4FSF_25_2b_loopbackscaffold     | 304      | 164  |                                          |
| Hilbert                         | —        | —    | no Taco reference                        |
| righthanded_turbine_only        | —        | —    | no Taco reference                        |
| Krishnan_NatCommun2016_pin pore | skipped  | —    | insert on one strand only in legacy file |

Foldnano counts are higher than tacoxDNA because the new symmetric NT model uses
a different twist-offset convention (uniform per-region vs. per-VH in tacoxDNA),
which misaligns crossover sites slightly. These long bonds relax quickly in an MD
run. The spec asserts counts are finite but does not enforce a maximum.

---

## Simulation Box

The box is sized and centered around the **mean nucleotide position**, not the bounding-box
midpoint, with a 4 oxDNA-unit (≈3.4 nm) padding per axis and a 10 % margin:

```
mean   = average of all nucleotide positions
maxDev = max(|position − mean|) per axis, over all nucleotides
side   = max(maxDevX, maxDevY, maxDevZ, 0.5) × 2 + 2 × padding, then × 1.1
box    = side × side × side   (cubic)
```

The box is always **cubic** (equal sides). oxDNA requires a cubic box by default; non-cubic boxes require `box_type = orthogonal` in the input file, which most users will not have set. Using the largest per-axis deviation for all three sides is consistent with what oxView produces on re-export.

### Box placement: centered on the mean, not the bounding-box midpoint

`anchorNucleotidesInBox` shifts the structure's **mean** nucleotide position to
`(side/2, side/2, side/2)` before writing the `.dat` file.

This matters because oxView — and any other center-of-mass-based PBC tool — recenters a loaded
structure using the **mean** nucleotide position, then independently wraps each nucleotide
("Monomer" inboxing, oxView's default) that falls more than half a box-length from that mean.
oxView does this unconditionally on every configuration load
(`parseConf()` → `centerAndPBC()` in `ts/file_handling/io.ts`), using its own
`centeringMode = 'Origin'` / `inboxingMode = 'Monomer'` defaults — it recomputes its own center
regardless of what convention we wrote the file with.

Two earlier versions of this exporter got this wrong in different ways:

- **Centered at the world origin** (`position − bboxMidpoint`): mathematically contains the
  structure, but doesn't match oxDNA's own `CubicBox::normalised_in_box` (`[0, side)` per axis,
  corner-anchored, not `[-side/2, side/2]`), and oxView's default recenter/wrap made the choice
  irrelevant anyway.
- **Anchored at the box corner** (`position − (bboxMidpoint − side/2)`): matched oxDNA's own
  `CubicBox` convention, but sized the box from the **bounding-box** midpoint/extent. For a
  design whose nucleotide density is asymmetric along an axis (e.g. a wide, dense hub tapering
  into a long, sparse arm), the bounding-box midpoint and the mean position can differ by a
  significant fraction of the extent. oxView's own recenter-to-mean step then puts a handful of
  outlier nucleotides _just past_ its own half-box threshold — even though every position was
  safely inside the _bbox-centered_ box we wrote — and its per-monomer wrap flips just those
  nucleotides to the opposite corner, disconnected from their strand neighbors, with no
  relaxation or simulation needed to trigger it.

Sizing and centering around the **mean** (not the bbox midpoint) fixes both: it matches what
oxView will independently recompute, so its wrap is a no-op, and the padding/margin headroom is
measured from the point that actually matters.

Velocities and angular momenta are written as zeros, which is correct for a starting configuration.

---

## Boundaries / Don'ts

- **Don't read VH placement from `vh.latticeCoords` / `vh.localFrame` directly.** Use `part.getVirtualHelixFrame(vh)` so plane transforms apply.
- **Don't persist `segPositionOverrides`.** RBS overrides come from `SimulationRunner` — they are passed in for one export and never written back to the model.
- **Don't change the cubic-box assumption** without also updating the oxDNA input-file flag (`box_type = orthogonal`); most user setups assume cubic.
- **Don't size or center the box from the bounding-box min/max.** oxView (and other COM-based PBC viewers) recenter using the _mean_ nucleotide position and independently wrap outliers relative to that — see § Simulation Box above. Use `computeMeanAndMaxDeviation` / `anchorNucleotidesInBox`, which size and center around the mean, not the bbox midpoint.
- **Don't allow unassigned sequences silently.** Use `hasUnassignedSequence(part)` to surface a warning and let the user pick the fallback base before running export.
- **Don't reshape `.dat` / `.top` line formats.** They are exact column-counted formats consumed by oxDNA — extra whitespace or reordered columns will fail to parse.
- **Don't export freeform-only parts and expect cadnano-style staple ordering.** Strand ordering is by oligo iteration; the `top` file reflects whatever order the model produces.
