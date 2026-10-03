---
status: snapshot
---

# Development history

The public repository starts from a fresh history. This page summarises how Foldnano was built
before that point: about 810 commits between October 2025 and October 2026.

## Why Svelte 5

The idea for the project came from Svelte 5. Its runes (`$state`, `$derived`) brought
fine-grained reactivity to plain classes, so a data model written as ordinary classes could
drive the UI directly. The author wanted to try that mechanism on a real problem: rebuilding
cadnano for the web, with the DNA design model itself as reactive Svelte 5 classes. Foldnano
has been a [SvelteKit](https://svelte.dev/docs/kit) application written in TypeScript ever
since, and runes remain the reactivity model throughout, including inside the design model.

## October–December 2025: a cadnano editor in the browser

The project began on 19 October 2025 as **cadnano-web**, an attempt to bring the cadnano 2.5
editing model to the browser. It was set up on SvelteKit 2 and Svelte 5, with Konva (through
svelte-konva) for the 2D canvas.

- **Strand editor first.** The first weeks built the 2D strand view (Konva) and a honeycomb
  lattice view: drawing strands, breaking them, crossovers that behave like cadnano's, skips
  and inserts, and dragging strand ends.
- **A reactive data model.** `Part`, `VirtualHelix`, `Oligo` and `OligoSegment` became the core
  model. Rather than keeping a separate store, the model classes hold their state in Svelte 5
  runes (`.svelte.ts` files, `SvelteSet`/`SvelteMap` collections), so every view updates
  directly from the model. JSON serialisation lets that state be snapshotted for undo and
  saving.
- **cadnano compatibility.** A cadnano `.json` importer arrived in late October and an exporter
  in November, followed by loops and skips on import and a square lattice alongside honeycomb.
- **Editor architecture.** November replaced component-level event handling with a controller
  and tool architecture (select, draw, break, paint, skip/insert), a command-based undo/redo
  history, and a spatial index for fast hit testing.
- **Design tools.** Auto staple, scaffold and staple sequences (with preset scaffolds), staple
  CSV export, oligo colouring, a context menu, and the first unit tests.
- **Persistence.** December added autosave to the browser and a storage manager, plus PNG
  export of the views.

## March–April 2026: GitHub sync, 3D, plugins, and a new name

After a pause in January and February, development resumed in March.

- **GitHub integration.** Designs can be committed to and pulled from a GitHub repository:
  a change list, staging, commit-all, branches, a commit graph, conflict handling, and backups
  before overwrites. A GitHub App replaced plain OAuth so private repositories work.
- **IndexedDB.** The working copy moved from `localStorage` to IndexedDB, and multiple open tabs
  now coordinate so only one tab writes a design.
- **3D view.** A Three.js structure view arrived in April, with skips and inserts handled
  correctly, selection, and export.
- **Rigid-body simulation.** A fast rigid-body relaxation (RBS) runs in a Web Worker with live
  preview and stress colouring, together with the first oxDNA export.
- **Python plugins.** A plugin system runs Python in the browser through Pyodide, with zip
  plugins, parameters, a plugin hub, and demo plugins. pyOrigamiBreak (staple auto-break) was
  adapted as the first real-world plugin, together with a trimmed cadnano 2.5 package
  (`cadnano2_5_mini`) that runs in the browser.
- **Freeform and regions.** Unlatticed "freeform" parts arrived in April, and the model was
  reorganised around regions, so square, honeycomb and freeform regions can coexist in one
  design. The old shadow model was removed.
- **New name.** The project was renamed from cadnano-web to **Foldnano** on 19 April 2026, and
  the native file extension became `.fn.json`.

## May–August 2026: scripting, simulation export, docs

- **Scripting.** A `foldnano_mini` Python API lets plugins edit a design through the same
  operations as the UI, replayed as one undoable step. Script Lab added an in-editor Python
  editor with a live 3D preview.
- **Simulation export.** A format-agnostic nucleotide model now feeds both oxDNA and mrDNA
  export, with insert > 1 support. mrDNA results and PDB protein structures can be loaded back
  as 3D overlays, positioned with a gizmo, and duplicated.
- **Design analysis.** A circular scaffold map, an oligo list page, sequence mismatch markers,
  and end alignment tools.
- **Documentation site.** A docs site with a user guide, plugin development guide and
  contributor guide, including interactive examples.
- **Landing page.** A public landing page with a 3D hero design, plus dark mode across the app.
- **Validation and plugin checks.** In August and September, Luka Van Gyes added automated
  comparisons against cadnano 2.5 (cadnano file round-trips, and staple sequences checked against
  reference output generated by cadnano 2.5 itself for published designs), completed the user
  guide, and built a shared plugin installation flow, safe plugin registration and replacement,
  and validation of plugin results before they are applied to a design.

## September 2026: preparing the beta

September focused on making Foldnano safe to release.

- **Data safety.** A versioned `.fn.json` format with migrations and a published JSON Schema,
  visible save failures, a recovery screen, rotating local backups, and a capped undo history.
- **Plugin sandbox.** Python plugins now run in an opaque-origin sandbox with declared network
  access, timeouts, size limits, and versioned manifests. Pyodide is self-hosted.
- **Repeat units.** Duplicate selections and linked mirror oligos that stay in sync.
- **Release housekeeping.** MIT license, citation metadata, third-party notices, a privacy page
  with cookieless analytics, in-app workspace help, and a What's New list.

## Development with AI coding assistants

Foldnano was developed with AI coding assistants: ChatGPT and OpenAI Codex (including GPT-5),
and Anthropic's Claude (through Claude Code). AI assistance runs through the whole project.

How much varied over time. In the first months, AI contributed much less: Svelte 5 runes were
new enough that the models of the time could not handle them reliably, so the core of the
reactive model and the strand editor was written largely by hand, with AI used mainly for
isolated pieces such as the cadnano file encoder and for code review. As the models caught up,
from spring 2026 onwards, assistants took on a growing share of the implementation.

They were used to draft implementations from written plans, review code and architecture,
write tests and documentation, and investigate bugs. Larger features were usually planned in a
design document first, then implemented in phases and checked against the plan; several of
those plans and reviews became the internal docs that the codebase still maintains. The
developers directed the work, reviewed and tested the changes, and made the design decisions.

## Built on

Foldnano reads and writes the cadnano 2 file format and was validated against
[cadnano 2.5](https://github.com/cadnano/cadnano2.5) (Wyss Institute and UCSF, BSD 3-Clause).
The bundled pyOrigamiBreak plugin is adapted from
[pyOrigamiBreak](https://github.com/douglaslab/pyOrigamiBreak) by Tural Aksel (MIT). The 3D
rigid-body relaxation is inspired by the cluster simulation in
[oxView](https://sulcgroup.github.io/oxdna-viewer/) (an independent implementation). Other
third-party components are listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
