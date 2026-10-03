---
title: Formats and Apply Strategies
description: Choosing between cadnano_json, foldnano_json, and foldnano_mini; apply strategy matrix
category: plugin-development
order: 3
slug: plugin-formats
---

# Formats and Apply Strategies

## Choosing a Format

| Question | Use |
| --- | --- |
| I only need helix topology and colors | `cadnano_json` |
| I need sequences, oligo names, or modifications | `foldnano_json` |
| I need to mutate the model and preserve sequences | `foldnano_json` with `replacePartKeepAnnotationsWhereMatched` |
| I want to write code that mutates the part directly (one undo step) | `foldnano_mini` with `replayMutationLog` / `…InRegion` |

**`cadnano_json`** is a lossy format: it carries helix topology and staple colors but drops sequences, modifications, oligo names, and the explicit scaffold flag (which is re-derived from lattice parity on import).

**`foldnano_json`** is the lossless `Part.toJSON()` snapshot. It includes everything: per-slot sequences, skip/insert structure, modifications, oligo names, `isScaffold` flag, and UUIDs. It is the only format that exposes sequence data to plugins. Its shape is the same as one entry of `parts` in a `.fn.json` file; the [File Format](/docs/contributors/file-format#part) page documents every field.

**`foldnano_mini`** is the mutable API. The plugin operates on a `MutablePart` whose mutations are captured as a structured op log; the host replays the log against the real JS-side `Part` under one undo step. This is the only format that lets you express _direct_ edits (`oligo.color = '#f00'`, `part.create_segment(...)`, `part.connect(a, b)`) instead of producing a whole-part snapshot.

**`live`** is reserved for a future phase and is not currently installable. Manifests that declare `format: "live"` are rejected at install time.

---

## Choosing an Apply Strategy

| Strategy | When to use |
| --- | --- |
| `previewOnly` | Analysis-only plugins that produce logs, CSV reports, or other artifacts without mutating the design. The model is never touched. |
| `replacePartKeepAnnotationsWhereMatched` | Whole-part replacement for `foldnano_json` plugins when sequences, modifications, and names should be re-grafted onto matched segments after the replace. |
| `replacePart` | Whole-part replacement for `foldnano_json` plugins when annotation re-grafting would be incorrect. Shows a data-loss warning before apply. |
| `replaceRegion` / `replaceRegionKeepAnnotations…` | Region-scoped replacement for `cadnano_json` plugins. Cross-region links are re-grafted automatically. Region replacement must preserve the region's VH index set; creating new VHs is not supported. |
| `replayMutationLog` | Replay a `foldnano_mini` mutation log against the existing part. One undo step covers the whole run. |
| `replayMutationLogInRegion` | As above, but every op's target VH must belong to the active region; otherwise the replay aborts cleanly. |

For `foldnano_json` mutations, **always prefer `replacePartKeepAnnotationsWhereMatched`** unless you are intentionally changing the topology. It ensures sequences assigned before the run survive the apply.

For `foldnano_mini` mutations, choose `replayMutationLogInRegion` when your plugin only touches the active region (the host enforces the scope) and `replayMutationLog` when it touches the whole part.

For `cadnano_json` region replacement, treat the active region's VH numbering as fixed. A `replaceRegion*` plugin may rewrite topology within those helices, but it must not introduce brand-new VHs for that region.

Install-time validation enforces the supported combinations:

- `cadnano_json`: `previewOnly`, `replaceRegion`, `replaceRegionKeepAnnotationsWhereMatched`
- `foldnano_json`: `previewOnly`, `replacePart`, `replacePartKeepAnnotationsWhereMatched`
- `foldnano_mini`: `previewOnly`, `replayMutationLog`, `replayMutationLogInRegion`
