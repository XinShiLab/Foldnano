---
title: Local Setup
description: Install dependencies, run the app, and execute checks for Foldnano development
category: contributors
order: 3
slug: local-setup
---

# Local Setup

Foldnano uses SvelteKit 2, Svelte 5 runes, TypeScript, Konva, Three.js, Dexie, Pyodide, Tailwind 4, shadcn-svelte components (built on bits-ui), paneforge, and pnpm.

## Commands

```bash
pnpm dev
pnpm build
pnpm preview
pnpm check
pnpm lint
pnpm test
```

Run a single unit test file with:

```bash
pnpm vitest run src/lib/model/test/VirtualHelix.spec.ts
```

## Development Notes

- Tests run in jsdom.
- Model specs live primarily under `src/lib/model/test`.
- Svelte class files that use runes must use `.svelte.ts`.
- Runtime persistence uses IndexedDB, not `localStorage`.
