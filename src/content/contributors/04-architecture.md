---
title: Architecture Overview
description: Source tree orientation, process layers, routes, editor contexts, and viewer responsibilities
category: contributors
order: 4
slug: architecture
---

# Architecture Overview

Foldnano separates the DNA model, command/history layer, editor session, view context, and viewer components.

## Main Areas

| Area | Responsibility |
| --- | --- |
| `src/lib/model` | Part, regions, virtual helices, oligos, segments, ends, sequence slots |
| `src/lib/commands` | Undoable mutations and history capture |
| `src/lib/components/Editor/context` | Document session and view context |
| `src/lib/components/Editor` | Editor shell, toolbar, panels, viewers |
| `src/lib/services/storage` | IndexedDB and GitHub-backed document providers |
| `src/lib/plugin` | Plugin manifests, runtime coordination, Python bridge |
| `src/routes` | SvelteKit pages and API proxies |

## Editor Session Split

`EditorDocumentSession` owns document state, the history stack, storage manager, GitHub metadata, and tab ownership.

`EditorViewContext` owns active editor mode, active region/viewer state, strand-view context, UI controllers, selection sets, and derived tab-owner state.

Keep persistence and document lifecycle in the session. Keep transient editor UI state in the view context.

## Viewer Responsibilities

- Strand view is the main routing surface.
- Helix/lattice and freeform viewers edit virtual-helix placement in a design region.
- 3D view inspects lab-frame geometry, plane transforms, simulation previews, and 3D exports.

All lab-frame placement should come from `part.getVirtualHelixFrame(vh)`.
