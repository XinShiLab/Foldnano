# Cadnano round-trip verification

## Method

Pipeline: `J0 → P1 → J1 → P2 → J2 → P3` (J = cadnano document, P = Foldnano Part). Each design
in `test_files/published_cadnano_designs` is imported, exported, and re-imported twice, and
checked for:

- **Cadnano data (J0 vs J1):** virtual-helix geometry, strands and crossovers, loops, skips and
  source colours, matched by vstrand `num`. Ordering-only changes are reported separately, and
  any field outside the compared set is reported rather than skipped.
- **Foldnano Part (P1 vs P2):** the same Part structure after re-import.
- **Stability (J1 vs J2, P2 vs P3):** no further changes on another cycle.

cadnano is treated as a topology interchange format, not lossless Foldnano storage: UUIDs,
sequences, modifications, oligo names, region information and freeform orientation are out of
scope.

## Results

- Completed all stages: 10/10 designs.
- **Exact agreement for all in-scope cadnano properties: 8/10 designs.**
- Virtual-helix geometry: 10/10; strand/crossover topology: 10/10; loops: 10/10; exact skips: 8/10; source colours: 10/10.
- No unexpected in-scope differences: 10/10 designs.
- Warned lossy discrepancies: 9 deletions relocated across 2 designs.
- Foldnano topology preserved on the first re-import: 10/10 designs.
- No recurring raw JSON differences on the next cycle: 10/10 designs.
- No recurring Foldnano design-and-color changes: 10/10 designs.

### Classified conversions and discrepancies

| Category | Change | Interpretation | Cited at |
|---|---|---|---|
| Warned lossy discrepancy | A deletion (`skip`) moves one base off a crossover column | The NT/oxDNA model cannot place a deletion on a pinned crossover anchor. The importer relocates it and emits a user-visible warning, so skips do **not** agree exactly. | `VStrand.relocateSkipsOffCrossovers()` |
| Representation-only | A predecessor `[vh, i, …]` at index `i` becomes `[vh, i±1, …]` | The importer tolerates a self-referential crossover-exit encoding and the exporter writes the regular form. Classified only when the successor is unchanged and the selected neighbour already points forward to this base. | `VStrand.buildSegments()`, and `cadnanoJSON_import.spec.ts` "Hilbert curve design (self-referential crossover exits)" |
| Generated metadata | A `scaf_colors` entry appears where the source had none | An uncoloured scaffold oligo receives a generated colour and the exporter writes it. Classified this way only when its vstrand, base index, and colour exactly match a scaffold oligo independently found in P1; unpredicted additions, duplicates, removals, and replacements remain unexpected. | `Oligo.constructor`, `CadnanoJSON.fromRegion()` |

### Summary

| Design | Original cadnano data preserved | Classified J0→J1 differences | Round-trip stability |
|---|---|---|---|
| **Aggregate (10 designs)** | Geometry, routing, loops, and colours: 10/10; exact skips: 8/10 | 9 warned deletion relocations in 2 designs; 0 unexpected differences | P1–P2 preserved: 10/10; no further J1–J2 or P2–P3 changes: 10/10 |
| 17. Krishnan_NatCommun2016_pin pore.json | yes | 24 staple-colour order changes; 1 scaffold colour added | yes |
| 4FSF_25_2b_complete_full_loopbackscaffold.json | except exact skip positions | 40 staple-colour order changes; 96 scaffold colours added; 8 warned deletion relocations | yes |
| 8hb_2ab_8f.json | yes | 4 staple-colour order changes; 11 scaffold colours added | yes |
| Force clamp.json | yes | 21 staple-colour order changes; 1 scaffold colour added | yes |
| Hilbert.json | yes | 106 VH positions reordered; 118 equivalent scaffold-tuple rewrites; 27 staple-colour order changes; 1 scaffold colour added | yes |
| LargeTetrascaffold-B-3.json | yes | 28 staple-colour order changes; 1 scaffold colour added | yes |
| NRs_antenna_Cadnano1_2_Staples_cut_colored_64_del_MOD20210922.json | yes | 53 staple-colour order changes; 108 scaffold colours added | yes |
| N_nanobase.json | yes | 16 VH positions reordered; 29 staple-colour order changes; 1 scaffold colour added | yes |
| righthanded_turbine_only.json | except exact skip positions | 38 VH positions reordered; 22 staple-colour order changes; 1 scaffold colour added; 1 warned deletion relocation | yes |
| slottedcross.json | yes | 30 VH positions reordered; 31 staple-colour order changes; 1 scaffold colour added | yes |

Common to all designs: object/field ordering changed, and the exporter added `scaf_colors`,
`segments`, and `warnings` fields. Exact locations are in the detailed table and per-design
results below.

### Detailed per-design verification table

| Design | Completed | VH geometry | Strand/crossover topology | Loops | Skips exact | Source colours | Representation-only changes | Generated metadata | Warned lossy discrepancy | Unexpected | Repeat stable |
|---|---|---|---|---|---|---|---|---|---|---:|---|
| 17. Krishnan_NatCommun2016_pin pore.json | yes | yes | yes | yes | yes | yes | 24 colour-order VH occurrences; key/spelling normalization | 1 scaffold colour entries added | none | 0 | yes |
| 4FSF_25_2b_complete_full_loopbackscaffold.json | yes | yes | yes | yes | no | yes | 40 colour-order VH occurrences; key/spelling normalization | 96 scaffold colour entries added | 8 deletion(s): VH 10: 68→67, VH 11: 68→67, VH 34: 68→67, VH 35: 68→67, VH 58: 68→67, VH 59: 68→67, VH 82: 68→67, VH 83: 68→67 | 0 | yes |
| 8hb_2ab_8f.json | yes | yes | yes | yes | yes | yes | 4 colour-order VH occurrences; key/spelling normalization | 11 scaffold colour entries added | none | 0 | yes |
| Force clamp.json | yes | yes | yes | yes | yes | yes | 21 colour-order VH occurrences; key/spelling normalization | 1 scaffold colour entries added | none | 0 | yes |
| Hilbert.json | yes | yes | yes | yes | yes | yes | 106 VH positions moved; 118 connection records rewritten; 27 colour-order VH occurrences; key/spelling normalization | 1 scaffold colour entries added | none | 0 | yes |
| LargeTetrascaffold-B-3.json | yes | yes | yes | yes | yes | yes | 28 colour-order VH occurrences; key/spelling normalization | 1 scaffold colour entries added | none | 0 | yes |
| NRs_antenna_Cadnano1_2_Staples_cut_colored_64_del_MOD20210922.json | yes | yes | yes | yes | yes | yes | 53 colour-order VH occurrences; key/spelling normalization | 108 scaffold colour entries added | none | 0 | yes |
| N_nanobase.json | yes | yes | yes | yes | yes | yes | 16 VH positions moved; 29 colour-order VH occurrences; key/spelling normalization | 1 scaffold colour entries added | none | 0 | yes |
| righthanded_turbine_only.json | yes | yes | yes | yes | no | yes | 38 VH positions moved; 22 colour-order VH occurrences; key/spelling normalization | 1 scaffold colour entries added | 1 deletion(s): VH 48: 385→386 | 0 | yes |
| slottedcross.json | yes | yes | yes | yes | yes | yes | 30 VH positions moved; 31 colour-order VH occurrences; key/spelling normalization | 1 scaffold colour entries added | none | 0 | yes |

## Known limitations

1. **The exported scaffold colour is randomly generated.** An oligo with no colour in the source
   gets `generateRandomOKLCHColor()` (`Oligo.constructor`), and `CadnanoJSON.fromRegion()` writes
   every oligo colour into `scaf_colors`, so exporting the same design twice produces two
   different files. Pinned by the "export determinism" test in the spec.
2. **Non-cadnano fields are emitted.** Every exported vstrand carries `segments` and `warnings`.
   `CadnanoJSON.fromRegion()` builds clean objects but wraps them in `VStrand` instances, whose
   public `VStrand.segments` and `VStrand.warnings` fields are picked up by `JSON.stringify`. They
   serialize as empty husks (`"segments":[{},{}]`, `"warnings":[]`), which the suite checks rather
   than assumes, so no design data escapes. It remains a schema-cleanliness and
   cadnano-compatibility issue.
3. **`scafLoop`/`stapLoop` are written as `[]` unconditionally** by `CadnanoJSON.fromRegion()`,
   which would discard input data. All ten designs have these empty, so this corpus cannot detect
   it; the J0 vs J1 check would catch it on a design that uses them.
4. **Deletion relocation is lossy, not cosmetic.** The affected designs come out encoding a
   slightly different molecule than went in (a deletion sits on a neighbouring base). It is
   documented and warned, so it is intended behaviour, but it carries its own verdict
   (`lossy-but-warned`) rather than being filed under normalization.
   Affected here: 4FSF_25_2b_complete_full_loopbackscaffold.json (8 deletions), righthanded_turbine_only.json (1 deletion).

## Provenance

Generated by `src/lib/model/test/cadnano-json-roundtrip.spec.ts`. Regenerate with:

```bash
UPDATE_CADNANO_REPORT=1 pnpm vitest run src/lib/model/test/cadnano-json-roundtrip.spec.ts
```

Random colour generation is seeded per design during the reported run, so regenerating produces
byte-identical output. The SHA-256 of each source design, taken over line-ending-normalised
content, is recorded in `cadnano-roundtrip-report.json` beside this file; a design edited without
regenerating is therefore visible from the artefacts alone.

| Design | Source SHA-256 |
|---|---|
| 17. Krishnan_NatCommun2016_pin pore.json | `f407fcd6405e667e5335fcf18caa8d2061a729e432a0fcb27ff6be59c78546f9` |
| 4FSF_25_2b_complete_full_loopbackscaffold.json | `6636365b6fa7e8c64225ce1d738f1044a1fee465ca68e83e0487f1baf7d2d8f0` |
| 8hb_2ab_8f.json | `5fe6f87b5e714a0fd9429ee92d4cad92cbb3e5e840ef5784403831c7d1b74158` |
| Force clamp.json | `645b745d2de189cb74cdd7c756569ad6382a0781c8aed9c85fb0d6320d7adaad` |
| Hilbert.json | `c9376e9f2bc70debb190e3481f1cc0d35ea5f4010b9b15097cb4554c578c99f2` |
| LargeTetrascaffold-B-3.json | `35da76feb262de35483ee0fff091c21fd3251828595a9b40946b66582d8e0ec0` |
| NRs_antenna_Cadnano1_2_Staples_cut_colored_64_del_MOD20210922.json | `7b31a23053698626477168812a78b209bff7828f7525c405c5c5ff22520bfbc2` |
| N_nanobase.json | `4bb9b1d9fb9d4b459370f3f3dd01e2f71ab2ae29b8c57b686b1db7143b08b217` |
| righthanded_turbine_only.json | `681ea72e2b05ceb9f19e6e8a75116545644d0173292f70d9fd7fb5d5496c185c` |
| slottedcross.json | `49eac0085a6281a46f87743eec3d6e35dad4e96b03bde5dea3c07a13c67c3985` |

## Detailed results

### 17. Krishnan_NatCommun2016_pin pore.json

Verdict: **stable normalization**

- Import warnings J0/J1/J2: 0/0/0

#### Cadnano interchange data — J0 vs J1

- All compared data identical after ignoring presentation differences: no
- In-scope agreement: virtual-helix geometry yes; strand/crossover topology yes; loops yes; skips exactly yes; source colours yes
- **Unexpected differences: 0**
- Classified changes: 0 representation-only; 1 generated metadata; 0 warned lossy deletion relocations (0 changed skip entries)

#### J0→J1 — Raw JSON differences

- Structurally equal (ignoring object-key order): no
- Added field `scaf_colors` on 55 vstrands: 0–54 (scaffold colour generated at import)
- Added field `segments` on 55 vstrands: 0–54 (non-cadnano field emitted by the exporter)
- Added field `warnings` on 55 vstrands: 0–54 (non-cadnano field emitted by the exporter)
- Reordered `stap_colors` without mapping changes on 24 vstrands: 0, 4, 6, 8, 12, 14, 16, 18, 20, 22, 24, 26, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52 (ordering only)
- Added `scaf_colors` entries with colour `0xD19400` on 1 vstrands: 54 (scaffold colour generated at import)

- Object-key ordering changed in 55 vstrands across 1 ordering patterns (presentation only).

#### P1→P2

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

#### J1→J2 — Raw JSON differences

- Structurally equal (ignoring object-key order): yes

#### P2→P3

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

### 4FSF_25_2b_complete_full_loopbackscaffold.json

Verdict: **lossy-but-warned (deletion relocated)**

- Import warnings J0/J1/J2: 8/0/0

- J0 warning: VH 10: deletion at crossover bp 68 moved to bp 67 (deletions are not allowed on crossover sites).
- J0 warning: VH 11: deletion at crossover bp 68 moved to bp 67 (deletions are not allowed on crossover sites).
- J0 warning: VH 34: deletion at crossover bp 68 moved to bp 67 (deletions are not allowed on crossover sites).
- J0 warning: VH 35: deletion at crossover bp 68 moved to bp 67 (deletions are not allowed on crossover sites).
- J0 warning: VH 58: deletion at crossover bp 68 moved to bp 67 (deletions are not allowed on crossover sites).
- J0 warning: VH 59: deletion at crossover bp 68 moved to bp 67 (deletions are not allowed on crossover sites).
- J0 warning: VH 82: deletion at crossover bp 68 moved to bp 67 (deletions are not allowed on crossover sites).
- J0 warning: VH 83: deletion at crossover bp 68 moved to bp 67 (deletions are not allowed on crossover sites).

#### Cadnano interchange data — J0 vs J1

- All compared data identical after ignoring presentation differences: no
- In-scope agreement: virtual-helix geometry yes; strand/crossover topology yes; loops yes; skips exactly no; source colours yes
- **Unexpected differences: 0**
- Classified changes: 0 representation-only; 96 generated metadata; 8 warned lossy deletion relocations (16 changed skip entries)
- Warned deletion relocation: VH 10, bp 68 → 67
- Warned deletion relocation: VH 11, bp 68 → 67
- Warned deletion relocation: VH 34, bp 68 → 67
- Warned deletion relocation: VH 35, bp 68 → 67
- Warned deletion relocation: VH 58, bp 68 → 67
- Warned deletion relocation: VH 59, bp 68 → 67

#### J0→J1 — Raw JSON differences

- Structurally equal (ignoring object-key order): no
- Added field `scaf_colors` on 96 vstrands: 0–95 (scaffold colour generated at import)
- Added field `segments` on 96 vstrands: 0–95 (non-cadnano field emitted by the exporter)
- Added field `warnings` on 96 vstrands: 0–95 (non-cadnano field emitted by the exporter)
- Reordered `stap_colors` without mapping changes on 40 vstrands: 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92 (ordering only)
- Added `scaf_colors` entries with colour `0xF167A3` on 96 vstrands: 0–95 (scaffold colour generated at import)

| Numeric field | Change | Count | Vstrands | Examples |
|---|---|---:|---|---|
| skip | 0→-1 | 8 | 10–11, 34–35, 58–59, 82–83 | vstrand(10).skip[67], vstrand(11).skip[67], vstrand(34).skip[67], vstrand(35).skip[67], vstrand(58).skip[67], vstrand(59).skip[67] |
| skip | -1→0 | 8 | 10–11, 34–35, 58–59, 82–83 | vstrand(10).skip[68], vstrand(11).skip[68], vstrand(34).skip[68], vstrand(35).skip[68], vstrand(58).skip[68], vstrand(59).skip[68] |

- Object-key ordering changed in 96 vstrands across 1 ordering patterns (presentation only).

#### P1→P2

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

#### J1→J2 — Raw JSON differences

- Structurally equal (ignoring object-key order): yes

#### P2→P3

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

### 8hb_2ab_8f.json

Verdict: **stable normalization**

- Import warnings J0/J1/J2: 0/0/0

#### Cadnano interchange data — J0 vs J1

- All compared data identical after ignoring presentation differences: no
- In-scope agreement: virtual-helix geometry yes; strand/crossover topology yes; loops yes; skips exactly yes; source colours yes
- **Unexpected differences: 0**
- Classified changes: 0 representation-only; 11 generated metadata; 0 warned lossy deletion relocations (0 changed skip entries)

#### J0→J1 — Raw JSON differences

- Structurally equal (ignoring object-key order): no
- Added field `scaf_colors` on 12 vstrands: 0–8, 10, 12, 14 (scaffold colour generated at import)
- Added field `segments` on 12 vstrands: 0–8, 10, 12, 14 (non-cadnano field emitted by the exporter)
- Added field `warnings` on 12 vstrands: 0–8, 10, 12, 14 (non-cadnano field emitted by the exporter)
- Reordered `stap_colors` without mapping changes on 4 vstrands: 0, 2, 4, 6 (ordering only)
- Added `scaf_colors` entries with colour `0x6FA4D5` on 1 vstrands: 0 (scaffold colour generated at import)
- Added `scaf_colors` entries with colour `0xB59A6C` on 1 vstrands: 1 (scaffold colour generated at import)
- Added `scaf_colors` entries with colour `0xA9A400` on 1 vstrands: 2 (scaffold colour generated at import)
- Added `scaf_colors` entries with colour `0xD67BB7` on 1 vstrands: 3 (scaffold colour generated at import)
- Added `scaf_colors` entries with colour `0xBD6FFF` on 1 vstrands: 5 (scaffold colour generated at import)
- Added `scaf_colors` entries with colour `0x00BFBC` on 1 vstrands: 7 (scaffold colour generated at import)
- Added `scaf_colors` entries with colour `0x2FBB60` on 1 vstrands: 8 (scaffold colour generated at import)
- Added `scaf_colors` entries with colour `0xA084FF` on 1 vstrands: 8 (scaffold colour generated at import)
- Added `scaf_colors` entries with colour `0x52BB00` on 1 vstrands: 10 (scaffold colour generated at import)
- Added `scaf_colors` entries with colour `0xA687F8` on 1 vstrands: 12 (scaffold colour generated at import)
- Added `scaf_colors` entries with colour `0x28B1C6` on 1 vstrands: 14 (scaffold colour generated at import)

- Object-key ordering changed in 12 vstrands across 1 ordering patterns (presentation only).

#### P1→P2

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

#### J1→J2 — Raw JSON differences

- Structurally equal (ignoring object-key order): yes

#### P2→P3

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

### Force clamp.json

Verdict: **stable normalization**

- Import warnings J0/J1/J2: 0/0/0

#### Cadnano interchange data — J0 vs J1

- All compared data identical after ignoring presentation differences: no
- In-scope agreement: virtual-helix geometry yes; strand/crossover topology yes; loops yes; skips exactly yes; source colours yes
- **Unexpected differences: 0**
- Classified changes: 0 representation-only; 1 generated metadata; 0 warned lossy deletion relocations (0 changed skip entries)

#### J0→J1 — Raw JSON differences

- Structurally equal (ignoring object-key order): no
- Added field `scaf_colors` on 42 vstrands: 0–41 (scaffold colour generated at import)
- Added field `segments` on 42 vstrands: 0–41 (non-cadnano field emitted by the exporter)
- Added field `warnings` on 42 vstrands: 0–41 (non-cadnano field emitted by the exporter)
- Reordered `stap_colors` without mapping changes on 21 vstrands: 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40 (ordering only)
- Added `scaf_colors` entries with colour `0x29ADDB` on 1 vstrands: 8 (scaffold colour generated at import)

- Object-key ordering changed in 42 vstrands across 1 ordering patterns (presentation only).

#### P1→P2

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

#### J1→J2 — Raw JSON differences

- Structurally equal (ignoring object-key order): yes

#### P2→P3

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

### Hilbert.json

Verdict: **stable normalization**

- Import warnings J0/J1/J2: 0/0/0

#### Cadnano interchange data — J0 vs J1

- All compared data identical after ignoring presentation differences: no
- In-scope agreement: virtual-helix geometry yes; strand/crossover topology yes; loops yes; skips exactly yes; source colours yes
- **Unexpected differences: 0**
- Classified changes: 118 representation-only; 1 generated metadata; 0 warned lossy deletion relocations (0 changed skip entries)

#### J0→J1 — Raw JSON differences

- Structurally equal (ignoring object-key order): no
- Vstrand order changed: 106 moved; same number set: yes; output ascending: yes (presentation only)
- Added field `scaf_colors` on 110 vstrands: 0–109 (scaffold colour generated at import)
- Added field `segments` on 110 vstrands: 0–109 (non-cadnano field emitted by the exporter)
- Added field `warnings` on 110 vstrands: 0–109 (non-cadnano field emitted by the exporter)
- Reordered `stap_colors` without mapping changes on 27 vstrands: 0, 8, 10, 12, 18, 20, 24, 30, 32, 36, 38, 40, 42, 44, 48, 50, 54, 56, 62, 68, 70, 74, 76, 82, 84, 86, 92 (ordering only)
- Added `scaf_colors` entries with colour `0x9F99BE` on 1 vstrands: 1 (scaffold colour generated at import)

| Connection field | Pattern | Count | Vstrands | Repeated occurrences | Examples |
|---|---|---:|---|---|---|
| scaf | fromBp:i→i-1 | 59 | 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94 | VH 6: 2, VH 16: 2, VH 46: 2, VH 48: 3, VH 52: 2, VH 68: 2, VH 78: 2, VH 86: 2, VH 92: 2, VH 94: 2 | vstrand(0).scaf[159]: [0,159,12,63] → [0,158,12,63]<br>vstrand(2).scaf[152]: [2,152,14,70] → [2,151,14,70]<br>vstrand(4).scaf[152]: [4,152,16,70] → [4,151,16,70]<br>vstrand(6).scaf[120]: [6,120,5,120] → [6,119,5,120]<br>vstrand(6).scaf[138]: [6,138,18,84] → [6,137,18,84]<br>vstrand(8).scaf[138]: [8,138,20,84] → [8,137,20,84] |
| scaf | fromBp:i→i+1 | 59 | 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47, 49, 51, 53, 55, 57, 59, 61, 63, 65, 67, 69, 71, 73, 75, 77, 79, 81, 83, 85, 87, 89, 91, 93, 95 | VH 5: 2, VH 15: 2, VH 47: 2, VH 49: 2, VH 51: 2, VH 55: 2, VH 69: 2, VH 83: 2, VH 89: 2, VH 91: 2, VH 93: 2 | vstrand(1).scaf[49]: [1,49,85,173] → [1,50,85,173]<br>vstrand(3).scaf[56]: [3,56,87,166] → [3,57,87,166]<br>vstrand(5).scaf[63]: [5,63,89,159] → [5,64,89,159]<br>vstrand(5).scaf[121]: [5,121,6,121] → [5,122,6,121]<br>vstrand(7).scaf[63]: [7,63,91,159] → [7,64,91,159]<br>vstrand(9).scaf[70]: [9,70,93,152] → [9,71,93,152] |

- Object-key ordering changed in 110 vstrands across 2 ordering patterns (presentation only).

#### P1→P2

- Vstrand presentation order changed: yes (106 moved)
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0
- Example: vstrand order moved 106 helices

#### J1→J2 — Raw JSON differences

- Structurally equal (ignoring object-key order): yes

#### P2→P3

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

### LargeTetrascaffold-B-3.json

Verdict: **stable normalization**

- Import warnings J0/J1/J2: 0/0/0

#### Cadnano interchange data — J0 vs J1

- All compared data identical after ignoring presentation differences: no
- In-scope agreement: virtual-helix geometry yes; strand/crossover topology yes; loops yes; skips exactly yes; source colours yes
- **Unexpected differences: 0**
- Classified changes: 0 representation-only; 1 generated metadata; 0 warned lossy deletion relocations (0 changed skip entries)

#### J0→J1 — Raw JSON differences

- Structurally equal (ignoring object-key order): no
- Added field `scaf_colors` on 60 vstrands: 0–59 (scaffold colour generated at import)
- Added field `segments` on 60 vstrands: 0–59 (non-cadnano field emitted by the exporter)
- Added field `warnings` on 60 vstrands: 0–59 (non-cadnano field emitted by the exporter)
- Reordered `stap_colors` without mapping changes on 28 vstrands: 0, 2, 4, 6, 8, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 52, 54, 56, 58 (ordering only)
- Added `scaf_colors` entries with colour `0x20B79B` on 1 vstrands: 55 (scaffold colour generated at import)

- Object-key ordering changed in 60 vstrands across 1 ordering patterns (presentation only).

#### P1→P2

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

#### J1→J2 — Raw JSON differences

- Structurally equal (ignoring object-key order): yes

#### P2→P3

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

### NRs_antenna_Cadnano1_2_Staples_cut_colored_64_del_MOD20210922.json

Verdict: **stable normalization**

- Import warnings J0/J1/J2: 0/0/0

#### Cadnano interchange data — J0 vs J1

- All compared data identical after ignoring presentation differences: no
- In-scope agreement: virtual-helix geometry yes; strand/crossover topology yes; loops yes; skips exactly yes; source colours yes
- **Unexpected differences: 0**
- Classified changes: 0 representation-only; 108 generated metadata; 0 warned lossy deletion relocations (0 changed skip entries)

#### J0→J1 — Raw JSON differences

- Structurally equal (ignoring object-key order): no
- Added field `scaf_colors` on 108 vstrands: 0–107 (scaffold colour generated at import)
- Added field `segments` on 108 vstrands: 0–107 (non-cadnano field emitted by the exporter)
- Added field `warnings` on 108 vstrands: 0–107 (non-cadnano field emitted by the exporter)
- Reordered `stap_colors` without mapping changes on 53 vstrands: 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90, 92, 96, 98, 100, 102, 104, 106 (ordering only)
- Added `scaf_colors` entries with colour `0xCA77E6` on 108 vstrands: 0–107 (scaffold colour generated at import)

- Object-key ordering changed in 108 vstrands across 1 ordering patterns (presentation only).

#### P1→P2

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

#### J1→J2 — Raw JSON differences

- Structurally equal (ignoring object-key order): yes

#### P2→P3

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

### N_nanobase.json

Verdict: **stable normalization**

- Import warnings J0/J1/J2: 0/0/0

#### Cadnano interchange data — J0 vs J1

- All compared data identical after ignoring presentation differences: no
- In-scope agreement: virtual-helix geometry yes; strand/crossover topology yes; loops yes; skips exactly yes; source colours yes
- **Unexpected differences: 0**
- Classified changes: 0 representation-only; 1 generated metadata; 0 warned lossy deletion relocations (0 changed skip entries)

#### J0→J1 — Raw JSON differences

- Structurally equal (ignoring object-key order): no
- Vstrand order changed: 16 moved; same number set: yes; output ascending: yes (presentation only)
- Added field `scaf_colors` on 136 vstrands: 0–135 (scaffold colour generated at import)
- Added field `segments` on 136 vstrands: 0–135 (non-cadnano field emitted by the exporter)
- Added field `warnings` on 136 vstrands: 0–135 (non-cadnano field emitted by the exporter)
- Reordered `stap_colors` without mapping changes on 29 vstrands: 0, 2, 4, 6, 8, 10, 14, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60 (ordering only)
- Added `scaf_colors` entries with colour `0x00BCD8` on 1 vstrands: 8 (scaffold colour generated at import)

- Object-key ordering changed in 136 vstrands across 1 ordering patterns (presentation only).

#### P1→P2

- Vstrand presentation order changed: yes (16 moved)
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0
- Example: vstrand order moved 16 helices

#### J1→J2 — Raw JSON differences

- Structurally equal (ignoring object-key order): yes

#### P2→P3

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

### righthanded_turbine_only.json

Verdict: **lossy-but-warned (deletion relocated)**

- Import warnings J0/J1/J2: 1/0/0

- J0 warning: VH 48: deletion at crossover bp 385 moved to bp 386 (deletions are not allowed on crossover sites).

#### Cadnano interchange data — J0 vs J1

- All compared data identical after ignoring presentation differences: no
- In-scope agreement: virtual-helix geometry yes; strand/crossover topology yes; loops yes; skips exactly no; source colours yes
- **Unexpected differences: 0**
- Classified changes: 0 representation-only; 1 generated metadata; 1 warned lossy deletion relocations (2 changed skip entries)
- Warned deletion relocation: VH 48, bp 385 → 386

#### J0→J1 — Raw JSON differences

- Structurally equal (ignoring object-key order): no
- Vstrand order changed: 38 moved; same number set: yes; output ascending: yes (presentation only)
- Added field `scaf_colors` on 54 vstrands: 0–53 (scaffold colour generated at import)
- Added field `segments` on 54 vstrands: 0–53 (non-cadnano field emitted by the exporter)
- Added field `warnings` on 54 vstrands: 0–53 (non-cadnano field emitted by the exporter)
- Reordered `stap_colors` without mapping changes on 22 vstrands: 0, 2, 4, 6, 8, 10, 12, 14, 18, 22, 24, 26, 30, 32, 36, 38, 42, 44, 46, 48, 50, 52 (ordering only)
- Added `scaf_colors` entries with colour `0x889FC8` on 1 vstrands: 6 (scaffold colour generated at import)

| Numeric field | Change | Count | Vstrands | Examples |
|---|---|---:|---|---|
| skip | -1→0 | 1 | 48 | vstrand(48).skip[385] |
| skip | 0→-1 | 1 | 48 | vstrand(48).skip[386] |

- Object-key ordering changed in 54 vstrands across 1 ordering patterns (presentation only).

#### P1→P2

- Vstrand presentation order changed: yes (38 moved)
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0
- Example: vstrand order moved 38 helices

#### J1→J2 — Raw JSON differences

- Structurally equal (ignoring object-key order): yes

#### P2→P3

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

### slottedcross.json

Verdict: **stable normalization**

- Import warnings J0/J1/J2: 0/0/0

#### Cadnano interchange data — J0 vs J1

- All compared data identical after ignoring presentation differences: no
- In-scope agreement: virtual-helix geometry yes; strand/crossover topology yes; loops yes; skips exactly yes; source colours yes
- **Unexpected differences: 0**
- Classified changes: 0 representation-only; 1 generated metadata; 0 warned lossy deletion relocations (0 changed skip entries)

#### J0→J1 — Raw JSON differences

- Structurally equal (ignoring object-key order): no
- Vstrand order changed: 30 moved; same number set: yes; output ascending: yes (presentation only)
- Added field `scaf_colors` on 142 vstrands: 0–141 (scaffold colour generated at import)
- Added field `segments` on 142 vstrands: 0–141 (non-cadnano field emitted by the exporter)
- Added field `warnings` on 142 vstrands: 0–141 (non-cadnano field emitted by the exporter)
- Reordered `stap_colors` without mapping changes on 31 vstrands: 0, 2, 4, 8, 10, 12, 14, 16, 22, 24, 26, 28, 30, 38, 40, 42, 46, 50, 52, 54, 56, 58, 62, 64, 66, 68, 72, 76, 78, 80, 82 (ordering only)
- Added `scaf_colors` entries with colour `0xFB6672` on 1 vstrands: 55 (scaffold colour generated at import)

- Object-key ordering changed in 142 vstrands across 1 ordering patterns (presentation only).

#### P1→P2

- Vstrand presentation order changed: yes (30 moved)
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0
- Example: vstrand order moved 30 helices

#### J1→J2 — Raw JSON differences

- Structurally equal (ignoring object-key order): yes

#### P2→P3

- Vstrand presentation order changed: no
- Out-of-scope name/region metadata changes: 0
- Virtual-helix geometry changes: 0
- Segments added/removed/modified: 0/0/0
- Crossovers added/removed: 0/0
- Oligos added/removed/modified: 0/0/0
- Oligo color changes: 0
- Total in-scope Foldnano topology changes: 0

