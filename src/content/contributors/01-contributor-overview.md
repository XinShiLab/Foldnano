---
title: Contributor Overview
description: How the contributor docs relate to the internal repo docs and where to start
category: contributors
order: 1
slug: contributor-overview
---

# Contributor Overview

## What Is Foldnano

Foldnano is a browser-based DNA nanostructure design tool built with SvelteKit. It's local-first: designs live in the browser's IndexedDB working copy, with optional sync to a GitHub repository. It embeds a Python plugin runtime (via Pyodide, running in a Web Worker), so design operations can be scripted in Python without leaving the browser. It also supports importing and exporting the legacy cadnano `.json` format alongside its own native `.fn.json`.

This section is a curated contributor guide. It is not a mirror of every internal file in the repository `docs/` folder.

Public-facing contributor docs should explain how to work on Foldnano. Internal audits, release-review notes, and exploration reports stay in the repository's `docs/` folder rather than on this site, unless they are rewritten as stable guidance.

## What To Read First

1. Coming from Python (skip if you're already comfortable with JS/TS/pnpm)
2. Local setup
3. Architecture overview
4. Model and command invariants
5. Storage, autosave, and GitHub sync
6. Plugin runtime architecture
7. Code style and tests

For deeper implementation detail, use the repo docs such as `docs/architecture.md`, `docs/dna-model.md`, `docs/commands-and-history.md`, and `docs/storage-architecture.md`.

## Branch Model And PR Workflow

- `main` is the stable branch; open pull requests against it.
- Name feature branches `feat/<name>` and bug-fix branches `fix/<name>`.
- Run `pnpm check && pnpm test` before pushing. `pnpm test` scopes to suites affected by your changes; run `pnpm test:branch` (suites affected vs. `main`) before opening the PR.

## Contribution Principle

Foldnano has a reactive editor, an undoable model, local persistence, and multi-tab protection. Most regressions come from bypassing one of those ownership boundaries. Prefer small changes that preserve the existing command, storage, and view-context contracts.
