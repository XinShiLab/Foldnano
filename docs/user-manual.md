---
covers:
  - src/lib/components/Editor/Editor.svelte
  - src/lib/components/Editor/Toolbar/**
  - src/lib/components/Editor/ToolPanel/**
  - src/lib/components/Editor/StrandView/ContextMenu.svelte
---

# Foldnano User Manual

Foldnano is a browser-based DNA nanostructure editor with three coordinated
views:

- the strand viewer for routing
- the plane viewer for lattice or freeform placement
- the 3D view for lab-frame inspection, plane editing, simulation, and export

This manual describes the current UI and shipped behavior.

---

## 1. Interface Overview

The editor has three main working areas:

| Area        | Purpose                                                                |
| ----------- | ---------------------------------------------------------------------- |
| Top toolbar | file actions, part creation, undo/redo, active-viewer tools, help menu |
| Left pane   | plane view or 3D view                                                  |
| Right pane  | strand viewer                                                          |

Important current behavior:

- the left pane has its own `Plane / 3D` toggle in the active-viewer toolbar
- the strand viewer remains the main routing canvas
- the active tool row belongs to the strand viewer

---

## 2. Documents And Parts

### Creating a document

Use the main toolbar to create a new document or load an existing one.

Supported save/load formats:

- Foldnano JSON: `.fn.json`
- cadnano JSON: `.json` or `.cadnano.json`

### Adding a part

Every design has a part at the top — the container that owns the planes and
regions. Starting a design creates that part with a default plane and default
region:

- Honeycomb part
- Square part
- Freeform part

Additional regions are added into the same part from **Add Region**. Every
region-creation path (start screen, **Add Region** button, its dropdown, or the
3D inspector's region buttons) opens the **New Region** tool panel, where you
pick a **Base Plane** — Top (XY), Front (XZ) or Side (YZ) — and confirm with
**Create … Region Here**.

### Loading a cadnano design as a region

**Add Region ▾ → Load Cadnano Design as a Region** imports a cadnano
`.json` / `.cadnano.json` into a **new region of the current part** instead of
a new document. The dialog asks for the same Base Plane choice. The lattice
type is detected from the file (base count divisible by 32 → square, by 21 →
honeycomb).

### Explicit scaffold

Scaffold identity is an explicit oligo flag, not inferred from cadnano's
`scaf` / `stap` arrays. Right-click an oligo in the strand viewer and choose
**Set as Scaffold** (or **Set as Staple** to clear it).

Scaffold-aware features only behave as expected once an oligo is flagged:
the scaffold sequence indicator (§ 5), the **scaffold** highlight, the
Circular Scaffold Map, and scaffold-aware exports.

### Auto Staple

When the active region is a lattice region, the top toolbar shows
**Auto Staple — [region name]**. It generates staple routing for that region
from the existing scaffold routing. It is gated on the region's
`supportsLatticeAutoStaple` capability, so freeform regions don't offer it.

Review the result before assigning sequence, especially at region
boundaries, around skips/inserts, and for very short or very long staples.

### Saving

The editor saves to local browser storage and also runs autosave through the
history system.

Default autosave policy:

- after 10 committed edits
- or after 1 minute
- and whenever you switch away from the tab

If a save fails, a red banner offers **Retry** and **Download .json**. Closing the
tab with unsaved edits or a failed save asks for confirmation first.

Foldnano keeps the last five earlier versions of each design: one about every
10 minutes while you work, and one before anything replaces your copy (GitHub
pull, accept remote, branch switch, resolving a conflict, discarding changes,
restoring a backup). Save menu → **Backups…** lists them, with **Download
.fn.json** and **Restore** for each. Older backups are removed automatically,
so download any version worth keeping. If a saved design
can't be opened, a recovery page offers to download the stored data or restore
one of those versions.

See § 11 for durability levels, GitHub sync, and multi-tab protection.

---

## 3. Left Pane: Plane And 3D Views

The left pane can show either:

- `Plane`
- `3D`

### Plane mode

What you see depends on the part / region type:

- honeycomb or square parts -> lattice plane view
- freeform parts -> freeform plane view

#### Lattice plane view

- click an empty lattice cell in `DRAW` mode to add a VH
- double-click an existing helix to fill its default scaffold-side strand set if empty
- in `SELECT` mode, click a helix circle to select it
- Shift/Cmd/Ctrl-click in `SELECT` mode to add or remove lattice helix selections
- drag on empty background in `SELECT` mode to marquee-select helix circles
- selecting one helix in a constrained-crossover-connected group selects that whole movable group
- drag a selected helix in `SELECT` mode to move the selected group on the lattice
- lattice moves stay snapped to lattice cells, preserve parity, and are rejected if the destination cells are occupied by non-moving helices
- invalid lattice drops leave the model unchanged and keep the current lattice selection
- pan with `PAN` mode
- zoom with the mouse wheel
- use the left-pane reset button to reset the camera

#### Freeform plane view

- double-click empty space in `DRAW` mode to add a perpendicular VH
- drag in empty space in `DRAW` mode to create an in-plane VH
- click a perpendicular VH in `DRAW` mode to fill it
- in `SELECT` mode, click or marquee-select VHs
- drag selected VHs to move them
- drag a rotate handle to rotate one in-plane VH
- click a free 3' end, then a free 5' end to make a connection
- drag a free endpoint in `SELECT` mode to resize that segment

### 3D mode

The 3D view shows the current part in lab coordinates and adds:

- helix cylinders and labels
- strand and crossover geometry
- optional cross-section cursor markers
- optional coordinate axis
- optional persisted plane overlays
- rigid-body simulation preview

The 3D toolbar lets you:

- show or hide geometry helpers
- filter to the current 2D selection
- run simulation
- toggle relaxed positions and stress coloring
- export image, GLB, oxDNA, or mrDNA (with an **Include mirror copies** option for oxDNA / mrDNA)

---

## 4. Strand Viewer

The strand viewer is the main routing canvas.

Recent UI change:

- rows are now grouped by region
- each region has a collapsible header row
- each visible VH has a draggable VH tag at the left edge

### Region controls

- click a region header in `SELECT` mode to make it the active region; double-click it to collapse or expand it
- drag a VH tag in `SELECT` mode to reorder that VH within its region

### Cross-section cursor

Click a VH grid cell to activate that region for the cross-section cursor, then
drag the vertical cursor bar to change the current bp index.

That cursor position also drives:

- lattice helix-circle scaffold indicators
- 3D cursor markers

### Circular Scaffold Map

Strand-view toolbar → View → **Circular Scaffold Map** toggles a QC panel
in the tool panel (not while the 3D view is active). The button is disabled
until an oligo is flagged as scaffold; the panel draws one map per scaffold:

- the scaffold as a circle labeled `name · N nt`, 5′ end as a square and
  3′ end as a triangle; linear scaffolds are an open arc, nicked circular
  scaffolds a circle with a gap
- each staple as inner **arcs** (scaffold stretches it binds) joined by
  **chords** — at staple crossovers, and where a continuous staple segment
  spans a scaffold crossover
- a radial **bar** per dsDNA segment (height = segment length)
- histograms of **segment length** (nt) and **crossover span** (scaffold
  sequence distance between a chord's ends; the shorter way round for
  circular scaffolds)

Controls: zoom in / out / reset (or `Ctrl/Cmd` + wheel), hover to emphasize
a staple, click to select it in the strand viewer, **render as a full
circle** override for linear / nicked scaffolds, per-histogram **bin size**
and **max count shown** (with reset to auto-scale), **Download SVG**, and
**Copy histogram data** (tab-separated).

---

## 5. Editing Tools

The strand-view tool row currently supports:

| Tool           | Shortcut              | Purpose                                                    |
| -------------- | --------------------- | ---------------------------------------------------------- |
| `PAN`          | hold `Option` / `Alt` | pan the active canvas                                      |
| `SELECT`       | `v`                   | select ends, segments, oligos, crossovers, region controls |
| `DRAW`         | `n`                   | create strands and crossovers                              |
| `BREAK`        | `b`                   | split an oligo                                             |
| `SKIP`         | `s`                   | add skips                                                  |
| `INSERT`       | `i`                   | add insertions                                             |
| `PAINT`        | `p`                   | recolor oligos                                             |
| `MODIFICATION` | `m`                   | apply or clear terminal modifications                      |
| `SEQUENCE`     | `a`                   | assign or clear sequences                                  |

### Draw

In the strand viewer:

- drag across empty space on a strand row to create a segment
- drag from an existing free end to extend it
- drag between compatible endpoints or crossover sites to create a crossover

### Break

Click a strand position to split the underlying segment.

### Skip / Insert

Click a segment position to add or remove skips / insertions.

### Paint

Click an oligo to apply the current paint color.

### Modification

Apply the currently selected terminal modification:

- to clicked free ends
- or to all selected free ends

### Sequence

Apply random, preset, custom, or clearing sequence actions to clicked strands.

**Fill mode** (radio group at the top of the panel):

| Option                     | Behaviour                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Update the entire sequence | Overwrites all bases on the clicked oligo/segment, including already-filled ones                                    |
| Fill only the empty parts  | Skips positions that already have a non-N base; the input sequence is compacted into the empty slots in 5′→3′ order |

---

### Scaffold sequence indicator

The **S** badge in the strand-view toolbar (and the ✓ / ✗ **Scaffold
Sequence** line in the Sequence panel) reports whether every scaffold-flagged
oligo has an applied sequence that still matches the current topology:

- green / ✓ — scaffold sequence is applied and current
- red / ✗ — no scaffold sequence yet, or a topology edit (moved end,
  skip/insert, break, reconnection) has shifted the nucleotide path since it
  was applied; re-apply the scaffold sequence before exporting

Clicking the badge toggles the **scaffold** highlight.

---

## 6. Selection

The strand viewer uses end-based selection.

Common actions:

- click an end -> select that end
- click a segment -> select both ends
- click an oligo -> select all ends in that oligo
- drag on empty background -> marquee selection
- Shift/Cmd/Ctrl-click -> additive or toggle selection
- `Delete` / `Backspace` -> remove selected routing
- `Escape` -> clear selection

### Selection filters

The select tool panel and toolbar filters control whether selection expands to:

- scaffold
- staple
- ends
- crossovers
- segments

Region headers, VH tags, VH grid cells, and the cross-section cursor are always
interactive in select mode even if strand filters are narrow.

Clicking an oligo or segment shows its oligo's details in the panel, including an
editable **Name** field (gray background). Names are optional labels for your own use
and for the CSV `Name` column; they don't have to be unique and most oligos have none.
Mirror oligos show their source's name read-only.

### Moving selected ends

Drag a selection left or right to move the selected ends together by a single
uniform shift, preserving their relative spacing. If the exact drop position is
blocked, the batch snaps to the nearest valid shift; if no valid shift exists for
the whole selection, the drag makes no change.

Constrained crossover ends move as part of the batch: each one snaps to a valid
crossover site on the same partner VH, and its partner end propagates with it (so
the crossover stays intact) even when the partner is not itself selected.

**Dragging one end** (expanding or shrinking a strand) and **dragging both ends
together** (sliding the whole strand) treat assigned sequence differently:

- **One end** — positions that fall outside the new range are dropped; newly
  added positions are automatically filled in from the complementary strand's
  existing sequence, wherever it has one. This is safe to do silently: those
  positions were previously blank, so there's nothing being overwritten.
- **Both ends together** — the strand keeps its own sequence exactly as it
  was, and the complementary strand is left untouched too. Because the
  complementary partner doesn't necessarily move along with the drag, this can
  leave the carried sequence no longer matching its partner at some positions.
  The tool does not guess which side to fix — that would mean silently
  discarding one of two sequences someone deliberately assigned — so instead
  it marks the mismatch and leaves the decision (which strand to edit) to you.
  See § 7 Highlighting And Hiding for how to see exactly where.

### Aligning ends

The strand-view toolbar's **Edit** group has **Align free ends left**,
**Justify selected segment ends**, and **Align free ends right**:

- **left / right** — move the selected ends to the leftmost / rightmost of
  them
- **justify** — move selected left ends to the leftmost and selected right
  ends to the rightmost of them

Rules (`endAlignmentOps.ts`):

- **Select** tool only, owner tab only
- only **free** ends move; ends joined to a crossover or connection never do
- one end of a segment selected → that end moves; both selected → align
  left/right moves the segment's left/right end (stretch or shrink, not
  slide), justify moves both
- left / right need at least two movable ends; justify needs at least two
  segments with at least one selected left and one selected right end
- all or nothing: disabled if any end would overlap another strand
  (including another moving one), reverse its segment's 5′→3′ direction, or
  leave the helix
- one undo step (a single batched `moveOligoEndCmd`); sequence follows the
  one-end rules above

Example: staple ends at bases 40, 42 and 45 on neighbouring helices → select
the three ends → **Align free ends left** → all at 40.

### Duplicating oligos

Select whole oligos (every strand of each) and press `Ctrl/Cmd + D`, or click
**Duplicate** in the Edit toolbar group. A translucent copy appears at the first free
position to the right, on the same helices:

- Move the pointer onto the copy to grab it; it then follows the pointer until you
  move off its helices. It snaps by the region's helical repeat (21 bp
  for honeycomb and freeform, 32 bp for square) so crossovers stay on valid sites and
  the copy keeps its twist. Hold `Shift` for a free 1-bp shift.
- `←` / `→` jump to the previous / next valid position.
- The copy turns red, with the reason shown, where it would overlap another strand,
  put a crossover on an invalid site, or leave a skip/insertion without a matching
  complementary strand.
- Click or press `Enter` to place it; `Escape` cancels.

Copies are independent oligos with the same color, sequence, skips/insertions and
modifications. If a copy runs past the end of the region, the region is extended. The
new copies stay selected, so pressing `Ctrl/Cmd + D` again places the next repeat.

### Mirror copies (repeat groups)

For structures that repeat, such as tile tubes or origami that assembles with
identical copies of itself, use **linked** copies instead: press
`Ctrl/Cmd + Shift + D`, or click **Duplicate as linked mirror copies**, and place
the copy the same way. The copies become **mirrors** of the selected oligos (the
**originals**), grouped into a repeat group:

- Mirrors always equal their original shifted by the copy's offset. Edit the
  original (move ends, break, add crossovers, skips, sequence) and every mirror
  follows, in the same undo step.
- If an edit would make a mirror overlap something, or put its crossover or skip
  somewhere invalid, the edit is refused with a message naming the copy.
- Mirrors can't be edited directly. Clicking one selects its original. A sequence
  written onto a mirror from its partner strand is reverted, and the original's
  sequence never changes because of a mirror; conflicts show as sequence
  mismatches.
- Mirrors are drawn faded in the strand view (and in its SVG export) and
  translucent in 3D. Staple lists, the
  sequence CSV, the oligo report and cadnano export include only real oligos. The
  3D Export menu has an **Include mirror copies** option for oxDNA / mrDNA, to
  simulate the assembled structure.

To add another copy, select all of a group's originals and press
`Ctrl/Cmd + Shift + D` again, or use **Add copy** in the group's panel. The
**Repeat groups** panel (Select tool panel) lists each group's copies, with
**Select originals**, per-copy remove, **Detach** (keep the copies as normal
oligos) and **Delete** (remove the copies).

### Freeform selection

Freeform plane view uses a separate VH-based selection:

- click or marquee-select VHs
- drag to move selected VHs
- `Delete` / `Backspace` removes selected freeform VHs

### Lattice helix selection

Lattice plane view now uses its own VH-based selection separate from strand-end
selection and separate from freeform VH selection.

- click -> select one constrained-move group
- Shift/Cmd/Ctrl-click -> toggle one constrained-move group
- marquee -> select all intersected helix circles, then expand to the full constrained groups
- drag a selected helix -> move the whole selected set together if the target cells are valid
- `Delete` / `Backspace`, or the Delete toolbar button, removes the selected helices (only **empty** VHs are removed; helices that still carry strands are skipped to prevent data loss)
- undo / redo restores lattice helix positions after a move or a delete

---

## 7. Highlighting And Hiding

The strand viewer toolbar includes highlight and hide menus.

Highlights dim non-matching oligos while keeping matching ones emphasized.
Current highlight types:

- scaffold
- circular strand
- with modifications
- longer than 90
- shorter than 15

Current hide toggles:

- crossovers
- connections
- sequence

The 3D view uses the same highlight context for strand dimming.

The same menu has a separate **Warnings** group, below Highlight, for defects
rather than categories:

- **sequence mismatch** (on by default) — draws a short red line connecting
  the two strands at any base pair where both sides have an assigned sequence
  letter but they aren't complementary. This is the most common way a mismatch
  appears: dragging a strand's body carries its sequence along, and the
  complementary strand doesn't always move with it (see § 6 Moving selected
  ends). Turning this off hides the markers but does not fix anything —
  mismatched bases still need to be corrected by hand.

---

## 8. Simulation

The 3D view includes rigid-body simulation controls.

Typical flow:

1. switch the left pane to `3D`
2. click `Relax` (RBS group)
3. optionally switch to relaxed positions
4. optionally enable stress coloring

If the topology changes afterward, the relaxed state becomes stale and the
toolbar will prompt for re-simulation.

---

## 9. Plane Editing

Plane editing is available from the 3D view.

Typical flow:

1. switch the left pane to `3D`
2. enable plane visibility
3. click a visible plane to select it
4. choose translate or rotate mode
5. drag the gizmo

Plane edits update the model live and become one undoable history entry when the
drag ends.

---

## 10. Exporting

Current export paths include:

| Export                 | Format          | Entry point                             |
| ---------------------- | --------------- | --------------------------------------- |
| Foldnano design        | `.fn.json`      | save/export controls                    |
| cadnano design         | `.cadnano.json` | lattice-compatible save/export controls |
| sequence CSV (part)    | `.csv`          | save menu, or the oligo report page     |
| strand view export     | `.svg` / `.png` | strand-view toolbar                     |
| circular scaffold map  | `.svg`          | Circular Scaffold Map panel             |
| plane / lattice export | `.png`          | plane-view toolbar                      |
| 3D snapshot            | `.png`          | 3D toolbar                              |
| GLB                    | `.glb`          | 3D toolbar                              |
| oxDNA                  | `.top` + `.dat` | 3D toolbar                              |
| mrDNA                  | mrDNA input     | 3D toolbar                              |

Notes:

- cadnano export is only valid for cadnano-compatible lattice parts
- freeform edits are preserved by Foldnano JSON, not cadnano JSON
- sequence CSV starts with a `Name` column (the optional oligo name; empty when
  unset, not unique)
- sequence CSV export requires explicit 5' and 3' ends; designs with circular
  scaffold or staple oligos must be linearized before export
- oxDNA export can use relaxed positions when enabled
- when the design has no assigned sequence, oxDNA export asks which base to
  put on single-stranded positions (default `T`); paired positions get random
  complementary bases
- mrDNA export writes a single `.txt` with one nucleotide per line
  (position in nm, base-pair partner, 3′ stacking partner, 3′ neighbour, and
  optionally base letter and orientation) for
  [mrDNA](https://github.com/cmaffeo2/mrdna) multi-resolution simulation
- the 3D **Export** menu's **Include mirror copies** adds linked mirror copies
  to oxDNA / mrDNA output; they're excluded otherwise

### NT model, skips and inserts

oxDNA and mrDNA both export from the same format-agnostic nucleotide (NT)
model built from the current design. Skips and inserts are resolved there,
before any file is written:

- a **skip** removes that base position from the emitted nucleotide path
- an **insert** adds extra nucleotides between neighbouring slots
- sequence follows each oligo's current 5′ → 3′ order

Because skips and inserts change the emitted path, they also shift where
assigned bases land. Check the scaffold sequence indicator before exporting.

---

## 11. Saving, GitHub And Multi-Tab Protection

### Durability levels

| Level         | Where it lives    | Created by                                 |
| ------------- | ----------------- | ------------------------------------------ |
| Working copy  | browser IndexedDB | autosave + **Save**                        |
| File backup   | your disk         | Save menu → **Export as Foldnano JSON**    |
| GitHub commit | the repository    | stage + commit in the Source Control panel |

Clearing browser data deletes the working copy. Autosave never downloads a
file or commits to GitHub. The **Saved Documents** page (`/toc`, Save menu →
**View Saved Documents**) lists every local document with Open / View Oligos
/ Delete. It sorts by last modified (newest first) or by name, filters to
All / Local / GitHub-synced documents, and switches between cards and a
compact table; the choice is kept in the page URL.

### Connecting GitHub

All GitHub API calls go through Foldnano's `/api/github/*` routes; the OAuth
token is an httpOnly cookie that client code never reads.

1. **Connect to GitHub** (top toolbar **GitHub** button or the Source Control
   panel in the left icon rail).
2. **Setup Repository**: search for a repository, pick a branch, **Connect**.
   Use **Install or configure app access →** if a private repository is
   missing.
3. Panel header: **Pull latest from GitHub**, **Refresh file tree**,
   **Disconnect repository**.

### Files tab

- click a file to open it; opening a cadnano `.json` creates a sibling
  `.fn.json` for the edits and leaves the original unchanged
- **New design file** → folder + file name → **Create & Open** (local-only
  until committed)
- right-click a file: Open / Rename / Copy path / Download / Delete; a folder:
  New design here / New folder / Delete folder; empty space: New design / New
  folder
- **Delete** stages the file for deletion; it's removed from GitHub on the
  next commit (files with uncommitted edits offer to commit first)
- banners: _GitHub has newer changes_ → **Pull**; _Diverged_ → **Review
  changes**, **Commit local**, **Discard & pull**

Save menu → **Save to GitHub Repo** publishes a design that isn't on GitHub
yet (folder, file name, commit message → **Publish**); for a GitHub file it
opens the Changes tab. Renaming a committed file via the document name asks
to **Rename & Commit**.

### Changes tab

- **Changes** / **Staged** lists with per-file **+** / **−** and **Stage all**
  / **Unstage all**
- click a file for its diff; right-click for **Discard changes** or **Undo
  staged deletion**
- commit message → **Commit**; the commit is written straight to the branch
  on GitHub (there is no separate push)
- committing directly to `main` / `master` shows a warning with **New
  branch**

### Graph tab

Commit graph with uncommitted local changes on top; click a branch label to
switch branch, **+** to create one, **Load more**, **Refresh**.

### Conflicts and backups

If the remote file changed since the last sync, commit stops with **Conflict
detected**: **View diff**, **Pull latest first**, **Force overwrite**, or
**Create new branch**. The diff dialog offers **Keep local**, **Accept
remote**, or **Edit & resolve** → **Apply resolved JSON**.

Actions that overwrite the local copy first keep it as a backup. The status
bar's **Backups** button (also Save menu → **Backups…**) opens the design's
backups → **Restore this backup**. The status bar also shows branch, _unsaved
to GitHub_ / _↓ remote ahead_, path, and short commit SHA.

The GitHub sign-in is renewed in the background when possible. If it can't be,
a banner says the session has expired; **Sign in again** returns to the same
design with uncommitted changes still pending.

### Multi-tab protection

Only the owning tab writes a document's working copy (`TabSync`). A second
tab on the same document shows _This file is open in another tab. Editing is
disabled._, is forced into **Pan**, ignores editing shortcuts, and offers
**Take back control**. When the owning tab closes, a waiting tab takes over
automatically and reloads the latest saved copy first.

---

## 12. Plugins

Plugins are Python tools run in a sandboxed Pyodide worker in the browser.
Open the **Plugins** panel from the left icon rail.

### Hub and My Plugins

- **Hub** tab: curated plugins → **Install** → review → **Confirm**
- **My Plugins** tab: installed plugins with format / apply-strategy /
  environment badges and **Activate**, **Run**, **Stop**, **Reset**,
  **Remove**, **Open Panel** (for plugins with a side panel)
- **Import zip** installs a local `.zip` (it can also be dropped on the start
  screen or the Open dialog); a bare `.fplugin.json` manifest is refused.
  During the beta there are no installs from other websites.
- built-in plugins (Script Lab) carry a **Core** badge and an on/off switch
  and can't be removed
- only one **custom env** plugin can be active at a time; activating another
  asks for confirmation and discards its unapplied result

### Running and applying

- a `cadnano_json` plugin runs on the active region (shown as **on R1**, or
  _no active region_)
- plugins with parameters open a run dialog first
- output tabs: **Console**, **Result**, **Artifacts** (downloadable files),
  **Apply** (mutating plugins only)
- applying records one undoable history entry
- a result is marked **stale** if the design changes after the run; discard
  and re-run

Formats: `cadnano_json` (lossy for Foldnano metadata), `foldnano_json`,
`foldnano_mini` (mutation log replayed by the app). Only install plugins from
sources you trust.

### Script Lab

Built-in code-editor plugin (off by default; enable its switch in My Plugins,
then open it from the icon rail). **Run** executes the editor contents in a
fresh Python namespace against a fresh design snapshot; **Stop**; **Clear**
(editor back to a bare `run(ctx)` skeleton); **Reset** (clear output and any
unapplied result, as in the Plugins panel); the **⋯** menu holds font size,
**Restore default script** and **Download**. The **Help** (book icon) menu loads the Mutation /
Analysis / Full API Demo starters. A run is applicable only if it calls
`ctx.set_result_mutation_log(...)` with a non-empty log. The script is kept
in IndexedDB across reloads.

---

## 13. Keyboard Shortcuts

Current editor shortcuts:

| Key                    | Action                                                        |
| ---------------------- | ------------------------------------------------------------- |
| `v`                    | select tool                                                   |
| `n`                    | draw tool                                                     |
| `b`                    | break tool                                                    |
| `s`                    | skip tool                                                     |
| `i`                    | insert tool                                                   |
| `p`                    | paint tool                                                    |
| `m`                    | modification tool                                             |
| `a`                    | sequence tool                                                 |
| `r`                    | split region tool                                             |
| hold `Option` / `Alt`  | temporary pan                                                 |
| `Delete` / `Backspace` | delete current selection                                      |
| `Ctrl/Cmd + D`         | duplicate selected oligos (then move, click/`Enter` to place) |
| `Ctrl/Cmd + Shift + D` | place linked mirror copies of the selected oligos             |
| `Escape`               | clear selection / cancel                                      |
| `Ctrl/Cmd + Z`         | undo                                                          |
| `Ctrl/Cmd + Shift + Z` | redo                                                          |
| `?`                    | toggle workspace help                                         |
| `c` / `t`              | toggle scaffold / staple filter (strand pane)                 |
| `e` / `x` / `d` / `o`  | toggle end / crossover / segment / oligo filter (strand pane) |

### Workspace help

`?` opens the workspace help: shortcut badges on controls, a caption on each visible pane
and panel, and a short explanation when you hover any control, plus the shortcut reference
card. Captions follow what is on screen (start screen, New Region panel, the active tool
panel). The editor stays usable while it is open; `?` or `Escape` closes it. It opens by
itself once on a first visit.

---

## 14. Current Limits

The current implementation still has a few intentional boundaries:

- the freeform 2D viewer offers only lightweight endpoint-level strand editing;
  full strand routing for freeform regions is done in the strand viewer, the same
  as for lattice regions
- freeform rotate handles act on one in-plane VH at a time (no group rotation in
  the 2D viewer)
- the freeform 2D viewer is region-scoped and does not expose a richer multi-plane
  2D UI; reposition/reorient a region's plane in lab space from the 3D plane gizmo
- cadnano JSON is a compatibility path: it captures lattice topology but not
  freeform geometry, explicit scaffold labels, or other Foldnano metadata

These are current product boundaries, not documentation omissions.
