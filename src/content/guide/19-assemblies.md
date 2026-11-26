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
---

<script>
	import Callout from '$lib/components/docs/Callout.svelte';
</script>

# Assemblies And Parts

A design can hold several **Parts**: structures that are folded separately and come together afterwards, such as a box and its lid, the two arms of a hinge, or tiles that are mixed in one tube. The design also records where each Part sits, so the 3D view and the simulation exports show the whole assembly.

## Recommended Workflow

For anything beyond a quick sketch, keep each Part in a design of its own and build the assembly only from links to them:

1. Make each Part as its own design. Draw, staple and relax it there, where every tool works on it.
2. Start the assembly from the **Assembly** card on the start screen, and link each Part with **Insert Part from…**.
3. In the assembly, add instances and place them in 3D. Apart from the linked copies, that is all the assembly holds.
4. To change a Part, choose **Open source** in its **⋯** menu, edit and save the source, then choose **Update from source** in the assembly.

![Assembly panel listing a linked Base Part placed once and a linked Arm Part placed twice, its link icon marked as changed, next to the 3D view showing the base with the two arms placed above it in a V](/screenshots/guide/assemblies/01-assembly-3d.webp)

This keeps every Part reusable: the same arm can be linked into several assemblies, and each one picks up a change to it with **Update from source**. The assembly itself only changes when you place something or update a link. Editable Parts made with **New Part** inside the assembly still work, for a quick test or a small piece that only this assembly needs.

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

- The round marker shows the **active** Part, the one the plane and strand views edit. Click a Part to make it active; its regions are listed under it.
- **×N** is how many instances the Part has.
- A Part's **⋯** menu renames it, adds an instance, duplicates it as a new, independent Part, or deletes it.
- Each instance has an eye button to hide or show it, and a **⋯** menu to rename, move, reset or delete it. A Part keeps at least one instance; to remove the last one, delete the Part.
- Double-click a Part or instance name to rename it.

With more than one Part, or when the active Part is linked, a bar above the strand view shows the design, the active Part and the active region. Click the Part name there to switch Parts, or double-click another Part on a helix in the 3D view.

## Adding A Part

Choose **New Part** at the top of the Assembly panel and pick the kind of its first region (honeycomb, square, freeform or wireframe). The editor switches to the new Part and opens the plane picker, as for a new design. Cancel the picker to drop the new Part again.

**Duplicate as new Part** copies a Part into a new one that you can change on its own. To place the same Part again and keep the copies identical, use **Add instance** instead.

Undo and redo cover the whole design: adding, deleting or renaming a Part and moving an instance are undo steps like any edit.

## Starting An Assembly

To build a design only from Parts you keep in other designs, start a new document and choose the **Assembly** card on the start screen, below the region cards. It opens **Insert Part from…** (see [Linked Parts](#linked-parts)) without first adding an empty Part. After the first Part is linked, the Assembly panel opens so you can link more Parts, add instances and place them. An assembly is an ordinary design: you can still add editable Parts to it with **New Part**.

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

To link one, choose **New Part** › **Insert Part from…** and pick a design saved in this browser. Only designs with exactly one Part and no linked Parts of their own can be linked. A link always follows the source as it is saved in this browser: the same design you see when you open it. Linking a design that is already linked adds another instance of it.

![Insert Part from dialog listing the designs Arm and Base, each marked Only in this browser](/screenshots/guide/assemblies/03-insert-part-dialog.webp)

### Working with a linked Part

You can view a linked Part, select strands in it, place and move its instances, rename it and export it. While it is the active Part, only **Pan** and **Select** are available, Select does not move anything, its planes can't be moved in 3D, and the bar above the strand view says **Linked, read-only**. Plugins can run on it, but their results can't be applied.

To change it, edit the source: **Open source** in its **⋯** menu opens the source design in a new tab. Save it there, and the assembly notices the change.

![Actions menu of the linked Arm Part: Rename, Add instance, Duplicate as new Part, Update from source, Open source, Break link and Delete Part](/screenshots/guide/assemblies/02-linked-part-menu.webp)

### Keeping it up to date

The link icon next to the Part's name shows its state:

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
