---
covers:
  - src/lib/notifications/**
  - src/lib/errorReporting.ts
  - src/lib/globalErrorCapture.ts
  - src/hooks.client.ts
  - src/lib/errors.ts
  - src/lib/components/Editor/NotificationHistory.svelte
  - src/lib/relativeTime.ts
---

# Notifications (toasts and the per-tab list)

Every toast in the app goes through `notify` in `src/lib/notifications/notify.svelte.ts`. It still
shows a sonner toast (the `<Toaster>` in `src/routes/+layout.svelte`), and it also records the
message in `notificationHistory`, a short in-memory list that the status bar's bell
(`NotificationHistory.svelte`) opens. The point is that a toast that disappeared after a few
seconds can be found again, without building a phone-style notification center.

## Rules

- **Import `notify`, never sonner's `toast`.** An ESLint `no-restricted-imports` rule enforces this;
  only the wrapper may import `toast`. `Toaster` itself still comes from `svelte-sonner`.
- **What goes in the list.** Errors and warnings by default; successes and info only with
  `history: true`. Opt in for outcomes the user may want to check later (commit, publish, pull,
  branch switch, plugin install/update/link, agent runs, backup restore, overlay loaded).
  Clipboard copies and "Saved in this browser" stay out by default. Every warning is listed,
  canvas-tool refusals ("Cannot place skip…") included, so the rule stays one rule; coalescing
  keeps repeats to one row. Reserve `history: false` for a warning that would truly be noise.
- **Coalescing.** A notification with the same level and title as the newest entry within
  `NOTIFICATION_COALESCE_MS` merges into it: `count` goes up and a new `description` is appended to
  `details` (deduped). A burst of "Cadnano import warning" toasts therefore becomes one entry that
  lists every warning; repeated canvas warnings become "×N". The toasts on screen are unchanged.
- **Errors keep their Error Log link.** `reportError()` (`src/lib/errorReporting.ts`) passes
  `errorLogId`; the list shows a **Details** link that opens `ErrorLogDialog` on that entry. The
  persistent Error Log stays the place for stacks and bug reports; this list is the quick look. The
  popover header's **Error Log** button is the log's main entry point (the Help menu has the other);
  it has no toolbar button of its own.
- **Refusals are not errors.** Throw `InvalidOperationError` / `OperationNotSupportedError`
  (`src/lib/errors.ts`) when the editor deliberately refuses a user action (crossover onto its own
  segment, a skip with no complementary strand). `reportError` turns those into a warning toast that
  goes in this list but skips the Error Log and returns `null`. The Error Log is only for failures
  worth reporting to developers. A plain `Error` thrown from a tool counts as a bug and shows
  "Something went wrong (#id)", so a refusal the user can trigger must use the refusal types.
- **Repeats merge in the Error Log too.** `reportError` keys the entries this tab logged by
  context + message; a repeat returns the first entry's id and adds to its `count` (written in one
  batch per `ERROR_LOG_REPEAT_FLUSH_MS`, so an error thrown every frame costs one write a second).
  The toast still shows for each explicit call.
- **Uncaught errors are captured.** `installGlobalErrorCapture()` (from `init` in
  `src/hooks.client.ts`) listens for `error` and `unhandledrejection`, and SvelteKit's
  `handleError` covers load/navigation failures (404s skipped). `reportUncaughtError` drops browser
  noise (`ResizeObserver loop`, cross-origin `Script error.`, `AbortError`, errors thrown from
  extension URLs), toasts only the first occurrence, and lets at most
  `MAX_NEW_UNCAUGHT_ERRORS_PER_MINUTE` new errors in; the rest stay in the console. Plugin Python
  failures never reach it: `PluginPanel` catches them and the plugin row shows the traceback.
- **Attention dot, no count.** Recording an error or warning sets `hasUnseenAttention`; opening the
  list clears it. A count would turn the list into a chore.

## Why it is small

- **In memory, per tab, cleared on reload.** Persisting would mean an IndexedDB schema, multi-tab
  writes (`TabSync`) and design or file names stored at rest; the Error Log deliberately stores
  metadata only. Capped at `NOTIFICATION_HISTORY_LIMIT`, newest first.
- **Toast actions are not stored.** An action replayed later could act on a document that has
  changed since. The only action rebuilt from the list is the navigation-only Error Log link.
- **No categories, read state or per-document scoping.** Entries carry a timestamp only.

## Boundaries / Don'ts

- Don't call sonner's `toast` directly, and don't silence the lint rule outside the wrapper.
- Don't persist `notificationHistory` or put design data in it beyond what the toast already says.
- Don't add toast actions that change data and expect them to work from the list; they aren't kept.
- Don't widen what the global capture logs to cover plugin or design-check output; the Error Log
  is for Foldnano failures, and anything caught on purpose should use `reportError` or the UI that
  owns it.
- Don't push important state into toasts because the list exists; a lasting condition belongs in
  the UI that owns it (status bar, design checks, banners).
