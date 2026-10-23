---
covers:
  - vite.config.ts
  - svelte.config.js
  - .husky/**
  - scripts/docs-check.ts
  - scripts/lint-changed.sh
  - scripts/screenshots-to-webp.sh
  - scripts/vite-third-party-licenses.ts
  - scripts/vite-sandbox-worker.ts
  - scripts/vite-pyodide.ts
  - vercel.json
  - .github/workflows/**
---

# Dev tooling

Build configuration, git hooks and the repo-maintenance scripts that aren't tied to one
feature area. Feature-specific scripts live with their feature's doc (e.g.
`scripts/build-plugins.mjs` and `scripts/generate-pyodide-packages.mjs` in
`docs/python-plugin-system.md`, `scripts/whats-new-draft.ts` in `docs/whats-new.md`).

## Build config

- **`vite.config.ts`** — Vite plugins (Tailwind, SvelteKit, the third-party license generator
  below), build-time constants (`__APP_VERSION__` from `package.json`, `__COMMIT_HASH__` from
  git), and the Vitest project setup (jsdom). Vitest reads this same file, so a plugin added
  here also loads during tests; gate build-only plugins with `apply: 'build'`.
- **`svelte.config.js`** — adapter (`adapter-auto`, which picks the Vercel adapter on Vercel),
  and mdsvex + Shiki for the Markdown doc site under `src/content/`.

A dirty `vite.config.ts` or `package.json` makes `vitest --changed` rerun every suite.

## Sandbox worker source (`?sandbox-worker`)

`scripts/vite-sandbox-worker.ts` resolves `import source from './x.worker.ts?sandbox-worker'` to the
worker bundled by esbuild into one self-contained ES module string, with `import.meta.env` replaced by Vite's
env object. esbuild has no `import.meta.glob`, so the plugin provides
`virtual:foldnano-python-packages` instead: every `.py` file of the bundled Python packages
(`foldnano`, `foldnano_mini`), read at bundle time, so a new module ships without touching the
worker. In dev, adding or removing a module there invalidates the bundle and reloads the page. The Python plugin sandbox starts it as a module worker from a
`data:` URL inside an opaque-origin iframe, where a `blob:` module worker fails silently (see
`docs/python-plugin-system.md` § Sandbox). It runs the same way in dev and build and registers
every bundled input as a watch file. `esbuild` is a direct devDependency for this plugin.
Other workers (e.g. rigid-body simulation) still use Vite's normal worker pipeline.

## Self-hosted Pyodide core

`scripts/vite-pyodide.ts` (`selfHostedPyodide()`, build only) emits the Pyodide core files from
the exact-pinned `pyodide` devDependency into the client build at `/pyodide/v<version>/`. Nothing
fetches them until a plugin is activated. `vercel.json` adds `Access-Control-Allow-Origin: *` (the
plugin sandbox is an opaque origin) and an immutable cache header for that path. Dev,
`pnpm preview` and Vercel preview builds don't use them (the sandbox can't fetch localhost or pass
Deployment Protection), so they load the same release from the CDN; `vite.config.ts` bakes the
preview case in as `__PYODIDE_SELF_HOSTED__`. The files are copied, not bundled, so the license generator doesn't list
Pyodide; the About dialog credits it directly. Upgrade steps: `docs/python-plugin-system.md` §
Sandbox.

## Third-party license file

`pnpm build` emits `third-party-licenses.txt` at the site root, linked from About → License.
`scripts/vite-third-party-licenses.ts` collects every `node_modules` package that ends up in the
client bundle and the worker bundles, and writes each one's name, version, license and full
license text.

- Worker bundles are built in nested builds that finish before the client's `generateBundle`,
  so one shared collector (registered in both `plugins` and `worker.plugins`) sees them all and
  the client build writes the combined file.
- SSR-only dependencies and dev tools are excluded on purpose: they never reach the user's
  browser, so there is nothing to attribute.
- Packages that omit `license` in `package.json` fall back to the heading of their `LICENSE`
  file.
- In `pnpm dev` the URL returns a one-line placeholder, so the About link never 404s.

Pyodide is loaded from its CDN at runtime and cadnano is not an npm package; both are credited
by hand in the file header, the About dialog and `THIRD_PARTY_NOTICES.md`.

## Git hooks (`.husky/`)

- **pre-commit** — `lint-staged` (Prettier on staged files), then `docs-check.ts --staged`,
  which only warns.
- **pre-push** — Git LFS. It first runs `.husky/pre-push.local` if present: an untracked,
  gitignored per-clone hook for a maintainer's own checks (e.g. a push guard). Git sends the
  pushed refs on stdin only once, so the hook buffers them and pipes them to both steps; a local
  hook that reads stdin directly would otherwise starve `git lfs pre-push` and skip LFS uploads.

## CI (`.github/workflows/ci.yml`)

GitHub Actions runs on every pull request and on pushes to `main`: a frozen-lockfile install,
then `pnpm lint` (which includes `docs:verify`), `pnpm check`, `pnpm test:all`, `pnpm build` and
`pnpm test:python` (pytest for the bundled `foldnano` / `foldnano_mini` packages, via uv), the same
commands as a local final check. Node comes from `.nvmrc` and pnpm from `package.json`
`packageManager`, so CI and local machines use the same versions. The checkout fetches Git LFS
files because the bundled plugin wheel and the doc-site `.webp` screenshots live there. `src/lib/plugin/python/.python-version` pins
the Python uv uses to the pinned Pyodide's minor version (`PYODIDE_PYTHON_VERSION`); bump both
together. The build needs no secrets: server code reads
its environment at runtime (`$env/dynamic/private`), and Vercel deploys separately.

## Repo-maintenance scripts

- **`scripts/docs-check.ts`** (`pnpm docs:check`, `pnpm docs:verify`) — reads each doc's
  `covers:` front matter, in `docs/*.md` and in the doc-site pages under `src/content/guide/` and
  `src/content/plugin-development/`. Site pages opt in (only those with `covers:` are loaded);
  they replaced the retired `docs/user-manual.md` and plugin development guide. mdsvex keeps
  `covers:` in page metadata, but the doc site reads only named fields and the agent markdown
  strips front matter. The three plugin API reference pages are also checked against the code by
  `src/lib/plugin/python/tests/test_api_reference_pages.py` (`pnpm test:python`). `docs:check` warns about covered code that changed without its doc;
  `docs:verify` fails if a doc lacks front matter, a glob matches no tracked file, or a
  backticked repo path in a doc no longer exists (gitignored paths, i.e. generated outputs, are
  accepted so a fresh clone passes). `pnpm lint` runs `docs:verify`.
- **`scripts/lint-changed.sh`** (`pnpm lint:changed`, `pnpm lint:branch`) — Prettier and ESLint
  on uncommitted files, or on everything since the merge-base with a given ref.
- **`scripts/screenshots-to-webp.sh`** (`pnpm screenshots:webp [files…]`) — converts doc-site
  screenshots under `static/screenshots/` to lossless WebP (needs `cwebp`) and deletes the PNGs.
  Screenshots are WebP, committed without Git LFS (only `*.png` is LFS-tracked); point guide
  image links at the `.webp` file.

## Boundaries / Don'ts

- Don't give `docs/architecture.md` (or `docs/reactivity-patterns.md`) a non-empty `covers:`
  list. They are cross-cutting; listing files there makes them flag on nearly every change.
- Don't hand-maintain the full dependency license list. The generated file is the complete
  record; the About dialog and `THIRD_PARTY_NOTICES.md` only credit notable packages.
- Don't cover `package.json` in any doc: dependency bumps would warn on every doc that lists it.
- Don't bundle the plugin worker through Vite's worker pipeline (`new Worker(new URL(...))`). It
  must stay a classic, self-contained string for the opaque-origin sandbox.
- Don't add steps to CI that the local commands don't have. CI should run exactly what a
  contributor can run before pushing, so a red check is reproducible locally.
- Keep the docs-check hook a warning. Blocking commits on docs makes people skip the hook.
