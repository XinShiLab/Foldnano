---
covers:
  - src/lib/plugin/**
  - src/lib/components/Editor/Plugin/**
  - scripts/build-plugins.mjs
  - scripts/gen_python_api.py
  - scripts/generate-pyodide-packages.mjs
  - scripts/vite-sandbox-worker.ts
  - scripts/vite-pyodide.ts
  - vercel.json
  - static/schemas/fplugin-v*.schema.json
---

# Python Plugin System

The plugin system lets researchers run Python tools directly in the Foldnano browser app — either by adapting existing cadnano-compatible scripts with minimal changes, or by writing new plugins that use the full Part model.

Python execution runs in a dedicated Web Worker via **Pyodide** (CPython compiled to WebAssembly), hosted in an **opaque-origin sandbox** so plugin code cannot act as the app (see § Sandbox). The main thread never blocks and the model is never mutated directly by the worker.

---

## Architecture Overview

```
MAIN THREAD
  PluginPanel.svelte              ← UI: list, install, activate, run, remove
        │
  PluginCoordinator.svelte.ts     ← lifecycle: activate → run → deactivate
        │
  PluginRegistry.svelte.ts        ← reactive map of registered plugins
        │
  PyodideWorkerBridge (bridge.ts) ← typed postMessage wrapper
        │
  SandboxedWorker (sandboxHost.ts) ← hidden <iframe sandbox="allow-scripts">, CSP
        │  (MessagePort handed to the worker at boot)
WEB WORKER (module worker from a data: URL, origin "null")
  pyodide.worker.ts               ← Pyodide runtime, runs plugin code
        │
  /foldnano/ + /foldnano_mini/ (virtual filesystem) ← bundled Python packages
```

**Separation of concerns:**

| Layer       | Responsibility                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Worker      | Python execution, stdout capture, artifact collection. Returns data — never mutates app state. |
| Sandbox     | Opaque-origin iframe + CSP around the worker: no app origin, network allowlist.                |
| Bridge      | Typed postMessage wrappers, Promise map, timeouts, streaming log callback.                     |
| Coordinator | Lifecycle sequencing, code resolution, error propagation.                                      |
| Registry    | Reactive plugin store, IndexedDB persistence.                                                  |
| Panel       | UI rendering, install dialog, user-triggered actions.                                          |

---

## Sandbox

Plugins are third-party code the user chose to run, so the trust model is "like running a script on your own machine" for the **design** (a plugin sees the design data it is given and can propose any result). The sandbox keeps that trust from extending to **the app itself**. Decided 2026-09-29 for the beta; spike evidence in `docs/explorations/plugin-sandbox-spike-2026-09-29.md`.

**How it works.** `SandboxedWorker` (`worker/sandboxHost.ts`) appends a hidden `<iframe sandbox="allow-scripts">`. Without `allow-same-origin` its origin is opaque (`null`). The iframe's `srcdoc` carries a `<meta>` CSP and a tiny bootstrap script. The host posts it the worker source and one end of a `MessageChannel`; the bootstrap starts a **classic** `blob:` worker and hands it the port (`SANDBOX_PORT_HANDOFF`). From then on, protocol traffic flows host ↔ worker over the port (transferables stay zero-copy); the iframe only reports boot failures via `window.postMessage`. `terminate()` removes the iframe, which destroys the worker and stops any running Python.

**What plugin code cannot reach:**

- The app origin: `/api/*` (the GitHub token cookie), static files, IndexedDB, Cache Storage, Web Locks, BroadcastChannel. CORS blocks reads; the `SameSite=Lax` cookies are not sent cross-site; and `src/hooks.server.ts` rejects cross-site script requests to `/api/*` via Fetch Metadata as defense in depth (see `docs/routes-guide.md`).
- Any host outside the CSP `connect-src` allowlist (`buildSandboxCsp`). The allowlist is the self-hosted Pyodide core path and the CDN package path, plus the manifest's declared `network` hosts, plus `PYPI_CONNECT_SOURCES` only when a requirement resolves from PyPI (`connectSourcesFor` in `networkPolicy.ts`). No `network` means no other network.

**Network declaration.** `network: ["api.example.org", "*.example.org", "localhost:8000"]` lists host names (no scheme or path; loopback hosts map to `http://`, everything else to `https://`), or `network: ["*"]` alone for any HTTPS host. Entries are spliced into a CSP inside an HTML attribute, so `networkEntryError` validates them strictly. `"*"` maps to `https:`, which also matches the app origin in production; CORS, the `SameSite=Lax` cookies, and the `/api/*` Fetch Metadata guard still keep the app out of reach.

**CSP per worker.** The CSP is fixed when a sandbox starts, so policy follows the worker tiers: any plugin that declares network access is classified **custom** (`classifyEnv`) and gets the custom slot with its own CSP; the shared standard worker has no network beyond the two Pyodide paths (standard plugins can't need PyPI by definition). The custom slot's warm environment is reused only when plugin id, version **and** CSP all match (`ownsCustomSlot`).

- String eval: the CSP grants `'wasm-unsafe-eval'` only.

**Blocked requests are explained.** The worker listens for `securitypolicyviolation` (`connect-src`) during a run, waits one task after Python returns (violations from a synchronous run are queued as tasks), and appends one `[sandbox] Blocked a request to <host>…` line per host to that run's logs. Safari/WebKit enforces the CSP but fires the event nowhere a script can see (not in the worker, the iframe document or on the `Worker`), so the worker also wraps `fetch` and `XMLHttpRequest`: a failed request whose URL is outside `connect-src` records its host too. The worker gets its policy in the `SANDBOX_PORT_HANDOFF` message and matches with `isConnectAllowed` (`worker/connectSources.ts`); the host set dedupes browsers that report both ways. This is diagnostics only: the browser still does the blocking, and code that bypasses the wrappers is still blocked, just without the line.

**Disclosure.** `PluginManifestInfo` shows network access and requirements grouped by `requirementSources()` (distribution / PyPI / bundled / first-party), with PyPI and `["*"]` highlighted. It is shown before every install path: the Hub, the Open dialog, and **Import zip**, which asks for review through `PluginInstallGate.requestInstall(…, { review: true })`. A Replace confirmation shows the new version and calls out a changed `network`.

**What it does not isolate:** plugins that share the standard-tier worker share one interpreter, so they can observe or monkeypatch each other's modules; and the plugin still receives the full design JSON and can return any result (validated before Apply as usual).

**Build.** The worker is imported as a string with `?sandbox-worker` (`scripts/vite-sandbox-worker.ts`, see `docs/dev-tooling.md`): esbuild bundles it as one self-contained ES module with every module of the Python packages inlined (`virtual:foldnano-python-packages`; a new `.py` file needs no worker change). The iframe starts it as a module worker from a `data:` URL (`worker-src data:`): Pyodide 314+ requires a module worker, and a `blob:` module worker fails silently in an opaque origin. A `data:` worker inherits the iframe's CSP. It must not go through Vite's worker pipeline. Pyodide itself is loaded with a dynamic `import()` of `pyodide.mjs` from the URLs in `INIT_RUNTIME`.

**Self-hosted Pyodide core.** The core (`pyodide.mjs`, `pyodide.asm.mjs`/`.wasm`, `python_stdlib.zip`, `pyodide-lock.json`; `PYODIDE_CORE_FILES`) comes from the exact-pinned `pyodide` devDependency, so `pnpm-lock.yaml` checks it, and `selfHostedPyodide()` (`scripts/vite-pyodide.ts`) emits it into the client build at `PYODIDE_CORE_PATH` (`/pyodide/v<version>/`). Distribution packages (numpy, …) still come from jsDelivr (`PYODIDE_PACKAGE_BASE_URL`, passed as `packageBaseUrl`); Pyodide checks each against the sha256 in the self-hosted lock file (`checkIntegrity`, on by default). The sandbox is cross-origin to the app, so `vercel.json` serves the core with `Access-Control-Allow-Origin: *` (and an immutable cache header; the path is versioned). The worker can't resolve app paths from its opaque origin, so the bridge resolves them (`pyodideUrls`) and sends absolute URLs in `INIT_RUNTIME`. `buildSandboxCsp` allows scripts only from the core path and connections to the core and package paths. **On loopback pages (`pnpm dev`, `pnpm preview`) the core comes from the CDN instead** (same pinned release): Chrome's local-network protection blocks the opaque-origin sandbox from fetching localhost at all, even with CORS and `Access-Control-Allow-Private-Network`. So self-hosting is exercised only on a deployed site. Vercel previews couldn't load it either: Deployment Protection redirects the sandbox's cookieless requests to the login page. So preview builds (`VERCEL_ENV=preview`, baked in as `__PYODIDE_SELF_HOSTED__` by `vite.config.ts`) also use the CDN; production self-hosts. To test self-hosting itself, build a preview without that switch and with protection off, or check production. `VITE_PYODIDE_INDEX_URL` points core and packages at another full distribution, for debugging.

**Upgrading Pyodide.** Bump the `pyodide` devDependency (exact), `PYODIDE_VERSION` and `PYODIDE_PYTHON_VERSION` together, then run `pnpm gen:pyodide-packages` (it reads the installed lock file); `pyodideConfig.spec.ts` fails on a mismatch. JS `null` reaches Python as `jsnull` since 0.28, so the worker passes `undefined` for absent inputs. Since 314 Pyodide versions follow Python (314 = Python 3.14, one major a year); a major bump changes the binary format, so compiled third-party wheels must be rebuilt, and the distribution packages move too (314 brought pandas 3). Also move `src/lib/plugin/python/.python-version` to the new Python and run `pnpm test:python`, run the bundled plugins, and update the pinned version and links in `src/content/plugin-development/`.

---

## File Structure

```
src/lib/plugin/
  types.ts                          ← PluginManifest, PythonPlugin, PluginStatus, ApplyStrategy
  manifestValidation.ts             ← validateManifest(), classifyManifest(), looksLikePluginManifest()
  PluginInstaller.ts                ← unified installer: local zip + pointer-manifest install paths
  PluginRegistry.svelte.ts          ← SvelteMap-based reactive store + IndexedDB persistence
  PluginCoordinator.svelte.ts       ← activate / run / deactivate, owns PyodideWorkerBridge
  ResultApplicator.ts               ← apply strategies: previewOnly / replacePart* / replaceRegion* / replayMutationLog*
  result-replacement-operations.ts  ← shared performReplacePart* / performReplaceRegion* ops used by ResultApplicator and design-verification
  design-verification.ts            ← dry-run reconstruction of a plugin result on a detached scratch Part, before Apply is ever offered
  plugin-result-errors.ts           ← PluginValidationError / PluginApplyError, InvariantCategory, phase display names
  result-format-validation-cadnano-json.ts   ← Result validation: shape-checks + repairs a cadnano_json plugin result
  result-format-validation-foldnano-json.ts  ← Result validation: shape-checks a foldnano_json plugin result
  worker/
    protocol.ts                     ← shared WorkerRequest / WorkerResponse discriminated unions
    bridge.ts                       ← PyodideWorkerBridge
    bridge.spec.ts                  ← vitest unit tests for the bridge
    sandboxHost.ts                  ← SandboxedWorker (opaque-origin iframe host) + buildSandboxCsp()
    sandbox-worker.d.ts             ← types for `?sandbox-worker` and `virtual:foldnano-python-packages`
    pyodide.worker.ts               ← Web Worker entry point (INIT_RUNTIME / RUN_PLUGIN / …)
    pyodideConfig.ts                ← PYODIDE_VERSION pin, core path, pyodideUrls()
  python/foldnano/
    __init__.py
    plugin.py                       ← PluginContext class
    io.py                           ← cadnano_json / foldnano_json helpers
    vh.py, oligo.py                 ← VirtualHelixProxy, OligoProxy (Phase 6 live mode)
    document.py, part.py            ← PartProxy (Phase 6 live mode)
  python/foldnano_mini/
    __init__.py                     ← mutable plugin entrypoint
    loader.py                       ← load_part(...)
    mutations.py                    ← mutation-log vocabulary (KNOWN_OPS)
    invariants.py                   ← pre-log validation helpers
    checks.py                       ← Check (truthy can_* result), InvalidOperationError
    topology.py                     ← occupancy index (rebuilt lazily per op generation)
    lattice.py                      ← potential crossover sites (port of latticeOffsets.ts)
    editing.py                      ← editor-level edits planned on a scratch mirror copy
    repeat.py                       ← repeat-group mirror sync (port of repeatGroups.ts) + apply_op
    repeat_group.py                 ← MutableRepeatGroup, RepeatInstance, MirrorInfo
    transport.py                    ← offline mirror transport
    part.py, region.py, vh.py, oligo.py, plane.py
  python/tests/fixtures/foldnano_mini_parity.golden.json ← host verdicts, written by foldnanoMiniParity.spec.ts
  python/tests/fixtures/foldnano_mini_replay.golden.json ← Python log + predicted state, replayed by foldnanoMiniReplay.spec.ts
  python/tests/fixtures/foldnano_mini_repeat_replay.golden.json ← repeat-group log + state, replayed by foldnanoMiniRepeatReplay.spec.ts
  python/example_all_ops.py         ← standalone CPython script exercising every op kind; run with `python example_all_ops.py`
  core_plugins/
    design_stats.fplugin.json       ← demo plugin manifest (previewOnly, cadnano_json)
    staple_colorizer.fplugin.json   ← demo plugin manifest (replaceRegionKeepAnnotationsWhereMatched, cadnano_json)
    nick_remover.fplugin.json       ← demo plugin manifest (replaceRegion, cadnano_json)
    sequence_report.fplugin.json    ← demo plugin manifest (previewOnly, foldnano_json)
    gc_colorizer.fplugin.json       ← demo plugin manifest (replacePartKeepAnnotationsWhereMatched, foldnano_json)
    crossover_analyzer.fplugin.json ← demo plugin manifest (previewOnly, cadnano_json, zip bundle)
    staple_colorizer_mini.fplugin.json ← demo plugin manifest (replayMutationLogInRegion, foldnano_mini)
    mutation_test.fplugin.json      ← demo plugin manifest (replayMutationLog, foldnano_mini)
    hello_world.fplugin.json        ← demo plugin manifest (replaceRegionKeepAnnotationsWhereMatched, cadnano_json, minimal inline entrypoint)
    pyOrigamiBreak.fplugin.json     ← demo plugin manifest (replaceRegion, cadnano_json, custom-tier: numpy/pandas/matplotlib + cadnano2_5_mini wheel)
    side_panel_form_demo.fplugin.json ← demo plugin manifest (previewOnly, foldnano_json, form side panel)
  scriptLabManifest.ts              ← built-in Script Lab manifest + starter templates

src/lib/components/Editor/Plugin/
  PluginPanel.svelte                ← sidebar panel component

static/plugins/
  design_stats/plugin.py            ← demo: helix stats + CSV artifact
  staple_colorizer/plugin.py        ← demo: golden-ratio HSL palette on staple strands
  nick_remover/plugin.py            ← demo: join adjacent staple nicks
  sequence_report/plugin.py         ← demo: per-oligo CSV report using foldnano_json
  gc_colorizer/plugin.py            ← demo: GC-based color gradient using foldnano_json
  staple_colorizer_mini/plugin.py   ← demo: region-scoped recolor via foldnano_mini
  mutation_test/plugin.py           ← demo: every foldnano_mini op kind; used to verify JS replay end-to-end
  crossover_analyzer/
    plugin.py                       ← demo (multi-file): orchestration entry point
    analyzer.py                     ← demo (multi-file): crossover extraction module
    report.py                       ← demo (multi-file): CSV + summary statistics module
  hello_world/plugin.py             ← demo: minimal inline entrypoint
  pyOrigamiBreak/                   ← demo (multi-file, wheel dep): thermodynamic staple-break optimizer
  side_panel_form_demo/plugin.py    ← demo: host-rendered form side panel
  cadnano_mini/v0.1.0/*.whl         ← pinned standard-extra wheel referenced by STANDARD_ENV_EXTRAS
```

Each `static/plugins/<dir>/` is packaged into `<dir>.zip` by `pnpm build:plugins`
(`scripts/build-plugins.mjs`), which injects the matching
`core_plugins/<name>.fplugin.json` as the zip's authoritative `fplugin.json`.
The generated zips are gitignored build artifacts.

---

## Plugin Packaging (one format: zip)

Every file/URL-delivered plugin is a single **zip bundle**:

```
my_plugin.zip
├── fplugin.json    ← manifest (required, at zip root — the authoritative copy)
├── plugin.py       ← Python entrypoint (required, at zip root, exactly this name)
├── *.py / assets   ← any supporting files (subfolders allowed)
└── *.whl           ← wheels listed as bare filenames in requirements
```

Both install routes converge on the same installer (`PluginInstaller.ts`):

- **Local**: the user imports the `.zip` directly (Import zip button, or
  dropping/opening the file).
- **Hub**: a pointer manifest in `core_plugins/` whose `entrypointUrl` points
  at a zip the app serves. The zip is fetched **at install time**, and the
  manifest **inside the zip** is what gets registered — the pointer is only a
  locator, and its `id` must match the inner manifest's `id`.

There is no user-facing pointer route: the paste-a-manifest dialog was removed
for beta, and opening a bare `.fplugin.json` is refused by `fpluginParser`
(`STANDALONE_MANIFEST_MESSAGE`) — it only recognizes manifests so they don't
fall through to a design parser with a confusing error.

The full zip is stored in IndexedDB at install; **activation never fetches**.
A missing/version-mismatched files record puts the plugin in `needs-reinstall`.

The one exception is **runtime-code plugins** (Script Lab and third-party
`sidePanel.codeEditor.execution: "entrypoint"` plugins): their source is the
editor buffer supplied at run time, so they are registered from the manifest
alone and carry only a placeholder inline `entrypoint`.

## Plugin Manifest (`.fplugin.json`)

A plugin is declared as a JSON file:

```json
{
	"schemaVersion": 2,
	"id": "my-router",
	"name": "My Router",
	"version": "1.0.0",
	"format": "cadnano_json",
	"applyStrategy": "replaceRegionKeepAnnotationsWhereMatched",
	"entrypointUrl": "/plugins/my_router/my_router.zip",
	"requirements": ["numpy"]
}
```

All fields are typed in `src/lib/plugin/types.ts`:

| Field           | Type                                                   | Description                                                                                               |
| --------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | `1 \| 2`                                               | Manifest schema version. Missing = `1`; shipped manifests always write it. See § Manifest versioning.     |
| `$schema`       | `string?`                                              | JSON Schema reference for editors; ignored.                                                               |
| `x-…`           | `unknown`                                              | Author metadata, top level only; ignored.                                                                 |
| `id`            | `string`                                               | Unique identifier and registry key; must match `PLUGIN_ID_PATTERN` (checked at install only).             |
| `name`          | `string`                                               | Human-readable display name.                                                                              |
| `version`       | `string`                                               | Semver, `PLUGIN_VERSION_PATTERN` (checked at install only).                                               |
| `format`        | `"cadnano_json" \| "foldnano_json" \| "foldnano_mini"` | Input/output format (see below). `"live"` is reserved for a future phase and is rejected at install time. |
| `applyStrategy` | see below                                              | How the host applies the plugin result.                                                                   |
| `entrypoint`    | `string?`                                              | Placeholder inline source — only valid for `sidePanel.codeEditor` plugins with `execution: "entrypoint"`. |
| `entrypointUrl` | `string?`                                              | URL of the plugin `.zip` bundle, fetched at install time. Mutually exclusive with `entrypoint`.           |
| `requirements`  | `string[]?`                                            | micropip packages or wheel URLs installed at activation. See **Wheel URL restrictions** below.            |
| `network`       | `string[]?`                                            | Hosts the plugin may contact, or `["*"]`. Omitted/empty = none. Enforced by the sandbox CSP (§ Sandbox).  |
| `description`   | `string?`                                              | Optional human-readable description.                                                                      |
| `icon`          | `string?`                                              | v2 only. Path of an SVG inside the plugin zip; see § Plugin icons.                                        |
| `parameters`    | `PluginParamDef[]?`                                    | User-configurable parameters shown in a dialog before each run (see below).                               |
| `sidePanel`     | `PluginSidePanelManifest?`                             | Optional host-rendered side panel request using built-in `form` or `codeEditor` surfaces.                 |

### Manifest versioning

`schemaVersion` versions the manifest **format**, the way `formatVersion` versions `.fn.json` designs; the plugin's own `version` is unrelated (it keys the file cache). `validateManifest` checks it first:

- **Missing:** read as `1` (see below).
- **Newer than `MANIFEST_SCHEMA_VERSION`:** refused with "needs a newer version of Foldnano", before any field is looked at, so an old app never half-understands a new manifest.
- **Unknown fields:** rejected at every level (`MANIFEST_V1_FIELDS`, `MANIFEST_V1_NESTED_FIELDS`). This is what gives the version teeth: a new field can't ship without a version bump, because older apps would reject it rather than ignore it. Top-level `x-` fields are the author escape hatch.

**Missing means 1, forever** (`DEFAULT_MANIFEST_SCHEMA_VERSION`, not the current version), like `.fn.json` files without a header. `withSchemaVersion` fills it in, so `validateManifest` returns, and `PluginRegistry` loads from IndexedDB, manifests with an explicit version. This is safe only because of two rules: unknown fields are rejected (a newer field used without declaring its version fails loudly), and **an existing field never changes meaning** in a later version; add a new field instead. A stored manifest newer than the app is flagged `needs-reinstall`.

**Published schemas:** `static/schemas/fplugin-v<N>.schema.json` (JSON Schema 2020-12), one per version and all kept online, documented for authors in `src/content/plugin-development/04-plugin-manifest.md`. `manifestSchema.spec.ts` keeps them in lockstep: every shipped manifest must pass the schema of its own `schemaVersion` and `validateManifest`, each schema's field lists must equal `manifestFieldsFor(N)`, and network-entry rules must agree.

**Versions:** v1 is the original field set (`MANIFEST_V1_FIELDS`). v2 (`MANIFEST_V2_FIELDS`) adds top-level `icon`; nested objects are unchanged. A v1 manifest that uses `icon` is refused with a message naming `schemaVersion`. Owned plugins (Script Lab) always write the current version.

**Bumping the version:** add the field to the validator and its field lists, raise `MANIFEST_SCHEMA_VERSION` (and the `schemaVersion` literal type), publish `fplugin-v<N>.schema.json` next to the old one, and update the author docs.

**Install-time identity rules.** `validateManifest` requires `id` to match `PLUGIN_ID_PATTERN` and `version` to be semver (`PLUGIN_VERSION_PATTERN`); the published schema carries the same patterns (`manifestSchema.spec.ts` checks they match). `validateManifest` runs only on install paths, so plugins installed before these rules (checked 2026-09-30) keep loading; tightening a v1 field this way is the exception the versioning policy allows only because it never touches stored manifests.

### Plugin parameters

If `parameters` is set, clicking **Run** opens a dialog pre-filled with defaults (or last-used values). The confirmed values are passed to Python as `ctx.params` / `ctx.get_param()`. Plugins with no `parameters` array fire immediately on **Run** with no dialog.

Each entry in the `parameters` array is a `PluginParamDef`:

| Field                  | Type                                            | Description                                                 |
| ---------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| `id`                   | `string`                                        | Key the plugin receives in `ctx.params`.                    |
| `label`                | `string`                                        | Label shown in the run dialog.                              |
| `type`                 | `"string" \| "number" \| "boolean" \| "select"` | Input type.                                                 |
| `default`              | `string \| number \| boolean`                   | Pre-filled value (also used on first open).                 |
| `description`          | `string?`                                       | Hint text shown below the input.                            |
| `required`             | `boolean?`                                      | If true, an empty/NaN value prevents submit. Default false. |
| `min` / `max` / `step` | `number?`                                       | Constraints for `number` inputs.                            |
| `options`              | `(string \| {value, label})[]?`                 | Option list for `select` inputs.                            |

Example:

```json
"parameters": [
  {
    "id": "palette",
    "label": "Palette style",
    "type": "select",
    "options": [
      { "value": "golden_ratio", "label": "Golden ratio" },
      { "value": "rainbow",      "label": "Rainbow" }
    ],
    "default": "golden_ratio"
  },
  {
    "id": "saturation",
    "label": "Saturation (%)",
    "type": "number",
    "default": 72,
    "min": 0,
    "max": 100,
    "step": 1
  },
  {
    "id": "colorize_scaffold",
    "label": "Colorize scaffold",
    "type": "boolean",
    "default": false
  }
]
```

`entrypoint` and `entrypointUrl` are mutually exclusive — setting both is a
validation error. For packaged plugins `entrypointUrl` is required and must
point to a `.zip` bundle (checked by parsed URL pathname, so query strings like
`plugin.zip?v=2` work). Raw `.py` entrypoint URLs are no longer supported.
`entrypointUrl` can be:

- A relative path to a `.zip` bundle served from `static/` (e.g. `/plugins/my_plugin/my_plugin.zip`)
- An absolute URL on the app's **own origin** (§ Same-origin installs); anything else is refused

The manifest **inside** a zip may omit `entrypointUrl` entirely — the installer
knows the files are in the zip. Inline `entrypoint` is only legal for
runtime-code (code-editor `execution: "entrypoint"`) plugins.

### Same-origin installs

Beta supports two ways to get a plugin: what ships with the app (the Hub, built-ins) and a local `.zip` the user imports. Anything the app would **fetch** must come from its own origin, checked by `isSameOriginUrl()` in `manifestValidation.ts`:

- **`entrypointUrl`** (Hub pointer manifests, and the inner manifest if it restates one) must resolve to the app's origin. Other hosts are refused with a hint to download the zip and use **Import zip**.
- **Wheel requirements:** a bare filename (`"pkg-1.0-py3-none-any.whl"`) must be in the zip, stored at install and never fetched; a path or URL must resolve to the app's origin. `PluginCoordinator` re-checks at activation before fetching, so a manifest stored before this rule can't pull an external wheel.
- **Other requirements** must be plain package names: a path, a URL, or a PEP 508 direct reference (`"pkg @ https://…"`) is refused. Names micropip resolves from PyPI stay allowed (disclosed to the user; see § Sandbox for the network allowlist).

`isSameOriginUrl` resolves the URL against the page instead of pattern-matching `http(s)://`, which also catches protocol-relative `//host/…` and whitespace-prefixed URLs that `fetch()` would otherwise send elsewhere. It fails closed when there is no page location.

Installing from other websites (with a user-chosen list of trusted sources, and content hashes) is a planned post-beta feature; see `docs/code_review/todo/beta-release-checklist.md` § After the beta.

### Plugin side panels

Plugins may declare a host-rendered `sidePanel` in the manifest. The plugin does not ship UI code; it can only opt into one of the host-owned surfaces:

- `type: "form"` — upper section renders `sidePanel.form.fields`, lower section renders plugin output and apply actions
- `type: "codeEditor"` — upper section renders a built-in Python editor, lower section renders plugin output and apply actions

Rules:

- `sidePanel.form.fields` uses the same field schema as `parameters`
- `parameters` and `sidePanel.form.fields` are mutually exclusive
- `sidePanel.icon` is limited to a host-owned enum: `form`, `code`, `analysis`. **Deprecated** for packaged plugins in favour of the top-level `icon` (§ Plugin icons), which wins when both are set; still honoured, and the enum won't grow. Runtime-code plugins have no zip, so it stays their only icon
- `sidePanel.codeEditor.execution` controls what the editor contents mean:
  - `"input"` (default) — run the manifest entrypoint and pass the editor contents to Python via `ctx.get_side_panel_code()`
  - `"entrypoint"` — execute the editor contents themselves as the plugin source for that run
- arbitrary asset URLs and plugin-defined components are not supported; the only plugin-supplied artwork is the bundled `icon`

Installing a plugin with `sidePanel` adds a dedicated sidebar tab next to the built-in GitHub and Plugin tabs.

### Plugin icons

A v2 manifest may name an SVG inside its zip: `"icon": "icon.svg"` (`PLUGIN_ICON_PATH_PATTERN`: a relative path, no segment starting with `.`). It is drawn on the plugin's sidebar tab (in place of the `sidePanel.icon` glyph) and on its Plugins list row.

- **Checked at install** (`PluginInstaller` → `bundledIconSvg` in `pluginIcon.ts`): the file must be in the zip, at most `MAX_PLUGIN_ICON_BYTES` (32 KB), parse as an SVG-namespace `<svg>` with a `viewBox`, and contain no scripts, event handlers, `foreignObject`/`image`/animation elements, DOCTYPE/entities, or references other than `#fragment`. Runtime-code manifests can't use `icon` (they have no zip).
- **Stored, not re-read:** `PluginRegistry` reads the icon again from the files record on every install/replace/save (`readPluginIcon`) and keeps the validated text as `iconSvg` on the `plugins` record and on `PythonPlugin`. Startup loads it from the record only while the manifest still names an icon; drawing never unzips.
- **Drawn as a CSS mask** (`PluginIcon.svelte`): a `data:` URL used as `mask-image`, filled with `currentColor`. Masks can't run scripts or fetch, and the icon follows the sidebar's muted/active colours and dark mode, so plugin icons are always one colour.
- **Precedence:** `manifest.icon` → `sidePanel.icon` → the panel type's default glyph (`toPluginSidePanelDescriptors` in `Editor/sidePanels.ts`).
- **Owned plugins** bundle theirs as `icon.svg`, chosen in Save as Plugin or the editor's Icon button; see `docs/script-lab.md` § Owned plugins.
- **Not yet:** the Plugin Centre lists pointer manifests before install, so it shows no icons.

### Code-editor execution modes

There are two distinct host behaviors for `sidePanel.type: "codeEditor"`.

#### `execution: "input"` (default)

Use this when the plugin has a fixed Python entrypoint but wants the user to author code-like input in the editor.

Behavior:

- the host executes the manifest's resolved Python entrypoint
- the current editor contents are forwarded as side-panel input
- Python reads the contents with `ctx.get_side_panel_code()`

This is the right model for "code as data" workflows such as custom expressions, templated snippets, or DSL-like inputs.

#### `execution: "entrypoint"`

Use this when the editor buffer itself is the Python source of truth.

Behavior:

- the host still launches a normal plugin run
- but `PluginCoordinator` replaces the resolved manifest entrypoint with the current editor contents for that invocation
- the same editor contents are still forwarded as side-panel input, so Python may also inspect them via `ctx.get_side_panel_code()`
- the run sets `loadImports`, so the worker loads the Pyodide distribution packages the source imports before running it (the editor source has no `requirements`; see script-lab.md § Packages from imports)

This is the model used by the built-in Script Lab plugin. See [script-lab.md](script-lab.md) for the full reference architecture.

### Format types

| `format`        | Python receives / returns            | Data preserved                                                                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cadnano_json`  | Classic cadnano JSON string          | Topology and colors. **Lossy**: sequences, modifications, and oligo names are dropped. Foldnano's `Oligo.isScaffold` flag is **not** read or written — cadnano IO is purely topological; the `scaf` / `stap` array assignment is a file-format directional adapter (see `docs/cadnano-import.md`), not a scaffold-identity claim.       |
| `foldnano_json` | Part-level JSON via `Part.toJSON()`  | Everything — sequences, modifications, oligo names, `isScaffold` flag, UUIDs.                                                                                                                                                                                                                                                           |
| `foldnano_mini` | `foldnano_json` in, mutation log out | Direct Python-side mutations captured as a structured op log and replayed against the existing JS `Part` in one undo step. `vh.id`, `oligo.id`, and `seg.id` are the canonical cross-runtime identifiers. Newly added lattice `vh.index` values in Python are mirror-local and may differ from the host-assigned JS index after replay. |
| `live`          | _(blocked — reserved for Phase 6)_   | Lossless, direct in-worker model access via Python proxy objects. Manifests declaring `format: "live"` are rejected at install time. The `"live"` value is preserved in the `PluginFormat` union type for forward-compatibility but must not be used in released plugins.                                                               |

### Apply strategies

| `applyStrategy`                            | Description                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `replacePartKeepAnnotationsWhereMatched`   | Whole-part replacement for `foldnano_json` plugins. Re-grafts sequences / mods / names onto segments at exactly matched coordinates. Unmatched segments are warned. |
| `replacePart`                              | Whole-part replacement for `foldnano_json` plugins. No annotation re-grafting. Shows a data-loss warning before apply.                                              |
| `replaceRegionKeepAnnotationsWhereMatched` | Region replacement for `cadnano_json` plugins. Re-grafts matched annotations inside the active latticed region and restores cross-region links.                     |
| `replaceRegion`                            | Region replacement for `cadnano_json` plugins without annotation re-grafting. Cross-region links are restored where possible.                                       |
| `replayMutationLog`                        | Replay a `foldnano_mini` mutation log against the current part under one undo step.                                                                                 |
| `replayMutationLogInRegion`                | As above, but every target VH must stay inside the recorded active region or the replay aborts cleanly.                                                             |
| `previewOnly`                              | Output shown as a diff only; never written to the model. Suitable for analysis plugins.                                                                             |

Install-time validation rejects unsupported format/strategy pairs:

- `cadnano_json`: `previewOnly`, `replaceRegion`, `replaceRegionKeepAnnotationsWhereMatched`
- `foldnano_json`: `previewOnly`, `replacePart`, `replacePartKeepAnnotationsWhereMatched`
- `foldnano_mini`: `previewOnly`, `replayMutationLog`, `replayMutationLogInRegion`

---

## Plugin Lifecycle

```
REGISTERED   ← plugin installed (zip stored in IndexedDB); code not yet loaded
     │
ACTIVATING   ← loading cached zip from IndexedDB, init Pyodide, micropip install
     │
ACTIVE       ← ready to run; Run button becomes available
     │
RUNNING      ← Python executing in the worker; logs stream in real time
     │   │
  ACTIVE   REGISTERED ← stopPlugin() called: worker terminated, all active plugins reset
     │         │
     │    (auto-reactivates if no requirements, e.g. ScriptLab)
     │
ERROR        ← on failure; errorMessage set; plugin stays ACTIVE for retry
     │
DEACTIVATED  ← explicit deactivate (available but not yet surfaced in UI)
```

Pyodide (~13 MB WASM) is loaded once on the first `activate()` call and reused for all subsequent runs via a single persistent Worker per editor session.

---

## Python API (`foldnano.plugin.PluginContext`)

Every plugin receives a single `ctx` argument in its `run(ctx)` function.

```python
from foldnano.plugin import PluginContext

def run(ctx: PluginContext) -> None:
    ...
```

### Input

```python
ctx.get_part_as_cadnano_json(part_index: int = 0) -> str
    # Returns the active part as a cadnano JSON string.
    # Only valid when manifest format == "cadnano_json".

ctx.get_part_as_foldnano_json(part_index: int = 0) -> str
    # Returns the active part as a Foldnano JSON string (Part.toJSON() schema).
    # Only valid when format == "foldnano_json", "foldnano_mini", or "live".

ctx.format -> str
    # "cadnano_json" | "foldnano_json" | "foldnano_mini" | "live"

ctx.active_region_id -> str | None
    # ID of the host region that was active when the plugin was launched.
    # Used by region-scoped replace/replay strategies and by foldnano_mini
    # plugins that want region-aware helper methods.

ctx.params -> dict
    # All parameter values confirmed in the run dialog.
    # Empty dict when the plugin declares no parameters.

ctx.get_param(key: str, default=None)
    # Return a single parameter value, or default if not set.
    # Number inputs are delivered as Python float/int, not str.

ctx.side_panel_type -> str | None
    # "form" | "codeEditor" when the plugin was launched from a side panel.

ctx.get_side_panel_code(default: str = "") -> str
    # Returns the current code editor contents for codeEditor side panels.
    # Returns default when no code payload was supplied.
    # For execution="input" plugins, this is usually the primary purpose of
    # the editor. For execution="entrypoint" plugins, this returns the same
    # source code the host executed for that run.
```

### Output

```python
ctx.set_result_cadnano_json(json_str: str) -> None
    # Store the modified design as cadnano JSON. Host applies it via applyStrategy.

ctx.set_result_foldnano_json(json_str: str) -> None
    # Store the modified design as Foldnano JSON (Part.toJSON() schema).

ctx.set_result_mutation_log(log: list[dict]) -> None
    # Store a foldnano_mini mutation log. Only valid when format == "foldnano_mini".
    # The host replays the log via replayMutationLog / replayMutationLogInRegion.

ctx.log(msg: str) -> None
    # Append a line to the plugin log. Streams to the UI in real time.

ctx.write_artifact(name: str, data: str | bytes) -> None
    # Store a named artifact (CSV, PDB, etc.). Displayed in the output panel.

ctx.set_result(data: dict) -> None
    # Store a structured JSON-serialisable dict. Displayed in the output panel.
```

`ctx.log()` also writes to stdout, so `print()` calls are captured too.

For `foldnano_mini` plugins, prefer `vh.id` over `vh.index` whenever you need a stable handle across Python and JS. The offline Python mirror may assign a provisional `vh.index` to newly created lattice helices before the host replays the mutation log.

### Example — cadnano_json mode

```python
from foldnano.plugin import PluginContext
import json

def run(ctx: PluginContext) -> None:
    data = json.loads(ctx.get_part_as_cadnano_json())

    num_helices = len(data.get("vstrands", []))
    ctx.log(f"Design has {num_helices} virtual helices")

    # Return the design unchanged
    ctx.set_result_cadnano_json(json.dumps(data))
    ctx.set_result({"num_helices": num_helices})
```

### Example — foldnano_json mode

Use `parse_foldnano_json()` from `foldnano.io` to get typed proxy objects instead of working with raw dicts:

```python
from foldnano.plugin import PluginContext
from foldnano.io import parse_foldnano_json
import json

def run(ctx: PluginContext) -> None:
    part = parse_foldnano_json(ctx.get_part_as_foldnano_json())

    for oligo in part.oligos:
        if oligo.is_scaffold:
            continue
        ctx.log(f"{oligo.name or oligo.id[:8]}  len={len(oligo.sequence)}  segs={len(oligo.segments)}")

    # Mutate _raw in-place and return (e.g. change a color)
    part._raw["oligos"][0]["color"] = "#ff0000"
    ctx.set_result_foldnano_json(json.dumps(part._raw))
```

The complete proxy API is on the doc site's API reference pages (`src/content/plugin-development/`: Context, Parse and foldnano_mini); `tests/test_api_reference_pages.py` fails when they drift from the code.

---

## Worker Message Protocol

Defined in `src/lib/plugin/worker/protocol.ts`.

### Main → Worker (requests)

```typescript
{ type: 'INIT_RUNTIME' }

{ type: 'INSTALL_PLUGIN';
    requestId: string;        // plugin ID
    requirements: string[];   // micropip package names
}

{ type: 'RUN_PLUGIN';
    requestId: string;        // equals the plugin ID (used to route streaming PLUGIN_LOG messages)
    pluginCode?: string;      // mutually exclusive with pluginZipData
    pluginZipData?: ArrayBuffer;
    pluginLabel: string;
    format: 'cadnano_json' | 'foldnano_json' | 'foldnano_mini' | 'live';
    cadnanoJsonIn?: string;
    foldnanoJsonIn?: string;
    activePartIndex: number;
    paramsJson?: string;      // JSON-encoded Record<string, unknown>; omitted when no parameters
    activeRegionId?: string | null;
    loadImports?: boolean;    // load distribution packages pluginCode imports first (code-editor runs);
                              // with pluginZipData too (owned-plugin draft) the zip runs, pluginCode is only scanned
}

{ type: 'RESOLVE_IMPORTS';  // which distribution packages provide code's imports (owned-plugin requirements)
    requestId: string;
    code: string;
}
```

### Worker → Main (responses)

```typescript
{ type: 'RUNTIME_READY' }
{ type: 'RUNTIME_ERROR'; error: string }

{ type: 'INSTALL_DONE';  requestId: string }
{ type: 'INSTALL_ERROR'; requestId: string; error: string }

{ type: 'PLUGIN_RESULT';
    requestId: string;
    primaryArtifact: string | null;   // cadnano or Foldnano JSON out
    artifacts: Record<string, string | Uint8Array>;
    pluginResult: Record<string, unknown> | null;
    mutationLog: Record<string, unknown>[] | null;  // foldnano_mini only
    logs: string[];
}
{ type: 'PLUGIN_ERROR';  requestId: string; error: string; traceback: string }
{ type: 'PLUGIN_LOG';    requestId: string; message: string }  // streaming

{ type: 'IMPORTS_RESOLVED'; requestId: string; packages: string[] }  // sorted package names
{ type: 'IMPORTS_ERROR';    requestId: string; error: string }
```

`PLUGIN_LOG` messages are emitted during execution and delivered to the plugin's `logs` array in real time via `PyodideWorkerBridge`'s `onLog` callback. They do **not** resolve the run Promise — only `PLUGIN_RESULT` or `PLUGIN_ERROR` do.

---

## PyodideWorkerBridge

**File:** `src/lib/plugin/worker/bridge.ts`

Typed wrapper around the Pyodide Web Worker.

### Design goals

- **Sandboxed by default** — the default `workerFactory` returns a `SandboxedWorker`; see § Sandbox.
- **Lazy creation** — the Worker is not spawned until `initRuntime()` is first called.
- **Idempotent init** — `initRuntime()` returns the same Promise on repeated calls while init is in flight.
- **Promise map** — each in-flight request is tracked by `requestId` so concurrent installs and runs proceed independently.
- **Timeouts** — 120 s for runtime init (Pyodide downloads ~13 MB); 30 s for install; 300 s for run. All three are injectable via the `timeouts` option (used by tests to avoid wall-clock delays).
- **Retry after error** — if `RUNTIME_ERROR` is received, `readyPromise` is cleared so the next `initRuntime()` starts fresh.
- **Testability** — optional `workerFactory` (any `WorkerLike`) lets tests inject a `MockWorker` without touching the real Worker constructor.

### Constructor

```typescript
new PyodideWorkerBridge({
    onLog?: (requestId: string, message: string) => void,
    workerFactory?: () => WorkerLike,  // default: SandboxedWorker
    timeouts?: {
        initMs?: number,    // default: 120_000 ms
        defaultMs?: number, // default:  30_000 ms (used for install)
        runMs?: number,     // default: 300_000 ms
    },
})
```

`PluginCoordinator` wires `onLog` to deliver streaming log lines to the matching plugin's `logs` array. `requestId` equals the plugin ID, so the registry lookup routes correctly:

```typescript
new PyodideWorkerBridge({
	onLog: (requestId, message) => {
		// requestId === pluginId, so this lookup always finds the right plugin
		const plugin = this.registry.get(requestId);
		if (plugin) plugin.logs.push(message);
	},
});
```

### Public API

```typescript
initRuntime(): Promise<void>
installPlugin(requestId: string, requirements: string[]): Promise<void>
runPlugin(options: Omit<RunPluginRequest, 'type'>): Promise<PluginResultResponse>
terminate(): void   // kills the worker (and any running Python); rejects all in-flight promises immediately
```

---

## PluginRegistry

**File:** `src/lib/plugin/PluginRegistry.svelte.ts`

Reactive store of all registered plugins, backed by IndexedDB.

### Reactive design

The registry uses `SvelteMap<string, PythonPlugin>` for the plugin collection. Individual plugins are stored as `PluginState` instances — a class with `$state` class fields:

```typescript
class PluginState implements PythonPlugin {
    manifest: PluginManifest;
    status: PluginStatus        = $state('registered');
    resolvedCode: string | null = $state(null);
    errorMessage: string | null = $state(null);
    logs: string[]              = $state([]);
    artifacts: Record<…>        = $state({});
    pluginResult: …             = $state(null);
    paramValues: Record<string, unknown> = $state({});  // initialised from manifest defaults
}
```

`paramValues` is seeded at registration time from each `PluginParamDef.default`. After the user confirms the run dialog the panel writes the new values back, so the next open shows last-used values rather than defaults.

This means external mutations like `plugin.status = 'activating'` (done by `PluginCoordinator`) automatically propagate to the UI without any extra plumbing.

**Why `SvelteMap` and not plain `Map`?** Plain `Map.set()` and `.delete()` are not tracked by Svelte 5. `SvelteMap` wraps them in reactive operations, so adding or removing a plugin triggers re-renders of the plugin list.

### Persistence

The manifest is persisted for user-installed plugins, with `iconSvg` when it names an icon (§ Plugin icons). Plugins made from Script Lab also carry `authoring` (ownership; makes them editable) and `draftCode` (unsaved edit) on the same record; see `docs/script-lab.md` § Owned plugins. For plugins with a `codeEditor` side panel, the current editor buffer (`sidePanelCode`) is also persisted — stored as an unindexed field in the same `plugins` table record. The panel saves it through `EditorCodeSaver` (debounced, awaited, flushed on close; see `docs/script-lab.md` § Editor code persistence). Runtime state (`status`, `logs`, `artifacts`) is ephemeral.

```typescript
// Write path (fire-and-forget)
register(manifest)                      →  foldnanoIndexedDb.savePlugin(...)
remove(id)                              →  foldnanoIndexedDb.deletePlugin(id)
persistEditorCode(pluginId, code)       →  foldnanoIndexedDb.savePluginEditorState(...)

// Read path (async, called once in constructor)
constructor()  →  this.ready = this.#loadFromStorage()
```

`registry.ready` is a `Promise<void>` that resolves once the initial IndexedDB load completes. Render the plugin list only after `await registry.ready` to avoid a flash of empty state.

### Public API

```typescript
register(manifest: PluginManifest): PythonPlugin
remove(id: string): boolean
get(id: string): PythonPlugin | undefined
get all(): PythonPlugin[]
persistEditorCode(pluginId: string, code: string): Promise<void>  // rejects on failure; EditorCodeSaver shows it
registerNew(manifest, files, { authoring? })   // authoring marks a plugin made from Script Lab
replaceConfirmed(manifest, files)              // an owned plugin stays owned only if the editor can handle the new package
saveOwnedVersion(manifest, files)              // owned plugins only; clears the draft; PluginVersionConflictError if another tab saved first
persistDraft(pluginId, code | null)            // owned plugins only
markExported(pluginId, version)
ready: Promise<void>
```

---

## PluginCoordinator

**File:** `src/lib/plugin/PluginCoordinator.svelte.ts`

Orchestrates the plugin lifecycle. Owns the worker bridges — one per environment tier (see § Environment tiers below):

- `standardBridge` — persistent worker shared by all **standard**-tier plugins.
- `customSlot` — at most one resident **custom**-tier worker, tagged with its `envOwner` (plugin id + manifest version).

### `activate(pluginId)`

1. **Custom tier only:** frees the custom worker slot (`evictCustomSlotFor`). If another custom plugin owns the slot, that plugin's worker is terminated and it is reset to `'registered'`; its owner-owned `pendingApply` is discarded. Re-activation of the _same_ plugin at the _same_ manifest version keeps the warm environment. The UI must have confirmed destructive evictions first via `getActivationImpact(pluginId)` (see below).
2. Sets `plugin.status = 'activating'`.
3. Loads the cached `IndexedDbPluginFilesRecord` from IndexedDB (the `pluginFiles` table).
4. Resolves Python code by package kind (`classifyManifest`):
   - **runtime-code** (code-editor `execution: "entrypoint"`) → placeholder `manifest.entrypoint`; the real source is the editor buffer at run time.
   - **packaged** → the zip stored at install time (record must exist with `manifestVersion === manifest.version`); a miss sets `needs-reinstall` and throws. Activation never fetches plugin code.
   - **legacy** (pre-zip shapes) → sets `needs-reinstall` and throws.
5. Resolves the tier's bridge (`ensureBridgeFor`, creating the worker lazily) and calls `bridge.initRuntime()` (no-op if already ready).
6. Separates `manifest.requirements` into micropip package names and wheels:
   - **Standard extras** (bare names in `STANDARD_ENV_EXTRAS`, e.g. `cadnano2_5_mini`) resolve to their pinned first-party wheel URL.
   - **Micropip packages** (`'numpy'`, etc.) are passed as-is and installed by micropip inside Python.
   - **Bundled wheels** (bare `.whl` filenames) come from the install-time cache; **URL / absolute-path wheels** are fetched on the main thread (with IndexedDB caching). All wheels are sent to the worker as `ArrayBuffer` transferables and written to the Pyodide VFS.
7. Calls `bridge.installPlugin(pluginId, micropipPackages, preloadedWheels)`.
8. Sets `plugin.status = 'active'` on success, `'needs-reinstall'` for legacy/missing-file cases, or `'error'` with `errorMessage` on other failures. If the worker was deliberately terminated mid-activation (stop or eviction), the plugin quietly returns to `'registered'` instead.

### `getActivationImpact(pluginId)`

Pure query called by the UI **before** `activate()` to determine whether an eviction confirmation is needed (`PluginActivationGate` / `PluginActivationConfirmDialog`). Returns `{ runningPluginId, pendingApplyPluginId, pendingResultToken, evictedPluginIds, requiresConfirmation }`:

- Standard-tier target, empty custom slot, or same-owner-same-version re-activation → no impact.
- Custom-tier target while another custom plugin owns the slot: `requiresConfirmation` is true when the owner is `running`/`activating` or holds an unapplied result; an idle-`active` owner is evicted silently (the UI shows a passive toast instead of a dialog).
- `pendingResultToken` is copied from the owner's `pendingApply.resultToken` whenever `pendingApplyPluginId` is set. This token is created once, when the result itself is created. If there is no pending result, it is `null`. `getActivationImpact()` therefore never creates a new token itself.

`PluginActivationGate.confirmPending()` calls `getActivationImpact()` again immediately before activation. It then compares `runningPluginId`, `pendingApplyPluginId`, and `pendingResultToken` with the impact currently shown in the dialog.

If any of these values changed, the warning is updated and activation stops until the user confirms again. If the impact changes again before that confirmation, the same check is repeated.

`requiresConfirmation` is derived from `runningPluginId` and `pendingApplyPluginId`, so it does not need to be compared separately. The same applies to `evictedPluginIds`: if the current owner has running work or an unapplied result, that is already captured by the compared fields. A change between two idle owners does not discard any work and therefore does not require another confirmation.

Activation only proceeds when `runningPluginId`, `pendingApplyPluginId`, and `pendingResultToken` still match the impact the user confirmed.

**File caching details:** The plugin zip and `.whl` wheel bytes are stored in IndexedDB under the `pluginFiles` table, keyed by plugin ID, at **install time**. The record is validated against `manifest.version` — bump the version in `fplugin.json` whenever the plugin files change. Micropip packages (PyPI packages like `numpy`) are **not** cached here; Pyodide handles those internally.

### Environment tiers (standard / custom)

Dependency isolation follows a two-tier model. `classifyEnv(manifest)` in `src/lib/plugin/envClassification.ts` decides a plugin's tier statically from its manifest:

- **`standard`** — no declared `network`, and every `requirements` entry is either an unversioned name from the pinned Pyodide distribution or a standard-extra name (no other wheels). Plugins with no requirements (e.g. Script Lab) are trivially standard.
- **`custom`** — anything else: declared network access (keeps the shared worker network-free), off-dist package names (their versions float on PyPI; `pypiRequirements` lists them), any version specifier (even one matching the dist version), or any `.whl` entry.

**Standard tier** shares one persistent worker. Installs are conflict-free by construction — every member package's version is determined by the Pyodide pin — so the installed union just grows; switching between standard plugins never reinstalls. Plugin _code_ stays isolated per run (fresh module namespace, `sys.modules` purge), but **library state** (`np.seterr`, `pd.set_option`, …) is shared — hence the "don't mutate global library configuration" rule in the dev guide.

**Custom tier** gets one dedicated worker with single-active semantics: activating custom plugin B evicts custom plugin A (confirm dialog if A is busy or holds an unapplied result; silent toast if idle). The custom→custom switch cost (teardown + reinstall) is accepted and surfaced in the UI. Custom-tier churn never touches the standard worker. Total residency is bounded at two Pyodide instances.

Classification only **routes** plugins — it never refuses them (`SUPPORTED_REQUIREMENTS_ALLOWLIST` in `manifestValidation.ts` is a separate, currently permissive gate). The UI badges each plugin's tier in the plugin list, the install dialog, and the Hub, and every run's log starts with a reproducibility stamp such as `[env] pyodide-0.29.5 · standard`.

**The standard environment, concretely:**

| Component        | Definition                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity / label | The pinned Pyodide version (`PYODIDE_VERSION` in `src/lib/plugin/worker/pyodideConfig.ts`, currently `314.0.7`, Python 3.14). Upgrading it _is_ the env version bump.           |
| Dist packages    | The package set of that Pyodide release, vendored in `src/lib/plugin/pyodideDistPackages.json` (regenerate with `pnpm gen:pyodide-packages`).                                   |
| Standard extras  | First-party pinned wheels in `STANDARD_ENV_EXTRAS` (`envClassification.ts`). Currently: `cadnano2_5_mini` 0.1.0. Authors write the bare name; the host resolves the pinned URL. |

The `cadnano2_5_mini` wheel (`static/plugins/cadnano_mini/`, Git LFS) is served to every user, so it must contain only the package and its license files. When rebuilding it from the fork, leave out bytecode (`__pycache__`, `*.pyc`), `.pytest_cache`, `.DS_Store` and `cadnano/tests/`, and check that no file embeds a local path (compiled bytecode records the build machine's absolute paths). The 0.1.0 wheel was repacked this way on 2026-10-07, with its code unchanged.

Built-in plugins are seeded directly by `PluginRegistry` and are not installed through the Hub. Today Script Lab is the main built-in plugin; it is tagged with `origin: "builtin"` and cannot be removed via `PluginRegistry.remove()`.

### `run(pluginId)`

```typescript
async run(pluginId: string): Promise<void>
```

1. Validates plugin is `'active'` and has resolved code.
2. Clears previous logs / artifacts / result; sets `plugin.status = 'running'`.
3. Serializes the active Part to the format declared in the manifest (`cadnano_json`, `foldnano_json`, or `foldnano_mini`) and captures a foldnano snapshot for annotation re-grafting / mutation-log replay.
4. Reads `plugin.paramValues` (written by the panel from the run dialog) and JSON-encodes them as `paramsJson`.
5. Uses `pluginId` as `requestId` and calls `bridge.runPlugin(...)`. Using `pluginId` (not a fresh UUID) ensures the `onLog` callback can route streamed log lines back to the correct plugin via `registry.get(requestId)`.
6. On success: populates `plugin.logs`, `plugin.artifacts`, `plugin.pluginResult`; sets status back to `'active'`.
7. For non-`previewOnly`, non-replay strategies, the raw `result.primaryArtifact` is checked **before** `pendingApply` is ever created:
   - **Result validation** (`result-format-validation-cadnano-json.ts` / `-foldnano-json.ts`) shape-checks the JSON against the declared format. Some issues are silently repaired (e.g. a one-sided connection pointer is cleared when the other end is free, so `pyOrigamiBreak`-style plugins don't need to emit fully reciprocal pointers); everything else is rejected.
   - **Design verification** (`design-verification.ts`) then reconstructs the result with the same `perform*` ops `ResultApplicator` uses, but against a **detached scratch `Part`** — never `doc.parts`, never inside a `tx` — and checks the rebuilt part for dangling plane/region/segment references, out-of-bounds segments, broken reciprocal connections, and (for region strategies) an unchanged active-region VH index set.
   - If either check throws (`PluginValidationError`), `plugin.status = 'error'` is set with that message and **no** `pendingApply` is created for that run.
     `replayMutationLog[InRegion]` results skip both checks and go straight to step 8 once the log is non-empty — op-level validation happens at replay time via `dispatchOp` instead.
8. If checks pass, the (possibly repaired) result is stored in `coordinator.pendingApply` along with a fresh `resultToken`. The UI shows a diff summary; the user must call `confirmApply()` (or `cancelApply()`) before the model is mutated.
9. `confirmApply(pluginId)` calls `ResultApplicator.applyResult()` inside `historyStack.snapshotTx` (undoable) — this is the only path that writes to `doc.parts`. Snapshot strategies consume `primaryArtifact`; mutation-log strategies consume `mutationLog`. If `applyResult()` itself throws, `pendingApply` is cleared and a `PluginApplyError` is reported instead of leaving a half-applied result. `cancelApply(pluginId)` discards the pending result without applying. While another tab owns the document (`setEditGate`, wired to `isTabOwner`), `confirmApply()` does nothing and keeps the result, and the Apply button is disabled; runs stay allowed (see `docs/multi-tab-protection.md`).
10. On run failure: sets status to `'error'`, sets `plugin.errorMessage`. Logs captured before the error are preserved. The run harness catches `BaseException`, not just `Exception`: plugins written as command-line tools call `sys.exit()`, and an uncaught `SystemExit` shuts the whole Pyodide runtime down with no message (pyOrigamiBreak does this when the scaffold is too short or no solution exists). It reports the failure as Python's one-line summary (`traceback.format_exception_only`, e.g. `SystemExit: …` or `KeyError: 'x'`), because `str(exc)` is empty for many exceptions. Failures outside the plugin's Python report the JavaScript stack instead of a traceback; an empty message falls back to `RUN_FAILED_WITHOUT_MESSAGE`, and `PluginRunOutput` shows the error box and traceback whenever the status is `'error'`, so a failed run is never just a red icon.

### `stopPlugin(pluginId)`

Stops a currently running plugin by terminating **its tier's** Pyodide Web Worker. Because `runPythonAsync()` cannot be interrupted mid-execution, termination is the only reliable way to halt a hung script.

After termination (blast radius is per-bridge):

- The stopped plugin transitions back to `'registered'` (not `'error'`) — the stop is treated as intentional. Its own `pendingApply` (if any) is cleared.
- **Standard tier:** other standard-tier plugins that were `'active'` or `'activating'` are also reset to `'registered'`, because their installations died with the shared worker. Custom-tier plugins are untouched.
- **Custom tier:** only the stopped plugin is affected — the standard worker and every standard-tier plugin keep running.
- Plugins with no `requirements` (such as Script Lab) are automatically re-activated so the user can run again without a manual Activate click.
- Plugins with requirements must be re-activated manually — the worker is respawned lazily on the next `activate()`.

The `_stoppedPluginIds` set on the coordinator marks deliberate terminations (user stop or custom-slot eviction) so the `runWithOptions` / `activate` catch blocks can distinguish them from genuine runtime errors — no error banner is shown for deliberate stops.

For `sidePanel.type: "codeEditor"` plugins, `runWithOptions(...)` may also receive `sidePanelInput`.

- in normal `execution: "input"` mode, the host runs the resolved manifest code and forwards `sidePanelInputJson`
- in `execution: "entrypoint"` mode, if `sidePanelInput.type === "codeEditor"`, the host executes `sidePanelInput.code` as `pluginCode` for that run

This override happens on the main thread in `PluginCoordinator`; the worker does not special-case Script Lab or any other plugin.

---

## The `foldnano` And `foldnano_mini` Python Packages

The worker bundles both Python packages at build time from one import,
`virtual:foldnano-python-packages` (provided by `scripts/vite-sandbox-worker.ts`, see
`docs/dev-tooling.md`): every `.py` file under `python/foldnano/` and `python/foldnano_mini/`,
keyed `'<package>/<module>.py'`. Don't list modules by hand in `pyodide.worker.ts`; a new module
is picked up automatically.

All files are written to Pyodide's virtual filesystem at `INIT_RUNTIME` time, so both `from foldnano.plugin import PluginContext` and `from foldnano_mini import load_part` work in every plugin regardless of network availability.

### Generated API stubs and completion index

`scripts/gen_python_api.py` (`pnpm gen:python-api`) reads both packages with `ast` (never imports them) and writes, from one pass:

- `src/lib/plugin/python/stubs/<package>/__init__.pyi`: every name in the package's `__all__`, with real signatures and full docstrings, plus the unexported helpers/aliases those names use. One file per package so an author (or their coding agent) can read the whole surface at once.
- `src/lib/plugin/python/stubs/<package>/<module>.pyi`: re-export shims so `from foldnano.plugin import PluginContext` type-checks against the stubs.
- `src/lib/plugin/python-api-index.generated.json`: members per class (inherited members flattened, setter-backed properties marked `settable`, including a subclass's `@Base.prop.setter` on an inherited property), function signatures and first-paragraph docs. Script Lab autocomplete reads it (`docs/script-lab.md` § API autocomplete).

What's public is decided by each package's `__init__.py` `__all__`: a new proxy method appears once it's on an exported class; a new class needs an `__all__` entry. Point a type checker at the stubs with `MYPYPATH=src/lib/plugin/python/stubs` (or pyright `stubPath`).

`python-completions.spec.ts` runs the generator with `--check` (skipped when `python3` is missing) and globs the package sources into its import graph, so `pnpm test` reruns it whenever a `.py` file changes. When it fails, run `pnpm gen:python-api` and commit the outputs.

### Run harness

Each plugin execution runs inside an isolated module namespace:

```python
_ns = types.ModuleType('_plugin')
exec(compile(_plugin_code, '<plugin>', 'exec'), _ns.__dict__)
_ctx = PluginContext(
    format=_format,
    cadnano_json_in=…,
    foldnano_json_in=…,
    params_json=_params_json,   # JSON string from the run dialog; None when no parameters
)
_ns.run(_ctx)
```

stdout and stderr are redirected to a `LogCapture` (`foldnano/_log_capture.py`, host-internal). It buffers `write()` calls and splits on newlines, because `print('a', 'b')` arrives as four writes: each log entry is one printed line, blank lines are dropped, and an unterminated last line is kept. Lines are returned in `logs` after the run completes; the worker does not currently send streaming `PLUGIN_LOG` messages, although the bridge still handles them.

This isolation matters especially for `execution: "entrypoint"` plugins such as Script Lab:

- the Pyodide runtime is reused across runs
- but the user script is executed in a fresh module namespace each time
- previous top-level variables from the last editor run are not preserved

After each run (success or error) all Pyodide globals used by the harness (`_plugin_code`, `_plugin_zip`, `_format`, `_cadnano_json_in`, etc.) are deleted so large JSON strings and zip buffers can be garbage-collected between runs.

### Run serialization

`RUN_PLUGIN` messages are processed one at a time through a module-level promise queue:

```typescript
let runQueue: Promise<void> = Promise.resolve();

// In onmessage RUN_PLUGIN case:
runQueue = runQueue.then(task, task);
```

This prevents a second `RUN_PLUGIN` arriving while the first `runPythonAsync()` is still in flight from overwriting the shared Pyodide globals that the first run is reading. The queue is the only guarantee: a timed-out run keeps executing until its worker is terminated.

### Size limits

Nothing a plugin supplies or produces is held in memory unbounded. Download and unpack limits are in `src/lib/plugin/sizeLimits.ts`; run-output limits are enforced in the worker, so an oversized result never reaches the page.

| What                                | Limit                                                                     | Where                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin zip (import or Hub download) | 50 MB (`MAX_PLUGIN_ZIP_BYTES`)                                            | `readResponseCapped` streams and aborts past the limit; the local import checks the file size                                                                                                                              |
| Wheel fetched at activation         | 50 MB (`MAX_WHEEL_BYTES`)                                                 | `readResponseCapped` in `PluginCoordinator.activate`                                                                                                                                                                       |
| Zip contents once unpacked          | 200 MB (`MAX_PLUGIN_UNZIPPED_BYTES`)                                      | `unzipCapped` sums declared sizes in fflate's `filter` before inflating; fflate inflates into a buffer of the declared size, so a lying header can't grow past it. Used by the installer and the Open dialog's zip preview |
| Run log                             | 5,000 lines of ≤ 10,000 characters, then one `[output truncated: …]` line | `LogCapture` (`foldnano/_log_capture.py`); a runaway print loop keeps bounded memory until the run timeout                                                                                                                 |
| Artifacts of one run                | 100 MB total (`MAX_ARTIFACT_BYTES` in `foldnano/plugin.py`)               | `write_artifact` refuses at the call site; the run harness re-checks `ctx.artifacts` (writes that bypass `write_artifact`) before serializing, and fails the run                                                           |

The primary result (`primary_artifact`) and the mutation log are not capped: they are the design itself and go through Result validation and Design verification.

### Run timeout

`runPlugin` rejects with `RunTimeoutError` after 300 s. Python can't be interrupted, so `PluginCoordinator.run()` then terminates that plugin's tier worker (`terminateTierOf`, shared with `stopPlugin`), shows the timeout as the plugin's error, and clears its resolved code so the UI offers **Activate** rather than **Run** (the environment died with the worker). Standard-tier bridge-mates are reset to `'registered'` exactly as for Stop.

---

## ResultApplicator

**File:** `src/lib/plugin/ResultApplicator.ts`

Applies a plugin's `primaryArtifact` back to the model after a successful run. All mutations are wrapped in `historyStack.snapshotTx` so the change is a single undoable step.

The actual whole-part / region reconstruction (`performReplacePart`, `performReplacePartKeepAnnotations`, `performReplaceRegion`, `performReplaceRegionKeepAnnotations`) lives in `result-replacement-operations.ts`, shared with `design-verification.ts`'s pre-Apply dry run against a scratch `Part`. `ResultApplicator` itself only owns history/undo wiring and console diagnostics (cross-region link messages, annotation-match warnings) around calling those shared ops for real.

### Strategies

| Strategy                                                     | Behaviour                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `previewOnly`                                                | No-op. Result is visible in the plugin log/output panel only.                                                                                                                                                                                                                                                |
| `replacePart`                                                | Deserializes the returned JSON into a new `Part` and swaps it directly into `doc.parts[partIndex]`. All UUIDs are regenerated. No annotation re-grafting.                                                                                                                                                    |
| `replacePartKeepAnnotationsWhereMatched`                     | Deserializes the returned JSON, then re-grafts sequences, skip/insert structure, modifications, and oligo names from the pre-run foldnano snapshot onto any segment whose coordinates (VH index, strand index, 5' bp, 3' bp) are unchanged. Unmatched segments get no sequence. New Part is then swapped in. |
| `replaceRegion` / `replaceRegionKeepAnnotationsWhereMatched` | Replaces only the active latticed region, preserves unaffected regions, restores cross-region links, and optionally re-grafts matched annotations inside the target region.                                                                                                                                  |
| `replayMutationLog` / `replayMutationLogInRegion`            | Replays a `foldnano_mini` mutation log against the existing JS `Part` inside one history transaction, through `replayMutationLog()` in `opDispatch.ts` (see below). The region-scoped variant rejects any op that targets a VH outside the recorded active region.                                           |

### Mutation-log replay and repeat groups

`replayMutationLog(part, log, options)` (`opDispatch.ts`) is the one replay loop:
`ResultApplicator` and the replay specs both use it. It dispatches op by op and throws
`MutationReplayError` naming the failing op. When the part has repeat groups it also runs
`syncRepeatGroups` after every op except attribute writes (color, name, scaffold flag,
modification, slot sequence), and after every group op. `foldnano_mini` rebuilds mirrors
in Python after each op (`foldnano_mini/repeat.py` `apply_op`), so a later op in the log
may use bases a mirror just left; syncing only at the end of the transaction would hit
the stale mirror. Attribute writes can't move a mirror, so they wait for the
transaction's sync (Python copies them onto mirrors in place, with the same result).

`dispatchOp` refuses any op whose target oligo (by `oligoId`, `segmentId` or a `connect`
end) is a mirror, with `MIRROR_EDIT_ERROR`; an edit that changes a mirror indirectly
(a skip on the strand opposite) is caught by the per-op sync. Group ops carry
Python-allocated `groupId` / `instanceId` / `name`, adopted by `createRepeatGroup` /
`addRepeatInstance`. Mirror ids are not shared: the host gives its mirrors fresh ids
and Python derives them as `<source id>@<instance id>`; no op refers to a mirror.

### Coordinate key for annotation matching

```
"${vhIdx}:${strandIdx}:${fivePrimeIdx}:${threePrimeIdx}"
```

`strandIdx` is derived from `fivePrimeIdx < threePrimeIdx ? 0 : 1` (strandSet 0 runs 5'→3' ascending).

### ID regeneration

`replacePart` and `replacePartKeepAnnotationsWhereMatched` both create a new `Part` from the deserialized JSON, so all `VirtualHelix`, `Oligo`, and `OligoSegment` UUIDs are freshly generated after each run. This is expected — coordinate-based matching is used, not ID matching.

For `foldnano_mini` replay, ids are shared across Python and JS for newly created entities during the run. Python allocates ids against the current offline mirror, the host adopts them verbatim, and replay/model code still rejects duplicates as a hard invariant. This removes replay's dependence on Python predicting JS numbering, but it does not make newly added offline lattice `vh.index` values authoritative after replay.

---

## Integration: EditorViewContext

`PluginRegistry` and `PluginCoordinator` are instantiated in `EditorViewContext` and provided via Svelte context:

```typescript
// EditorViewContext.svelte.ts
pluginRegistry = new PluginRegistry();
pluginCoordinator = new PluginCoordinator(
	this.pluginRegistry,
	() => this.currentDoc,
	() => this.historyStack
);
```

The getter functions are evaluated lazily at run-time, so they always return the current `currentDoc` / `historyStack` values even after a document load replaces them.

Any component can access them:

```typescript
const editorCtx = getEditorViewContext();
const registry = $derived(editorCtx.pluginRegistry);
```

`PluginCoordinator.terminate()` is called when the editor unmounts to clean up the Pyodide worker.

---

## Integration: Sidebar Panel

The editor uses a VSCode-style icon sidebar. Built-in tabs cover source control and plugin management, and installed plugins may contribute their own sidepanel tabs through the manifest:

```
│ ← icon strip →│← active panel →│
│  [git icon]    │                 │
│  [plugin icon] │  PluginPanel    │
│  [plugin tab]  │  Plugin side UI │
```

Clicking the active icon collapses the panel (toggle). Only one panel is visible at a time.

---

## Writing a Plugin

Every plugin is a zip — a single-file plugin is just a zip with one `plugin.py`.

### 1. Author the files

```
my_plugin/
  fplugin.json    ← manifest (the authoritative copy — it ships inside the zip)
  plugin.py       ← entry point, exactly this name
  helper.py       ← optional supporting modules / assets
```

```python
# my_plugin/plugin.py
from foldnano.plugin import PluginContext
from helper import analyse   # resolves via /plugin_run/helper.py

def run(ctx: PluginContext) -> None:
    import json
    data = json.loads(ctx.get_part_as_cadnano_json())
    stats = analyse(data.get("vstrands", []))
    ctx.log(f"Done: {stats}")
    ctx.set_result(stats)
```

The manifest inside the zip may omit `entrypointUrl`:

```json
{
	"schemaVersion": 2,
	"id": "my-plugin",
	"name": "My Plugin",
	"version": "1.0.0",
	"format": "cadnano_json",
	"applyStrategy": "previewOnly"
}
```

### 2. Build the zip (files at root, no directory prefix)

```bash
cd my_plugin
zip my_plugin.zip fplugin.json plugin.py helper.py
```

Bundled (core) plugins are built automatically by `pnpm build:plugins`
(`scripts/build-plugins.mjs`): source lives in `static/plugins/<dir>/`, the
manifest in `src/lib/plugin/core_plugins/<name>.fplugin.json` with
`entrypointUrl: "/plugins/<dir>/<dir>.zip"`, and the script zips the dir and
injects the manifest as the zip's `fplugin.json`. Generated zips are
gitignored; the script is chained into `pnpm dev` / `pnpm build`.

### 3. Install

- **Local:** click **Import zip** in the plugin panel (or open the `.zip` via
  the file dialog). Works offline; nothing needs hosting.
- **Bundled with the app:** put the zip under `static/plugins/` and add a
  pointer manifest to `core_plugins/`; the Hub installs it. Pointer manifests
  from other websites are refused (§ Same-origin installs).

**How the worker runs a zip:**

1. The stored zip bytes are written to the Pyodide VFS at `/plugin.zip`.
2. Extraction places every file at `/plugin_run/<filename>` (path-traversal-checked).
3. `/plugin_run/` is prepended to `sys.path`; `plugin.py` is the entry point, so
   `from helper import ...` resolves against the zip's other files.

### With numpy (or other packages)

Add `"requirements": ["numpy"]` to the manifest. The package is installed via micropip during `activate()`.

```python
import numpy as np

def run(ctx):
    ctx.log(f"numpy {np.__version__}")
    arr = np.array([1, 2, 3])
    ctx.set_result({"mean": float(arr.mean())})
```

To ship a wheel inside the zip, add the `.whl` at the zip root and list its
bare filename in `requirements` (e.g. `"mypkg-1.0-py3-none-any.whl"`). Wheels
served by the app itself (paths or same-origin URLs) are fetched at activation.

### Caveats

- Installed plugin files live in IndexedDB; clearing browser data removes them. The user must re-import.
- `manifest.version` must be bumped when files change — the cache is keyed on version.
- Plugins installed before the zip unification are flagged `needs-reinstall` and must be re-imported.

---

## Demo Plugins

### Design Statistics (`previewOnly`)

**Manifest:** `src/lib/plugin/core_plugins/design_stats.fplugin.json`
**Source:** `static/plugins/design_stats/plugin.py`

Demonstrates:

- Packaged zip plugin installed from a pointer manifest
- `"requirements": ["numpy"]`
- Multiple helper functions (grid analysis, strand occupancy, GC-content simulation)
- CSV artifact output via `ctx.write_artifact()` — appears as a download link in the plugin panel
- Structured result via `ctx.set_result()`
- Graceful fallback when no cadnano JSON is provided (synthetic 10-helix demo design)
- `applyStrategy: previewOnly` — never mutates the model

To try it:

1. Start the dev server (`pnpm dev`)
2. Open the Plugin panel → **Hub** → **Install** on Design Statistics
3. Switch to **My Plugins**
4. Click **Activate** (loads the installed zip, installs numpy — ~30 s first time)
5. Click **Run** — logs show grid stats, occupancy summary, GC-content estimate; a `design_stats.csv` download link appears under "Artifacts"

---

### Staple Colorizer (`replaceRegionKeepAnnotationsWhereMatched`)

**Manifest:** `src/lib/plugin/core_plugins/staple_colorizer.fplugin.json`
**Source:** `static/plugins/staple_colorizer/plugin.py`

Demonstrates:

- **Plugin parameter system** — five parameters covering all four input types (`select`, `number`, `boolean`); opening Run shows a dialog pre-filled with defaults
- Modifying `stap_colors` in cadnano JSON (purely cosmetic topology change)
- `replaceRegionKeepAnnotationsWhereMatched` — the active region is replaced; sequences, modifications, and oligo names are re-grafted onto coordinate-matched segments inside that region
- Reads `palette`, `hue`, `saturation`, `lightness`, and `colorize_scaffold` from `ctx.get_param()`; logs received values at the start so you can verify they came through
- The plugin is **deterministic**: re-running it with the same parameters assigns the same palette again (idempotent). Use Ctrl+Z to revert.

---

### Nick Remover (`replaceRegion`)

**Manifest:** `src/lib/plugin/core_plugins/nick_remover.fplugin.json`
**Source:** `static/plugins/nick_remover/plugin.py`

Demonstrates:

- `applyStrategy: replaceRegion` — region-scoped topology operation; sequences are **not** preserved for replaced segments
- Detecting adjacent staple nicks: position _i_ is a 3' end (`stap[i][2] == -1`) and position _i+1_ is a 5' end (`stap[i+1][0] == -1`) on the same helix
- Connecting the nick by writing `stap[i][2..3]` and `stap[i+1][0..1]` with the current helix number and adjacent bp index
- Scaffold strands are intentionally left unchanged

> **Data-loss note:** Because `replaceRegion` replaces the active region from the returned cadnano JSON, any sequences or modifications on changed segments in that region will be lost. Use Ctrl+Z to restore the original design.

---

### Sequence Report (`previewOnly`, `foldnano_json`)

**Manifest:** `src/lib/plugin/core_plugins/sequence_report.fplugin.json`
**Source:** `static/plugins/sequence_report/plugin.py`

Demonstrates:

- `format: foldnano_json` — only possible with this format since cadnano JSON carries no sequence data
- `parse_foldnano_json()` proxy API: `oligo.sequence`, `oligo.segments`, `seg.vh_index`, `seg.five_prime_modification`, `seg.three_prime_modification`, `seg.length`
- Graceful handling of unsequenced designs: `gc_pct` is left blank when no sequence is assigned; `length` falls back to topology (`sum(seg.length)`)
- Homopolymer run detection via `re.search(r"(.)\1{3}", seq)` — flags potential synthesis problems
- CSV artifact output via `ctx.write_artifact("sequence_report.csv", ...)`
- Structured result dict via `ctx.set_result({...})`

CSV columns: `name, length, gc_pct, has_run, mods, segment_count, vh_indices, sequence`

---

### GC Colorizer (`replacePartKeepAnnotationsWhereMatched`, `foldnano_json`)

**Manifest:** `src/lib/plugin/core_plugins/gc_colorizer.fplugin.json`
**Source:** `static/plugins/gc_colorizer/plugin.py`

Demonstrates:

- `foldnano_json` round-trip mutation: parse → mutate `part._raw` → return via `set_result_foldnano_json`
- Using sequence data to drive color assignments — impossible with `cadnano_json`
- Mutating `part._raw["oligos"][i]["color"]` in-place (the `._raw` dict is the canonical mutation surface)
- Handling of N-placeholder sequences: strips `"N"` chars before computing GC so unsequenced oligos are correctly skipped rather than colored as AT-rich
- HSL → RGB gradient: GC=0% → red (`#cc3300`), GC=100% → blue (`#0044cc`), using the same `hsl_to_rgb` helper pattern as `staple_colorizer`
- `pendingApply` confirm/cancel flow: changes are held until the user confirms in the diff preview

### Crossover Analyzer (`previewOnly`, zip bundle)

**Manifest:** `src/lib/plugin/core_plugins/crossover_analyzer.fplugin.json`
**Sources:** `static/plugins/crossover_analyzer/` (`plugin.py`, `analyzer.py`, `report.py`)
**Bundle:** `static/plugins/crossover_analyzer/crossover_analyzer.zip`

Demonstrates:

- **Multi-file zip plugin**: three Python modules bundled into one zip; `plugin.py` imports `from analyzer import ...` and `from report import ...`
- Crossover counting: scans every vstrand's `scaf` and `stap` arrays; records the departure side only (no double-counting); keyed by `(min_vh, max_vh)` to canonicalize helix pairs
- `ctx.write_artifact("crossovers.csv", ...)` — per-pair CSV download
- `ctx.set_result({...})` — aggregate summary shown in the output panel
- `applyStrategy: previewOnly` — no model mutation

**Module split:**

| Module        | Responsibility                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `analyzer.py` | Data extraction — scans `vstrands`, returns `dict[(vh_a, vh_b), {scaf, stap}]`                         |
| `report.py`   | Presentation — `build_csv()` formats the per-pair CSV; `build_summary()` computes aggregate statistics |
| `plugin.py`   | Orchestration — reads JSON, calls analyzer + report, writes artifact, logs summary                     |

The split is genuine: `analyzer.py` is pure data logic with no I/O; `report.py` is pure formatting with no analysis. Either module can be reused or tested in isolation.

---

## Testing

Bridge unit tests live in `src/lib/plugin/worker/bridge.spec.ts` and run with vitest in jsdom.

```bash
pnpm vitest run src/lib/plugin/worker/bridge.spec.ts
```

The tests use a `MockWorker` class that implements the same `onmessage` / `postMessage` / `terminate` surface as a real Web Worker:

```typescript
class MockWorker {
	onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
	postMessage = vi.fn();
	terminate = vi.fn();

	respond(msg: WorkerResponse): void {
		this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
	}
}
```

Injected via `workerFactory`:

```typescript
bridge = new PyodideWorkerBridge({
	workerFactory: () => mockWorker as unknown as Worker,
});
```

Timeout tests use the `timeouts` option to avoid Vitest's wall-clock limit:

```typescript
const shortBridge = new PyodideWorkerBridge({
	workerFactory: () => mockWorker as unknown as Worker,
	timeouts: { runMs: 500 },
});
vi.useFakeTimers();
// … run and advance timers …
vi.advanceTimersByTime(501);
await expect(p).rejects.toThrow(/timed out/);
vi.useRealTimers();
```

Coverage: `initRuntime` idempotency, RUNTIME_ERROR retry, concurrent installs and runs, injectable timeout rejection, `PLUGIN_LOG` streaming, worker `onerror` propagation.

---

## What's Next

| Status   | Description                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Done     | Core bridge, registry, coordinator, result applicator.                                                                                                                                                                                                                                                                                                                             |
| Done     | `cadnano_json` demo plugins: `design_stats`, `staple_colorizer`, `nick_remover`.                                                                                                                                                                                                                                                                                                   |
| Done     | `foldnano_json` demo plugins: `sequence_report`, `gc_colorizer`.                                                                                                                                                                                                                                                                                                                   |
| Done     | `pendingApply` confirm/cancel flow with diff summary in the plugin panel.                                                                                                                                                                                                                                                                                                          |
| Done     | **Unified zip packaging** — every file/URL-delivered plugin is one zip (`fplugin.json` + `plugin.py` + assets); the inner manifest is authoritative; both local and pointer installs converge on `PluginInstaller`; the worker extracts to `/plugin_run/` on `sys.path`. Core zips are generated by `pnpm build:plugins`. Legacy inline/.py records are flagged `needs-reinstall`. |
| Done     | **Plugin parameter system** — `parameters` array in the manifest; `PluginRunDialog` shown on Run when parameters exist; `ctx.params` / `ctx.get_param()` in Python. Demo: `staple_colorizer` (v1.1.0).                                                                                                                                                                             |
| Done     | **Mutation-log replay API** — `foldnano_mini`, `replayMutationLog`, `replayMutationLogInRegion`, offline mirror tests, and demo plugins such as `staple_colorizer_mini` and `mutation_test`.                                                                                                                                                                                       |
| Done     | **Host-rendered side panels** — `form` and `codeEditor` side panels, including `codeEditor.execution` modes (`input` and `entrypoint`).                                                                                                                                                                                                                                            |
| Done     | **Built-in Script Lab** — always-available `foldnano_mini` code-editor plugin that executes the editor buffer as the runtime entrypoint.                                                                                                                                                                                                                                           |
| Done     | **Stop / cancellation** — `stopPlugin(pluginId)` terminates the Pyodide worker, resets all active plugins to `'registered'`, and auto-reactivates plugins with no requirements (Script Lab). Stop buttons added to the ScriptLab panel, form side panel, and My Plugins list.                                                                                                      |
| Done     | **Result validation + Design verification** — `replacePart*` / `replaceRegion*` results are shape-checked and reconstructed on a detached scratch `Part` before `pendingApply` is ever created; `confirmApply()` also catches a failing real Apply and surfaces `PluginApplyError` instead of leaving a half-applied result.                                                       |
| Deferred | **Live proxy API** — direct in-worker model proxy objects (`format: "live"`). The type is still reserved, but manifests declaring it are rejected by `validateManifest()`.                                                                                                                                                                                                         |

---

## Boundaries / Don'ts

- Don't hand-edit `python/stubs/**` or `python-api-index.generated.json`; change the Python source (signature, annotation, docstring, `__all__`) and regenerate.

This file is for **Foldnano developers** working on the host side of the plugin system. Plugin authors should read the doc site's Plugin Development pages (`src/content/plugin-development/`).

- **The worker never mutates the app model.** It returns artifacts and (for `foldnano_mini`) a structured mutation log. The main thread applies them via `ResultApplicator` inside `historyStack.snapshotTx` — one undo step per plugin run.
- **Don't change what an existing manifest field means** in a new schema version; add a new field. Unversioned manifests are read as v1, so a changed meaning would be misread silently.
- **Don't add a manifest field without bumping `schemaVersion`** and publishing a new schema. Older apps must refuse a manifest they can't fully understand, and `manifestSchema.spec.ts` fails until the schema and validator agree.
- **Don't render a plugin icon as markup.** No `{@html}`, inline `<svg>` or `<object>`: draw `iconSvg` through `PluginIcon.svelte` (CSS mask). Validation is defence in depth, not a sanitizer.
- **Don't bypass `validateManifest`.** It is the only enforcement point for `format` × `applyStrategy` compatibility (e.g. `replayMutationLog*` requires `foldnano_mini`; `live` is rejected).
- **Don't offer `pendingApply` for an unchecked result.** For non-replay strategies, `runWithOptions()` must run Result validation (`result-format-validation-*.ts`) and Design verification (`design-verification.ts`) on `result.primaryArtifact` before creating `pendingApply` — both run against a detached scratch `Part`, never `doc.parts`. `confirmApply()` still wraps the real `ResultApplicator.applyResult()` call in a try/catch (`PluginApplyError`) as a last-resort net, but it should not be the first place a malformed result is caught.
- **Don't assume all `codeEditor` side panels execute editor code directly.** `execution: "input"` remains the default; `execution: "entrypoint"` is an explicit opt-in.
- **Don't share a single `PyodideWorkerBridge` across documents.** `PluginCoordinator` owns the worker; teardown happens with the editor session.
- **Don't pass live `$state` proxies into the bridge.** Snapshot first (`$state.snapshot(...)`) — the postMessage path is structuredClone-only.
- **Don't run plugins from inside a `tx`.** Plugin execution is async and the bridge resolves on a microtask; commands must be the only callers of `historyStack.tx`.
- **Don't fetch plugin code or wheels from another origin.** `entrypointUrl` and wheel paths must pass `isSameOriginUrl()` (resolve, then compare origins; never match URL prefixes). The zip is fetched once at install time by `PluginInstaller`; `activate()` never fetches plugin code, and re-checks wheel URLs before fetching them.
- **Don't run plugin code in a same-origin Worker, and never add `allow-same-origin` to the sandbox iframe.** Either hands plugins the user's GitHub token and local data. New worker features must work from an opaque origin.
- **Don't make the worker fetch the app origin.** It can't; fetch same-origin assets (wheels, zips) on the main thread and send bytes, as `PluginCoordinator` does for wheels.
- **Don't widen the sandbox CSP casually.** `connect-src` is the network permission boundary; `'unsafe-eval'` is not needed by Pyodide.
- **Don't extend the protocol without updating both sides.** The discriminated unions in `worker/protocol.ts` are the contract; main and worker must stay in lockstep.
- **Don't special-case Script Lab inside the worker.** The "execute editor buffer as source" behavior belongs in host-side code resolution, not in Pyodide's runtime harness.
- **`foldnano_mini` mutation logs are replayed against a snapshot taken before the run.** Don't reorder ops inside the dispatcher — replay order is part of the contract.
- **Replay a log through `replayMutationLog`, not a bare `dispatchOp` loop.** The per-op repeat-group sync is part of the contract: Python predicts it.
- **Keep `foldnano_mini/repeat.py` in step with `repeatGroups.ts` and `Part.canDuplicateOligosBy` / `duplicateOligos`** (`docs/repeat-units.md`); `foldnanoMiniRepeatReplay.spec.ts` replays a Python-written log on the real `Part`.
- **Cadnano-format plugins are lattice-only.** `cadnano_json` plugins require an active `LatticedDesignRegion` — `runWithOptions()` throws before the worker even starts if the active region is freeform or missing. A freeform-only design (or a design with no lattice region active) can't drive a `cadnano_json` plugin; use `foldnano_json` or `foldnano_mini` instead.
