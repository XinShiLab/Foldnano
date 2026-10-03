---
covers:
  - src/lib/model/io/mrdnaExport.ts
---

# mrDNA Export

Foldnano can export any design to the mrDNA plain-text nucleotide format, enabling downstream multi-resolution coarse-grained simulation with [mrDNA](https://github.com/cmaffeo2/mrdna) (Maffeo & Aksimentiev, _Nucleic Acids Research_ 2020).

> For the reverse direction — loading an mrDNA-style `.txt` **back into** the 3D
> view as a non-editable reference overlay — see `editor-3d-view.md` § External
> Structure Overlay. The two share this file format but are separate code paths.

---

## File Format Overview

mrDNA reads a single plain-text `.txt` file. Each non-comment line represents one nucleotide, addressed by its 0-based line index (comment lines starting with `#` are skipped). All indices in the field columns reference these line numbers.

```
# Text input for mrdna: one line per nucleotide
# coord_x(nm) coord_y(nm) coord_z(nm) bp_idx stack_on_three_prime_idx three_prime_idx [seq Rxx...Rzz]
```

| Field                      | Meaning                                                          | −1 sentinel                  |
| -------------------------- | ---------------------------------------------------------------- | ---------------------------- |
| `coord_x/y/z`              | Nucleotide CM position in **nanometres**                         | —                            |
| `bp_idx`                   | 0-based index of the Watson-Crick base-pair partner              | ssDNA / unpaired             |
| `stack_on_three_prime_idx` | 0-based index of the intra-helix stacking partner on the 3′ side | crossover, ssDNA gap, 3′ end |
| `three_prime_idx`          | 0-based index of the 3′ phosphodiester neighbour                 | 3′ terminus of strand        |

Optional trailing fields (space-separated on the same line):

| Field       | Meaning                                                              |
| ----------- | -------------------------------------------------------------------- |
| `seq`       | Base letter: A / T / C / G                                           |
| `Rxx … Rzz` | Row-major 3×3 rotation matrix (local nucleotide frame → world frame) |

### bp pairing encoding

`bp_idx` stores each nucleotide's partner index: if nt A has `bp_idx = B`, then B has `bp_idx = A`. Because pairing is one-to-one, every value in the `bp_idx` column is distinct (no two nucleotides share the same partner). The symmetry condition is `bp[bp[i]] == i` for all dsDNA nucleotides.

### Stacking vs. strand connectivity

`stack_on_three_prime_idx` and `three_prime_idx` encode different relationships:

- **`three_prime_idx`**: always the next nucleotide in the strand chain (phosphodiester bond). Follows the strand topology regardless of helix boundaries.
- **`stack_on_three_prime_idx`**: only set when the 3′ neighbour is in the **same continuous dsDNA helix segment**. At crossover junctions or ssDNA gaps it is −1.

Concretely:

| Situation                              | `three_prime_idx` | `stack_idx`                                          |
| -------------------------------------- | ----------------- | ---------------------------------------------------- |
| Interior dsDNA nt, same helix          | next nt           | = `three_prime_idx`                                  |
| dsDNA nt at cross-VH crossover         | nt on other VH    | physical neighbor on same VH (cross-strand stacking) |
| dsDNA nt at helix end (no same-VH nbr) | nt on other VH    | −1                                                   |
| dsDNA nt before ssDNA gap/linker       | ssDNA nt          | −1                                                   |
| ssDNA nt (no bp partner)               | next nt (or −1)   | always −1                                            |
| 3′ terminus                            | −1                | −1                                                   |

---

## Coordinate System

Positions are written in **nanometres** — the same unit and lab frame as the NT model. No unit conversion is applied (unlike oxDNA export, which divides by `OXDNA_NM = 0.8518`).

The helix axis is the z-axis in the local VH frame. Axial rise per base pair is `0.332 nm` (oxDNA v2 geometry).

### Orientation matrix (optional)

When `includeOrientation` is enabled, the rotation matrix R maps the nucleotide local frame to the world frame. Rows are:

```
Row 0 (x′):  a1              — inward from backbone toward base
Row 1 (y′):  a3 × a1         — tangential (right-hand completion)
Row 2 (z′):  a3              — 5′ direction along backbone
```

Written as `a1.x a1.y a1.z  a2.x a2.y a2.z  a3.x a3.y a3.z`.

---

## Field Derivation from the NT Model

`mrdnaExport.ts` calls `buildSimulationNtModel(part)` and maps each `SimulationNucleotide` as follows:

| mrDNA field                | NT model source              | Notes                                                                          |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `coord_x/y/z`              | `nt.positionNm`              | direct — no unit conversion                                                    |
| `three_prime_idx`          | `nt.next`                    | direct                                                                         |
| `bp_idx`                   | `nt.pairKey`                 | build `pairKey → id` map; partner = the other nt sharing the key; −1 if unique |
| `stack_on_three_prime_idx` | `nt.next`, `nt.vhId`, bp map | see stacking rule                                                              |
| `seq`                      | `nt.base`                    | direct                                                                         |
| rotation matrix            | `nt.a1`, `nt.a3`             | rows = `[a1, a3×a1, a3]`                                                       |

### Stacking rule

`stack_on_three_prime_idx` encodes **physical co-axial helix stacking**, which is independent of strand connectivity. The stacking partner may be on a different strand than `three_prime_idx` (cross-strand stacking at crossovers).

For each nucleotide, the exporter first finds the **physical 3′ neighbor** — the nt at the same `(vhId, strandIdx)` one bp-step in the 3′ direction:

- **Same-VH `nt.next`, axially adjacent**: use `nt.next`. The NT model already places inserts in the correct physical order for both strandIdx directions. Cadnano skips/deletions **close the helix up** (the NT model removes the skipped layer via `cumNetOffset`), so the flanking bases stay ~1 rise apart and still stack.
- **Same-VH `nt.next`, axially far (genuine gap)**: `physNext = -1`. An internal same-VH connection that bridges _absent_ bp positions (one segment's 3′ end connecting to another's 5′ end on the same VH, with a true empty-space gap between — e.g. bp82→179 on one VH) is **not** a deletion: the NT model preserves the axial space, leaving the flanking nts ≥2 rises apart. These do **not** stack, matching mrDNA's own cadnano reader (which sets `stack=-1` across such gaps). The discriminator is `axialSeparationNm(nt, nt.next) > 1.5 × RISE_NM` — skips close to ~1 rise, genuine gaps stay ≥2. The geometry is the only signal that distinguishes the two cases (both leave the intervening bp positions empty in the nt list).
- **Cross-VH `nt.next`**: look up position `(vhId, strandIdx, bpIndex±1, loopIndex)` in the position map. No physical neighbor on the same VH → `physNext = -1`.

Then:

```
stack_idx =
  physNext[nt]   if physNext[nt] !== -1
                  AND bp_idx[nt] !== -1          // this nt is dsDNA
                  AND bp_idx[physNext[nt]] !== -1 // physical neighbor is dsDNA
  else -1
```

This correctly handles:

| Situation                                     | `physNext`                      | `stack_idx`                                                    |
| --------------------------------------------- | ------------------------------- | -------------------------------------------------------------- |
| Interior dsDNA, same helix                    | next same-VH nt                 | `= physNext` (may differ from `three_prime_idx` at crossovers) |
| dsDNA nt at crossover                         | nt on same VH, different strand | `= physNext` (cross-strand stacking)                           |
| dsDNA nt with no same-VH neighbor (helix end) | -1                              | -1                                                             |
| ssDNA nt                                      | —                               | always -1                                                      |

---

## Code Location

```
src/lib/model/io/mrdnaExport.ts        — exporter (outputs nm)
src/lib/model/io/mrdnaExport.spec.ts   — tests
src/lib/model/io/simulationNtModel.ts  — NT model builder consumed by the exporter
```

Key public API in `mrdnaExport.ts`:

```typescript
// Main entry point: returns { txt, nucleotideCount, strandCount }.
export function exportPartToMrdna(
	part: Part,
	options?: {
		fallbackBase?: MrdnaFallbackBase; // 'A'|'T'|'C'|'G'|'random', default 'T'
		includeSequence?: boolean; // default true
		includeOrientation?: boolean; // default false
		segPositionOverrides?: Map<string, BlockTransformOverride>;
		includeMirrors?: boolean; // default false — export the assembled multimer
	}
): MrdnaExportResult;

// Lower-level: collect per-nucleotide mrDNA data without formatting.
export function collectMrdnaNucleotides(
	part: Part,
	segPositionOverrides?: Map<string, BlockTransformOverride>,
	fallbackBase?: MrdnaFallbackBase,
	includeMirrors?: boolean // default false
): MrdnaNucleotide[];
```

`MrdnaFallbackBase` is `'A' | 'T' | 'C' | 'G' | 'random'` (default `'T'`).

Mirror oligos (repeat-unit copies, see `docs/repeat-units.md`) are excluded from the export
unless `includeMirrors` is set — the 3D Export menu shows an "Include mirror copies" toggle
when the part has mirrors.

---

## Sequence Handling

Sequence fallback logic is identical to the oxDNA exporter:

1. Real base (A/T/C/G) in the design slot → use it.
2. Complement already resolved → return its Watson-Crick complement.
3. dsDNA, complement not yet resolved → generate a random base; cache so the partner complements it.
4. ssDNA with no partner → use `fallbackBase`.

The `includeSequence` option (default `true`) appends the base letter as the 7th field. Setting it to `false` produces a 6-field-per-line file that can be read by mrDNA without modification.

---

## Reference Fixture

```
test_files/fixtures/mrdna_export/nontrivial_uiuc.txt
```

This file was generated by mrDNA's internal cadnano reader for `test_files/internal_cadnano_designs/nontrivial_uiuc.json`. It is used by `mrdnaExport.spec.ts` to verify that the Foldnano exporter produces the same nucleotide count (276 data lines). Exact coordinate comparison is intentionally skipped — mrDNA's reader uses different geometry constants than Foldnano's oxDNA v2 physical model.

---

## Relaxed Positions

When the rigid-body simulation (RBS) has been run, `exportPartToMrdna` accepts `segPositionOverrides` (a `Map<segmentId, BlockTransformOverride>`) to rotate and translate segments into the relaxed 3D layout, identical to how oxDNA export handles RBS overrides.

---

## Boundaries / Don'ts

- **Don't convert positions to oxDNA units.** mrDNA reads nm directly; dividing by `OXDNA_NM` would produce wrong coordinates.
- **Don't set `stack_idx = three_prime_idx` unconditionally.** Stacking must be −1 at cross-VH crossovers and ssDNA junctions — mrDNA uses it to place stacking potentials, which are incorrect across helix boundaries.
- **Don't read VH placement from `vh.latticeCoords` / `vh.localFrame` directly.** Always use `part.getVirtualHelixFrame(vh)` so plane transforms apply.
- **Don't persist `segPositionOverrides`.** RBS overrides are transient and are passed in for one export only.
- **Don't allow unassigned sequences silently.** Surface the same fallback-base dialog as oxDNA export before calling `exportPartToMrdna`.
