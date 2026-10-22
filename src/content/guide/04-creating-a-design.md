---
title: Creating A Design
description: New documents, regions, lattice/freeform virtual helices, routing, auto-staple, and scaffold setup
category: guide
order: 4
slug: creating-a-design
---

<script>
	import Callout from '$lib/components/docs/Callout.svelte';
</script>

# Creating A Design

This page is the end-to-end workflow, from an empty document to a routed, scaffolded structure. It ties together the tools covered in detail on [Editing Tools](/docs/guide/editing-tools), [Views And Regions](/docs/guide/views), and [Selection](/docs/guide/selection).

## Start From A New Document

Click **New Document** in the top toolbar. A design starts empty; you then add a region and place virtual helices into it.

Every design has a **part** at the top, the container that owns your planes and regions. Starting a design (as honeycomb, square, or freeform) creates that part together with a default **plane** and a default **design region**, and you can **Add Region** for more later. See [Mental Model](/docs/guide/mental-model) for what those terms mean.

![Empty-document state right after New Document, with the Add Region button highlighted](/screenshots/guide/creating-a-design/01-empty-document.webp)

*Empty-document state right after New Document, with the Add Region button highlighted.*

## Add A Region

Use **Add Region** in the top toolbar. The dropdown offers **Add Honeycomb Region**, **Add Square Region**, **Add Freeform Region**, and **Load Cadnano Design as a Region** (which imports an existing cadnano file into a new region).

| Choice | Use when |
| --- | --- |
| Honeycomb lattice | You want cadnano-compatible honeycomb spacing and parity rules. |
| Square lattice | You want cadnano-compatible square spacing and parity rules. |
| Freeform | You want explicit helix positions, arbitrary angles, or non-lattice geometry. |

Each region carries its own plane. The **active region** controls which region receives new virtual helices and which region-specific tools (lattice grid, constrained crossover sites, lattice auto-staple) are available. You can have several regions in one design and connect DNA across them.

![Add Region dropdown open, showing all four items](/screenshots/guide/creating-a-design/02-add-region-dropdown.webp)

*Add Region dropdown open, showing all four items.*

## Add Virtual Helices

Switch the left pane to **Plane** and select the **Draw** tool (`n`).

**In a lattice region:** click empty lattice cells to add a virtual helix at each. Placement is snapped to lattice cells, parity rules are enforced, and dropping onto an occupied cell is rejected (the model is left unchanged).

**In a freeform region:**

- **double-click** empty space to add a *perpendicular* helix (pointing out of the plane), or
- **drag** in empty space to create an *in-plane* helix along the drag direction.

Freeform movement and rotation update each helix's local frame, and those frames are preserved in `.fn.json`.

See [Views And Regions](/docs/guide/views) for the full plane-view interaction list.

## Route DNA

Routing happens in the **strand viewer** (right pane). Each tool is covered in depth on [Editing Tools](/docs/guide/editing-tools); the short version:

- **Draw** (`n`): drag to create segments; drag between compatible ends or crossover sites to create crossovers.
- **Break** (`b`): click a position to insert a nick.
- **Select** (`v`): move ends, delete selections, collapse/expand regions, reorder visible VH rows.
- **Skip** (`s`) / **Insert** (`i`): edit per-base slot structure (deletions / insertions).
- **Paint** (`p`), **Modification** (`m`), **Sequence** (`a`): annotate existing oligos.

Crossovers are **directional**: connect the upstream **3′ end** to the downstream **5′ end**.

<Callout type="tip" title="An order that avoids rework">

1. Route the **scaffold** path first.
2. Mark it as the scaffold (explicit label, see below).
3. Add or auto-generate staples.
4. Add skips/inserts for length tuning.
5. Assign sequence last.

</Callout>

> Routing is easiest to learn hands-on: try it in the interactive walkthrough on [Editing Tools](/docs/guide/editing-tools).

## Auto-Staple

Run **Auto Staple** (top toolbar; labeled `Auto Staple — [region name]`) once you have scaffold routing and want Foldnano to generate staple routing for the active lattice region.

Auto-staple is available only on lattice regions (it's gated on the region's `supportsLatticeAutoStaple` capability).

<Callout type="warning">

**Always review the generated topology** before assigning sequence, paying special attention to region boundaries (staples that approach where one region meets another), skips and inserts (these change effective length), and very short or very long resulting staples.

</Callout>

![Honeycomb region with only the scaffold routed, before running Auto Staple](/screenshots/guide/creating-a-design/03-before-auto-staple.webp)

*Before: only the scaffold is routed.*

![The same honeycomb region after running Auto Staple, with staples now filled in](/screenshots/guide/creating-a-design/04-after-auto-staple.webp)

*After: staples generated by Auto Staple.*

## Foldnano Versus Classic Cadnano

Foldnano is more flexible than classic cadnano, and a few defaults differ.

| Topic | Classic cadnano expectation | Foldnano behavior |
| --- | --- | --- |
| Scaffold identity | Often implied by file slot and helix parity | Explicit oligo flag you set yourself |
| Strand-set pairing | Scaffold/staple distinction tied to lattice convention | Ends can connect whenever topology allows |
| Default scaffold fill | Often creates a circular scaffold by default | Double-clicking a helix circle fills the default strand set **without** creating a circular scaffold by default |
| Non-lattice geometry | Not represented | Preserved in `.fn.json` |

For compatibility import/export, cadnano `scaf` and `stap` arrays are treated as **file-format directional conventions only**; they are not the same as Foldnano's explicit scaffold label. See [Mental Model](/docs/guide/mental-model#explicit-scaffold).

## When To Assign Scaffold Sequence

Topology edits (moving ends, adding skips/inserts, breaking strands, reconnecting segments) can make an already-assigned scaffold sequence locally **stale**, because the nucleotide path no longer matches the bases you assigned.

<Callout type="tip">

Finish the main topology first, then assign or refill the scaffold sequence. The **scaffold sequence indicator** tracks this for you: if it shows red, the assigned sequence may no longer match the topology, so refill before treating the sequence as final or exporting. See [Editing Tools](/docs/guide/editing-tools#scaffold-sequence-indicator).

</Callout>

![Scaffold Sequence indicator in its red/stale state, with a callout explaining that a red X means the sequence no longer matches the design's topology and should be refilled](/screenshots/guide/creating-a-design/05-stale-scaffold-indicator.webp)

*Scaffold Sequence indicator in its red/stale state, with a callout explaining that a red X means the sequence no longer matches the design's topology and should be refilled.*
