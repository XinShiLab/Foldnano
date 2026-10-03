---
covers:
  - src/lib/model/rbs/**
  - src/lib/components/Editor/View3D/rbs/**
  - src/lib/components/Editor/View3D/view3dSimulationState.ts
---

# Block-Based Rigid Body Simulation

This document describes the current rigid body simulation (RBS) used by the
3D view to relax flat cadnano designs into a more physical 3D layout. The RBS
and export code is implemented as model-level pure data logic, but the resulting
layout is still transient: it does not yet write relaxed coordinates into the
Foldnano document model or into `.fn.json`.

## Goal

cadnano designs are authored on a flat lattice. That flat layout is useful for
editing, but it can put connected DNA regions far apart in 3D, especially when
crossovers represent folding edges. Full molecular relaxation is too expensive
for an editor preview and can fail when the initial layout is very far from a
reasonable geometry.

The RBS pass provides a fast topology-first relaxation:

1. Partition the design into rigid blocks.
2. Replace only flexible topology edges with distance constraints.
3. Simulate block translation and rotation.
4. Render the 3D view with transient block transforms.

The approach is inspired by [oxView](https://sulcgroup.github.io/oxdna-viewer/)'s rigid-body
cluster simulation. It is an independent implementation: no oxView code is used (oxView is
GPL-3.0, Foldnano is MIT), and the block extraction is based on Foldnano's model topology and
constrained-crossover semantics.

## Current Pipeline

### Module Boundaries

The reusable logic lives outside the View3D component tree:

- `src/lib/model/geometry3d/dnaGeometry.ts`: pure lattice/twist coordinates,
  insert/skip physical offsets, vector rotation, and block-transform helpers.
- `src/lib/model/rbs/`: block extraction, shared RBS types, block colors, and
  the rigid-body solver.
- `src/lib/model/io/oxdnaExport.ts`: pure oxDNA `.dat`/`.top` string export.

The View3D component owns only view adapters: Three.js scene construction,
toolbar state, browser downloads, and the module worker entry point.

### Block Builder

The entry point is `buildBlocksAndConstraints(part)`.

A block is a rigid connected component of occupied virtual-helix spans. The
builder starts with one span per `OligoSegment`, then uses union-find to weld
spans into blocks when any of these conditions are true:

- They are the same continuous `OligoSegment`.
- They are complementary occupied spans on the same virtual helix with an
  overlapping base-pair range. This treats duplex material as one rigid body.
- They are connected by a 3-prime to 5-prime crossover that is constrained by
  `SegmentEnd.isConstrained` or `Part.canEndsBeConstrained(...)`.

Unconstrained crossovers are not welded. Instead, they become distance
constraints with:

- `source = "unconstrained-crossover"`
- `restLength = 0.6 nm`
- attachment points computed from the existing twisted helix geometry at the
  exact endpoint base and strand.

The canonical fixture is `test_files/internal_cadnano_designs/test_tetrahedral2.fn.json`.
With this algorithm it must build exactly 6 blocks.

### Collision Approximation

Each block keeps two representations:

- `spans`: topological metadata for diagnostics, debug display, and mapping
  segment IDs back to block IDs.
- `collisionCapsules`: simplified physical geometry used by the solver.

Collision capsules are merged per virtual helix and occupied base-pair range.
This avoids checking every nucleotide during simulation. Each capsule is a
local-space line segment with a radius of `HEX_INTERHELIX_NM / 2 × (1/1.3) ≈ 0.835 nm`.
This value is scaled from the physical (oxDNA) honeycomb inter-helix distance to
maintain the same ~23 % surface clearance between adjacent lattice helices as the
original 1.0 nm radius provided at the old 2.6 nm visual grid spacing.
The block also stores a bounding radius for broadphase rejection.

### Solver

The solver uses one rigid body per block. The defaults are intentionally close
to oxView's rigid-body settings:

- `iterations = 1200`
- `dt = 0.1`
- `springK = 10`
- `repulsionK = 1000`
- `damping = 0.25`
- `collisionPasses = 2`

For every step:

1. Reset forces and torques.
2. Apply Hooke spring forces at unconstrained-crossover attachment points.
3. Convert off-center spring forces into torque with `r x F`.
4. Apply capsule-capsule repulsion for overlapping block tubes.
5. Integrate linear velocity, position, angular velocity, and quaternion.
6. Project remaining capsule overlaps apart as a hard correction.

The solver returns a transform per block:

```ts
{
	originalCenter: Vec3;
	position: Vec3;
	quaternion: Quat;
}
```

The renderer applies this transform as:

```ts
position + quaternion * (referencePoint - originalCenter);
```

This preserves the block's local geometry while moving and rotating it in the
relaxed layout.

### Worker And Live Preview

The 3D view runs RBS in a module worker (`rbsWorker.ts`) so the editor stays
responsive during simulation. `View3D.svelte` builds the block graph on the
main thread, sends plain structured-cloneable block and constraint data to the
worker, and receives progress snapshots every 50 solver steps.

Each progress snapshot contains block transforms and diagnostics. The main
thread converts block transforms into segment overrides and rebuilds the 3D
scene from those transient overrides. This gives a live folding preview while
the simulation runs. The toolbar button changes from "Relax" to "Stop"; stop
requests worker cancellation and leaves partial results transient.

If worker creation or messaging fails, `View3D.svelte` falls back to local
chunked simulation. There is also a 1500 ms watchdog timer: if the worker is
started but no progress response is received within 1500 ms, the fallback kicks
in automatically. Both paths yield between chunks so the UI remains responsive
and the timer is cleared on the first valid worker message.

### Rendering And UI

`buildScene(...)` and `buildExportScene(...)` accept an optional
`Map<segmentId, BlockTransformOverride>`. When no overrides are provided, the
3D view renders the normal lattice geometry. When overrides are present, each
segment's points are transformed by its block transform.

The 3D toolbar exposes the user-facing controls:

- Relax / Re-relax / Stop (toolbar group labelled "RBS")
- Relaxed layout toggle
- Clear relaxed layout
- RBS parameter panel for spring constant `k`, repulsion constant `C`,
  friction, and iteration count
- Crossover stress toggle
- PNG, GLB, and oxDNA export buttons

The relaxed layout toggle switches between lattice geometry and the latest
transient RBS overrides. Clear removes the transient overrides. Results are not
persisted to the model or to `.fn.json`.

### Crossover Stress

After each solver result, `rbsEngine.ts` computes a length ratio for each
distance constraint:

```ts
currentDistance / restLength;
```

`buildScene(...)` accepts a stress map keyed by constraint ID. When stress
display is enabled, crossover arcs are colored on a green-to-yellow-to-red ramp:
values at or below `1x` rest length are green, `5x` is yellow, and `10x` or
larger is red. When stress display is off, crossover arcs use the oligo color.

The stress layer is diagnostic only. It does not affect the solver.

### Insert/Skip Effects

RBS intentionally uses ideal rigid-block bp geometry. Insertions and skips
represent local twist/curve effects inside a DNA segment, but a rigid body
cannot bend or twist internally. Applying insert/skip effects directly to block
centers, collision capsules, or crossover springs would therefore produce
misleading relaxation results.

Insert/skip effects are applied in rendering and export only. Shared helpers in
`src/lib/model/geometry3d/dnaGeometry.ts` compute physical coordinate offsets:

- `buildPhysicalOffsetMaps(...)`
- `getPhysicalStart(...)`
- `getSegmentPhysicalRange(...)`
- `getSegmentEndPhysicalIndex(...)`

`buildScene(...)`, `buildExportScene(...)`, and oxDNA export reuse these
helpers so inserted nucleotides are rendered/exported and skipped nucleotides
are omitted. Tests cover ideal mode, insertions, skips, and reverse-orientation
endpoint physical indices.

### oxDNA Export

The 3D toolbar can export the current layout to oxDNA `.dat` and `.top` files.
This is implemented in `src/lib/model/io/oxdnaExport.ts` and is independent of
persistence and View3D rendering.

The exporter builds a nucleotide-level 5-prime to 3-prime iterator over oligos,
connected segments, and slots:

- Normal slots emit one nucleotide.
- Inserted slots emit multiple nucleotides.
- Skipped slots emit no nucleotide.
- Connected segments continue the same strand in `.top`.

For each nucleotide, the exporter computes the lattice-frame position and local
orientation vectors, applies a segment block transform when a relaxed transient
override exists, and writes the resulting geometry to `.dat`. `.top` stores
strand ID, base, previous index, and next index. Unknown bases are exported as
`A` because oxDNA topology needs concrete bases.

When no relaxed override exists, the exporter writes the unrelaxed lattice
layout. After simulation, it writes the transient relaxed layout currently
shown by the 3D view.

### Strand Viewer Debug Layer

The StrandViewer has a block-debug layer controlled by a transient
`strandViewContext.showBlocks` flag. It recomputes block assignment with the
same `buildBlocksAndConstraints(part)` function used by the 3D RBS path, then
draws semi-transparent colored bands and labels (`B1`, `B2`, ...) behind the
strand routes.

The layer is inspection-only. It must not listen for events or interfere with
selection, hit testing, or editing.

Block colors come from the shared block color helper so diagnostics and the
2D layer use stable colors for the same block IDs.

## Current Limitations

- Results are transient and are not stored in the data model or in `.fn.json`.
- Only unconstrained crossovers are modeled as springs.
- Single-stranded DNA without a complementary strand is not yet modeled as an
  entropic spring.
- Live preview currently rebuilds the scene from transient overrides. Directly
  transforming persistent block groups would be smoother for larger designs.
- oxDNA export is a simplified geometric export, not a full molecular
  relaxation. It should be validated in oxView/oxDNA before production use.

## Verification

The current targeted checks are:

```bash
pnpm vitest run src/lib/model/rbs/blockRbs.spec.ts
pnpm vitest run src/lib/components/Editor/View3D/helixGeometry.spec.ts
pnpm vitest run src/lib/model/io/oxdnaExport.spec.ts
pnpm vitest run src/lib/model/test/LatticeGeometry.spec.ts
pnpm check
```

The RBS tests cover:

- `test_tetrahedral2.fn.json` builds 6 blocks.
- Constrained crossovers weld blocks and emit no elastic constraint.
- Unconstrained crossovers remain separate and emit one `0.6 nm` distance
  constraint.
- Same-VH complementary occupied spans weld into one block.
- Continuous `OligoSegment` spans stay in one block.
- A single unconstrained crossover converges near its rest length.
- Off-center spring attachments produce rotation.
- Overlapping block capsules are separated.
- Repeated runs are deterministic.
- Insert/skip physical-coordinate helpers emit the correct rendered/exported
  nucleotide counts and endpoint indices.
- oxDNA export emits inserted nts, omits skipped nts, preserves topology
  neighbor indices, applies transient relaxed overrides, and is deterministic.

## Future Work

### ssDNA Entropic Springs

Add flexible constraints for single-stranded regions without complementary
duplex support.

Plan:

- Detect unpaired occupied ranges by comparing each occupied span against the
  complementary strand set on the same VH.
- Convert each unpaired region that connects two rigid blocks into an
  `ssdna` distance constraint.
- Use a polymer model instead of a rigid contour-length spring. A reasonable
  first pass is an FJC/WLC-inspired rest length derived from nucleotide count,
  with contour length around `0.6 nm/nt` and a shorter RMS end-to-end distance.
- Use a lower spring constant than unconstrained crossovers because ssDNA is
  flexible and entropic.
- Keep source metadata on constraints so diagnostics can report crossover and
  ssDNA residuals separately.

This should be implemented after the crossover-only solver remains stable on
the tetrahedral fixture and a few larger designs.

### Persistence

The current layout is deliberately transient. A future persistence phase can
store relaxed block transforms in the model and `.fn.json`, then invalidate
them when topology or geometry changes. Until then, users can simulate and
export the current relaxed layout in one session, but saving the document does
not preserve the RBS result.

### Preview Optimization

Worker progress currently updates the scene by rebuilding from transient
segment overrides. For large designs, a smoother approach would keep one
renderable group per block and update each group's `position` and `quaternion`
directly on worker progress messages.

---

## Public API Surface

```ts
// model/rbs/buildBlocks.ts
buildBlocksAndConstraints(part): BlockBuildResult
//   { blocks, constraints, segmentToBlockId, spanToBlockId }

// model/rbs/rbsEngine.ts
class SimulationRunner {
  constructor(blocks, constraints, params)
  runSteps(n): void
  getResults(): Map<string, BlockTransformOverride>
  getStressMap(): Map<string, number>
  getDiagnostics(): RbsDiagnostics
}
DEFAULT_SOLVER_PARAMS = { iterations: 1200, dt: 0.1, springK: 10, repulsionK: 1000, damping: 0.25, collisionPasses: 2 }
```

Worker messages (`View3D/rbs/rbsWorker.ts`):

| Message    | Direction     | Fields                                           |
| ---------- | ------------- | ------------------------------------------------ |
| `run`      | main → worker | `blocks, constraints, params, progressInterval?` |
| `stop`     | main → worker | —                                                |
| `progress` | worker → main | `{ step, transforms, stressMap }`                |
| `done`     | worker → main | `{ transforms, stressMap, diagnostics }`         |
| `stopped`  | worker → main | —                                                |
| `error`    | worker → main | `{ message }`                                    |

## Boundaries / Don'ts

- **Don't persist `BlockTransformOverride`.** It is render-time only. Saving it into the model would invalidate any future topology change.
- **Don't run the solver on the main thread by default.** `View3D` first tries the worker; main-thread chunked simulation is a fallback after a 1500 ms watchdog.
- **Don't bypass `buildBlocksAndConstraints`.** The block partition (union-find over complementary VH spans + constrained crossovers) is what makes the solver tractable; ad-hoc block construction will tear at crossovers.
- **Don't treat `getStressMap()` as an absolute force value.** It is a relative residual map for visualization, not a physical Newton.
- **Don't keep stale `simOverrides` after a topology edit.** The 3D effect already invalidates via `isSimStale`; preserve that flag when adding new triggers.
- **Don't run RBS over a part with cross-region oligos and expect identical relaxation.** The block builder operates per-part; cross-region behavior follows the active region's geometry.
