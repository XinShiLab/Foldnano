---
covers:
  - src/lib/whats-new/**
  - scripts/whats-new-draft.ts
  - src/lib/components/Editor/Toolbar/AboutDialog.svelte
---

# What's New (About dialog)

The **Foldnano** button in the top toolbar opens the About dialog; its first tab, **What's
New**, lists recent user-facing changes. The list is a hand-reviewed data file. A local script
drafts entries from commit messages, but nothing reaches users until a human edits the draft.

---

## Source files

```text
src/lib/whats-new/
├── entries.ts        # WhatsNewEntry type, WHATS_NEW data, watermark, display helpers
├── draft.ts          # pure draft logic (git log parsing, filtering, area guess, file rewrite)
└── draft.spec.ts     # unit tests for draft.ts and the display helpers
scripts/whats-new-draft.ts                       # CLI: runs git, calls draft.ts, writes entries.ts
src/lib/components/Editor/Toolbar/AboutDialog.svelte  # renders the list
```

`package.json` → `"whats-new:draft": "node scripts/whats-new-draft.ts"`. It needs the repo's Node
(`engines: 24.x`; anything ≥ 22.6 works): Node runs the TypeScript script directly (type
stripping), which is why the script imports `draft.ts` with its
`.ts` extension. `scripts/` is outside the tsconfig include, so only `src/lib/whats-new/` is
type-checked.

---

## Data model (`entries.ts`)

```ts
interface WhatsNewEntry {
	date: string; // YYYY-MM-DD, the day the change landed
	area: string; // "Strand view", "Plugins", "3D view", "Export", ...
	text: string; // one or two user-facing sentences
	draft?: boolean; // set by the draft script; hidden in the app
}
```

- `WHATS_NEW` — the list, **newest first**. Edit freely; the script only inserts at the top.
- `WHATS_NEW_REVIEWED_THROUGH` — ISO 8601 **author date** of the newest commit already
  considered. The draft script only looks at commits authored after it.
- `publishedWhatsNew()` — drops drafts, sorts newest first (stable for equal dates).
- `splitByRecency(entries, months = RECENT_WINDOW_MONTHS)` — `{ recent, earlier }`, cut
  `RECENT_WINDOW_MONTHS` (3) before the **newest entry's date**, not today, so a quiet period
  never empties the dialog.

---

## Display (`AboutDialog.svelte`)

- Header: `v{APP_VERSION} · {APP_COMMIT}` (`package.json` version + short build commit, both
  injected by `vite.config.ts` `define`).
  Next to it, the plugin runtime: `Pyodide {PYODIDE_VERSION} · Python {PYODIDE_PYTHON_VERSION}`
  from `pyodideConfig.ts`, so bug reports carry the same runtime as a run's `[env]` stamp.
- **Recent updates**: "Last updated {newest date}. Showing the last 3 months." then the `recent`
  entries grouped under month headings (`Intl.DateTimeFormat`, UTC so dates don't shift by
  timezone), each rendered as **Area:** text.
- **Show earlier updates (N)** reveals the `earlier` entries in the same month groups.

The other tabs: **Project** (maintainer, contributors, and links to the source, issues and
`CITATION.cff` on the public repo, `REPO_URL`) and **License** (Foldnano's license plus the
notable third-party credits, which mirror `THIRD_PARTY_NOTICES.md`).

Old entries are never deleted; the file doubles as a changelog. Change the window with
`RECENT_WINDOW_MONTHS`.

---

## Updating the list

```bash
pnpm whats-new:draft --dry-run   # preview drafts and skipped commits, writes nothing
pnpm whats-new:draft             # insert drafts into entries.ts and advance the watermark
```

Then, in `entries.ts`:

1. Merge related drafts (a feature is often several commits) and rewrite them in user terms.
2. Delete drafts for internal changes (refactors, test-only work, tooling that slipped through).
3. Fix the `area` if the guess is wrong.
4. Remove `draft: true` from what should ship, and commit.

Drafts left with `draft: true` are harmless: they're committed but hidden. The watermark has
already moved past them, so re-running the script won't recreate them.

### How the script builds drafts (`draft.ts`)

1. **Collect** — `git log --no-merges --since=<watermark> --name-only
--format=%x1e%H%x1f%aI%x1f%s`. `--since` filters on commit date (never earlier than author
   date), so it only narrows the scan; `buildDrafts` applies the exact author-date cutoff.
2. **Type filter** — keep subjects matching `add:`, `feat:`, `fix:` (optional `(scope)`, plus the
   repo's `major feat:` / `Bug fix:` variants). Others are reported as skipped.
3. **App-file filter** — keep a commit only if it touches `src/lib/`, `src/routes/`, or
   `static/`, excluding `*.spec.*` / `*.test.*`, `/test/` folders, and `src/routes/docs/`. A
   `fix:` that only adds a PDF or edits `.gitattributes` is skipped.
4. **Area** — `AREA_RULES` maps path prefixes to areas; the area with the most matching app
   files wins, ties go to the earlier rule, fallback `General`.
5. **Text** — strip the type prefix and leading `[tag]`s, drop a trailing period, capitalize.
6. **Write** — `insertDrafts` inserts entries after the `WHATS_NEW` declaration line, sets the
   watermark to the newest author date seen (including skipped commits), and the CLI runs
   prettier on the file.

**Why author dates, not hashes:** the repo is rebased manually, which rewrites hashes and commit
dates but keeps author dates, so a rebase never re-drafts reviewed commits.

---

## Boundaries / Don'ts

- **Don't generate What's New at build time or from an LLM in CI.** Text must be reviewed by a
  human; also, Vercel builds from a shallow clone, so `git log` history is incomplete there.
- **Don't ship commit-speak.** Entries are for designers using the app, not developers.
- **Don't rename `WHATS_NEW` or `WHATS_NEW_REVIEWED_THROUGH` without updating `draft.ts`.** The
  script finds them by their exact declaration text (`insertDrafts` throws if they're missing).
- **Keep `draft.ts` pure** (no `node:` imports) so it stays unit-testable and type-checked; git and
  file I/O belong in `scripts/whats-new-draft.ts`.
- **Don't move the watermark backwards by hand** unless you want those commits drafted again.
- **Add an `AREA_RULES` entry when a new top-level feature folder appears**, and a test in
  `draft.spec.ts` for it.
