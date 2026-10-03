---
status: snapshot
---

# Plugin sandbox spike — 2026-09-29

Go/no-go spike for the beta plugin trust model (a P0 for the beta release). Question: can the Pyodide plugin worker run in an **opaque origin** so that plugins
lose access to the app's origin (the `/api/github/*` cookie, IndexedDB, Web Locks, BroadcastChannel)
and network access can be enforced per plugin by CSP?

**Result: go.** The real worker (`src/lib/plugin/worker/pyodide.worker.ts`: Pyodide boot, `micropip`,
run harness) ran unmodified inside a sandboxed iframe with a strict CSP, at parity boot time.
Tested in Chromium (the desktop app's browser pane) only; Firefox and Safari are unverified.

## Trust-model decisions this spike serves

Agreed before the spike; recorded here because they shaped what was tested.

1. Online installs are limited to same-origin plugins (built-ins and the bundled hub).
2. Beta formally supports offline ZIP plugins; the user is responsible for trusting them, as with
   any script run on their own machine.
3. Network access must be declared in the manifest (`network: string[]`, hosts or `["*"]`);
   undeclared access is blocked, not just discouraged.
4. Even with network declared, plugins must not reach the app's own API routes.
5. PyPI `requirements` stay allowed but are disclosed in the install/activate UI.
6. Script Lab keeps its restricted builtins but warns it is not a sandbox; it gets no network.

## Setup

- **Worker bundle:** esbuild bundled `pyodide.worker.ts` into one self-contained string (~133 KB),
  resolving the `?raw` Python imports with a text loader and defining
  `import.meta.env.VITE_PYODIDE_INDEX_URL` as `undefined`.
- **Host:** a hidden `<iframe sandbox="allow-scripts" srcdoc=…>` (no `allow-same-origin`, so its
  origin is `null`). The parent posts the worker source plus one end of a `MessageChannel`; the iframe
  creates a `blob:` Worker and relays messages between the port and the worker.
- **CSP** (a `<meta>` in the `srcdoc`, inherited by the blob worker):
  `default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src blob:; connect-src <allowlist>`.
  Baseline allowlist: `https://cdn.jsdelivr.net https://pypi.org https://files.pythonhosted.org`.
- **Flow per mode:** `INIT_RUNTIME` → `INSTALL_PLUGIN` (`micropip` install of `humanize`, a
  PyPI-only package) → `RUN_PLUGIN` with a probe plugin.
- **Probe:** a Script Lab-style inline plugin whose synchronous `run(ctx)` used `import js` and sync
  `XMLHttpRequest` to try each capability, printing the results as JSON.

## Results

| Probe (from Python via `import js`) | Same-origin (today)     | Sandbox, no network | Sandbox, declared `api.github.com` | Sandbox, `["*"]`¹ |
| ----------------------------------- | ----------------------- | ------------------- | ---------------------------------- | ----------------- |
| Worker origin                       | `http://localhost:5173` | `null`              | `null`                             | `null`            |
| `GET /api/github/repos`             | **reached** (401²)      | blocked             | blocked                            | blocked           |
| `GET /api/auth/github/status`       | **reached** (200)       | blocked             | blocked                            | blocked           |
| Same-origin static file             | reached                 | blocked             | blocked                            | blocked           |
| `indexedDB.open()`                  | **allowed**             | SecurityError       | SecurityError                      | SecurityError     |
| Cache Storage                       | allowed                 | blocked             | blocked                            | blocked           |
| Nested Worker from app origin       | created                 | SecurityError       | SecurityError                      | SecurityError     |
| `js.eval`                           | allowed                 | blocked (CSP)       | blocked (CSP)                      | blocked (CSP)     |
| Undeclared host (`httpbin.org`)     | reached                 | **blocked**         | **blocked**                        | allowed           |
| Declared host (`api.github.com`)    | reached                 | blocked             | **allowed**                        | allowed           |
| PyPI package via `micropip`         | ok                      | ok                  | ok                                 | ok                |
| Boot → first result                 | 5.9 s                   | 6.7 s               | 6.8 s                              | 6.2 s             |

¹ This run explicitly added the app origin to `connect-src` to test the next layer in isolation:
CORS still blocked every read, because the app sends no `Access-Control-Allow-Origin`.
² 401 only because the test browser was not signed in to GitHub; a signed-in user gets 200.

A permissive-CSP sandbox run (`default-src * 'unsafe-inline' 'unsafe-eval' blob: data:`) matched
the strict runs on origin-bound probes, which confirms the isolation comes from the opaque origin
and the network allowlist from the CSP.

## Findings that shape the implementation

- **Module workers fail silently in an opaque origin.** `new Worker(blobUrl, { type: 'module' })`
  fires `error` with no message (even for `postMessage(1)`). Classic workers work. The worker must be
  built as a classic IIFE. Within it, both dynamic `import()` of `pyodide.mjs` and
  `importScripts('pyodide.js')` boot Pyodide from jsDelivr.
- **No `'unsafe-eval'` needed.** `'wasm-unsafe-eval'` is enough for Pyodide 0.27.4.
- **The worker never needs the app origin.** Wheels (bundled and `STANDARD_ENV_EXTRAS`) are
  already fetched on the main thread and sent as bytes (`preloadedWheels`), and the Python packages
  are inlined via `?raw`. So the app origin can stay out of `connect-src` in every mode except
  `["*"]`, where `https:` matches it in production.
- **`no-cors` requests are not fully proven.** CORS stops reads, but a blind `no-cors` POST would
  still be sent. In the spike it failed client-side before reaching the server, so whether cookies
  would be attached wasn't observed. By spec the opaque-origin context is cross-site, so the
  `SameSite=Lax` auth cookie is withheld. Defense in depth: `/api/github/*` and `/api/auth/*` reject
  requests whose `Sec-Fetch-Site` isn't `same-origin` (also CSRF hardening).
- **The build path works.** An esbuild bundle of the worker is self-contained. The production
  version is a small Vite plugin that returns the bundled worker as a string module, so dev and
  prod share one path. That needs `esbuild` as a direct devDependency (it is currently transitive
  via Vite).
- **Terminating is now real.** Removing the iframe kills the worker, which gives the run timeout
  (the beta item "Run timeout doesn't stop Python") a way to actually stop Python.

## Open items for implementation

- Verify in Firefox and Safari (opaque-origin blob workers, `wasm-unsafe-eval`, CSP inheritance).
- The iframe's `message` handler must check `e.source === parent`.
- Plugins that declare network access route to the custom worker slot (their own iframe and CSP);
  the shared standard worker stays network-free.

The throwaway harness (a static page plus an esbuild script) was not committed.
