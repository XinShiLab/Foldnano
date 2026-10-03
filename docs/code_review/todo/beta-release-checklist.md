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

**Deferred until the paper is published** (decided 2026-09-27): remove the access gate
(`AlphaAccessGate` and its "Beta Testing" titles on `/`, `/docs`, `/editor` and `/oligos`, and the
README note about the access code). When removing it, make the app open when `ALPHA_ACCESS_CODE`
is unset; today an unset code locks everyone out, which would break self-hosting. The alpha
wording became beta on 2026-10-07 (toolbar badge, gate titles, a use-with-caution note); drop
the "beta" badge at 1.0.

## After the beta

- Evaluate Pyodide 314+ (Python 3.14): its core is an ES module and it drops classic-worker
  support, which the plugin sandbox relies on; needs its own sandbox spike and browser checks.
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
- Renumber `src/content/plugin-development/` so file prefixes match their `order:` front matter
  (two files start with `02-`). Slugs come from front matter, so URLs don't change. Carried over
  from the retired doc-site to-do list (2026-10-07).
