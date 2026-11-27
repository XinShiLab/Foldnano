---
covers:
  - src/lib/model/partLinks.ts
  - src/lib/commands/partLinks.ts
  - src/lib/commands/linkedPartGuard.ts
  - src/lib/services/partLinks/**
  - src/lib/services/storage/docSavedChannel.ts
  - src/lib/model/checks/links.ts
  - src/lib/components/Editor/Assembly/InsertLinkedPartDialog.svelte
  - src/lib/components/Editor/Assembly/LocalOnlyLinksNotice.svelte
---

# Linked Parts

A linked Part is a **read-only cached copy** of the single Part of another design (its _source_),
inserted into an assembly with **Link Part** in the Assembly panel (the header's main button in a
design that is empty or already links Parts, else under its arrow), by **New assembly** there (a blank document via `openBlankDocument`, then the dialog with the design it came from
listed first: `EditorViewContext.insertLinkedPartFromDocId`, cleared when the dialog closes), or
from the start screen's **Assembly** card, which opens the same dialog on a design with no Parts (an
"assembly" is an ordinary document; no flag marks it, `FoldnanoDocument.isAssembly` reads it from the Parts). The dialog is mounted once in `Editor.svelte`
and opened through `EditorViewContext.insertLinkedPartDialogOpen`. The copy is
what the assembly draws, exports and saves; the link (`Part.source`, a `PartSource`) says where it
came from and lets the assembly notice and pull in later changes. The assembly model itself
(Parts, occurrences) is in `docs/dna-model.md`.

## What a link holds

`PartSource` (`src/lib/model/Part/Part.svelte.ts`), round-tripped as the Part's `source`:

- `repoPath`: repo-relative path, for a source that is a file in the current GitHub repo. Portable:
  it resolves on any machine that opened that file.
- `docId`: the source's local document id. Only meaningful in this browser.
- `partId`: the Part's id **inside the source** (the copy has fresh ids; see below).
- `contentHash`: sha-256 of the source Part when it was copied (`partContentHash`).
- `blobSha`: the GitHub blob SHA of the source's local copy at link time (recorded; not compared
  yet).
- `linkedAt`: when the copy was taken.

## Sources are the local copies (a decision)

A link only ever resolves against designs in this browser's IndexedDB: the copy the user sees when
they open the source. It never fetches the source from GitHub. A version that differs from the
local, open one would be confusing (the assembly would follow a design the user isn't looking at)
and dangerous (an Update could bring in geometry nobody reviewed). So, on purpose:

- The Insert dialog offers only designs stored here; a repo file never opened in this browser is
  opened from the GitHub explorer first.
- A `notLocal` link (a repo path this browser hasn't opened) is not fetched; opening the file from
  the explorer resolves it.
- After a branch switch, a cached source keeps its local content until it is opened and pulled;
  opening it from the explorer loads that same local copy, so Update and the user see one version.
- Links stay within one repo. `repoPath` is relative to the assembly's repo and records no repo of
  its own; the commit/publish notice (below) flags sources that this browser knows are files in
  another repo.

## Rules

- **Only single-Part, link-free designs can be linked** (`unlinkableReason`,
  `storedUnlinkableReason`). Assemblies stay one level deep, so links can never form a cycle.
- **The copy gets its own ids throughout** (`linkedPartJson` → `remapPartIds` with
  `stableIdsFor(copyPartId)`): derived from the copy's Part id and the source ids, so two copies
  never clash, while an update keeps every surviving id (active region, hidden regions). Linking
  a design that is already linked places the existing copy once more instead (the Insert dialog
  checks `sameLinkTarget`, which matches the same repo path or the same local document, so a
  local link still matches after its source is published).
- **Status and update share one check** (`matchLinkSource`): the source still holds the linked
  Part (`same`), holds a different single Part (`replaced`), or can't be linked any more
  (`unlinkable`). `update` takes a replaced Part only with `{ relink: true }` (the Assembly
  panel's **Relink to its current Part…**, after a confirm) and never an unlinkable source; the
  copy is left as it was whenever it returns `ok: false`.
- **Change detection hashes the source, never the copy.** `canonicalPartJson` is the Part's JSON
  with sorted keys and without `id`, `name` and `source`; both sides are read through
  `Part.fromJSON` first, so load-time normalisation can't make them differ. A Part's own saved
  sticky-end pairs are in that JSON, so pairing in the source makes the copy outdated; their
  `oligoId` anchors are remapped with the rest (`ID_FIELDS`). Pairs that join the copy to another
  Part live in the assembly and may be made on linked Parts (`docs/sticky-ends.md`).
- **Names belong to the assembly.** A copy is named after the source design when linked, and
  neither renaming the source nor updating changes it or makes the link outdated. The status
  carries the source's current name (`PartLinkStatus.sourceName`) so the link icon's tooltip
  shows it.
- **Read-only is enforced in `HistoryStack`, not only in the UI** (`linkedPartGuard.ts`). After a
  `tx`, `snapshotTx` or `partSnapshotTx` runs, `linkedPartEditedBy` looks at the entry: any
  targeted change carrying a linked Part's `partId`, or a snapshot in which a linked Part's
  content changed, is rolled back and thrown as an `InvalidOperationError` (a warning toast). The
  Part's `name` and `source` fields are allowed, as are deleting and duplicating it (a duplicate
  has no `source` and is editable). Only the link commands bypass it, through
  `HistoryStack.withLinkedPartEdits`.
- **UI:** `EditorViewContext.canEditActivePart` is false for a linked active Part; tool panels use
  it instead of `isTabOwner`. `isModeEnabled` keeps Pan and Select only (mode buttons and mode
  hotkeys), and switching to a linked Part from an editing mode drops to Select. Select only
  selects there: the select tool skips the drag handler (`WITH_SELECTION`) and VH-tag reordering.
  The Part can still be viewed, placed, moved in 3D, renamed and exported. A plugin result for it
  shows in the preview with Apply disabled (`PluginDiffPreview`'s `linkedPartName`).
- **Inserting needs tab ownership:** the start screen's Assembly card is disabled in a read-only
  tab, and `InsertLinkedPartDialog` checks `isTabOwner` (and that the same design is still open)
  before the read and again after it, just before the command.

## Commands (`src/lib/commands/partLinks.ts`)

- `insertLinkedPartCmd`: whole-document snapshot (adds a Part).
- `updateLinkedPartCmd`: Part-scoped snapshot replacing the copy with the source's current Part,
  keeping the local id, name and placements.
- `breakPartLinkCmd`: targeted `source` field change; the Part becomes ordinary and editable.

All three undo. Undoing a break makes the Part read-only again.

## Status (`PartLinkService`)

`EditorDocumentSession.partLinks` follows the open document's links. `resolveDocId(source)` prefers
`repoPath`, then `docId`. Repo paths are relative to the open design's own repo when it is a GitHub
file, else to the connected repo (`EditorDocumentSession.#linkRepo`), so opening an assembly from
repo A while connected to repo B still finds A's sources. `statusOf(part)` returns
`upToDate | outdated | replaced | unlinkable | missing | notLocal | checking`, plus the resolved
`sourceDocId`, `localOnly` (no `repoPath`) and, for `unlinkable`, the `reason`. A link with a repo
path whose source can't be read here is `notLocal`, even when it carries another browser's
`docId`. It is computed lazily: reading a status the service has not checked
for the Part's current `contentHash` queues a `refresh()`, which loads each source from IndexedDB
and hashes its Part. Refreshes also run when the document loads, when the window regains focus,
and when another tab saves one of the sources.

**Save broadcast:** `StorageManager.saveDocument` posts `{ docId }` on the `foldnano-doc-saved`
`BroadcastChannel` after every successful non-memory save (`announceDocSaved`). GitHub pull and
open write through the same path, so they announce too.

`update(history, partId)` loads the source again, renews the link (`linkTargetFor`: a source
published to the repo since gains its `repoPath`) and runs `updateLinkedPartCmd`. Just before
replacing it checks again that the design is the same, the link is unchanged since the read
started (`superseded` otherwise, so a slow Update never reverts a newer Relink or Update) and the
caller's `canEdit` (tab ownership) still holds (`readOnly`). After a successful Update the
Assembly panel calls `EditorViewContext.afterPartReplaced`: the replaced Part's selection held
its old objects and is cleared, and a removed active region is repaired, as after undo/redo.

**Design checks:** `checkPartLink` (`model/checks/links.ts`) adds a `link-outdated` or
`link-missing` warning for the active Part; `collectDesignIssues` always runs it.

**GitHub:** `LocalOnlyLinksNotice` in the commit and publish dialogs (and the source-control
panel) lists `PartLinkService.unfollowableLinks()`: links without a `repoPath` (the source is kept
only in this browser) and links whose source document is a file in another repo than the
assembly's (`PartLinkStorage.otherRepoOf`, from the source's GitHub metadata; a path would be read
in the wrong repo). Either way others can't follow the link; the notice offers to embed the
copies (break the links). A source in another repo is flagged whether or not its link has a path,
since `resolveDocId` would match the path against the assembly's repo.

## Sticky ends across links

Matching overhangs between Parts (`docs/sticky-ends.md`) are found from the copies' sequences, so
they work on linked Parts like on any other; nothing about them is stored on the link.

## Not done yet

- The cross-repo check needs the source in this browser: a link made elsewhere to another repo's
  file isn't flagged here (its `docId` has no metadata in this browser).
- `remoteAhead` (comparing `blobSha` with the file on GitHub) is not computed.
- Renaming or moving a source file doesn't update `repoPath`; the link becomes `missing` (or
  falls back to `docId`) and the copy keeps working.
- `githubMetadataStore` doesn't reload metadata another tab wrote, so a file opened in another
  tab after this one loaded resolves only after a reload.

## Boundaries / Don'ts

- Don't edit a linked Part's content outside the link commands; the history guard will refuse it,
  and `withLinkedPartEdits` is for `partLinks.ts` only.
- Don't hash the copy to detect changes: the copy has remapped ids.
- Don't let a linked design link others (nesting) without adding cycle detection first.
- Don't fetch a source from GitHub to resolve or update a link; links follow the local copy (see
  the decision above).
- Don't read the source on every render: go through `statusOf`, which caches per `contentHash`.
