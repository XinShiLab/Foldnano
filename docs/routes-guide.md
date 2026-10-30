---
covers:
  - src/routes/**
  - src/hooks.server.ts
  - src/lib/analytics.ts
  - src/lib/server/**
  - src/lib/remote/**
  - src/lib/components/PrivacyNotice.svelte
  - src/lib/components/NoticeStack.svelte
  - src/lib/notices/**
  - src/lib/browserSupport.ts
---

# Routes Guide

SvelteKit route map for the editor. The runtime working copy lives in **IndexedDB** (Dexie); GitHub and `localStorage` are not in this path.

## Route Map

| Route                       | File                                | Purpose                                         |
| --------------------------- | ----------------------------------- | ----------------------------------------------- |
| `/`                         | `src/routes/+page.svelte`           | Landing placeholder                             |
| `/editor`                   | `src/routes/editor/+page.svelte`    | Document list (also entry-point for new doc)    |
| `/editor/[docId]`           | `src/routes/editor/[docId]/+page.*` | Editor for a specific document                  |
| `/oligos`                   | `src/routes/oligos/+page.svelte`    | Saved-document picker for oligo reports         |
| `/oligos/[docId]`           | `src/routes/oligos/[docId]/+page.*` | Oligo report table for a saved document         |
| `/oligos/diff`              | `src/routes/oligos/diff/+page.*`    | Local saved-document oligo report diff          |
| `/toc`                      | `src/routes/toc/+page.svelte`       | Saved-documents list (sort, source filter)      |
| `/privacy`                  | `src/routes/privacy/+page.svelte`   | Privacy notice — cookies/storage inventory      |
| `/docs`, `/docs/[...slug]`  | `src/routes/docs/**`                | Doc site (user guide, plugin dev, contributors) |
| `/testpage`                 | `src/routes/testpage/+page.svelte`  | Internal dev/debug                              |
| `/api/auth/github`          | …                                   | GitHub OAuth init (optional `returnTo`)         |
| `/api/auth/github/callback` | …                                   | OAuth callback (sets httpOnly token cookies)    |
| `/api/auth/github/install`  | …                                   | GitHub App install/configure redirect           |
| `/api/auth/github/logout`   | …                                   | Clears auth cookie                              |
| `/api/auth/github/status`   | …                                   | `{ authenticated, user }`                       |
| `/api/github/repos`         | …                                   | List repos                                      |
| `/api/github/repo`          | …                                   | One repo's metadata (default branch)            |
| `/api/github/contents`      | …                                   | GET / PUT / DELETE file (proxy)                 |
| `/api/github/trees`         | …                                   | Repo tree                                       |
| `/api/github/branches`      | …                                   | List / create branches                          |
| `/api/github/commits`       | …                                   | List commits                                    |

## Editor Loading Flow

`/editor/[docId]/+page.ts` extracts `docId` from URL params and passes it to `+page.svelte`, which lazily mounts `Editor.svelte` (browser-only — Konva and Three need `window`).

Inside `Editor.svelte`:

1. `onMount` awaits `githubMetadataStore.hydrate()` and `githubExplorerStateStore.hydrate()` in parallel.
2. After hydration, `session.refreshGitHubStateFromStore()` populates reactive GitHub state.
3. A `storesHydrated` flag triggers the `$effect` that loads the active document via `EditorDocumentSession.loadDocumentFromLocalStorage(docId)`.
4. If the doc is missing in IndexedDB, the user is prompted to go to `/toc` or start a new document. If it exists but can't be opened, `DocumentRecoveryScreen` shows instead (see `storage-architecture.md` § Loading a local document).

## Oligo Report Routes

`/oligos/[docId]` loads the saved document snapshot from IndexedDB and renders an
oligo table for `document.parts[0]`. This mirrors the editor's current one-part
working assumption; multi-part selection will be added with the broader editor
multi-part workflow.

Circular oligos are shown for inspection with `Circular` endpoint labels and
segment positions, but the `Download CSV` action still uses the strict sequence
CSV exporter and rejects circular oligos.

`/oligos/diff` compares two local saved documents by each oligo's canonical
5'→3' segment endpoint signature. The table-facing `OligoKey` is a short stable
hash of that signature, not the persisted oligo UUID. Oligo names are only a
compared column (a rename shows as changed); they never drive matching.

## Loading a Design from an External URL

The editor accepts a `?url=` query parameter to fetch and open a design file hosted anywhere that allows CORS:

```
/editor?url=https://example.com/my_design.cadnano.json
```

An optional `&lattice=honeycomb|square` settles a cadnano file whose length fits both lattices,
so a shared link opens without asking; without it the editor asks (see `cadnano-import.md` §
Lattice detection). An unrecognised value, or one the file's crossovers contradict, is an error.

### State machine

```
/editor?url=... detected
  → FETCHING  (loading overlay shown; fetch + parse in progress)
    → PENDING  (doc in memory, autosave suppressed; SaveIndicator = "Click to Save Locally")
      → CONFIRMED  (user clicked "Save to Browser" and confirmed → IndexedDB write → /editor/[docId])
      → DISCARDED  (user navigates away without confirming; no IndexedDB write)
    → ERROR  (fetch failed, CORS blocked, or unrecognised format → toast)
```

### Implementation

1. `Editor.svelte` reads `window.location.search` for `?url=` once `storesHydrated` is true.
2. The URL is validated (must be `http:` or `https:`; other schemes are rejected).
3. `fetch(url, { credentials: 'omit' })` retrieves the file. CORS is the browser's natural security boundary — no server proxy is used.
4. The response JSON is dispatched through the parser registry (`parseDesignRaw`). Cadnano `.json` and `.fn.json` are both supported.
5. `session.loadTransientDocument(doc, rawUrl)` adopts the document **without** writing to IndexedDB and sets `session.pendingUrlSave = true`.
6. The URL stays at `/editor?url=...` while pending. The `SaveStatusIndicator` shows a pulsing "Click to Save Locally" button instead of the normal saved/unsaved state.
7. Clicking the button opens `SaveFromUrlDialog`, which explains what saving means (local storage, accessible at `/toc`; use Export to download).
8. On confirm, `session.confirmAndSaveFromUrl()` clears the pending flag and force-saves to IndexedDB, then the editor navigates to `/editor/[docId]` with `replaceState: true` so the `?url=` param is gone.

### Security constraints

| Constraint      | Mechanism                                                                              |
| --------------- | -------------------------------------------------------------------------------------- |
| Protocol        | Only `http:` and `https:` accepted; `javascript:`, `data:`, `file:`, etc. are rejected |
| Credentials     | `credentials: 'omit'` — no cookies sent to third-party servers                         |
| CORS            | Browser enforces; only CORS-enabled public servers succeed                             |
| JSON validation | Existing parsers validate structure; unrecognised shapes throw and surface a toast     |
| Redirect target | After confirm, navigation goes to internal `/editor/[docId]` only                      |

### Key files

| File                              | Role                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `Editor.svelte`                   | Reads `?url=`, fetches, parses, calls `loadTransientDocument`                   |
| `EditorDocumentSession.svelte.ts` | `loadTransientDocument`, `confirmAndSaveFromUrl`, `pendingUrlSave`, `sourceUrl` |
| `SaveStatusIndicator.svelte`      | Shows "Click to Save Locally" branch when `session.pendingUrlSave`              |
| `SaveFromUrlDialog.svelte`        | Confirmation dialog; explains local storage vs Export                           |
| `parsers/index.ts`                | `parseDesignRaw` — shared by file-open and URL-load paths                       |

## Saved Documents (`/toc`)

Lists every IndexedDB working copy. Sort, source filter (All / Local / GitHub; "GitHub" means the doc has `GitHubFileMetadata`) and layout (cards / compact table) live in the URL query (`sort`, `source`, `view`), not in component state, because runtime `localStorage` is off-limits and this keeps a chosen view across reloads and bookmarks. Defaults are omitted from the URL. Changes use `goto(..., { replaceState: true })` so toggling doesn't pile up history entries. Sorting/filtering is client-side over the metadata already loaded; `getDocumentList()` returns rows in primary-key (UUID) order, so the page must always sort.

## Multi-Tab Coordination

When a doc opens, `EditorDocumentSession` creates a `TabSync` per `docId`, which takes that document's Web Lock; a tab that loses the lock shows the read-only banner and gets it back (after reloading) when the owner closes. See `multi-tab-protection.md`. Saves are gated on `isTabOwner` to avoid last-writer-wins clobbering on the local IndexedDB row.

See `multi-tab-protection.md`.

## Web Analytics

`src/routes/+layout.ts` calls `injectAnalytics()` from `@vercel/analytics/sveltekit` for cookieless
Vercel Web Analytics on every route. `beforeSend` is wired to `redactAnalyticsEvent` (`src/lib/analytics.ts`),
which rewrites document-scoped paths (`/editor/[docId]`, `/oligos/[docId]`) to their route pattern before
the event leaves the browser, so no document ID reaches analytics.

## Preference Cookies

The root `+layout.server.ts` reads the dismissal cookies for every route: the privacy notice
(`src/lib/server/privacyNotice.ts`, set by the `dismissPrivacyNotice` remote form) and the
editor's first-visit workspace help (`src/lib/server/workspaceHelp.ts`, set by the
`markWorkspaceHelpSeen` remote command; see `workspace-help.md`), and the editor's
Chromium-browser notice (`src/lib/server/browserNotice.ts`, set by the `dismissBrowserNotice`
remote command; shown only when `isChromiumBrowser()` in `src/lib/browserSupport.ts` is false,
which is every browser without `navigator.userAgentData`). All are httpOnly and versioned. It also
reads the two What's New watermarks, `foldnano_announcement` and `foldnano_whats_new`
(`src/lib/server/announcements.ts`, set by the `markAnnouncementSeen` / `markWhatsNewSeen`
commands); these hold the newest id seen rather than a version (see `whats-new.md`). Every new cookie must be added to the storage table in `src/routes/privacy/+page.svelte`.

A remote `form` whose `submit()` is awaited without `.updates(...)` calls `invalidateAll()` on
success, re-running every load function. `PrivacyNotice` therefore calls `submit().updates()`
(nothing to refresh; it hides itself locally), and dismissals that need no page data use a remote
`command`, which never invalidates. The editor pages also derive the `browser && alphaAccessGranted`
boolean before the dynamic `import()` of `Editor.svelte`, so a load-data refresh can't remount the
editor and drop the in-memory design.

## Notice stack

Messages for the user (privacy notice, announcements) all appear bottom right, in `NoticeStack`
mounted by the root `+layout.svelte`. The stack owns the fixed position; its cards don't position
themselves. `flex-col-reverse` puts the first card (the privacy notice) in the corner and later
ones above it. A page hands a card to the stack by setting a snippet on `noticeStack`
(`src/lib/notices/noticeStack.svelte.ts`) and clearing it in its effect teardown, so the layout
never imports page state. Tab status (non-owner tab, browser notice) stays in the editor's
top-center banner stack instead.

## Access gate

`/`, `/docs`, `/editor`, `/oligos` and the doc text routes (`llms*.txt`, per-page `.md`, `/docs/search-index.json`; see `doc-site.md`) sit behind an optional beta access
gate. Every check goes through `hasAlphaAccess` (`src/lib/server/alphaAccess.ts`): page loads
via `alphaAccessLoad`, which feeds `AlphaAccessGate`, and the text routes directly. The switch is
the `ALPHA_ACCESS_CODE` environment variable: unset or empty opens the app to everyone (the
hosted beta for reviewers, self-hosting); one or more comma-separated codes turn the gate on. On
Vercel, scoping the variable to Preview keeps internal preview builds gated while Production stays
open. Keep the gate code in place while it is off, and add new protected routes through
`hasAlphaAccess` rather than a separate check.

## API Proxy Boundary

All GitHub API calls **must** go through `/api/github/*`. The OAuth token sits in an httpOnly cookie and is attached server-side; client code never reads it. Adding new GitHub endpoints means adding a server route — do not add direct calls to `api.github.com` from the browser.

`src/hooks.server.ts` rejects `/api/*` requests that scripts on another site issued (`isCrossSiteScriptRequest` in `src/lib/server/fetchMetadata.ts`: `Sec-Fetch-Site` not `same-origin`/`none` and `Sec-Fetch-Mode` not `navigate`). That covers the opaque-origin plugin sandbox (`docs/python-plugin-system.md` § Sandbox) and CSRF. Top-level navigations pass because the OAuth callback arrives cross-site from github.com; clients without Fetch Metadata pass and still rely on the `SameSite=Lax` cookie.

## Boundaries / Don'ts

- **Don't add `localStorage` reads/writes** for documents, metadata, or session state. The runtime store is IndexedDB through `StorageManager`; ephemeral preferences can live in cookies or component state.
- **Don't relax the `/api/*` Fetch Metadata guard** to let cross-site scripts in. If a new flow needs a cross-site entry, make it a top-level navigation.
- **Don't make GitHub API requests from the client.** Add a SvelteKit `+server.ts` route under `/api/github/*` and call it via `src/lib/services/github/api.ts`.
- **Don't load the editor from a non-browser context.** Routes that mount `Editor.svelte` must use lazy import with `ssr = false` (already set on the editor pages).
- **Don't bypass `EditorDocumentSession`** when loading or saving the active document — it owns the storage manager, history stack, and GitHub metadata wiring.

## Related Docs

- `storage-architecture.md` — IndexedDB schema and persistence flows
- `autosave.md` — auto-save thresholds and triggers
- `multi-tab-protection.md` — tab ownership protocol
- `github-integration.md` — auth, sync, conflict, diff flows
