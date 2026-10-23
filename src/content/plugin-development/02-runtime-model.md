---
title: Runtime Model
description: How Foldnano loads, runs, scopes, and applies Python plugins
category: plugin-development
order: 2
slug: runtime-model
covers:
  - src/lib/plugin/envClassification.ts
  - src/lib/plugin/networkPolicy.ts
  - src/lib/plugin/worker/pyodideConfig.ts
  - src/lib/plugin/sizeLimits.ts
---

# Runtime Model

Foldnano plugins run in a browser Python runtime ([Pyodide](https://pyodide.org/en/314.0.7/index.html), CPython compiled to WebAssembly) hosted by a Web Worker. The main editor remains the owner of the real model; Python receives a serialized input and returns either analysis output or an explicit result to apply.

## Runtime Pipeline

1. The user installs a plugin: either by importing a `.zip` locally, or from Foldnano's Hub, whose zips are served by Foldnano itself and fetched once at install time.
2. Foldnano validates the manifest inside the zip (format, apply strategy, entrypoint shape) and stores the whole zip in IndexedDB.
3. When the plugin is activated, the plugin coordinator loads the cached zip from IndexedDB. Activation never re-fetches the plugin's code. (Script-Lab-like `sidePanel.codeEditor` plugins are the one exception: their source is the live editor buffer, not a stored zip.)
4. Pyodide extracts the zip and loads `plugin.py`, plus any requirements: bundled wheels come from the zip; package names are installed from the Pyodide distribution or PyPI at this point.
5. Foldnano builds a `PluginContext` with the active part, active region, parameters, and side-panel state.
6. Python runs `run(ctx)`.
7. The host receives logs, artifacts, JSON results, or a mutation result.
8. Mutating results are applied only through the selected apply strategy.

If `run()` raises, the run ends with an error: the panel shows the traceback, and the log keeps every line written before the exception. Nothing is applied. To report a problem more readably, catch it and log a message instead, for example around `ctx.get_part_as_foldnano_json()`, which raises `RuntimeError` when the manifest declares another format. A result can also be refused after a clean run; see [When a Result Can't Be Applied](/docs/plugin-development/plugin-formats#when-a-result-cant-be-applied).

Plugins installed under the old, pre-unification shapes (inline `entrypoint` on a normal plugin, or a raw `.py` `entrypointUrl`) are flagged `needs-reinstall` and cannot be activated. Re-import the zip to fix.

## Environment Tiers

Your `requirements` and `network` decide which of two Python runtimes your plugin uses. Plugins whose requirements are all unversioned Pyodide-distribution names (e.g. `numpy`, `pandas`) or standard extras (first-party pinned wheels referenced by bare name, currently `cadnano2_5_mini`) run in the shared **standard environment**, a persistent runtime where standard plugins activate side by side with no reinstall on switch. Anything else (declared [network access](/docs/plugin-development/plugin-manifest#network-access), off-distribution package names, any version specifier, or any `.whl`) routes the plugin to a dedicated **custom environment**, of which only one can be active at a time: activating a custom plugin evicts the previous one (with confirmation if it is busy).

Within the standard environment, your plugin's own code runs in a fresh namespace each run, but installed libraries and their state are shared with other standard plugins. Do not mutate global library configuration (`np.seterr`, `pd.set_option`, monkey-patching shared modules): it leaks into every other standard plugin's runs; if unavoidable, save and restore the setting inside `run(ctx)`. Prefer staying standard-tier: avoid unnecessary version pins, and ship wheels only for libraries missing from the Pyodide distribution.

Foldnano currently pins **Pyodide 314.0.7** (Python 3.14); the About dialog shows the version your copy runs. The package names and exact versions available in the standard environment are listed in [Packages in Pyodide 314.0.7](https://pyodide.org/en/314.0.7/usage/packages-in-pyodide.html) (machine-readable: [`pyodide-lock.json`](https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide-lock.json)). Develop and test against these versions. Anything importable but not on that list is a pure-Python package micropip fetches from PyPI at its latest version, which classifies your plugin custom-tier.

Bundled wheels must match this runtime. Pure-Python wheels (`py3-none-any`) work across Pyodide versions; a wheel with compiled code must be built for Python 3.14 and Pyodide 314 (`cp314` with platform tag `pyemscripten_2026_0_wasm32`). Wheels built for Pyodide 0.29 (Python 3.13, `pyemscripten_2025_0` or `pyodide_2025_0`) or earlier no longer load.

Pyodide now numbers its releases after the Python version they ship (314 is Python 3.14) and plans one new major release a year. When Foldnano moves to a new one, the distribution packages move with it (Pyodide 314 brought pandas 3, for example), so test your plugin again after an upgrade.

## Writing Python That Runs In Pyodide

Pyodide is CPython in WebAssembly, and most pure-Python code just works, but the browser sandbox has real limits that surface as runtime errors in plugins. Before debugging in Foldnano, check the upstream Pyodide 0.29 documentation:

- [Pyodide documentation](https://pyodide.org/en/314.0.7/index.html): entry point for everything below.
- [Python compatibility and WASM constraints](https://pyodide.org/en/314.0.7/usage/wasm-constraints.html): what does not work in the browser, including no `threading`/`multiprocessing` (they import but can't spawn), no `subprocess`, no blocking `socket` networking (so `requests`-style HTTP calls fail), and other removed or stubbed stdlib modules.
- [Loading packages and micropip](https://pyodide.org/en/314.0.7/usage/loading-packages.html): how `requirements` entries are actually installed, and which wheels micropip accepts (pure-Python wheels from PyPI, or Pyodide/emscripten builds).
- [Pyodide FAQ](https://pyodide.org/en/314.0.7/usage/faq.html): common patterns and workarounds, including HTTP requests from Python.

Rule of thumb: keep plugins CPU-bound and self-contained, reading the design from `ctx`, computing, and returning results or a mutation log. If a library spawns threads or touches the network at import time, it will not survive the worker even if it installs cleanly.

## Model Ownership

Python never receives direct access to the live JavaScript `Part`. This keeps undo/redo, region scoping, and validation on the host side.

| Format | Python receives | Python returns |
| --- | --- | --- |
| `cadnano_json` | cadnano JSON string | cadnano JSON result or preview output |
| `foldnano_json` | Foldnano `Part.toJSON()` snapshot | Foldnano JSON result or preview output |
| `foldnano_mini` | Foldnano JSON loaded into a mutable Python mirror | structured mutation log |

`foldnano_mini` is the preferred model for direct edits because the host replays the mutation log into the real part inside one undoable command transaction.

## Region Scope

Plugins launched from the editor receive `ctx.active_region_id` when a region is active. Use it to keep plugin behavior predictable in multi-region designs.

When using `replayMutationLogInRegion`, the host rejects mutation-log operations that target virtual helices outside the active region.

## Side Panels

Manifests can request host-rendered side panels. A form side panel shows parameter controls. A code-editor side panel can either pass editor text as input or execute the editor contents as the plugin entrypoint for that run.

## Security And Trust

Your plugin runs in a sandbox: a Web Worker inside a hidden iframe with no origin of its own, plus a Content Security Policy. From Python, that means:

- **No access to Foldnano itself.** Requests to Foldnano's server (including the user's GitHub connection) fail, and browser storage such as IndexedDB is unavailable. Everything your plugin needs arrives through `ctx`.
- **Network only as declared.** Requests go only to the Pyodide CDN, to PyPI when your `requirements` need it, and to the hosts in your manifest's [`network`](/docs/plugin-development/plugin-manifest#network-access). Anything else is blocked, and the run's log gets a line such as `[sandbox] Blocked a request to api.example.org`.
- **No `eval` of JavaScript strings** (`js.eval` fails), and no nested workers from Foldnano's site.
- **Runs are bounded.** A run that takes more than 5 minutes, or that the user stops, is ended by terminating the worker.

Users see your manifest's format, apply strategy, network access and packages (grouped by source, with PyPI packages flagged) before they install. Mutating plugins change the design only when the user clicks **Apply**, as one undoable step. Users install plugins from the Hub or from a local zip; Foldnano doesn't review third-party plugins, so users are told to install only from people they trust.
