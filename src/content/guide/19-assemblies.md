---
title: Assemblies And Parts
description: Put several Parts in one design, place them in 3D, link Parts from other designs, and export the whole assembly
category: guide
order: 19
slug: assemblies
covers:
  - src/lib/components/Editor/Assembly/**
  - src/lib/model/partLinks.ts
  - src/lib/services/partLinks/**
  - src/lib/components/Editor/ToolPanel/StickyEndsPanel.svelte
  - src/lib/components/Editor/StrandView/StickyEndMarkers.svelte
  - src/lib/components/Editor/View3D/stickyEndOverlay.ts
---

<script>
	import Callout from '$lib/components/docs/Callout.svelte';
</script>

# Assemblies And Parts

A design can hold several **Parts**: structures that are folded separately and come together afterwards, such as a box and its lid, the two arms of a hinge, or tiles that are mixed in one tube. The design also records where each Part sits, so the 3D view and the simulation exports show the whole assembly.

## Recommended Workflow

For anything beyond a quick sketch, keep each Part in a design of its own and build the assembly only from links to them:

1. Make each Part as its own design. Draw, staple and relax it there, where every tool works on it.
2. Start the assembly with **New assembly** at the top of the Assembly panel in one of those designs (or the **Assembly** card on the start screen), and link each Part with **Link Part**.
3. In the assembly, add instances and place them in 3D. Apart from the linked copies, that is all the assembly holds.
4. To change a Part, choose **Open source** in its **⋯** menu, edit and save the source, then choose **Update from source** in the assembly.

![Assembly panel listing a linked Base Part placed once and a linked Arm Part placed twice, its link icon marked as changed, next to the 3D view showing the base with the two arms placed above it in a V](/screenshots/guide/assemblies/01-assembly-3d.webp)

This keeps every Part reusable: the same arm can be linked into several assemblies, and each one picks up a change to it with **Update from source**. The assembly itself only changes when you place something or update a link. Editable Parts made with **New Part in this design** still work, for a quick test or a small piece that only this assembly needs.

## Parts, Regions And Instances

| Level | What it is | Connected to the rest by |
| --- | --- | --- |
| **Region** | A block of helices inside a Part, on its own plane (see [Mental Model](/docs/guide/mental-model#planes-and-design-regions)) | Strands and crossovers: regions of one Part fold together |
| **Part** | One folded structure, usually with its own scaffold | Nothing: Parts are folded separately |
| **Instance** | One placement of a Part in the assembly | The same Part placed twice shows every edit in both places |

<Callout type="tip" title="Which one do you need?">

If strands cross between two pieces, they belong in one Part, as regions. If the pieces fold in separate tubes, make them separate Parts. If the same piece appears several times, add instances of one Part instead of copying it.

</Callout>

A design started from a region card has one Part, placed once. Nothing about Parts shows in the editor until you add a second one or link one.

## The Assembly Panel

Open the **Assembly** panel from the stacked-boxes icon in the left sidebar. It lists every Part with its instances:

- The button at the top suggests the next step. In an assembly file (every Part linked) or an empty design it is **Link Part**; anywhere else it is **New assembly**, which starts a new assembly file (see [Linked Parts](#linked-parts)). The arrow next to it holds the other one and **New Part in this design**.

- The round marker shows the **active** Part, the one the plane and strand views edit. Click a Part to make it active; its regions are listed under it.
- **×N** is how many instances the Part has.
- A Part's **⋯** menu renames it, adds an instance, duplicates it as a new, independent Part, or deletes it.
- Each instance has an eye button to hide or show it, and a **⋯** menu to rename, move, reset or delete it. A Part keeps at least one instance; to remove the last one, delete the Part.
- Double-click a Part or instance name to rename it.
- In a design with only one Part, renaming the design renames that Part (and its instances) too, as long as you haven't given the Part a name of its own.

With more than one Part, or when the active Part is linked, a bar above the strand view shows the design, the active Part and the active region. Click the Part name there to switch Parts, or double-click another Part on a helix in the 3D view.

## Adding A Part

Open the arrow at the top of the Assembly panel, choose **New Part in this design** and pick the kind of its first region (honeycomb, square, freeform or wireframe). The editor switches to the new Part and opens the plane picker, as for a new design. Cancel the picker to drop the new Part again.

**Duplicate as new Part** copies a Part into a new one that you can change on its own. To place the same Part again and keep the copies identical, use **Add instance** instead.

Undo and redo cover the whole design: adding, deleting or renaming a Part and moving an instance are undo steps like any edit.

## Starting An Assembly

To build a design only from Parts you keep in other designs, open one of them and choose **New assembly** at the top of its Assembly panel. This saves it, starts a new document and opens **Link Part from…** (see [Linked Parts](#linked-parts)) with the design you came from listed first. From an empty document, the **Assembly** card on the start screen, below the region cards, opens the same dialog. Neither adds an empty Part first. After the first Part is linked, the Assembly panel opens so you can link more Parts, add instances and place them. While every Part in it is linked, it is marked as an assembly file: a teal **Assembly** badge before the design's name in the toolbar, and a teal status bar that starts with **Assembly file**. Click either to open the Assembly panel. An assembly is still an ordinary design: you can add editable Parts to it with **New Part in this design** (it is then no longer marked as an assembly).

## What An Assembly File Is

An assembly file is a Foldnano design whose Parts are all linked from other designs. It is not a special file type: it is saved, backed up, downloaded and committed exactly like any other design, as the same `.fn.json` format. Nothing in the file says it is an assembly; Foldnano only notices that every Part in it is linked and marks it with the teal badge and status bar so you can tell it apart from the designs its Parts come from.

<Callout type="note" title="Nothing is lost in an assembly file">

An assembly file holds a **complete copy** of every linked Part: its helices, strands, sequences and regions, plus where each instance is placed. It is not a list of references that only works next to its sources. So the file opens, shows in 3D and exports on its own, even on another computer or after a source design was deleted; the link then only reports that it can't check the source any more. **Update from source** replaces a copy only when you choose it, and undo brings the previous copy back.

</Callout>

## Placing Instances In 3D

New instances start at the origin. To place one, choose **Move in 3D** from its **⋯** menu. A move gizmo appears on it, and a bar at the top of the 3D view switches between moving and rotating, puts the instance back at the origin (**Reset**), or finishes (**Done**, or `Esc`). Each drag is one undo step.

In the 3D view:

- The active Part is drawn as usual and can be edited there. Its other instances show the same strands and follow every edit.
- The other Parts are drawn see-through.
- **Fit** and the view cube frame everything shown: the active Part and every visible instance.
- Click an instance in the Assembly panel to edit its Part in that placement: the 3D view's planes, cursor and gizmos then sit on that instance. Its name turns bold.

Hiding an instance with its eye button hides it in 3D and leaves it out of the simulation exports. Hiding the instance you are editing also stops strands from being selected in 3D where it was.

### Relaxing Parts

**Relax** simulates the active Part on its own. Each Part keeps its result when you switch to another Part, so you can relax them one after the other: a Part whose relaxed layout was shown when you left it stays relaxed in 3D, in every instance, and is exported relaxed. Switching back brings the result and its toggles back. A relaxation still running when you switch is stopped. A kept result is dropped from the view once that Part's design changes (by undo, say); switch back to it to see it marked out of date and run it again.

## Linked Parts

A Part can come from another design: a hinge you keep in its own file, for example, used in several assemblies. The assembly holds a **read-only copy** that follows the source design.

To link one, choose **Link Part** at the top of the Assembly panel (in a design without linked Parts it is under the arrow, as **Link Part into this design**) and pick a design saved in this browser. Only designs with exactly one Part and no linked Parts of their own can be linked. A link always follows the source as it is saved in this browser: the same design you see when you open it. Linking a design that is already linked adds another instance of it.

![Link Part from dialog listing the designs Arm and Base, each marked Only in this browser](/screenshots/guide/assemblies/03-insert-part-dialog.webp)

### Working with a linked Part

You can view a linked Part, select strands in it, place and move its instances, rename it and export it. While it is the active Part, only **Pan** and **Select** are available, Select does not move anything, its planes can't be moved in 3D, the bar above the strand view says **Linked, read-only**, and the toolbar hides **Add Region** and **Auto Staple**. Plugins can run on it, but their results can't be applied.

To change it, edit the source: **Open source** in its **⋯** menu opens the source design in a new tab. Save it there, and the assembly notices the change.

![Actions menu of the linked Arm Part: Rename, Add instance, Duplicate as new Part, Update from source, Open source, Break link and Delete Part](/screenshots/guide/assemblies/02-linked-part-menu.webp)

### Keeping it up to date

A linked Part is named after its source design when you link it, and keeps that name: renaming the source doesn't change it or mark the link as changed, and you can rename the copy freely. Hover the link icon to see the source's current name. The icon also shows the link's state:

| Icon | Meaning | What to do |
| --- | --- | --- |
| Link | The copy matches the source | Nothing |
| Link with an amber dot | The source changed since the copy was taken | **Update from source** |
| Link with an amber dot | The source design now holds a different Part | **Relink to its current Part…**, if that Part is the one you want; you are asked to confirm |
| Red link | The source isn't in this browser any more, or can't be linked any more (several Parts, or links of its own) | Nothing, if the copy is what you want; the copy keeps working |

**Update from source** copies the source again, as one undo step; the Part keeps its name and its instances keep their placements. It never swaps in a different Part: if the source design's Part was replaced, only **Relink** takes the new one. A source that is changed or missing also shows as a warning in the design checks (see [Design Checks](/docs/guide/design-checks#linked-parts)).

**Break link** turns the copy into an ordinary Part that you can edit here. It no longer follows the source; undo links it again.

### If You Use GitHub

Linked Parts work the same without GitHub. For assemblies kept in a repository, see [Assemblies with linked Parts](/docs/guide/saving-github#assemblies-with-linked-parts).

## Sticky Ends

Parts often join through **sticky ends**: a single-stranded overhang on one Part whose sequence is complementary to an overhang on another. Foldnano finds these from the sequences, so there is nothing to mark. It works the same in a one-Part design, for overhangs meant to bind within that Part.

Click the **Sticky Ends** button (a magnet) in the strand-view toolbar to open the Sticky Ends panel. It lists every pair of single-stranded stretches that are exact complements over at least the **Shortest match** length (7 nt to start with, never under 5). Each match gets its own color:

- In the **strand view**, the matched bases are shaded in that color. A side whose partner is in another Part carries a small badge with that Part's name, since the strand view shows one Part at a time.
- In the **3D view**, the matched stretches are drawn in that color on every instance, and dashed lines join the two sides. By default every pair of instances that could bind is joined. When a Part is placed more than once, the panel's **One line per instance** switch joins each instance only to the nearest instance of its partner instead, which keeps a large assembly readable. A match within one Part can join two stretches of the same instance, and a self-complementary stretch is only joined to other instances. Pointing at a match in the panel fades the others.
- Pointing at a match in the panel emphasizes it in both views. Clicking it shows that stretch in the strand view, switching to its Part if needed.

![Sticky Ends panel listing matches in their colors, next to the 3D view where the matched stretches are drawn in the same colors and dashed lines join the partners across instances](/screenshots/guide/assemblies/04-sticky-ends.webp)

*Each match has one color in the panel and in both views; dashed lines in 3D join the two sides.*

The **Show in the views** switch (also the **sticky end matches** highlight) turns the colors on or off without closing the panel. Stretches without an assigned sequence never match, and a stretch that is its own complement is listed as **self-complementary**, since it can bind another copy of the same strand.

### Pairing And Ignoring Matches

New matches are listed under **New**. Each row has two buttons:

- **Pair** (chain link) says you meant these two stretches to bind. The match moves to **Paired**, and from then on the design checks warn if an edit breaks it: a changed sequence, a deleted strand, or a strand shortened past the stretch. The row shows how the pair stands: matching, partly matching, no longer matching, a side gone, or no sequence yet.
- **Ignore** (crossed eye) says the match is a coincidence. It moves to **Ignored** and is no longer colored in the views.

**Unpair** and **Stop ignoring** put a match back under **New**. Every one of these is a design edit, so it is saved with the design and **Undo** reverts it.

A pair is kept by its position along each strand, counted from the nearer end, so moving or lengthening a strand at its other end keeps the pair. Pairs within one Part are saved with that Part; pairs between two Parts are saved with the assembly. A linked Part brings its own pairs along, read-only: pair or unpair them in the source design, then update the link. Pairs between a linked Part and another Part can be made in the assembly. A circular strand has no ends, so its matches can't be paired or ignored.

<Callout type="note">

A short match can be a coincidence, so raise **Shortest match** if the list shows pairs you didn't design, or ignore them one by one.

</Callout>

## Exporting An Assembly

| Export | What it covers |
| --- | --- |
| oxDNA, mrDNA | Every visible instance, each at its placement, in one file, while **All visible instances** is checked in the 3D **Export** menu; uncheck it for the active Part only (see [Simulation And Export](/docs/guide/simulation-export#several-parts)) |
| **Export Oligos of all Parts as CSV, with quantities** (**Save** menu) | Every Part's oligos, with a **Part** column and a **Quantity** column: how many instances of that Part the design has, hidden ones included. Also offered for a single Part placed more than once |
| **Export Oligos of this Part as CSV** | The active Part; the file name adds the Part's name |
| cadnano JSON | The active lattice region, as always; the file name adds the Part's name |
| Oligo report, Oligo Diff | One Part at a time, picked on the page, plus an all-Parts CSV with quantities (see [Oligo Report](/docs/guide/oligo-report)) |
| oxDNA replay, GLB | The active Part only |

## Instances With A Missing Part

A file can place a Part it no longer contains, for example after editing it by hand. Such instances are listed under **Instances with a missing Part** in the Assembly panel. Use **Link to…** to place one of the design's Parts there instead, or delete the instance.

## Current Limits

- One Part is edited at a time; the others are shown see-through.
- Each Part is relaxed on its own: the simulation doesn't see other Parts, so it won't keep Parts from overlapping.
- Linked Parts are one level deep: a design that links other Parts, such as an assembly, can't be linked itself.
- Renaming or moving a linked source file breaks the link; the copy keeps working, and **Update from source** is no longer offered.
