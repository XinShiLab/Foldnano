---
title: Coming From Python
description: JS/TS/Svelte concepts, Node install, and coding-agent setup for contributors with a Python background
category: contributors
order: 2
slug: coming-from-python
---

# Coming From Python

Foldnano's frontend is TypeScript and Svelte, not Python. If you already work comfortably in a JS/TS toolchain, skip this page and go straight to Local Setup. If your background is Python (scripting, Jupyter, scientific computing), this page maps the ecosystem before you touch a terminal command.

## What Are JavaScript, TypeScript, And Svelte?

If the names above are unfamiliar, here's the short version before anything else:

- **JavaScript** is the programming language every web browser runs: the browser understands it natively, the same way it only understands HTML/CSS for markup and layout. It's dynamically typed, like Python. See [MDN's JavaScript guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide) for an introduction.
- **TypeScript** is JavaScript plus a type system, checked before the code runs, not at runtime. Think Python type hints, except the compiler (`tsc`, run here via `pnpm check`) *enforces* them rather than just suggesting them, and strips the types out to produce plain JavaScript. This project is TypeScript throughout; see the [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html).
- **Svelte** is a UI framework for building interactive web pages out of reusable components, the same role [React](https://react.dev/) or [Vue](https://vuejs.org/) play, if you've heard of either. The difference that matters here: React/Vue ship a runtime library that does its work in the browser at page-load time, while Svelte is mostly a *compiler*. It turns your components into plain, minimal JavaScript ahead of time, so there's less framework code shipped to the browser. See [Svelte's introduction](https://svelte.dev/docs/svelte/overview).
- **SvelteKit** is the application framework built on top of Svelte: it adds routing, server-side rendering, and API endpoints, the same relationship [Next.js](https://nextjs.org/) has to React, or Django has to plain Python. See [SvelteKit's introduction](https://svelte.dev/docs/kit/introduction).

## The Mental Model

| Python world                   | JS/TS/Svelte equivalent here                                              |
| ------------------------------- | --------------------------------------------------------------------------- |
| `python` / `pyenv`              | [Node.js](https://nodejs.org/en/docs) / `nvm`                               |
| `pip` / `conda` / `uv`          | [pnpm](https://pnpm.io/)                                                     |
| `venv` / `.venv`                | `node_modules/` (auto-managed, never commit)                                |
| `requirements.txt`              | `package.json` + `pnpm-lock.yaml`                                           |
| a module (`.py`)                | a [TypeScript](https://www.typescriptlang.org/docs/) module (`.ts`, or `.svelte.ts` if it uses reactive state) |
| a function/class you call       | a [Svelte](https://svelte.dev/docs/svelte) *component* (`.svelte` file: template, script, and scoped style together) |
| a Flask/Django route            | a [SvelteKit](https://svelte.dev/docs/kit) file-based route (`src/routes/.../+page.svelte`) |
| a `@dataclass` field others read | a Svelte 5 [*rune*](https://svelte.dev/docs/svelte/what-are-runes) (`$state`, `$derived`, `$props`), an explicitly reactive field |
| `pytest`                        | [Vitest](https://vitest.dev/)                                                |
| `python -m mymodule` / `uv run` | `pnpm run <script>`                                                         |

## How Svelte/TypeScript Dev Works Here

A few things that don't have a direct Python analogue:

- **Components compile away.** A `.svelte` file isn't interpreted at runtime like a Python module. The [Svelte compiler](https://svelte.dev/docs/svelte/overview) turns it into plain, targeted DOM-update JavaScript at build time. There's no framework runtime diffing a virtual tree on every change.
- **Reactivity is explicit, via runes.** [`$state`, `$derived`, and `$props`](https://svelte.dev/docs/svelte/what-are-runes) mark a field as reactive; code that reads it re-runs when it changes, similar to a spreadsheet cell recalculating. Plain fields are not reactive; this trips people up coming from Python, where every attribute is implicitly "live." See `docs/reactivity-patterns.md` for the details, including why class files using runes need the `.svelte.ts` extension.
- **SvelteKit is the meta-framework.** It gives you [file-based routing](https://svelte.dev/docs/kit/routing) (`src/routes/`), server-side rendering, and API route handlers (`+server.ts`), roughly the role Flask or Django plays, but routes are directories, not decorators.
- **TypeScript is checked, not run directly.** `pnpm check` runs `svelte-kit sync` + [`svelte-check`](https://www.npmjs.com/package/svelte-check); there's no separate "compile" step you invoke by hand during dev. `pnpm dev` handles it.

The specific libraries in play (Konva for the 2D strand view, Three.js for the 3D view, Dexie over IndexedDB for storage, Pyodide for the Python plugin runtime) are listed in `CLAUDE.md`'s Tech Stack section.

## Install Node.js Via nvm

[nvm](https://github.com/nvm-sh/nvm) (Node Version Manager) is the recommended way to install Node: it lets you switch Node versions per project, the same role `pyenv` plays for Python.

**macOS / Linux:**

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
```

Restart your shell, then install the Node version this project requires (pinned in `package.json`'s `engines` field):

```sh
nvm install 24
nvm use 24       # or: nvm alias default 24  to make it the global default
node --version   # should print v24.x.x
```

**Windows:** use [nvm-windows](https://github.com/coreybutler/nvm-windows): download the installer from its releases page, run it, then open a new terminal and run the same `nvm install 24` / `nvm use 24` commands above. (Native `nvm` is a shell script and doesn't run on Windows; nvm-windows is a separate, compatible tool with the same command surface.) Alternatively, install Node 24 directly from [nodejs.org](https://nodejs.org) if you don't need to switch versions.

## Install pnpm Via Corepack

This project uses [Corepack](https://nodejs.org/api/corepack.html) (ships with Node) to manage the pnpm version pinned in `package.json`. You don't install pnpm manually; Corepack downloads the exact pinned version on first use.

```sh
corepack enable       # one-time; tells Node to let Corepack manage package managers
pnpm --version         # Corepack downloads pnpm on first use; should print 10.x or later
```

## Clone, Install, Run

```sh
git clone https://github.com/XinShiLab/foldnano.git
cd foldnano
pnpm install          # reads package.json, installs everything into node_modules/
pnpm dev               # starts http://localhost:5173, hot-reloads on save
```

`pnpm install` is the equivalent of `pip install -r requirements.txt`; re-run it whenever `package.json` changes (e.g. after pulling commits that add a dependency). `node_modules/` is the `venv` equivalent: it's fully regenerable from the lockfile and is never committed.

Continue to Local Setup for the rest of the repo-specific commands (`pnpm check`, `pnpm lint`, `pnpm test`).

## Where The Docs Live

| Location                            | What it's for                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `docs/*.md`                          | Internal, per-subsystem deep dives (model, commands, storage, plugin system…). Read the relevant one before a non-trivial edit in that area; each ends with a "Boundaries / Don'ts" section. |
| `CLAUDE.md` / `AGENTS.md`            | A pocket reference of commands, invariants, and style rules. Written for a coding agent, but works as a human cheat sheet too. |
| `src/content/contributors/*` | This guide: curated, public-facing contributor onboarding.                    |
| `src/content/guide/*`                | The end-user manual (how to use the app, not how to build it).                 |
| `src/content/plugin-development/*`   | Authoring guide for third-party Python plugin authors.                         |

## Working With A Coding Agent On This Repo

`CLAUDE.md` and `AGENTS.md` (identical content) are automatically read by coding agents (Claude Code, and other tools that follow the `AGENTS.md` convention) at the start of a session in this repo. That means you don't need to re-explain the command/history invariants, the `Part`-owns-mutations rule, or the style guide every time; the agent already has them.

Practical notes if you're new to working alongside an agent here:

- Point the agent at the relevant `docs/*.md` file before asking for a non-trivial change in that area. The agent is expected to load it, but naming it explicitly (e.g. "read `docs/commands-and-history.md` first") avoids it guessing.
- Treat agent-written changes like your own: run `pnpm check && pnpm test` (or the scoped `pnpm test`, which only runs suites affected by your diff) before considering the change done.
- [Claude Code](https://claude.com/claude-code) is the CLI this project's `CLAUDE.md` is written for; see its docs for installation.

## Further Reading

- [Node.js documentation](https://nodejs.org/en/docs)
- [nvm](https://github.com/nvm-sh/nvm) / [nvm-windows](https://github.com/coreybutler/nvm-windows)
- [pnpm documentation](https://pnpm.io/); see [pnpm vs npm/yarn](https://pnpm.io/motivation) if you're curious why this project uses it
- [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Svelte documentation](https://svelte.dev/docs/svelte) and [Svelte 5 runes](https://svelte.dev/docs/svelte/what-are-runes)
- [SvelteKit documentation](https://svelte.dev/docs/kit)
- [Vitest documentation](https://vitest.dev/guide/)
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), the base this project's style follows (see Code Style And Testing)
