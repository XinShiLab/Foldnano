---
covers:
  - src/lib/whats-new/**
  - scripts/whats-new-draft.ts
  - src/lib/components/Editor/Toolbar/AboutDialog.svelte
  - src/lib/components/AnnouncementCard.svelte
  - src/lib/server/announcements.ts
  - src/lib/remote/announcements.remote.ts
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
	link?: GuideLink; // guide page (optionally #heading) for "Learn more" / "Read more"
	announce?: WhatsNewAnnouncement; // major change: also shown once in the editor
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
`RECENT_WINDOW_MONTHS`. Entries with `announce` look the same as any other entry in the list.

An entry's optional `link` adds **Learn more →** after its text, and its announcement's **Read
more** uses the same link: one field, so the two can't drift apart. `link` is a `GuideLink`
(`src/lib/components/help/help.ts`): a `GuideSlug`, optionally with a heading anchor
(`'views#3d-view'`). The page name is type-checked, the anchor is not (a renamed heading just lands
at the top of the page); anchors are rehype-slug ids, lowercase and hyphenated. `guideHref()` turns
it into a URL.

---

## Announcements and the unread dot

Two tiers, both driven by `WHATS_NEW` (no backend):

- **Unread dot** (every published entry): a small dot inside the toolbar's Foldnano button, left
  of the label, while `latestEntryKey()` (newest date + entries on it) differs from the
  `foldnano_whats_new` cookie. Opening the About dialog calls `markWhatsNewSeen`. The dot stays
  inside the button so the `beta` / `preview` build badge keeps the top-right corner: the badge
  describes the build, the dot this browser's unread state.
  Inside the dialog, the first `unreadEntryCount(whatsNewSeen)` entries are unread: they get the
  same dot (plus a screen-reader "New:") and normal text colour, while read ones keep the muted
  colour. The count is taken from the cookie as it was at page load, so entries stay highlighted
  until the next load even though opening the dialog marks them seen. No cookie means none unread
  (a first visit shouldn't light up the whole changelog).
- **Announcement** (entries with `announce`): `AnnouncementCard` in the bottom-right notice stack
  (`routes-guide.md` § Notice stack), above the privacy notice when both show.
  `pendingAnnouncement(seenId, today)` picks the newest unseen, unexpired one and counts older
  unseen ones ("And N earlier updates"). Shown only after the document loads and while the
  workspace help is closed; "Got it" and "Read more" call `markAnnouncementSeen(id)`. "Read more"
  opens the entry's `link`, or What's New.

`WhatsNewAnnouncement.id` starts with the entry's date and is never reused; ids sort in release
order. `foldnano_announcement` holds the newest id dismissed (a watermark, not a version);
`advanceAnnouncementWatermark` rejects unknown or draft ids and never moves back, so an old tab
can't resurface a newer announcement. An announcement expires `ANNOUNCEMENT_DEFAULT_DAYS` (90)
after `date` unless `showUntil` says otherwise. A first visit marks everything seen when the
welcome help closes (`workspace-help.md` § First visit): new users never knew the old behaviour.

### When to announce

- Rarely (a few times a year): only changes that affect how people work or their files.
- Factual and about the user's work, not marketing; no emoji, no "exciting news".
- A title and at most two sentences; say whether existing designs are affected. Longer text
  belongs on the guide page in the entry's `link`.
- The draft script never adds `announce`; it is always written by hand.

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
- **Don't reuse or reorder announcement ids.** The cookie is a watermark; an id that sorts below
  an earlier one is never shown to anyone who saw the earlier one.
- **Don't show announcements outside the notice stack** or on first visit.
- **Don't move the watermark backwards by hand** unless you want those commits drafted again.
- **Add an `AREA_RULES` entry when a new top-level feature folder appears**, and a test in
  `draft.spec.ts` for it.
