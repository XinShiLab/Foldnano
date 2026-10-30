---
title: Design Checks Reference
description: Every check Foldnano runs on import, while editing, and before simulation or cadnano export, and what to do about each
category: guide
order: 17
slug: design-checks
covers:
  - src/lib/model/checks/**
  - src/lib/model/io/cadnanoLattice.ts
---

# Design Checks Reference

Foldnano checks designs at a few points: when it opens a file, while you edit (the **Design checks** button in the strand view, see [Creating A Design](/docs/guide/creating-a-design#design-checks-while-you-edit)), and before a simulation or cadnano export. This page lists every check in one place.

Each problem has a level:

| Level | Meaning |
| --- | --- |
| **Error** (red) | That export or that plugin can't work with the design until you fix it. When you open a design, errors are only reported; the design still opens. |
| **Warning** (amber) | Something will be lost or changed. You can go ahead anyway. |
| **Info** | Data the target format doesn't store. Listed, never blocking. |

## Opening A File

### cadnano files

| What Foldnano finds | What happens |
| --- | --- |
| A base claims a connection from a base that is empty | Repaired: the claim is removed and the base becomes a free end, as cadnano draws it. A warning names the helix and base. |
| A crossover end that points at its own base (some older files) | Repaired silently: rewritten to the neighbouring base, the form Foldnano writes. Nothing changes in the design. |
| A deletion (skip) on a crossover base | Moved to a neighbouring base. A warning names both positions. If no neighbour is free, it stays and simulation export may refuse it. |
| An insert on a crossover base | Kept, and reported by the **Editor rules** check below. |
| A helix length that fits both honeycomb (21) and square (32), such as 672 | Foldnano picks the lattice whose crossover positions match. If the file has no crossovers to go by, you choose. A link can answer in advance with `&lattice=honeycomb` or `&lattice=square`. |
| Two bases that disagree about how they connect | Not opened. |
| Two helices on one lattice position, a negative helix number or lattice position, helices of different lengths | Not opened. |
| Malformed data: missing arrays, connections to helices or bases that don't exist, a base marked as both skip and insert, invalid colors | Not opened. |
| A strand only one base long | Not opened. Extend or remove it in cadnano first. |
| A helix length that fits neither lattice | Not opened. |

### Foldnano files

| What Foldnano finds | What happens |
| --- | --- |
| Helices at negative lattice positions | Repaired: the region is moved onto the grid without changing where it sits in 3D. For a design saved in this browser, the unrepaired copy is kept in **Backups**. |
| A mirrored plane, from regions created on the **Side (YZ)** base plane before this was fixed (and never rotated since) | Repaired: the plane's V axis is flipped. The 2D view is unchanged; in 3D the regions on it flip along V, and their helices now twist the right way, so crossovers line up in the 3D view and in oxDNA/mrDNA export. For a design saved in this browser, the unrepaired copy is kept in **Backups**. |
| Inconsistencies from an earlier bug (strands listed on the wrong helix, one-way connections) | Repaired, with a message listing what was fixed (and a **Backups** copy for a design saved in this browser). |
| Anything in the **Editor rules** check | Reported, not changed. |

## Editor Rules

States the editor doesn't create itself. They come from imported files or plugin results. When you open a design, they are listed in one message. A plugin whose result has an error is refused before you can apply it.

| Check | Level | What to do |
| --- | --- | --- |
| A skip on one strand and an insert on the other (or different inserts) at the same base | Error | Make both strands match: remove the skip or insert and add it again with the skip or insert tool. |
| A skip or insert on a constrained crossover site | Error | Move the skip or insert to a neighbouring base. |
| Two helices on the same lattice position | Error | Move one of them. |
| A helix at a negative lattice position | Error | Foldnano moves a saved design onto the grid when it opens it, so this mostly shows up as a refused plugin result: fix the plugin. |
| A helix whose number is even on an odd lattice position (or the reverse) | Warning | cadnano export and crossover positions assume they match. Recreate the helix in place if you need either. |
| A freeform helix whose saved direction or roll is not a proper frame (not unit length, or roll not at a right angle to the helix) | Warning | The 3D view and exports would distort the helix. Select it and set its **Roll** in the Select panel, which rebuilds the frame. |

## Simulation Export

What oxDNA and mrDNA export (and the 3D view's NT mode) refuse. Turn on **Simulation export** in the Design checks button to see them while you edit. See [Simulation And Export](/docs/guide/simulation-export#nt-model).

| Check | Level | What to do |
| --- | --- | --- |
| Any **Editor rules** error about skips or inserts | Error | As above. |
| A skip or insert on a base where only one strand exists | Error | Single-stranded DNA simulates fine, but not as a one-sided skip or insert. Draw the bases as ordinary strand bases (or shorten the strand instead of skipping), or remove the skip or insert. |

## Cadnano Export

What cadnano JSON can't hold, for the **active region**. Shown before **Export as cadnano JSON** and before a plugin that works on cadnano JSON runs. Turn on **Cadnano export** in the Design checks button to see them while you edit. See [Exporting cadnano JSON](/docs/guide/simulation-export#exporting-cadnano-json).

| Check | Level | What to do |
| --- | --- | --- |
| A freeform region | Error | cadnano only has honeycomb and square lattices. Use Foldnano JSON instead. |
| A connection from a cadnano scaffold path to a staple path | Error | cadnano keeps those in separate arrays, decided by helix number and strand. Reroute the connection so it stays on one kind of path. |
| A helix length that isn't a multiple of 21 (honeycomb) or 32 (square) | Error | Change the region length. |
| A **Editor rules** issue about lattice positions or per-strand skips and inserts | Error or warning | As in Editor Rules. |
| A helix length that fits both lattices, such as 672 | Warning | cadnano asks whether the design is square when it opens the file; the message says what to answer. |
| Connections to other regions | Warning | They are cut in the exported file. |
| Repeat-group copies | Warning | Only the originals are exported. |
| Sequences, modifications, oligo names, the scaffold label | Info | Not stored in cadnano JSON. |

A plugin that only reads the design (no result to apply) is only stopped by errors. A plugin that replaces the region also shows the warnings, because applying its result makes those losses permanent.
