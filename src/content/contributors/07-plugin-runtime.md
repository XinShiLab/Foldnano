---
title: Plugin Runtime Architecture
description: Plugin formats, apply strategies, Pyodide worker ownership, mutation logs, and host-side replay
category: contributors
order: 7
slug: plugin-runtime
---

# Plugin Runtime Architecture

The plugin runtime lets Python analyze or mutate designs without giving Python direct access to the live JavaScript model.

That last clause is deliberate: Python code runs inside a Pyodide (WASM) Web Worker, sandboxed away from the main thread. A plugin never gets a live handle into the editor's `Part`; it only ever receives a serialized snapshot and returns a serialized result (or a mutation log). All of that result is then applied back to the model by host-side TypeScript (`ResultApplicator`), inside a normal `historyStack` transaction, so a plugin can't corrupt the model, bypass undo, or touch anything outside what its declared format/strategy allows.

## Formats

| Format | Purpose |
| --- | --- |
| `cadnano_json` | Compatibility topology format. Lossy: sequences, modifications, oligo names are dropped. |
| `foldnano_json` | Full Foldnano snapshot: everything, including `isScaffold` and UUIDs. |
| `foldnano_mini` | Mutable Python mirror that records a replayable mutation log, rather than returning a whole new document. |
| `live` | Reserved and rejected by manifest validation (planned direct in-worker access; not available yet). |

`foldnano_mini` exists because whole-document replace/re-graft (`foldnano_json`) is coarse: any edit, however small, means diffing a full snapshot and re-matching annotations by coordinate. A mutation log instead captures the actual Python-side operations (add VH, set sequence, add crossover, …) as a structured op list, which the host replays against the *existing* live `Part` in one undo step. No coordinate re-matching is needed, and IDs for newly created entities are shared between the Python mirror and the host rather than guessed.

## Apply Strategies

Preview strategies (`previewOnly`) never touch the model: output is diff/log only, for analysis-only plugins. Replacement strategies (`replacePart[KeepAnnotationsWhereMatched]`, `replaceRegion[KeepAnnotationsWhereMatched]`) deserialize returned JSON and swap it into the document; the `KeepAnnotationsWhereMatched` variants re-graft sequences/mods/names onto segments whose coordinates are unchanged, since a whole-part replace otherwise regenerates all UUIDs and loses that data. Replay strategies (`replayMutationLog`, `replayMutationLogInRegion`) apply a `foldnano_mini` mutation log through command transactions against the live `Part`. This is why `foldnano_mini` is the only format the replay strategies accept: replaying an op log only makes sense against the format that produced one.

Use `replayMutationLogInRegion` when a plugin must be scoped to the active region: it rejects any operation that targets a VH outside the recorded active region and aborts the whole replay cleanly, rather than partially applying it. Without that check, a region-scoped plugin could silently reach outside its declared scope and mutate unrelated parts of the design.

## Contributor Rules

- Manifest validation must enforce compatible format/apply-strategy pairs: the pairing above isn't just a convention, install-time validation rejects mismatched combinations (e.g. `cadnano_json` + `replayMutationLog`).
- Mutating plugin results must become undoable editor history entries: `ResultApplicator` wraps every apply in `historyStack.snapshotTx` so a plugin run is always one undo step, never an untracked mutation.
- Region-scoped replay must reject out-of-region operations, per above.
- Plugin artifacts are downloads, not model mutations: an artifact a plugin produces for the user to save is not the same thing as applying a result to the live document.
- Plugin entrypoint and requirement loading should stay explicit and reviewable: a plugin's manifest declares what it needs (Python packages, wheel URLs) up front rather than fetching arbitrary code at run time.

Read `docs/python-plugin-system.md` and `docs/foldnano-plugin-development-guide.md` for deeper implementation detail.
