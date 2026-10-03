---
covers:
  - eslint.config.js
  - .prettierrc
  - .prettierignore
  - components.json
  - jsrepo.json
  - src/lib/components/ui/**
---

# Code Style Guide

This project follows the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) (ts.dev) as its base, with Svelte 5 specifics layered on top.

Formatting is enforced by **Prettier** — run `pnpm format` before committing. The rules below cover conventions that Prettier cannot enforce.

---

## Formatting (Prettier-enforced — don't discuss in PRs)

| Setting         | Value                                        |
| --------------- | -------------------------------------------- |
| Indentation     | Tabs                                         |
| Quotes          | Single                                       |
| Semicolons      | On                                           |
| Trailing commas | `"es5"` (multi-line arrays, objects, params) |
| Print width     | 100 characters                               |
| Svelte parser   | `prettier-plugin-svelte`                     |

Run `pnpm format` to auto-fix. Run `pnpm lint` to check.

---

## Naming Conventions

| Entity                                | Convention             | Example                                   |
| ------------------------------------- | ---------------------- | ----------------------------------------- |
| Classes                               | `UpperCamelCase`       | `VirtualHelix`, `StrandSet`               |
| Interfaces                            | `UpperCamelCase`       | `MirrorTag`                               |
| Type aliases                          | `UpperCamelCase`       | `LeafTarget`, `ApplyStrategy`             |
| String-literal union members          | `SCREAMING_SNAKE_CASE` | `EditorMode` values: `'SELECT'`, `'DRAW'` |
| Svelte components                     | `UpperCamelCase`       | `StrandView.svelte`                       |
| Variables / functions                 | `lowerCamelCase`       | `vhId`, `getEntitiesAt`                   |
| Method parameters                     | `lowerCamelCase`       | `numBases`, `isScaf`                      |
| Reactive fields (`$state`/`$derived`) | `lowerCamelCase`       | `selectedVhIds`                           |
| Module-level true constants           | `SCREAMING_SNAKE_CASE` | `MAX_BASES_PER_HELIX`                     |
| Private class members                 | `_lowerCamelCase`      | `_length`, `_slotCache`                   |
| File names (TS/JS)                    | `kebab-case`           | `spatial-index.ts`                        |
| File names (classes with runes)       | `PascalCase.svelte.ts` | `VirtualHelix.svelte.ts`                  |
| File names (Svelte components)        | `PascalCase.svelte`    | `StrandView.svelte`                       |

---

## Type System

### Prefer `interface` over `type` for object shapes

```typescript
// Good
interface MirrorTag {
	groupId: string;
	instanceId: string;
	sourceOligoId: string;
	structure: string;
}

// Avoid for plain object shapes
type MirrorTag = {
	groupId: string;
	instanceId: string;
	sourceOligoId: string;
	structure: string;
};
```

Use `type` for unions, intersections, and mapped types:

```typescript
type LeafTarget = 'END' | 'XOVER' | 'SEGMENT';
type Nullable<T> = T | null;
```

### Never use `any`

Use `unknown` with narrowing instead:

```typescript
// Bad
function process(data: any) { ... }

// Good
function process(data: unknown) {
  if (typeof data === 'string') { ... }
}
```

### Type inference

Don't annotate types TypeScript can infer:

```typescript
// Bad
const count: number = 0;
const label: string = 'hello';

// Good
const count = 0;
const label = 'hello';
```

Do annotate public method return types explicitly:

```typescript
// Good — explicit return type on public API
getVirtualHelixFrame(vh: VirtualHelix): VirtualHelixFrame {
  ...
}
```

### `readonly`

Use `readonly` on properties that shouldn't change after construction:

```typescript
class OligoSegment {
  readonly inPart: Part;
  readonly inVirtualHelix: VirtualHelix;
  ...
}
```

---

## Imports

- All imports at the top; no inline `require()`.
- Group in this order, separated by a blank line:
  1. Node built-ins (`node:fs`, `node:path`)
  2. External packages (`three`, `konva`, `dexie`)
  3. `$lib/...` path aliases
  4. Relative imports (`./`, `../`)
- Within each group, sort alphabetically (Prettier/ESLint handles this if configured).

---

## Exports

- Use **named exports** everywhere.
- **Default exports** are allowed only for:
  - Svelte components (SvelteKit convention)
  - SvelteKit route files (`+page.svelte`, `+layout.svelte`, `+server.ts`)

```typescript
// Good
export class VirtualHelix { ... }
export function getEntitiesAt(...) { ... }

// Avoid default exports in plain TS files
export default class VirtualHelix { ... }  // Bad
```

---

## Svelte 5 Specifics

### Reactive state in classes

`$state` / `$derived` must be per-field inside `.svelte.ts` files. A `$state<ClassName>([])` array makes the array reactive, but mutations to instance fields are not tracked unless the class itself uses `$state`.

```typescript
// VirtualHelix.svelte.ts
class VirtualHelix {
  _length = $state(0);         // reactive field
  id: string;                  // plain field, no rune needed
  ...
}
```

### `$derived` over manual `$effect` + assignment

```typescript
// Good
const totalBases = $derived(helices.reduce((sum, vh) => sum + vh.length, 0));

// Avoid
let totalBases = $state(0);
$effect(() => { totalBases = helices.reduce(...); });
```

### `$effect` only for true side effects

Use `$effect` for DOM manipulation, external subscriptions, or cleanup — not for deriving values.

### Component props

```svelte
<!-- Good (Svelte 5) -->
<script lang="ts">
  const { label, onClick }: { label: string; onClick: () => void } = $props();
</script>

<!-- Avoid (Svelte 4 syntax) -->
<script lang="ts">
  export let label: string;
</script>
```

---

## UI Components

UI elements (buttons, dialogs, menus, inputs, …) come from [shadcn-svelte](https://shadcn-svelte.com)
and live in `src/lib/components/ui/`. When you need one that isn't there yet, add it with the CLI
(config in `components.json`) instead of building it directly on bits-ui:

```bash
pnpm shadcn-svelte add <component>
```

- Check shadcn-svelte first; only fall back to another registry (`file-drop-zone` came from
  shadcn-svelte-extras via `jsrepo.json`) or a hand-built component when it has nothing suitable.
- The CLI overwrites files it regenerates. Afterwards re-apply the shared `glass-paper` surface
  style to floating components (the `apply-glass-paper` skill in `.claude/skills/`).
- Compose app-specific widgets from these components elsewhere under `src/lib/components/`; keep
  `ui/` close to upstream so later updates stay easy.
- Credit any new upstream source in `THIRD_PARTY_NOTICES.md` and the About dialog.

## Comments

Write a comment only when the **why** is non-obvious: a hidden constraint, a subtle invariant, or a workaround for a specific bug.

```typescript
// Bad — describes what the code does (the code already says this)
// Increment the counter
count++;

// Bad — references the current task (rots as code evolves)
// Added for the crossover selection fix in PR #42
const offset = 2;

// Good — explains a non-obvious invariant
// Parity flip: cadnano scaf↔strandSet[0] for even VH, ↔strandSet[1] for odd VH
const ssIdx = vhIdx % 2 === 0 ? 0 : 1;
```

One short line max. No multi-paragraph docstrings. No `// removed`, `// TODO: fix later` without a linked issue.

---

## What ESLint Already Enforces

These are covered by `typescript-eslint` recommended + `eslint-plugin-svelte` recommended — don't duplicate them in comments:

- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/no-unused-vars`
- `@typescript-eslint/no-inferrable-types`
- Svelte template validity and accessibility rules

Run `pnpm lint` to see all current violations.
