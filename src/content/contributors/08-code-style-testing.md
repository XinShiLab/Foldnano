---
title: Code Style And Testing
description: Naming, type rules, comments, formatting, and test expectations for contributors
category: contributors
order: 8
slug: code-style-testing
---

# Code Style And Testing

## Naming

- `UpperCamelCase` for classes, interfaces, type aliases, enums, and Svelte components.
- `lowerCamelCase` for variables, functions, methods, parameters, and reactive fields.
- `SCREAMING_SNAKE_CASE` for module-level true constants.
- `_prefixedName` for private class members.
- File names are kebab-case for regular TypeScript, `ComponentName.svelte` for components, and `ClassName.svelte.ts` for rune-using classes.

The `.svelte.ts` extension on rune-using classes isn't stylistic: the Svelte compiler only applies the runes transform (`$state`, `$derived`, `$props`) to files with that extension. A `$state` field in a plain `.ts` file is inert; it looks reactive but never triggers a UI update.

## Types

Use interfaces for object shapes and type aliases for unions or intersections. Avoid `any`; use `unknown` with narrowing. Annotate public method return types. TypeScript can usually infer them, but an explicit return type documents the contract for callers and keeps a signature change from silently propagating an inferred type through the codebase.

## Comments

Comment only when the reason is not obvious: hidden constraints, subtle invariants, or workarounds. Keep comments short.

```ts
// Bad: restates what the code already says
// increment the counter by one
counter += 1;

// Good: explains a non-obvious constraint
// GitHub's contents API 404s on a 0-byte file, so write a single
// newline instead of an empty string.
await writeFile(path, content || '\n');
```

Comments describing *what* code does rot as the code changes and the comment doesn't; a well-named function or variable already says what, so the only comment worth writing is the *why* a reader can't get from the code itself.

## Formatting

Prettier owns formatting. Run:

```bash
pnpm lint
```

Use `pnpm format` only when intentionally rewriting formatting.

## Test Expectations

Run checks that match the change risk:

- `pnpm check` for Svelte and TypeScript correctness.
- `pnpm test` for unit tests (scoped to suites affected by your uncommitted changes; fast, the default inner loop).
- `pnpm test:branch` before pushing/opening a PR (scoped to suites affected vs. `main`).
- Targeted `pnpm vitest run ...` for focused model or service changes.
- Manual browser checks for UI, canvas, 3D, storage, GitHub, and plugin workflows; these aren't covered by the unit suite.

For model changes, prefer focused tests around commands, undo/redo, region behavior, and persistence snapshots.
