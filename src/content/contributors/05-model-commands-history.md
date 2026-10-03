---
title: Model, Commands, And History
description: Mutation ownership, command transactions, topology identity, reactivity, and undo/redo invariants
category: contributors
order: 5
slug: model-commands-history
---

# Model, Commands, And History

## Commands And Transactions

**All model mutations go through commands.** Commands are plain functions in `src/lib/commands/` (not classes) that mutate the live model only inside a `HistoryStack` transaction:

```ts
export function someCmd(args: Args, history: HistoryStack): void {
	history.tx('Label', (rec) => {
		args.part.someMutation();
	});
}
```

Mutations made outside a transaction are reactive (the UI updates) but not undoable: the history stack never saw them, so undo/redo has nothing to replay. This is the single most common way a new feature quietly breaks undo.

There are two transaction APIs, and the choice matters:

- **`historyStack.tx(label, rec => ...)`**: use for targeted edits. It runs the mutation, records only the specific fields/slots that changed via the recorder (`rec.field(...)`, `rec.slot(...)`, `rec.oligo(...)`), and commits only if something actually differs. Cheap, and produces small, precise undo patches.
- **`historyStack.snapshotTx(label, () => ...)`**: use for structural edits (adding/removing virtual helices, regions, oligos, or anything else that changes the shape of the document, not just a field's value). It snapshots the whole document before and after and stores the diff as one `DocumentSnapshotChange`. More expensive, but correct for changes a targeted patch can't safely describe.

When in doubt: if you can name the exact fields that changed, use `tx`. If the edit restructures the document, use `snapshotTx`.

## Part Is The Only Mutation Owner

`Part` is the only mutation owner inside the model. Never write directly to `VirtualHelix._length`, `OligoSegment.slots`, `StrandSet.segmentIds`, or similar internal fields; go through a `Part` method instead.

This exists because `Part` is the one place that keeps derived state consistent when topology changes: the `SpatialIndexService` hit-test cache (keyed by `vh.id`), `vh.listRow` (row order), and the undo/redo mementos all assume mutations funnel through `Part`. A direct field write skips all of that bookkeeping: the model looks mutated, but the spatial index, row order, or undo history silently fall out of sync with it.

Concretely: `vh.listRow` is assigned by `Part.syncListRows()`, not derived on read. If you reorder a region's `vhOrder`, call the `reorderVirtualHelixCmd` command and let it rebuild `listRow`; don't write `vh.listRow` yourself. The same applies to `vh.latticeCoords` and `vh.localFrame`: go through region helpers and movement commands, not direct field assignment.

## Topology Identity: `vh.id`, Not `vh.listRow`

Topology (the spatial index, identity lookups) is keyed by `vh.id`. `vh.listRow` is a *display* concern: it can change when a region collapses or a user reorders the VH list, and it must not invalidate anything that depends on identity. Use `getEntitiesAtVh(vhId, ...)` when you need identity-stable lookups; `getEntitiesAt(vhRow, ...)` is a thin row-index adapter for display code only.

## Regions And Capabilities

Capability flags live on `DesignRegion`, not `Part`: `supportsLatticeGrid`, `supportsConstrainedXoverSites`, `supportsLatticeAutoStaple`. Use these, not `instanceof` checks, for UI and IO decisions, and gate on the *active region*, not the part. A single `Part` can contain a mix of lattice and freeform regions, so a part-level "is this lattice?" answer is frequently wrong for at least one of its regions.

## Reactivity

Reactive collections must be `SvelteSet`/`SvelteMap`: a plain `Set`/`Map` won't trigger Svelte's reactivity when mutated, so the UI silently goes stale. Plain `Set`/`Map` are fine only for caches that are intentionally non-reactive (e.g. `SpatialIndexService`'s internal index).

Class files that use `$state` or `$derived` must use the `.svelte.ts` extension: the Svelte compiler only applies the runes transform to files with that extension, and a rune in a plain `.ts` file is inert. See `docs/reactivity-patterns.md` for the full pattern, including snapshotting reactive classes for the history recorder.

## Crossover Direction

Crossover connections are always recorded 3' to 5': call `ThreePrimeEnd.connectTo(FivePrimeEnd)`, never the reverse. Downstream code (sequence generation, export) assumes this direction consistently.
