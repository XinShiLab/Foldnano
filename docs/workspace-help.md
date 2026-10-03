---
covers:
  - src/lib/components/help/**
  - src/lib/server/workspaceHelp.ts
  - src/lib/remote/workspaceHelp.remote.ts
---

# Workspace Help (`?` overlay)

Pressing `?` in the editor toggles the workspace help (**Workspace help** in the top toolbar's Help
menu, which also links to the docs site, opens it): key badges on controls, pinned captions on
panes and panels, a hover card with a short explanation for any registered control, and the
keyboard-shortcut reference card. It is the app's only onboarding surface; there is no step-by-step
tour, because most users are repeat professionals and a layer they open themselves never has to be
skipped.

## How it works

- **Components declare their own help.** A control or panel adds `{@attach help({...})}` (entry
  point `help()` in `src/lib/components/help/help.ts`). The attachment only registers the element
  and its `HelpSpec` in the module-level `helpRegistry`, and unregisters on unmount. It renders
  nothing and does not read `showShortcuts`, so it can stay on every control permanently.
- **One layer renders everything.** `WorkspaceHelp.svelte` is mounted by `Editor.svelte` while
  `editorViewContext.showShortcuts` is true. It measures registered elements every animation frame
  (panes resize, panels fly in, toolbars scroll) and only reassigns state when a box moved.
- **What is on screen decides what is explained.** Because registration follows mount/unmount, the
  start screen shows start-screen help, clicking a region kind makes the New Region panel's help
  appear while the overlay stays open, and so on. The overlay's dim layer is `pointer-events-none`,
  so users can keep working with it open.
- **Areas vs controls.** `area: true` entries (panes, panels, the start-screen groups) get a pinned
  caption and a dashed outline of the area; everything else gets a key badge (if `key`) and a hover
  card. The hover card picks the smallest registered control under the pointer. Titles fall back
  to the element's `title` / `aria-label`.
- **Notes never overlap.** `placeNotes()` (`helpLayout.ts`, pure and unit-tested) lays out every
  caption after its size is measured: it starts at the preferred `placement`, slides along that
  side or tries another until clear of earlier notes and the pinned cards (shortcut card,
  exit pill). The hover card is placed last so hovering never moves captions. A note that
  ends up away from its target gets a dashed leader line (`leaderLine()`) back to it.
- **Shortcut card** (`ShortcutCard.svelte`) is collapsed by default to leave room for notes; its
  expanded state is remembered for the session.
- **Visibility.** Non-area controls are shown only if `elementFromPoint` at their centre lands
  inside them, which hides controls clipped by scrolling toolbars or covered by floating panels.
- **Root filter.** The registry is module-level because attachments run after component init, where
  `getContext` is unavailable. `WorkspaceHelp` only shows entries inside its `root` element, so
  editor components reused elsewhere (docs tutorial) never leak into the editor's overlay.
- **Mode descriptions** reuse `MODE_TUTORIAL_INFO` from the docs tutorial data, so the mode buttons
  and the docs describe modes with the same text.

## Exit pill

Clicks pass through the overlay to the editor, so clicking never closes it. The pill with a
**Close (Esc)** button is the overlay's only close control besides `?` / `Esc`, so it is always
shown: at the top as the welcome on the first visit, otherwise compact at the bottom center,
clear of the top toolbar. Don't remove it or make it conditional.

## First visit

`+layout.server.ts` exposes `workspaceHelpSeen` (cookie `foldnano_workspace_help`, versioned by
`WORKSPACE_HELP_VERSION`). When it is false, `Editor.svelte` opens the help once the document has
loaded, in a first-visit variant with a
lighter dim and the exit pill at the top as a "Welcome" message. Closing it by any means calls the
`markWorkspaceHelpSeen` remote command. Bump `WORKSPACE_HELP_VERSION` only when the content changes
enough that returning users should see it open once more.

## Writing help text

- A title and at most two short sentences; link the guide page with `doc` (a `GuideSlug`) for
  anything longer.
- Set `newVsCadnano` where Foldnano behaves differently from cadnano (regions, movable planes,
  linked mirror copies); it renders a badge.
- Canvas contents (Konva strand view, Three.js scene) are not DOM, so they only get an area caption.

## Boundaries / Don'ts

- **Don't render from the attachment.** Keep `help()` registration-only; all drawing belongs in
  `WorkspaceHelp.svelte`.
- **Don't gate the first-visit help on other notices.** It used to wait for the privacy notice,
  which tied the two together; the privacy notice now sits bottom-right above the overlay
  (`z-[999]`) so both can show at once.
- **Don't add a second first-visit flag** (IndexedDB, `localStorage`). The cookie is server-read so
  the decision is known before the editor mounts, and it is listed on `/privacy`.
- **Don't wrap controls in a help component.** Wrappers break toggle groups, button groups and
  pane layouts; the attachment adds no DOM.
