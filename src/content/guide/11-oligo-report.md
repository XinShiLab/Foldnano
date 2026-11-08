---
title: Oligo Report And Diff
description: Review every oligo of a design in a sortable table, download the CSV, and compare two saved designs
category: guide
order: 11
slug: oligo-report
covers:
  - src/lib/components/Oligos/**
  - src/routes/oligos/**
  - src/lib/model/io/oligoReport.ts
---

<script>
	import Callout from '$lib/components/docs/Callout.svelte';
</script>

# Oligo Report And Diff

The **oligo report** is a full-page table of every oligo in a design: its name, where it starts and ends, its sequence, length, color, and end modifications. It's the place to review staples before ordering them, and the **Oligo Diff** page compares the reports of two saved designs.

## Opening The Report

- From the editor: Save menu (the **⌄** next to **Save**) → **View Oligos**. The current design is saved to browser storage first, then its report opens.
- From the **Oligos** page (`/oligos`), which lists every document saved in this browser: click **View Oligos** on a document. **Open** goes back to the editor instead.
- From **Saved Documents** (`/toc`): **View Oligos** on a document card.

<Callout type="note">

The report covers the **first part** of a document, and only **real oligos**: [mirror copies](/docs/guide/duplicates-repeat-groups) are left out, as they are in every export.

</Callout>

## The Report Page

The header shows the document name and ID, with three buttons:

| Button | Action |
| --- | --- |
| **All Oligos** | Back to the Oligos list |
| **Open Editor** | Open this design in the editor |
| **Download CSV** | Download the same CSV as the editor's **Export Oligos of this Part as CSV** |

The table has one row per oligo, with the text tinted in the oligo's own color. Click any column header to sort by it; click again to reverse.

| Column | Contents |
| --- | --- |
| **OligoKey** | A short ID derived from the oligo's positions (`oligo-…`). The same routing gives the same key in any document. Not the same as the oligo's ID, see [OligoKey And Oligo ID](#oligokey-and-oligo-id). |
| **Name** | The oligo's optional name, empty if it has none (see below) |
| **Start** / **End** | 5′ and 3′ end, written `helix[base]`, for example `12[48]`. Circular oligos show `Circular`. |
| **Sequence** | Assigned sequence, 5′ → 3′ (empty for circular oligos) |
| **Length** | Length in nucleotides |
| **Color** | The oligo's color swatch and hex value |
| **Mod5Prime** / **Mod3Prime** | Terminal modification names, if any |
| **Positions** | Every segment as `5′ end>3′ end`, in routing order |

<Callout type="note">

**Oligo names are optional labels.** Set them in the editor's [Select tool panel](/docs/guide/selection#naming-an-oligo) or from a plugin. They're there for your convenience and for the ordering sheet; Foldnano never uses them to identify an oligo. They don't have to be unique, and most oligos have none. The CSV's first column is `Name`, left empty for unnamed oligos. To tell oligos apart, see [OligoKey And Oligo ID](#oligokey-and-oligo-id).

</Callout>

Circular oligos are listed but the page warns that they're **rejected by CSV export**. Linearize them in the editor first (the **circular strand** highlight finds them, see [Selection](/docs/guide/selection#highlighting-and-hiding)).

![Oligo report page: the document name and ID with the All Oligos, Open Editor and Download CSV buttons, above a table of oligos with OligoKey, Start, End, Sequence, Length, Color, Mod5Prime, Mod3Prime and Positions columns](/screenshots/guide/oligo-report/01-report-page.webp)

*The oligo report, sorted by OligoKey. Each row is tinted in its oligo's color.*

## OligoKey And Oligo ID

Every oligo has two identifiers. They answer different questions: the **oligo ID** says *which oligo this is*, the **OligoKey** says *where it runs*.

| | Oligo ID | OligoKey |
| --- | --- | --- |
| **What it is** | A random ID the oligo gets when it's created, for example `3f9c2a1e-…`. Oligos made by a plugin start with `py-oligo-`. | A short code computed from the oligo's positions, `oligo-` plus 8 characters |
| **Saved in the file** | Yes, in `.fn.json`. Importing a cadnano `.json` gives every oligo a new ID, because cadnano files don't store one. | No. It's worked out from the positions whenever it's needed. |
| **After you move an end** | Stays the same. So do recoloring, renaming and adding modifications. | Changes. Any change to where the oligo runs gives a new key. |
| **Same design in two files** | Different IDs, unless one file is a copy of the other | The same key for the same routing, as long as the helices are numbered the same |
| **Where you see it** | The editor's status bar, when you hover an oligo (*Oligo 3f9c2a*, the first characters, without the `py-oligo-` part). Plugins read it as `oligo.id`. | The **OligoKey** column of this report |

So the two never match: the status bar's *Oligo 3f9c2a* won't appear in this table. Use the **Start** / **End** columns to find a hovered oligo here.

Use the OligoKey to compare designs: the [Oligo Diff](#comparing-two-designs) pairs up oligos by the same positions the key is made from, so a staple re-routed by even one base shows up as a different oligo. Use the oligo ID (in plugins) for an oligo you're editing, since it survives the edit. Neither is the oligo's **name**, which is an optional label you set yourself.

### How The OligoKey Is Computed

The key is made in two steps.

1. **Write out the positions.** Each segment of the oligo is written as its 5′ end and its 3′ end, `helix[base]>helix[base]`, using the helix numbers you see in the editor. The segments are joined with `|`, in routing order: starting at the oligo's 5′ end and following each crossover to the next segment. A circular oligo has no 5′ end, so it starts at its segment on the lowest-numbered helix (lowest base if there's a tie). This text is the **Positions** column, with `, ` in place of `|`.
2. **Shorten it.** That text is run through a standard 32-bit hash (FNV-1a), and the result is written as 8 hexadecimal characters after `oligo-`.

For example, a staple that runs from base 48 down to base 27 on helix 12, then crosses over and runs from base 27 up to base 48 on helix 13, is written `12[48]>12[27]|13[27]>13[48]`, and its key is `oligo-9e1b89a7`.

What follows from this:

- **Only the routing counts.** The sequence, color, name and modifications are not part of the key, so changing them keeps it.
- **Moving any end, adding or removing a crossover, or splitting or joining the oligo** changes the text, and so the key.
- **Renumbering helices changes keys** even if nothing moved, because the helix numbers are part of the text. Two designs only get the same keys if their helices are numbered the same way.
- **Two different oligos could, very rarely, share a key**, since a long text is squeezed into 8 characters. The Oligo Diff compares the full positions, not the key, so it isn't affected.

## Comparing Two Designs

The **Oligos** page has a **Compare saved documents** section:

1. Pick a **Left** and a **Right** document (they must differ).
2. Click **Compare**. The **Oligo Diff** page opens (`/oligos/diff`).

The diff matches oligos by their **positions** (the same segments on the same helices), then compares the remaining columns. The summary shows how many oligos are:

| Status | Meaning |
| --- | --- |
| **Unchanged** | Same positions and identical values |
| **Changed** | Same positions, but a different name, sequence, color, or modification |
| **Only in left** | Present only in the left design (for example removed or re-routed) |
| **Only in right** | Present only in the right design (for example added or re-routed) |

Below the summary, a table lists every oligo that isn't unchanged, with its **Status**, the **Changed fields**, and the **Left values** / **Right values** side by side. If everything matches it says *No oligo report differences*.

Each side also has a **Download CSV** button for that document's report, and you can change either document and click **Compare** again at the top of the page.

<Callout type="tip">

When you keep two versions of a design in this browser (for example before and after re-running Auto Staple or a plugin), compare them to see exactly which staples changed before you re-order anything.

</Callout>
