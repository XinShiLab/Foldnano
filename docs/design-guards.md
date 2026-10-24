---
covers:
  - src/lib/model/checks/**
  - src/lib/components/Editor/designCheckPrompt.svelte.ts
  - src/lib/components/Editor/DesignCheckDialog.svelte
  - src/lib/plugin/result-format-validation.ts
---

# Design guards — `src/lib/model/checks/`

One place for "is this design acceptable here?" checks, shared by import, plugins, export and the
strand view's issue overlay. Each caller decides what an issue means for it; the checks only report.
Changing the editor, the model or an exporter usually means changing a rule here: see § Changing
the checks.

## Issues

Every check reports a `DesignIssue` (`designIssue.ts`): a `rule`, a `severity`
(`error | warning | info`), a user-facing `message`, and an optional `anchor` locating it
(`vhIndex` for raw-JSON checks; model checks also fill `vhId`, segment and oligo ids). Anchors key
on `vh.id` where a Part exists, like the spatial index, so display reordering never stales them.

## Layers

| Layer          | Input                       | Where                                                     |
| -------------- | --------------------------- | --------------------------------------------------------- |
| Shape          | parsed JSON, before a Part  | `shape/cadnanoJsonShape.ts`, `shape/foldnanoJsonShape.ts` |
| Integrity      | a Part / region             | `integrity.ts`                                            |
| Target profile | a Part / region, per format | `simulation.ts`, `cadnano.ts`                             |

**Shape** checks fail fast: they throw `DesignCheckError` (carrying the issue) on the first error,
because later shape checks index into structures the earlier ones verified. Non-fatal repairs come
back as `warning` issues alongside the cleaned data (`checkCadnanoJsonShape` discards a one-sided
connection pointer whose target is free, and says so; a crossover exit pointing at its own base is
rewritten to its neighbour as an `info` issue).

**Integrity** checks (`checkPartIntegrity(part, regionIds?)`, `checkDocumentIntegrity(doc)`) look
for states the editor never creates itself but a loaded file or plugin result can. They collect
every issue and never throw:

| Rule                       | Severity | Why                                                                                                                                                                 |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `helix-cell-parity`        | warning  | helix number parity ≠ cell parity (`row % 2 === col % 2` is even); the editor assigns them together (`addVhAtCoords`), cadnano export and crossover sites assume it |
| `negative-cell`            | error    | the grid, move bounds and parity math assume row/col ≥ 0                                                                                                            |
| `shared-cell`              | error    | two helices of one region on one lattice cell                                                                                                                       |
| `asymmetric-skip-insert`   | error    | both strands present at a base with different slot lengths; `addSkipOrInsertion` always edits both                                                                  |
| `skip-insert-on-crossover` | error    | skip/insert on a constrained crossover site; the editor refuses it (`_assertCanModifySkipOrInsertionAt`)                                                            |

A skip/insert on a base whose other strand is **absent** is not an integrity issue: deleting the
partner strand leaves it there in normal editing. Simulation export refuses it through the
simulation profile below.

**Target profiles** say what a format can't represent. `checkSimulationProfile(part)`
(`simulation.ts`) returns the integrity errors that break the NT model (`asymmetric-skip-insert`,
`skip-insert-on-crossover`) plus `unpaired-skip-insert` (a skip/insert whose other strand is
absent; ssDNA is fine, a one-sided skip/insert is not, so the message asks for explicit ssDNA or
removal). `assertSimulationReady(part)` throws the first as `Cannot export simulation model: …`;
`buildSimulationNtModel` calls it, so oxDNA, mrDNA and the 3D NT view share one check and one
wording. `SIMULATION_RULES` holds the profile's own rules.

`checkCadnanoProfile(part, region)` (`cadnano.ts`) lists what `CadnanoJSON.fromRegion` can't write
faithfully:

| Rule                     | Severity        | Why                                                                                                                                                                                                                                                                                    |
| ------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cadnano-no-lattice`     | error           | freeform region, or a helix without a lattice position                                                                                                                                                                                                                                 |
| `cadnano-strand-class`   | error           | a connection between a cadnano scaffold path and a staple path; cadnano picks the array by `(vh.index + strandIndex) % 2` (`0` → `scaf`), so the export points into the wrong array and the file can't be read back                                                                    |
| `cadnano-lattice-length` | error / warning | length not a multiple of the lattice repeat (cadnano can't open it); a length that fits both lattices (multiples of 672) is a warning: cadnano asks "is this design in square lattice?" on import, so the message tells the user what to answer; Foldnano decides from crossover sites |
| `cadnano-cross-region`   | warning         | connections to other regions are cut (one issue with the count)                                                                                                                                                                                                                        |
| `cadnano-mirror-oligo`   | warning         | repeat-group copies are left out                                                                                                                                                                                                                                                       |
| `cadnano-metadata`       | info            | sequences, modifications, oligo names, the scaffold label                                                                                                                                                                                                                              |

It also includes the region's integrity issues that matter to cadnano (`helix-cell-parity`,
`negative-cell`, `shared-cell`, and `asymmetric-skip-insert`, because cadnano's `loop`/`skip` are
per base, not per strand). `skip-insert-on-crossover` is left out: cadnano allows it.

## Repairs and refusals on cadnano import

Every place a cadnano file is changed or refused on the way in, so nothing is dropped silently.
`warning` repairs reach the user as "Cadnano import warning" toasts (plugins: console only);
`info` repairs are kept as issues but not shown. Keep this table and the user guide's
"Opening cadnano files" section (`src/content/guide/04-creating-a-design.md`) in step.

| Case                                                                                              | Outcome                                                         | Severity | Where                                           |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------- | ----------------------------------------------- |
| One-sided pointer whose target is empty (e.g. `[0,0,…]` at a base whose source `stap[0]` is free) | pointer cleared, end becomes free; same strand cadnano draws    | warning  | `checkCadnanoJsonShape`                         |
| Crossover exit pointing at its own base (Hilbert.json)                                            | rewritten to the adjacent base that points to it                | info     | `checkCadnanoJsonShape`                         |
| Deletion (skip) on a crossover base                                                               | moved to an adjacent non-crossover base                         | warning  | `VStrand.relocateSkipsOffCrossovers`            |
| Deletion on a crossover base with no free neighbour                                               | kept; simulation export may refuse it                           | warning  | `VStrand.relocateSkipsOffCrossovers`            |
| Insert (loop) on a crossover base                                                                 | kept; `skip-insert-on-crossover` reports it on open (warn-only) | —        | `relocateSkipsOffCrossovers` handles skips only |
| Length fits both lattices, crossovers don't decide                                                | user is asked                                                   | —        | `cadnanoLattice.ts`, `withLatticeChoice`        |
| Pointer whose target claims a different connection                                                | refused                                                         | error    | `checkCadnanoJsonShape`                         |
| Two helices on one cell, duplicate helix numbers, unequal helix lengths                           | refused                                                         | error    | `checkCadnanoJsonShape`                         |
| Negative helix number, row or col (cadnano never writes one)                                      | refused                                                         | error    | `checkCadnanoJsonShape`                         |
| Malformed arrays, pointers to missing helices or out-of-range bases, skip and insert on one base  | refused                                                         | error    | `checkCadnanoJsonShape`                         |
| Malformed or out-of-range colors                                                                  | refused                                                         | error    | `checkCadnanoJsonShape`                         |
| 1-nt strand                                                                                       | refused, listing helix[base]                                    | error    | `CadnanoJSON._assertNoSingleNtStrands`          |
| Length fits no lattice; requested lattice the length or crossovers rule out                       | refused                                                         | error    | `CadnanoJSON._resolveLattice`                   |

## Repairs on foldnano JSON load

`repairDocumentJson` (see `storage-architecture.md` § Repair on load) also moves a lattice region off
negative cells without moving it in 3D. Integrity issues found after that are reported, never fixed:
which strand's skip is right, or which helix owns a shared cell, isn't knowable.

## Callers

- **Every document the editor opens.** `EditorDocumentSession.#adoptDocument` runs
  `checkDocumentIntegrity` and `notifyDesignIssues` (`documentRecovery.ts`) lists up to five
  `error`/`warning` messages in one toast. The same notice for the same document within 10 s is skipped: opening a file as a new document adopts it twice (import, then the `/editor/[docId]` remount). Load is warn-only, whatever the severity: refusing would
  lock the user out of their own design. `loadCadnanoAsRegion` checks the new region the same way.

- **cadnano import.** `CadnanoJSON.fromRaw` (file open and the URL loader via `cadnanoParser`,
  `LoadCadnanoAsRegionDialog`, the landing hero) runs the shape check and keeps the issues;
  `warning`s join `CadnanoJSON.warnings`, `info` stays out of the user's way.
- **Plugins.** `plugin/result-format-validation.ts` (`checkResultArtifact`) parses the raw
  artifact, runs a shape check and turns a `DesignCheckError` into a
  `PluginValidationError` in the `result-format-validation` phase. The shape rule names
  (`SHAPE_RULES`) are a prefix of `INVARIANT_CATEGORIES`, so the category passes through
  unchanged. The format adapters (`result-format-validation-cadnano-json.ts`, `-foldnano-json.ts`)
  keep their `validateResultShape` signatures for `PluginCoordinator`. Design verification runs
  `checkPartIntegrity` on the reconstructed scratch Part (only the replaced region for region
  strategies) and rejects on the first `error`, with the rule name as the category
  (`INTEGRITY_RULES` are in `INVARIANT_CATEGORIES` too); `warning`s go to the console.

- **cadnano export (Toolbar).** Runs `checkCadnanoProfile` first; with any `error` or `warning`
  it asks through `designCheckPrompt` / `DesignCheckDialog` (mounted in `Editor.svelte`): errors
  only offer Close, warnings offer "Export anyway". `info` alone exports without asking.
- **cadnano_json plugin launch.** `PluginCoordinator.runWithOptions` asks the reviewer set with
  `setCadnanoInputReviewer` (the editor passes `designCheckPrompt`) before the run starts, so a
  declined review leaves the plugin untouched. It always asks about errors, and about warnings only
  for `replaceRegion*` strategies, where applying the result would make the loss permanent; a
  read-only plugin just sees a lossy copy.

- **Editor overlay.** `collectDesignIssues(part, activeRegion, selection)` (`collect.ts`) runs the
  selected checks (integrity on all regions, simulation on the part, cadnano on the active region),
  drops duplicates (the profiles repeat integrity rules) and sorts errors first.
  `EditorViewContext.designIssues` feeds it to the strand view's markers and issue list; see
  `editor-strand-viewer.md` § Design Check Overlay.

## Changing the checks

The rules encode what the editor allows and what each format can hold, so they go stale when either
side changes. Nothing enforces this: `docs:check` only flags this doc when `model/checks/` itself
changes, so the model, editor and exporter docs point here instead.

**When to revisit a rule**

| You changed…                                                                                                       | Then…                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The editor now **allows** a state an integrity rule forbids (e.g. a skip on a crossover site, a per-strand insert) | Remove or relax that rule in `integrity.ts`. Otherwise every saved design using the new freedom is flagged on load and plugin results using it are rejected.                                     |
| The editor now **forbids** something it used to allow (a new invariant)                                            | Add an integrity rule (old files and plugin results can still carry it), usually `warning` on load; reserve `error` for states that break export or the NT model.                                |
| The model gains a feature (a new region kind, oligo/segment field, repeat-group behaviour)                         | Ask whether cadnano JSON and the NT model can hold it. If not: a cadnano profile rule (`warning` if structure is lost, `cadnano-metadata` info if only annotation is), and/or a simulation rule. |
| `CadnanoJSON.fromRegion` / `toPart` / the importer's repairs                                                       | Re-check `cadnano.ts` and the import repair table above, and add a `cadnano-native-roundtrip.spec.ts` case; the corpus fails if a change goes unreported.                                        |
| `buildSimulationNtModel` (what it can place)                                                                       | Update `simulation.ts`; the NT model must keep calling `assertSimulationReady` first.                                                                                                            |
| A new import format or plugin result format                                                                        | A shape check in `shape/`, fail-fast, plus a plugin adapter if plugins return it.                                                                                                                |

**Where a rule goes**

| Kind                                        | File            | Rule list          | Who sees it                                                                          |
| ------------------------------------------- | --------------- | ------------------ | ------------------------------------------------------------------------------------ |
| Raw JSON is malformed or self-contradictory | `shape/*.ts`    | `SHAPE_RULES`      | file import (refused), plugin results (rejected)                                     |
| A Part state the editor never creates       | `integrity.ts`  | `INTEGRITY_RULES`  | every opened design (notice), plugin results (errors reject), overlay "Editor rules" |
| The NT model / oxDNA / mrDNA can't place it | `simulation.ts` | `SIMULATION_RULES` | simulation export and 3D NT view (refused), overlay "Simulation export"              |
| cadnano JSON can't hold it                  | `cadnano.ts`    | `CADNANO_RULES`    | cadnano export and `cadnano_json` plugin launch (dialog), overlay "Cadnano export"   |

A profile that also cares about an integrity rule includes it (`CADNANO_INTEGRITY_RULES`,
`SIMULATION_INTEGRITY_RULES`) rather than re-implementing it; `collectDesignIssues` removes the
duplicates.

**With every rule change**

1. The rule name in its list above (plugin categories are derived from `SHAPE_RULES` and
   `INTEGRITY_RULES`, so nothing else to register).
2. A message that names the helix and base and says what to do, not just what is wrong.
3. An `anchor` with `vhId` and `bp` when the issue has a spot, so the overlay can frame it and the
   issue list can jump to it. Region-wide issues just omit them; no UI change is needed either way.
4. A spec for the rule; for cadnano rules also a corpus case with `flags` and `loses`.
5. The tables in this doc, and the user-facing ones: `src/content/guide/17-design-checks.md` (the
   full list, one row per rule), `src/content/guide/04-creating-a-design.md`
   (Opening Cadnano Files, Design Checks While You Edit), `src/content/guide/09-simulation-export.md`
   (NT model, Exporting cadnano JSON), and `src/content/plugin-development/03-plugin-formats.md`
   when plugins see it.

## Testing

Each layer has a spec per rule (`cadnanoJSON_fromRaw`, `cadnanoLattice`, `integrity`,
`cadnanoProfile`, `collectDesignIssues`, `simulationNtModel` in `src/lib/model/test/`). Two corpora
keep the cadnano rules honest from both sides:

- `cadnano-json-roundtrip.spec.ts` runs published cadnano files three times through import and
  export; they must also come out clean in `checkCadnanoProfile` (`cadnanoProfile.spec.ts`).
- `cadnano-native-roundtrip.spec.ts` builds Foldnano-native designs, one per thing cadnano can't
  hold (plus clean controls), exports and re-imports each, and asserts per case which rules are
  flagged and whether the design changed. The guard it enforces: any change was reported up front by
  the cadnano profile or, for states only an imported file can carry (a skip on a crossover base),
  by an editor-rules error. Add a case here with every new cadnano rule.

## Boundaries / Don'ts

- **Checks never import from `$lib/plugin` or UI code.** Plugin- or dialog-specific wording and
  error classes live in the adapters; check messages are neutral ("Design is missing …").
- **Don't add a shape or integrity rule without adding it to `SHAPE_RULES` / `INTEGRITY_RULES`.**
  The plugin error category list is derived from them.
- **Don't refuse or auto-fix a loaded design from an integrity issue.** Report it; only
  `repairDocumentJson` changes loaded data, and only where the fix is unambiguous.
- **Don't add a silent repair.** Anything that changes imported data reports an issue
  (`warning` if the user would notice a difference, else `info`) and gets a row above.
- **Don't make shape checks collect-all.** They rely on fail-fast ordering; collect-all reporting
  belongs to the Part-level layers.
