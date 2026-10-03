---
covers: [] # cross-cutting; review manually
---

# Reactivity Patterns

This project uses **Svelte 5 rune syntax inside TypeScript classes**, not just inside `.svelte` components. This page documents the conventions used throughout the model and editor layers.

---

## Why `.svelte.ts` Files

Svelte 5 runes (`$state`, `$derived`, `$props`) are compiled syntax — the Svelte compiler must process files that use them. Plain `.ts` files are not processed by the compiler.

**Rule:** Any TypeScript class that uses `$state` or `$derived` must use the `.svelte.ts` extension.

```
src/lib/model/
├── document.svelte.ts          ← uses $state
├── Part/Part.svelte.ts         ← uses $state, $derived
├── VirtualHelix/VirtualHelix.svelte.ts
├── Oligo/Oligo.svelte.ts
├── Oligo/OligoSegment.svelte.ts
├── Oligo/SegmentEnd.svelte.ts
└── io/cadnanoJSON.ts           ← pure logic, no runes → plain .ts
```

---

## `$state` in Classes

`$state(value)` marks a class property as reactive. Any component or `$derived` expression that reads it will re-run when it changes.

```typescript
// src/lib/model/Oligo/Oligo.svelte.ts
export default class Oligo {
	color = $state<string>('#FFA500');
	isScaffold = $state<boolean>(false);
	segments = $state<SvelteSet<OligoSegment>>(new SvelteSet());
}
```

Only properties that **change** during normal editing should be `$state`. Immutable identity fields (like `id`) are plain assignments.

```typescript
export default class VirtualHelix {
	readonly id: string; // never changes → plain assignment
	listRow: number = $state(0); // changes on reorder → reactive
	private _length: number = $state(0); // changes on extend → reactive
}
```

---

## `$derived` and `$derived.by`

`$derived(expr)` auto-recomputes when any reactive value it reads changes. Use `$derived.by(() => …)` for multi-line derivations.

```typescript
// Simple: re-runs when this.selectionToggles changes
selectionFilter = $derived(fromToggleToLeafTarget(this.selectionToggles));

// Complex: re-runs when this.oligos changes
isAllScaffoldSequenceLocked = $derived.by(() => {
	for (const oligo of this.oligos) {
		if (oligo.isScaffold && !oligo.isSequenceLocked) return false;
	}
	return true;
});
```

**Common use cases in this codebase:**

| Location                            | What is derived                                        |
| ----------------------------------- | ------------------------------------------------------ |
| `StrandViewContext.selectionFilter` | `Set<LeafTarget \| Category>` from `selectionToggles`  |
| `SegmentEnd.isConstrained`          | whether this end is constrained by a crossover         |
| `OligoSegmentInPart` (component)    | Konva line points from `segment.fivePrime.index`, etc. |

---

## `SvelteSet` and `SvelteMap`

Plain `Set` and `Map` are **not reactive** — Svelte cannot track `.add()`, `.delete()`, or `.clear()` on them. Use `SvelteSet` and `SvelteMap` from `svelte/reactivity` for any collection that must trigger re-renders when its membership changes.

```typescript
import { SvelteSet, SvelteMap } from 'svelte/reactivity';

// Oligo holds its segments in a SvelteSet
segments = $state<SvelteSet<OligoSegment>>(new SvelteSet());

// SpatialIndexService caches VH lookups in SvelteMaps, even though it's a
// non-model cache, because hit-test results are read from derived/component context
_vhCoordToSegmentCache = new SvelteMap<string, Map<number, OligoSegment>>();
```

**When to use each:**

| Use `SvelteSet` / `SvelteMap`                | Use plain `Set` / `Map`                           |
| -------------------------------------------- | ------------------------------------------------- |
| Part of reactive model state                 | Internal cache only (e.g., `SpatialIndexService`) |
| UI iterates over the collection              | Collection not read in derived/component context  |
| Membership changes should trigger re-renders | Populated once, never mutated after               |

> Note: `SpatialIndexService` uses `SvelteMap` even though it is an internal cache, because the cache is read in derived component expressions (hit-test results drive rendering).

---

## `$state.snapshot()` — Non-Reactive Deep Clone

`$state.snapshot(value)` extracts a deep, **non-reactive** copy of any reactive object (it uses `toJSON()` when the value has one).

**Caveat: in the server compile it can be a no-op.** For `const x = $state.snapshot(y)`, Svelte's server transform emits `const x = y`, since nothing is reactive on the server. Vitest runs `.svelte.ts` files through that transform, so in tests such a "copy" is the live object. Code whose correctness depends on a real copy, like history snapshots, must not rely on it: `HistoryStack` uses `FoldnanoDocument.snapshot()` (a JSON round-trip of `toJSON()`) instead. See `commands-and-history.md`.

`$state.snapshot` is also useful for:

- Serialization (passing to `JSON.stringify`)
- Passing state to a Web Worker (non-reactive, transferable)
- Logging immutable state at a point in time

---

## Mutating `$state` Arrays

Arrays assigned to `$state` support tracked in-place mutation via standard array methods:

```typescript
// ✅ tracked mutations
ctx.strandCtx.tempParts.push(newPart);
ctx.strandCtx.tempParts.splice(idx, 1);
ctx.strandCtx.tempParts.length = 0; // clear

// ✅ also fine — reassignment
ctx.strandCtx.tempParts = [...ctx.strandCtx.tempParts, newPart];
```

Avoid getting a local reference and mutating through that — the connection to the reactive system may be lost:

```typescript
// ⚠️ potentially problematic if ref is detached
const parts = ctx.strandCtx.tempParts;
parts.push(newPart); // works today but fragile
```

---

## Debounced Slot Sync (Microtask Pattern)

`SegmentEnd.index` has a side effect: when it changes, the parent segment's slot array must be resized. Rather than running this synchronously on every assignment (which would be expensive during batch moves), a microtask is scheduled:

```typescript
// SegmentEnd.svelte.ts
private _pendingSlotSync = false;

set index(newIndex: number) {
  const prev = this._index;
  this._index = newIndex;
  if (prev !== newIndex) this._scheduleSlotSync();
}

private _scheduleSlotSync() {
  if (this._pendingSlotSync) return;    // already queued
  this._pendingSlotSync = true;

  // Vitest: run synchronously (no event loop)
  if (typeof process !== 'undefined' && process.env?.VITEST_WORKER_ID) {
    this._pendingSlotSync = false;
    this.segment.updateSlotsAfterEndMove?.();
    return;
  }

  Promise.resolve().then(() => {
    this._pendingSlotSync = false;
    this.segment.updateSlotsAfterEndMove?.();
  });
}
```

This coalesces many rapid index changes (e.g., batch-moving multiple ends) into a single slot resize per segment per microtask tick.

The Vitest special-case ensures tests see the sync result immediately without needing to flush the microtask queue.

---

## Context Injection (Svelte Context vs. Props)

The `EditorViewContext` (which holds `strandViewContext`, `editorMode`, `historyStack`) is injected via Svelte's type-safe `createContext<T>()` helper (from `'svelte'`), which wraps `setContext` / `getContext` under the hood. `EditorViewContext.svelte.ts` calls `createContext<EditorViewContext>()` once to produce a `[getEditorViewContext, setEditorViewContext]` pair; `Editor.svelte` calls `setEditorViewContext(...)`, and any descendant component or tool calls `getEditorViewContext()`.

This avoids prop-drilling across deeply nested components. However, context is **not reactive by default** — the context object itself is stable, and reactivity comes from the `$state` properties inside it.

```typescript
// EditorViewContext.svelte.ts
export const [getEditorViewContext, setEditorViewContext] = createContext<EditorViewContext>();

// Editor.svelte
setEditorViewContext(editorViewContext);

// Any descendant
const ctx = getEditorViewContext();
// ctx.editorMode is $state → reading it in a $derived or template is reactive
```

---

## Common Pitfalls

### Pitfall 1: Wrapping a `SvelteSet` in a non-reactive copy

```typescript
// ❌ snapshot breaks reactivity
const snapshot = [...part.oligos];  // snapshot
snapshot.forEach(…);               // will NOT re-run if oligos changes later
```

Iterate `part.oligos` directly inside a `$derived` expression to maintain tracking.

### Pitfall 2: Forgetting `.svelte.ts` extension

A class with `$state` in a `.ts` file will compile, but `$state(…)` will be treated as a plain function call (it doesn't exist at runtime in non-Svelte contexts), throwing a runtime error.

### Pitfall 3: Mutating outside a transaction

Mutations to `$state` model objects outside a `history.tx()` call will still update the UI reactively, but will **not** be captured in the undo stack. Always use a command function for user-initiated mutations.

### Pitfall 4: Reading derived state during construction

`$derived` in a class is evaluated lazily on first access. Accessing a `$derived` property inside the constructor (before the class is fully initialized) can cause unexpected behavior if the derivation depends on other properties that aren't set yet. Initialize `$state` fields before any code that might trigger `$derived` reads.

---

## Boundaries / Don'ts

- **Don't put `$state` / `$derived` in `.ts` files.** Use `.svelte.ts`. Plain `.ts` is fine for pure logic (no runes).
- **Don't `[...spread]` a reactive collection inside a `$derived`** unless you want to break the tracking link — iterate the original.
- **Don't pass live model objects to a Web Worker.** Use `$state.snapshot(value)` first; the snapshot is plain and structuredClone-safe.
- **Don't subscribe to `$state` from inside a long-lived callback registered outside Svelte's reactive scope.** Use `$effect` from a component or a class with a Svelte-tracked owner. Bare callbacks survive component unmount and leak.
- **Don't mutate during a `$derived` read.** Derivations must be pure; mutating fields the derivation depends on triggers re-runs and can loop.
- **Always reach for `SvelteSet` / `SvelteMap` for reactive collections.** Plain `Set` / `Map` only inside non-reactive caches that are read through other reactive entry points.
