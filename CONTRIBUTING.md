# Contributing to Foldnano

Thanks for helping. This guide covers local setup and the rules that keep the codebase consistent.
The contributor section of the docs site goes deeper into architecture, the data model, and code
style.

## New to Node.js / pnpm? Start here

If you come from a Python background, this section maps familiar concepts to the JS ecosystem.

| Python world                             | JS equivalent here                           |
| ---------------------------------------- | -------------------------------------------- |
| `python` / `pyenv`                       | `node` / `nvm`                               |
| `pip` / `conda` / `uv`                   | `pnpm`                                       |
| `venv` / `.venv`                         | `node_modules/` (auto-managed, never commit) |
| `requirements.txt`                       | `package.json` + `pnpm-lock.yaml`            |
| `pyproject.toml` + `uv.lock`             | `package.json` + `pnpm-lock.yaml`            |
| `python -m mymodule` / `uv run <script>` | `pnpm run <script>`                          |

### 1. Install Node via nvm

[nvm](https://github.com/nvm-sh/nvm) (Node Version Manager) is the recommended way to install Node — it lets you switch versions per project, similar to `pyenv`.

```sh
# Install nvm (macOS / Linux)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash

wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
```

Running either of the above commands downloads a script and runs it. The script clones the nvm repository to `~/.nvm`, and attempts to add the source lines from the snippet below to the correct profile file (`~/.bashrc`, `~/.bash_profile`, `~/.zshrc`, or `~/.profile`).

```sh
# Restart your shell, then install the Node version this project requires
nvm install 24
nvm use 24       # or: nvm alias default 24  to make it the global default
node --version   # should print v24.x.x
```

> **Windows:** use [nvm-windows](https://github.com/coreybutler/nvm-windows) instead, or install Node 24 directly from [nodejs.org](https://nodejs.org).

### 2. Enable pnpm via Corepack

This project uses [Corepack](https://nodejs.org/api/corepack.html) (ships with Node) to manage the pnpm version declared in `package.json`. You don't install pnpm manually — Corepack downloads the exact pinned version for you.

```sh
corepack enable       # one-time; tells Node to let Corepack manage package managers
pnpm --version        # Corepack downloads pnpm on first use; should print 11.x
```

### 3. Clone and install dependencies

```sh
git clone https://github.com/XinShiLab/foldnano.git
cd foldnano
pnpm install          # reads package.json, installs everything into node_modules/
```

The bundled `cadnano2_5_mini` plugin wheel is stored with [Git LFS](https://git-lfs.com). Install it (`git lfs install`, once per machine) before cloning, or run `git lfs pull` afterwards; without it the wheel is a small pointer file and that plugin won't load.

`pnpm install` is the equivalent of `pip install -r requirements.txt`. You only need to re-run it when `package.json` changes (e.g. after pulling new commits that add packages).

### 4. Run the dev server

```sh
pnpm dev              # starts http://localhost:5173 — hot-reloads on file save
```

Open [http://localhost:5173](http://localhost:5173) in your browser. The server keeps running in the terminal; press `Ctrl+C` to stop it.

---

## Development

**Prerequisites:** Node 24+, pnpm

```sh
pnpm install      # install dependencies
pnpm dev          # dev server (http://localhost:5173)
pnpm check        # svelte-kit sync + type checking
pnpm lint         # prettier + eslint
pnpm format       # auto-format
pnpm test         # tests affected by uncommitted changes
pnpm test:all     # full test suite
pnpm vitest run src/lib/model/test/Part_oligos.spec.ts  # run a single test file
```

Native Foldnano design files use `.fn.json`. Legacy cadnano `.json` and `.cadnano.json` files are supported through the cadnano import/export path.

## Environment

Copy `.env.example` to `.env`. The app has an optional access gate: leave `ALPHA_ACCESS_CODE`
empty to open every page, or set it to a code that visitors must enter first.

## GitHub Integration Setup

The GitHub sync feature requires a GitHub App. To run it locally:

1. [Create a GitHub App](https://github.com/settings/apps/new) with:
   - **Callback URL:** `http://localhost:5173/api/auth/github/callback`
   - **Repository permissions:** Contents (read/write), Metadata (read)
2. Fill in these values in `.env`:
   ```
   GITHUB_APP_CLIENT_ID=...
   GITHUB_APP_CLIENT_SECRET=...
   GITHUB_APP_NAME=your-app-slug
   AUTH_COOKIE_SECRET=<random 32+ char string>
   ```

The GitHub OAuth token never reaches the client — it lives in an `httpOnly` cookie managed by the SvelteKit server routes under `/api/auth/github/` and `/api/github/`.

## Architecture

- `docs/architecture.md` — full source-tree map and per-area entry points
- `CLAUDE.md` — quick reference for AI-assisted development (commands, invariants, style guide)
- `docs/` — per-area deep-dive docs (model, commands, reactivity, storage, plugin system, …)
- `docs/development-history.md` — how the project developed before this repository's history begins

## Key Invariants

1. **Part is the only mutation owner.** Never write directly to `VirtualHelix`, `OligoSegment.slots`, `StrandSet.segmentIds`, etc. — go through `Part` methods.
2. **All model mutations go through commands**, wrapped in `historyStack.tx(label, rec => ...)` (targeted patches) or `historyStack.snapshotTx(label, () => ...)` (structural edits).
3. **Topology is keyed by `vh.id`, not `vh.listRow`.** Don't write `vh.listRow` directly; call `part.syncListRows()` after changing `region.vhOrder`.
4. **No `localStorage` at runtime.** Working copy lives in IndexedDB via `StorageManager`.
5. **Saves are tab-owner-gated.** Preserve the `isTabOwner` check when adding write paths.

## UI Components

UI elements come from [shadcn-svelte](https://shadcn-svelte.com). Add new ones with
`pnpm shadcn-svelte add <component>` rather than building them directly on bits-ui; see
`docs/code-style.md` § UI Components.

## Adding a Command

Commands live in `src/lib/commands/`. Each command is a plain function that:

- Accepts a `HistoryStack` (or `HistoryRecorder`) and the relevant model objects
- Wraps mutations in `historyStack.tx(label, rec => { ... })` for targeted patches, or `historyStack.snapshotTx` for structural changes
- Records undo data via `rec.field(...)`, `rec.slot(...)`, `rec.oligo(...)`, etc. (see `historyChanges.ts`)

## Adding a Plugin Operation

Freeform-part plugin operations are dispatched through `src/lib/plugin/opDispatch.ts`. Add a new case to the `dispatchOp` switch and a corresponding Python-side method in `src/lib/plugin/python/foldnano_mini/mutations.py`.

## Branch Model

- `main` is the stable branch; open PRs against it.
- Feature branches: `feat/<name>`, fix branches: `fix/<name>`.
- Run `pnpm check && pnpm test:branch && pnpm lint:branch` before pushing.
- CI (GitHub Actions) runs `pnpm lint`, `pnpm check`, `pnpm test:all` and `pnpm build` on every pull request; it must pass before merging.

## AI-Assisted Contributions

We assume every pull request was made with help from AI coding agents unless its description says
otherwise. That is fine. Either way, you are responsible for the changes you submit: read and
understand them, check that they work, and be ready to explain them in review.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
