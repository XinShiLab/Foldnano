# Open Work After the Beta

Carried over on 2026-10-07 from the beta release checklist, which was worked through before the
public release; its completed items are not repeated here. Add new items to the matching section.

## Before the paper

- [ ] **Software DOI via Zenodo** (P1, before paper submission). `CITATION.cff` is ready
      (author, affiliation, Xin's ORCID) and Zenodo reads it. Enable
      the repo in Zenodo's GitHub integration, then publish a GitHub release (e.g. the beta
      version); Zenodo archives it and mints a concept DOI (latest version: put it in
      `README.md` and `CITATION.cff`) and a version DOI (cite this one in the paper). To have a
      DOI in the manuscript earlier, reserve one with a manual Zenodo upload. Zenodo's archive
      holds only a Git LFS pointer for the plugin wheel; accepted (2026-10-03), since the
      public repo holds the files.

**Deferred until the paper is published** (decided 2026-09-27): the access gate is switched off
since 2026-10-13 (an unset `ALPHA_ACCESS_CODE` opens the app); decide whether to delete its code
(`AlphaAccessGate` and its "Beta Testing" titles on `/`, `/docs`, `/editor` and `/oligos`) or keep
it for internal test deployments. The alpha wording became beta on 2026-10-07 (toolbar badge,
gate titles, a use-with-caution note); drop the "beta" badge at 1.0.

## After the beta

- Plugin dev mode follow-ups. Linking, the dev worker, the Dev tab, log streaming and folder
  paths in tracebacks landed 2026-10-23 on `feat/plugin_devMode`
  (`docs/python-plugin-system.md` § Plugin dev mode). (1) Done: tested in Chrome
  against the real worker on 2026-10-23, all checks passed
  (`docs/code_review/plugin-dev-mode-manual-test-2026-10-23.md`); still untested: PyPI packages
  and bundled wheels in a linked folder. (2) Step 6 landed the same day (New plugin
  dialog, starter files, API stubs, Check, Zip). Still open: listing _every_ manifest error (needs
  `validateManifest` to collect instead of throw), filling the manifest from `pyproject.toml`,
  an "update stubs" action, and exporting an owned plugin to a folder. (3) Decide whether to support `.fpluginignore` on top of the default ignore list. (4) Offline tests in
  the generated folder (discussed 2026-10-23, deferred: another front to maintain): `tests/`
  with a `conftest.py` `run_plugin(design, params, active_region_id)` helper and a starter
  `test_plugin.py` per format/strategy (mutation-log replay self-check, result shape,
  `previewOnly` sets only `plugin_result`), sample `.foldnano.json` / `.cadnano.json` designs, a
  Dev-tab **Save open design as test design** button (active region for `cadnano_json`; accept
  a document's `parts[0]` or a bare Part). Needs the real packages (vendored
  `.foldnano-runtime/` now, or the planned PyPI package; prefer waiting for PyPI), `tests/` and
  `conftest.py` in the linked-folder ignore list, and stating the limits (host-side validation,
  repeat groups, `pyodide.http` are not covered offline).
- Pyodide 314 (Python 3.14) follow-ups. The upgrade landed 2026-10-23 on `chore/pyodide-314`:
  the sandbox now starts a `data:` module worker, verified in Chromium only. (1) Check Firefox
  and Safari boot it in the opaque-origin iframe and enforce its CSP, and check the self-hosted
  core on production (`pyodide.asm.mjs` with the CORS header). (2) Check a bundled compiled
  wheel's tags at install, so a wheel built for another Pyodide fails with a clear message
  instead of at import.
- Multi-file commits as one atomic commit via the Git Data API. Assessed
  2026-10-03: ~1–2 days (blob/tree/commit/ref proxy routes, batch conflict check against the
  branch head, per-file SHA updates, keeping the current doc's tab-owner and snapshot path).
  Kept out of the beta: today's per-file commits are correct, only noisy.
- Build 3D overlay geometry off the main thread before advertising large structures.
  Measured 2026-10-03 (Node, without GPU upload): mrDNA parse + build ≈ 60 ms at 20k nt,
  ≈ 145 ms at 100k, ≈ 360 ms at 300k; a one-off pause on drop, not a freeze. A loading
  indicator would cover most cases.
- Extract overlay lifecycle out of `View3D.svelte`, now ~1,180 lines. Keep the
  data/visibility effect split that stops drags and Hide/Show from rebuilding geometry.
- Plugins from other websites (decided 2026-09-29; beta is same-origin + local zip only). (1) Let
  experienced users install from a URL, opt-in, with a user-managed list of trusted sources.
  (2) A community-maintained plugin list (a repo of reviewed plugin URLs plus descriptions) that
  users can choose to subscribe to. Pin each entry to a sha256 of its zip and verify on install,
  so a reviewed URL can't change underneath. Manifest `network` stays the enforcement point.
- pyOrigamiBreak stops with `sys.exit()` on some designs (found 2026-10-07): "SCAFFOLD SEQUENCE
  IS SHORTER THAN SCAFFOLD LENGTH!" (the design needs a longer scaffold than the one chosen) or
  "SOLUTION DOESNT EXIST". This used to kill the Python runtime and show only a red icon; the
  run now reports the message. Consider friendlier wording in the plugin (e.g. suggest a longer
  scaffold such as p8064) and checking the scaffold length before running.
