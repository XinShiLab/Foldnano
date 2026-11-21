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

- [ ] **Design file-name safeguards: check in the browser** (landed 2026-11-08 on
      `dev/wireframe`; unit-tested, not yet tried in the UI). One name rule for every entry point
      (`validateDesignName`), case-insensitive folder clashes that block (toolbar rename, Files
      tab rename, New File, Publish), a warning for a name another saved design uses, no
      toolbar rename of a committed file with uncommitted changes, `Name (2)` for opened files
      whose name is taken, and "Untitled Document" reserved for the empty workspace with a
      required name prompt once a Part appears (`docs/autosave.md` § Reserved blank name). Try:
      add a region in a blank workspace, open an old "Untitled Document" design, rename onto a
      taken name (same folder and elsewhere), publish onto an existing path.
- [ ] **Same design from GitHub: check in the browser** (landed 2026-11-19 on
      `feat/doc_ID_edit`; unit-tested, not yet tried in the UI). A GitHub file now always keeps its
      design id (`docs/storage-architecture.md` § Open from GitHub). Try: (1) download a design,
      upload the `.fn.json` to the repo outside Foldnano, open it from the Files tab: Open as copy
      keeps both (the browser design moves to a new id), Replace keeps a backup, Cancel shows no
      error; (2) copy a committed file to a new path on GitHub, open the copy: only "Save as a
      copy" with a name, which appears as an uncommitted file in that folder; (3) change a
      committed file's `id` on GitHub, pull in another browser: the design stays linked and the
      URL follows the new id; (4) try (1) with the browser design open in a second tab.
- [x] **Save as a copy and the name field: check in the browser** (tried 2026-11-19, no problems; landed 2026-11-19 on
      `feat/doc_ID_edit`; session unit-tested, toolbar not tried). Try: edit the name and press
      Rename, Enter, Esc, Save as a copy; type a name and click the canvas (Rename pulses, Save /
      Save menu / Commit wait); Save menu → Save as a Copy… on a browser-only design, a committed
      repo file and an uncommitted repo file (copy appears as an uncommitted file in that folder);
      a name taken in the folder; narrow window (icon-only buttons); URL moves to the copy.
- [x] **Design ID chip: check in the browser** (landed 2026-11-19 on `feat/doc_ID_edit`; tried 2026-11-19, no problems).
      Try: the `#xxxxxxxx` chip after the toolbar name (hover tooltip, click copies, toast; hidden
      while editing the name, below `lg`, and for Untitled Document); the Open dialog's
      "already in your browser" note; both GitHub same-design prompts; Saved Documents cards and
      compact table; light and dark themes.
- [ ] **Download stamps and the Open dialog comparison: check in the browser** (landed
      2026-11-19 on `feat/doc_ID_edit`; unit-tested). Try: export a design and open the file
      again (same content); edit, save, open the old file (older, "Replace newer browser
      version"); export with unsaved edits and reopen (newer); edit `parts` in a text editor
      (changed outside Foldnano); a file matching a backup; offline (DevTools) export and open
      ("seems"); Download All files carry `exported`; GitHub commits don't; a deployed build
      answers `/api/time`.
- [ ] **Download button next to Save: check in the browser** (landed 2026-11-21 on
      `feat/doc_ID_edit`). Try: the ⬇ between Save and ⌄ downloads a stamped `.fn.json` (same as
      Save menu → Download as Foldnano JSON); while editing the name it waits like Save does;
      narrow window (all three segments icon-only).
- [ ] **Open menu with recent designs: check in the browser** (landed 2026-11-21 on
      `feat/doc_ID_edit`). Try: ⌄ next to Open lists up to 5 other designs by last change (not the
      open one), each opens after the current design saves; empty browser shows "No other saved
      designs yet"; while editing the name the menu waits; **All Saved Documents…** and the link
      in the Open dialog go to `/toc`; New shows as "New" at `xl`.
- [ ] **Files no longer store the design name: check in the browser** (landed 2026-11-19 on
      `feat/doc_ID_edit`; unit-tested). Try: download a design and open it (named after the
      file); commit, then view the file on GitHub (no top-level `name`); open an older repo file
      that still has one (no diff shown for it); rename a committed file from the toolbar and from
      the Files tab; resolve a conflict by hand (name kept); Download All zip.
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
- Design checks follow-ups (checks landed 2026-10-24, `docs/design-guards.md`). (1) Done
  2026-10-24: `replaceRegionKeepAnnotationsWhereMatched` dropped the scaffold label (confirmed by a
  test); it is now regrafted, and the scaffold indicator turns grey when no scaffold is set. (2) A design with
  cross-region links shows the cadnano warning on every `replaceRegion*` plugin run; consider "don't
  ask again for this design". (3) `cadnano-cross-region` is one region-wide issue, so the overlay
  can't frame the cut links; give each link its own anchor. (4) Review and publish the two What's
  New drafts of 2026-10-24. (5) Refresh `06-design-checks-menu.webp` (shows the old lowercase
  "cadnano export" label).
- Agent runs follow-ups (prototype landed 2026-10-28 behind an experimental switch,
  `docs/python-plugin-system.md` § Agent runs). An agent asked for a 6-helix bundle built a valid
  but unconventional one (helices numbered in placement order, scaffold crossovers between helices
  not next to each other along the path): the checks only answer "is it valid?". Next steps, in
  order: (1) A design-conventions guide (helix numbering along the scaffold path, scaffold routing
  and seams, staple crossovers and lengths), in our own words with citations, plus worked example
  scripts (a conventional 6HB), linked from `AGENTS.md`, and a plan-first step where the agent
  proposes layout, numbering and scaffold path before building. (2) A design-quality report: soft
  warnings with reasons, built on the overview's data, kept apart from the hard checks in
  `src/lib/model/checks/`. (3) foldnano_mini helpers that make the conventional design the easy
  one: choosing helix numbers in `add_vh_at` (today the host assigns them by cell and order),
  autostaple / autobreak (the editor has `autoStapleRegion`), a raster scaffold route. (4) A small
  set of test prompts scored with the report, to tell whether 1–3 help. Left out on purpose so far:
  seam detection (a guess about intent), a diff against the previous run, a foldnano_mini
  `describe()` (a second builder would drift).
- Agent runs: known gaps before it stops being a prototype. (1) A result held for
  `--ask-user-approval` lives in the tab's memory: after a reload it is gone, but if the editor
  comes back within the heartbeat window `run.py` keeps waiting until its timeout; a new listener
  could mark such results as lost. (2) Detection is polling (~0.5 s) on the main thread and hidden
  tabs are throttled; use `FileSystemObserver` where available and poll from a dedicated worker
  otherwise. (3) `awaiting-user` covers the requirements review dialog only; a folder permission
  prompt or the cadnano input review still shows as `running`. (4) No rate limit, no cleanup of old
  `runs/` files; artifacts are listed by name, not exported. (5) The undo label is the plugin's, not
  "Agent: <script>". (6) No copy of each run's code and input design (records hold hashes only); no
  selection or view state in the context. (7) No "Connect a coding agent" entry outside dev mode.
  (8) Protocol mismatch handling is a version check only, with no migration.
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
  (2) ~~A community plugin list pinned by sha256~~: done 2026-11-02 as a listing shipped with the
  app (`XinShiLab/foldnano-plugins`, `pnpm plugins:sync-listing`; `docs/python-plugin-system.md`
  § Community plugins). Still open: fetching the listing live (needs signing) and letting users
  subscribe to other lists. Manifest `network` stays the enforcement point.
- Plugin update known limits (reviewed 2026-11-02; low risk, fix when there's a real reason):
  id-only update matching and other tabs not seeing installs/updates/removals until reload.
  Details and planned fixes: `docs/python-plugin-system.md` § Plugin updates.
- pyOrigamiBreak stops with `sys.exit()` on some designs (found 2026-10-07): "SCAFFOLD SEQUENCE
  IS SHORTER THAN SCAFFOLD LENGTH!" (the design needs a longer scaffold than the one chosen) or
  "SOLUTION DOESNT EXIST". This used to kill the Python runtime and show only a red icon; the
  run now reports the message. Consider friendlier wording in the plugin (e.g. suggest a longer
  scaffold such as p8064) and checking the scaffold length before running.
