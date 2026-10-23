---
covers:
  - src/lib/plugin/scriptLabManifest.ts
  - src/lib/plugin/ownedPlugins.ts
  - src/lib/plugin/ownedPluginActions.ts
  - src/lib/components/Editor/SidePanel/**
---

# Script Lab

Development and maintenance guide for Foldnano's Script Lab plugin.

This file is for:

- Foldnano developers and AI agents maintaining Script Lab itself
- developers and agents who want to build similar third-party plugins using the host-owned `codeEditor` side panel

For the general host architecture, read [python-plugin-system.md](python-plugin-system.md). For the plugin authoring API, read the doc site's plugin pages (`src/content/plugin-development/`).

---

## What Script Lab is

Script Lab is a built-in Python plugin that lets the user edit and run arbitrary plugin code from a side-panel code editor.

Key properties:

- it is implemented as a normal plugin manifest, not a one-off editor feature
- it uses `format: "foldnano_mini"` and `applyStrategy: "replayMutationLog"`
- the current editor contents are the Python entrypoint for that run
- each run executes in a fresh Python module namespace against a fresh Foldnano snapshot
- the Pyodide runtime is reused across runs, but user code state is not
- if the script emits no mutation log, the host shows output but offers no apply action

This is deliberately different from a traditional plugin with a static `entrypoint` or `entrypointUrl`: Script Lab's code is supplied by the user at runtime.

---

## Source Map

Primary files:

- `src/lib/plugin/scriptLabManifest.ts`
- `src/lib/plugin/corePlugins.ts`
- `src/lib/plugin/PluginRegistry.svelte.ts`
- `src/lib/plugin/PluginCoordinator.svelte.ts`
- `src/lib/plugin/types.ts`
- `src/lib/plugin/manifestValidation.ts`
- `src/lib/components/Editor/SidePanel/PluginCodeEditorSidePanel.svelte`
- `src/lib/components/Editor/SidePanel/PluginCodeEditorShell.svelte`
- `src/lib/components/Editor/SidePanel/ScriptLabReferenceCard.svelte`
- `src/lib/components/Editor/SidePanel/python-autocomplete.ts`
- `src/lib/components/Editor/SidePanel/PopOutWindow.svelte`
- `src/lib/components/Editor/SidePanel/prism-foreign-document.ts`
- `src/lib/plugin/python-completions.ts`
- `src/lib/components/Editor/Plugin/PluginRunOutput.svelte`
- `src/lib/plugin/ownedPlugins.ts`, `src/lib/plugin/ownedPluginActions.ts` (owned plugins)
- `src/lib/components/Editor/SidePanel/MakePluginDialog.svelte`
- `src/lib/components/Editor/SidePanel/OwnedPluginEditorPanel.svelte`

Relevant tests:

- `src/lib/plugin/manifestValidation.spec.ts`
- `src/lib/plugin/PluginRegistry.spec.ts`
- `src/lib/plugin/PluginCoordinator.spec.ts`
- `src/lib/plugin/python-completions.spec.ts`
- `src/lib/plugin/ownedPlugins.spec.ts`, `src/lib/plugin/ownedPluginActions.spec.ts`

Related generic runtime files:

- `src/lib/plugin/worker/protocol.ts`
- `src/lib/plugin/worker/bridge.ts`
- `src/lib/plugin/worker/pyodide.worker.ts`
- `src/lib/plugin/python/foldnano/plugin.py`
- `src/lib/plugin/python/foldnano_mini/*`

---

## Architecture

Script Lab is built from four layers:

1. Manifest definition
2. Built-in plugin registration
3. Runtime execution override
4. Side-panel UI

### 1. Manifest definition

`scriptLabManifest.ts` defines the built-in manifest and the starter templates.

Current contract:

- `id: "script-lab"`
- `format: "foldnano_mini"`
- `applyStrategy: "replayMutationLog"`
- `sidePanel.type: "codeEditor"`
- `sidePanel.icon: "code"`
- `sidePanel.title: "Script Lab"`
- `sidePanel.codeEditor.execution: "entrypoint"`

Important detail: the manifest still includes an `entrypoint`, but it is only a placeholder:

```python
def run(ctx):
    raise RuntimeError("Script Lab executes the editor contents from the side panel.")
```

That placeholder exists because the manifest schema still requires `entrypoint` or `entrypointUrl`. Script Lab never intends to execute that code in normal use. The real code comes from the editor buffer.

### 2. Built-in plugin registration

Script Lab is not installed from the Hub.

Instead:

- `corePlugins.ts` exports `builtinPlugins`, currently containing `scriptLabManifest`
- `PluginRegistry` seeds built-ins in its constructor
- built-ins get `origin: "builtin"`
- built-ins are not persisted as user-installed plugins
- `PluginRegistry.remove()` refuses to remove built-ins

This gives Script Lab three behaviors that normal third-party plugins do not have:

- always present in every editor session
- not removable from the Plugin panel
- marked as `Core` in the Plugin panel

### 3. Runtime execution override

The core Script Lab behavior lives in `PluginCoordinator.runWithOptions()`.

Normal code-editor side panels work like this:

- the plugin's manifest entrypoint is executed
- the current editor contents are passed as side-panel input
- Python can read that code with `ctx.get_side_panel_code()`

Script Lab changes only one piece:

- if `sidePanel.codeEditor.execution === "entrypoint"` and the launch input is `type: "codeEditor"`, the host executes `sidePanelInput.code` as `pluginCode`

That means Script Lab is still a normal plugin run, except the code source is runtime-provided instead of manifest-provided.

Pseudo-flow:

```text
editor buffer
  -> PluginCodeEditorSidePanel.handleRun(...)
  -> PluginCoordinator.runWithOptions(... sidePanelInput.code ...)
  -> execution mode resolves pluginCodeForRun from editor contents
  -> worker executes that code in Pyodide
  -> plugin emits logs / result / artifacts / mutation_log
  -> host optionally exposes pending Apply
```

### 4. Editor code persistence

Script Lab's editor code is persisted globally to IndexedDB so it survives page reloads and tab switches. It is **not** tied to any document — the same buffer is available regardless of which design is open.

Implementation:

- `IndexedDbPluginRecord` in `indexedDbTypes.ts` carries an optional `sidePanelCode` field alongside the plugin manifest.
- `FoldnanoIndexedDb.savePluginEditorState(pluginId, code)` upserts into the `plugins` table using `update` (so a manifest-only record is not overwritten) with a fallback `put` for the first write. No schema version bump is needed since the field is unindexed.
- `PluginRegistry.#loadFromStorage()` restores `sidePanelCode` for all plugins including built-ins. Built-ins are registered before storage loads, so the restore pass explicitly checks `this.plugins.get(record.id)` rather than skipping already-registered IDs.
- `PluginCodeEditorSidePanel` watches `plugin.sidePanelCode` and hands each change (typing, template loading, or Reset) to an `EditorCodeSaver` (`src/lib/plugin/EditorCodeSaver.svelte.ts`), which writes through `pluginCoordinator.persistEditorCode(...)` 500 ms after typing stops. The write is awaited: a failure shows a **Not saved** button next to the panel title (the error on hover, click to retry) instead of only a console warning. A pending edit is flushed, not dropped, when the panel unmounts or the page is hidden or closed (`visibilitychange` / `pagehide`). `PluginSidePanelHost` keys the panel by plugin id so a flush always writes under the right id. This save path is **not** Script-Lab-specific: it runs for every `sidePanel.type: "codeEditor"` plugin (an earlier `isScriptLab`-only guard was removed), so `execution: "input"` plugins also get a reload-persistent editor buffer, keyed by their own plugin ID.

### 5. Side-panel UI

Script Lab uses the generic `PluginCodeEditorShell` and the plugin-specific wrapper `PluginCodeEditorSidePanel`.

Current UI responsibilities:

- `PluginCodeEditorShell`
  - generic shell: title row, toolbar, editor pane, output pane, resizable split
  - supports toolbar tail and title tail snippets
  - output pane has a fixed `Output` header; while `outputEmpty` it shows a generic placeholder (or `Running…`) instead of the `output` snippet, so the pane is never blank before the first run
  - registers `?` workspace-help entries (editor/output areas, Run/Stop/Clear/Reset, pop out); `helpDoc` picks the linked guide page
  - `Mod+Enter` in the editor runs the script (same `runDisabled` gate as the button). It is a capture-phase listener on the editor host because prism's default keymap binds `Mod+Enter` to "insert blank line below"; the host listener must stay in capture or prism wins
- `PluginCodeEditorSidePanel`
  - binds a specific plugin instance into the generic shell
  - auto-activates on Run if needed
  - provides Script Lab-specific starter loading
  - shows the "no mutation log" notice for no-op analysis runs
  - derives `outputEmpty` from `hasRunOutput(...)` (exported from `PluginRunOutput`'s module script; keep it in sync with that component's sections)
- `ScriptLabReferenceCard`
  - compact toolbar-adjacent help trigger
  - exposes starter actions and quick API notes
- `PluginRunOutput`
  - generic run-output renderer
  - now uses dynamic tabs for `Console`, `Result`, `Artifacts`, and `Apply`
  - auto-switches to `Apply` when a pending apply exists

### 6. Pop-out window

The shell's header button moves the whole editor surface (toolbar, editor, output) into a separate browser window; the side panel shows a placeholder with **Show window** / **Bring back**. Every code-editor plugin gets it, not only Script Lab.

- `PopOutWindow` opens a same-origin `window.open('')` popup and `mount()`s the shell's `editorSurface` snippet into it with the opener's contexts. Same realm, so state, the Pyodide worker, `pluginCoordinator` and Apply all work unchanged; there is no messaging layer and no second `TabSync` participant.
- `mount()` into the popup's `<body>` is what makes Svelte's delegated events (`onclick`) work there; moving existing DOM nodes would not, because delegation listens on the main document.
- The popup's `about:blank` has no doctype, so it is rewritten (`document.write`) into a standards-mode document first; in quirks mode prism's `height: 100%` line-number pseudo-element stretches every line to the editor height.
- The mount/portal root is a `<div>` created by the opener's `document`, then appended to the popup body. Nodes keep their realm when adopted, and opener-realm `instanceof` checks (bits-ui's dev-mode portal-target check) reject popup-realm nodes like the popup's own `<body>`; a throw there aborts the whole mount.
- `patches/paneforge@1.0.2.patch`: paneforge keeps one module-level drag-cursor `<style>` and appends it to the dragged handle's document, but removed it from the main `document.head`. A drag in the popup then threw on release, left `dragState` set (handle stuck to the cursor) and poisoned every later drag in both windows. The patch uses `element.remove()`; re-check it when upgrading paneforge.
- `PopOutWindowContent` wraps the snippet in `BitsConfig defaultPortalTo` so menus/tooltips portal into the popup. bits-ui and paneforge otherwise resolve documents via `ownerDocument`, so they work as-is.
- Stylesheets and `<html>` attributes (theme class) are mirrored from the opener with `MutationObserver`s (Vite HMR rewrites `<style>` in place). Cloned `<link>`s take their sheet's loaded URL: SvelteKit's SSR hrefs are relative (`./_app/…`) to the page first loaded, so after a client-side navigation (`/toc` → `/editor/<id>`) the popup's `<base>` would resolve them to a 404 in production builds. `<body>` is deliberately not mirrored: bits-ui scroll-lock writes there.
- The editor is created by an `{@attach}` rather than `onMount`, so it is rebuilt in whichever window hosts it. The buffer survives (it lives in `plugin.sidePanelCode`); the editor's own undo history, caret and pane split do not.
- `bridgeForeignDocument` (`prism-foreign-document.ts`) covers prism-code-editor binding to the module-level `document`: it forwards the popup's `selectionchange` to the main document and, while the popup has focus, routes `document.execCommand` to the popup's document (edits, auto-indent and bracket insertion use it).
- Lifetime: the popup closes when the shell unmounts or the opener's `pagehide` fires; closing the popup (`pagehide`, plus a `closed` poll) docks the editor back.
- Switching side-panel tabs must not unmount a popped-out panel (that would close its window). The popped-out state lives in `EditorViewContext.poppedOutPluginPanels` (bound to the shell's `poppedOut` by `PluginCodeEditorSidePanel`), and `SidePanel` keeps every id in it mounted in a keyed `{#each}`, hidden while another tab shows, so the same instance survives the switch. Docking removes the id, which unmounts an off-tab panel.
- Known gaps: `PluginRunDialog`, `PluginActivationConfirmDialog` and toasts still render in the main window, and app keyboard shortcuts do not reach the popup (intended).

### 7. API autocomplete

`PluginCodeEditorShell` adds `foldnano` / `foldnano_mini` completions to every code-editor plugin, not only Script Lab (every plugin runs with both packages on its path).

- `python-completions.ts` is the editor-agnostic engine: given the text before the caret it returns members for the receiver's type, module exports after `from … import`, or scope names, keywords and builtins for a bare identifier.
- Type inference is deliberately shallow and runs on every keystroke: parameter/assignment annotations, `x = <chain>`, `for x in <chain>` (element type), `next((x for x in <chain> …))`, indexing, and method return types from the index. An unannotated `ctx` is `PluginContext`. No `isinstance` narrowing, no flow analysis; the last binding before the caret wins.
- An unresolved receiver offers nothing while typing; **Ctrl+Space** falls back to every API member so a name can still be found.
- The data comes from `src/lib/plugin/python-api-index.generated.json` (see `docs/python-plugin-system.md` § Generated API stubs and completion index). Never hand-edit it.
- `python-autocomplete.ts` adapts the engine to `prism-code-editor`'s `autoComplete` extension. `basicEditor` renders into a shadow root, so the popup CSS is injected there; `cursorPosition` (which `autoComplete` needs) comes from `basicEditor`'s own extension set. Completion sources are synchronous, which is why the engine can't ask Pyodide (e.g. Jedi).
- **Signature help:** `signatureHelpPython` resolves the innermost open `(` before the caret (an API function, or a method on a receiver typed by the same inference) and reports its params plus the active one (by position, keyword, or a `*args` / keyword-only slot). `python-autocomplete.ts` shows it in an `addTooltip` above the caret on `selectionChange`; Escape dismisses it for that call. Class constructors aren't covered (the index has no `__init__` signatures).
- The extension pins the list to an inline `width: min(25em, …)`; the injected CSS overrides it (`!important`) to 42em, capped by `100cqw` because the editor container is made an inline-size container. Labels don't shrink; the signature detail truncates instead.

---

## Execution Semantics

Script Lab is intentionally reproducible-by-default.

### Fresh module namespace per run

Each run is executed inside the worker's run harness as a freshly created module.

For inline source, the worker does:

- create a new `_plugin` module object
- `exec(compile(_plugin_code, ...), _ns.__dict__)`
- instantiate `PluginContext`
- call `_ns.run(_ctx)`

The namespace gets a builtins dict without `open`, `eval`, `exec`, `compile`, `breakpoint`, `input` and `memoryview`. That is a guard rail against accidents, **not a security boundary** (`import builtins` or `import js` gets around it in one line). Isolation comes from the plugin sandbox (`docs/python-plugin-system.md` § Sandbox): Script Lab runs in the standard-tier worker with no network beyond the Pyodide core and package paths and no access to the app origin. The UI says so in the Script Lab manifest `description` (shown at the top of its side panel) and in the Sandbox section of `ScriptLabReferenceCard`'s help menu.

This means:

- top-level variables from a previous Script Lab run are not reused
- imported code is re-evaluated for the current run
- the run only depends on the current editor buffer and current design snapshot

### Packages from imports

Script Lab has no `requirements`, so each code-editor run sets `RUN_PLUGIN.loadImports` (the coordinator sets it for any `execution: "entrypoint"` run, not Script Lab by name). The worker then calls Pyodide's `loadPackagesFromImports` on the editor source before running it and prefixes the run logs with `[env] loaded <pkg> <version>` for each newly loaded package (`scriptImports.ts`).

- Distribution packages only: they come from the Pyodide CDN, which every sandbox CSP already allows, so Script Lab stays standard tier with no network. PyPI packages need a packaged plugin with `requirements`.
- Loaded packages stay loaded in the shared standard worker; that is the same pinned distribution every standard plugin uses.
- When a run fails with `No module named 'x'`, the worker appends a hint saying `x` is not a Pyodide package and to package the script as a plugin.
- Loading counts toward the run timeout.

### Shared Pyodide runtime

The worker runtime itself is still reused across plugin runs. That is fine because the important reproducibility boundary is the user script namespace, not whether the WASM runtime is reloaded.

### No "run follow-up"

Script Lab intentionally does not expose a "continue in same session" button.

Reason:

- follow-up execution would make the result depend on hidden in-memory state
- hidden state would make apply behavior harder to reason about
- maintenance and bug reports become much worse when the script body alone is no longer the source of truth

If someone proposes adding it later, treat that as a new product and architecture decision, not a small UI enhancement.

---

## Output and Apply Behavior

Script Lab uses the generic plugin output flow, but two details matter more here than for most plugins.

### No mutation log == no apply

Because Script Lab uses `replayMutationLog`, a run only becomes applyable when Python calls:

```python
ctx.set_result_mutation_log(part.mutation_log)
```

If the emitted mutation log is:

- `null`, or
- an empty list

then the host does not create `pendingApply`.

For Script Lab specifically, the UI also shows a small notice explaining that the run completed without a mutation log, so there is nothing to apply.

This is important for analysis scripts: they may still log output, return JSON, and write artifacts, but they should not imply a design mutation happened.

### Pending apply flow

If a non-empty mutation log is returned:

- `PluginCoordinator` stores `pendingApply`
- `PluginRunOutput` shows an `Apply` tab
- that tab auto-focuses
- confirm/cancel is still handled through the normal host `ResultApplicator` flow

Script Lab does not bypass any of the existing undo/history/apply machinery.

---

## Starter Templates

Script Lab ships three built-in starters in `scriptLabManifest.ts`:

- `SCRIPT_LAB_MUTATION_TEMPLATE`
- `SCRIPT_LAB_ANALYSIS_TEMPLATE`
- `SCRIPT_LAB_FULL_API_DEMO_TEMPLATE` — exercises every `foldnano_mini` op kind against the current active region/design (discovering VHs, oligos, and regions dynamically rather than using a fixed fixture, and using the `can_*` checks to skip a step with its reason instead of failing). Users load it from **Script Lab Help → Load Full API Demo**. It runs in sections A–I, each skipped with a `SKIPPED` line when its preconditions are missing:
  A oligo color / name / scaffold flag; B modifications, slot sequence, skips and insertions;
  C helix and region length; D `create_segment` and `create_oligo`; E `break_oligo` and
  `move_terminus`; F adding lattice and freeform helices; G moving, reframing and reordering
  helices; H plane transform, `add_region_and_plane`, `split_region`; I removing what it made.
  It ends with `ctx.set_result_mutation_log(part.mutation_log)`, so Apply shows every op and one
  Undo reverts them all.

Why keep them in code instead of static files:

- they are part of the built-in plugin contract
- they are versioned with the host feature
- they are easy to reuse from the help UI without fetches

Current expectations for the mutation starter:

- import `PluginContext`
- import `load_part` from `foldnano_mini`
- load the current part with `ctx.active_region_id`
- demonstrate a direct mutable edit
- call `ctx.set_result(...)`
- call `ctx.set_result_mutation_log(part.mutation_log)`

Current expectations for the analysis starter:

- load the part with `load_part(...)`
- inspect but do not mutate
- log useful information
- call `ctx.set_result(...)`
- do not emit a mutation log

When updating starters, keep them:

- short
- correct
- representative of real usage
- explicit about whether they mutate or only analyze

---

## Manifest Contract for Similar Plugins

Third-party plugins can reuse most of Script Lab's architecture without being built-in.

The minimal manifest shape for a similar plugin is:

```json
{
	"schemaVersion": 2,
	"id": "my-script-plugin",
	"name": "My Script Plugin",
	"version": "1.0.0",
	"format": "foldnano_mini",
	"applyStrategy": "replayMutationLog",
	"entrypoint": "def run(ctx):\n    raise RuntimeError('Editor contents should execute instead')\n",
	"sidePanel": {
		"type": "codeEditor",
		"title": "My Script Plugin",
		"icon": "code",
		"codeEditor": {
			"filename": "script.py",
			"initialCode": "from foldnano.plugin import PluginContext\n\n\ndef run(ctx: PluginContext) -> None:\n    pass\n",
			"execution": "entrypoint"
		}
	}
}
```

That will give the plugin:

- a host-owned code editor
- a dedicated side-panel tab after install
- runtime execution from the current editor buffer

What it will not give automatically:

- built-in availability on every editor session
- non-removability
- `Core` badge

Those are host decisions tied to `origin: "builtin"` and registry seeding.

---

## How To Build a Similar Third-Party Plugin

There are two useful patterns.

### Pattern A: dynamic script runner like Script Lab

Use this when the plugin itself is a code-writing environment.

Recommended manifest choices:

- `format: "foldnano_mini"` if users should mutate the model directly
- `applyStrategy: "replayMutationLog"` unless you need strict region scoping
- `sidePanel.type: "codeEditor"`
- `sidePanel.codeEditor.execution: "entrypoint"`

Recommended runtime expectations:

- treat the editor buffer as the full source of truth
- require the script to define `run(ctx)`
- make starter templates clearly mutating or clearly read-only
- never infer an apply action if no mutation log was emitted

### Pattern B: static plugin with editable code input

Use this when the plugin has fixed execution logic but accepts user-authored code as data.

Manifest choices:

- any supported format
- `sidePanel.type: "codeEditor"`
- omit `execution`, or set `execution: "input"`

Behavior:

- the plugin's manifest `entrypoint` runs
- it reads the user editor contents via `ctx.get_side_panel_code()`
- the editor content is input data, not the entrypoint itself

---

## Maintenance Guide

When changing Script Lab, check these areas in order.

### If you change the plugin's identity or default code

Review:

- `src/lib/plugin/scriptLabManifest.ts`
- `src/lib/plugin/PluginRegistry.svelte.ts`
- `src/lib/plugin/PluginRegistry.spec.ts`

Questions to ask:

- should the built-in plugin ID stay stable?
- does changing the starter break expectations in the help menu?
- will old persisted user plugins conflict with the built-in ID?

### If you change how code-editor plugins execute

Review:

- `src/lib/plugin/types.ts`
- `src/lib/plugin/manifestValidation.ts`
- `src/lib/plugin/PluginCoordinator.svelte.ts`
- `src/lib/plugin/PluginCoordinator.spec.ts`

Questions to ask:

- is the new behavior generic for all code-editor plugins, or Script-Lab-specific?
- is `execution: "input"` still backward-compatible?
- does the worker still receive `sidePanelInputJson`?

### If you change apply semantics

Review:

- `src/lib/plugin/PluginCoordinator.svelte.ts`
- `src/lib/components/Editor/Plugin/PluginRunOutput.svelte`
- `src/lib/components/Editor/Plugin/PluginDiffPreview.svelte`
- `src/lib/plugin/ResultApplicator.ts`

Questions to ask:

- does no-op analysis still avoid creating `pendingApply`?
- does `Apply` still auto-surface when a mutation log is present?
- does the stale-result protection still work?

### If you change how editor code is persisted

Review:

- `src/lib/services/storage/indexedDbTypes.ts`
- `src/lib/services/storage/indexeddb/FoldnanoIndexedDb.ts`
- `src/lib/plugin/PluginRegistry.svelte.ts`
- `src/lib/plugin/EditorCodeSaver.svelte.ts`
- `src/lib/components/Editor/SidePanel/PluginCodeEditorSidePanel.svelte`

Questions to ask:

- does the save path cover all code-change sources (typing, template load, reset)?
- does `#loadFromStorage` still restore code for built-ins, not just user plugins?
- does `savePluginEditorState` use `update` rather than `put` to avoid clobbering an existing manifest?
- if a new unindexed field is added to `IndexedDbPluginRecord`, is a version bump needed? (only for new _indexed_ fields)

### If you change the panel UI

Review:

- `src/lib/components/Editor/SidePanel/PluginCodeEditorSidePanel.svelte`
- `src/lib/components/Editor/SidePanel/PluginCodeEditorShell.svelte`
- `src/lib/components/Editor/SidePanel/ScriptLabReferenceCard.svelte`
- `src/lib/components/Editor/Plugin/PluginRunOutput.svelte`

Questions to ask:

- is the editor still primary?
- did helper UI start competing with the editor or output area?
- does the toolbar stay single-row on narrow panel widths?
- does the pop-out window still work (menus open inside it, typing/Enter/Tab, theme switch, closing it docks back)?

---

## Testing Checklist

When maintaining Script Lab, verify at least these cases.

### Manifest and registry

- `execution: "entrypoint"` is accepted
- invalid execution modes are rejected
- Script Lab is registered as a built-in plugin
- built-ins cannot be removed

### Coordinator behavior

- `execution: "input"` plugins still use manifest source
- `execution: "entrypoint"` plugins use the editor buffer as `pluginCode`
- side-panel input is still forwarded as JSON
- no mutation log means no `pendingApply`
- non-empty mutation log creates `pendingApply`

### UI behavior

- Script Lab side panel appears automatically
- Activate appears only when not ready
- Run auto-activates if needed
- the help trigger loads all three starters
- the no-mutation-log notice appears after analysis runs
- output tabs appear only when multiple sections have content
- `Apply` auto-focuses when pending apply exists

### Editor persistence

- typing in the editor and reloading the page restores the last code
- loading a template and reloading restores the template
- resetting to initial code and reloading shows the initial code
- opening a different design file shows the same persisted buffer (global, not per-doc)

### Manual smoke tests

1. Open Script Lab on a design with at least one non-scaffold oligo.
2. Run the mutation starter.
3. Confirm an `Apply` tab appears and applying produces one undo step.
4. Load the analysis starter.
5. Run it and confirm no `Apply` tab appears, but logs and result JSON do.
6. Download the current script and confirm the file matches the current editor buffer.
7. Type custom code, reload the page, confirm the custom code is still in the editor.

---

## Owned plugins (Save as Plugin)

**Save as Plugin** in Script Lab's toolbar packages the current script as a normal packaged plugin
the user owns: it shows in the Plugins list, runs from there like any plugin, and gets **Edit** and
**Export**. Possible later work: § Possible future work.

**Ownership** is the local `authoring` field on the IndexedDB plugin record (`PluginAuthoring`),
never the manifest: a zip can't claim it. Only owned plugins are editable. `PluginRegistry`
carries it through `registerNew(..., { authoring })`, `replaceConfirmed` and `saveOwnedVersion`
(clears the draft). Ownership also needs a package the editor can handle without losing anything
(`isOwnedEditablePackage`: only `fplugin.json` + `plugin.py` + an optional `icon.svg` that the
manifest names exactly when present, no side panel, and only requirements that imports can
produce, i.e. distribution packages). The editor rebuilds the zip from those files and re-derives
requirements, so `replaceConfirmed` with any other package
ends ownership and drops the draft; the replace dialog warns first (`endsEditing`). This keeps
every editable plugin standard tier.

**What Make Plugin writes** (`createOwnedPlugin`): `fplugin.json` + `plugin.py`, Script Lab's run
contract (`foldnano_mini` + `replayMutationLog`, no parameters), version `1.0.0`, and a generated
`local.<8 chars>` id shown read-only in the dialog (renaming never changes it; the prefix keeps
owned ids apart from distributed ones). The manifest carries `x-foldnano-authoring` as a
restore hint only, and is written at the current manifest `schemaVersion`.

**Icon.** The dialog's `PluginIconPicker` offers no icon, the curated `PLUGIN_ICON_PRESETS`
(lucide SVGs), or an uploaded SVG checked with `validatePluginIconSvg`. Whatever is picked is
written into the zip as `icon.svg` with `"icon": "icon.svg"` in the manifest, so a plugin never
depends on the preset list. **Save version** keeps the current icon (`plugin.iconSvg`); the
editor's **Icon** button calls `changeOwnedPluginIcon`, which saves the saved `plugin.py` as the
next version with the new icon and keeps the draft. Rendering and validation: `docs/python-plugin-system.md` § Plugin icons.

**Requirements come from imports, never by hand.** Packaged plugins don't get `loadImports`, so
`PluginCoordinator.resolveScriptRequirements` asks the standard worker (`RESOLVE_IMPORTS`) which
Pyodide distribution packages provide the script's imports, using Pyodide's lockfile import map
(import names differ from package names: `sklearn` is `scikit-learn`). Re-derived on every
**Save version**, so adding or removing an import just works. Distribution packages only.

**Draft vs saved.** Run from the Plugins list always runs the saved zip. The editor buffer is a
draft in `plugin.draftCode` / the record's `draftCode`, written through `EditorCodeSaver` →
`registry.persistDraft` (a buffer equal to the saved code clears the draft). Editor runs pass
`runWithOptions(id, { draftCode })`: the coordinator zips the draft with the plugin's own manifest
and runs it through the normal zip path (same format, apply strategy, builtins), with
`loadImports` so imports the draft added load without re-activation. **Save version** bumps the
patch number (the version keys the file cache, so it only moves up) and writes through
`saveOwnedVersion`, which checks inside the IndexedDB transaction that the stored version is still
the one this tab loaded; if another tab saved first it throws `PluginVersionConflictError` and the
draft stays. The editor is read-only while a save is in flight, so the saved draft is exactly what
was on screen (a later keystroke would otherwise be cleared with the draft). The editor reloads
the saved `plugin.py` whenever the plugin instance changes, not only the version: an import can
replace a plugin at the same version.

**Editor panel.** `OwnedPluginEditorPanel` reuses `PluginCodeEditorShell`. It is a host panel, not a
manifest `sidePanel`: `EditorViewContext.pluginEditorIds` lists open editors (any number;
`openPluginEditor` adds one), `getSidePanelDescriptors` adds a `plugin:<id>` descriptor with
`isOwnedEditor` for each, and `PluginSidePanelHost` routes to the editor. `SidePanel.svelte` keeps
every open editor mounted while hidden, like popped-out panels, so switching icons keeps its undo
history, cursor and scroll. Each editor's pop-out window is named by plugin id (`popOutKey`), and
`bridgeForeignDocument` counts bridged pop-out documents and routes `execCommand` to the focused
one, so several pop-outs work at once. The header's × calls `closePluginEditor` (draft kept). After
a reload, every owned plugin with a draft gets its icon back (with an unsaved dot). Opening a new plugin's editor from the Make Plugin dialog resets Script Lab
to its starter script.

**Backups.** The dialog downloads the zip by default; afterwards **Export** (editor header and
Plugins list) downloads the saved version and records `authoring.lastExportedVersion`, which
drives the amber not-backed-up state. Removing an owned plugin asks first and offers **Export
first**; with a draft it says the export doesn't include unsaved edits. Importing a zip that
`isRestorableOwnedZip` accepts (hint present, `isOwnedEditablePackage`, local file not a Hub URL) offers **Restore as editable** in the install
dialog (`PluginInstallGate.confirmPending({ asEditable })`).

## Possible future work

Ideas worked out far enough to record but not scheduled; other priorities come first. Move an entry
into the sections above when it is implemented, and delete it here.

### Version history and Revert

- Keep the last N saved zips per owned plugin (5 matches the backup count in the user-settings
  backlog). Today only the latest saved version exists, in the `pluginFiles` record.
- **Revert** saves the old code as a **new** version (e.g. 1.0.5 holding 1.0.3's code), never as a
  lower number: the version keys the plugin file cache, so it must only move up, and history stays
  linear.
- Touches `PluginRegistry.saveOwnedVersion`, the IndexedDB plugin tables
  (`docs/storage-architecture.md`) and `OwnedPluginEditorPanel`.

### Edit a copy of a Hub plugin

- Turn an installed Hub plugin into an owned, editable copy under a new `local.*` id; the original
  stays as it is.
- Only packages the owned-plugin editor can handle without losing anything qualify
  (`isOwnedEditablePackage`: `fplugin.json` + `plugin.py` + optional `icon.svg`, no side panel,
  only requirements that imports produce). Most Hub plugins fail this today, so it needs a decision
  on what is copied, what is dropped (with a warning), and what makes a plugin ineligible.

### Export to a folder, then link it in dev mode

- Owned plugins live entirely in IndexedDB and suit Script Lab users; dev mode
  (`docs/explorations/plugin-dev-mode-2026-10-21.md`) links a folder on disk and suits multi-file
  plugins and external editors. Exporting an owned plugin as a folder and linking it would connect
  the two.

### Known limitations (accepted for now)

- **Two browser tabs editing the same draft:** the last write wins, as for Script Lab's own buffer.
  Saving a version is protected (`PluginVersionConflictError`); drafts are not.
- **Clearing browser data deletes owned plugins and drafts.** Mitigated by the default-on backup
  download, Export and the not-backed-up hint; it can't be removed without server storage.

### Plugin Centre (future)

A hosted catalogue of published plugins replacing the bundled Hub list.

- **Local saves are like commits; publishing is a release.** The Centre owns the published version
  line and requires versions to increase at submission. Local saves between publishes never reach
  it.
- **Installing your own published plugin** from the Centre gives a separate, non-editable entry; the
  owned copy remains the working copy.
- **Ids:** `local.*` ids keep owned plugins out of the Centre's id space (e.g. `author.plugin`).
- **Icons in the listing:** the Hub/Centre list is built from pointer manifests before any zip is
  downloaded, so plugin icons (`docs/python-plugin-system.md` § Plugin icons) only show once a
  plugin is installed. The Centre could serve each `icon.svg` next to its zip, validated the same
  way (`validatePluginIconSvg`) and drawn the same way (`PluginIcon.svelte`).

## Relationship To Third-Party Plugins

Script Lab is intentionally a proof point for a more general host capability:

- host-rendered code-editor side panels
- optional runtime execution from the current editor contents
- standard plugin output and apply handling

If a third-party plugin wants Script-Lab-like behavior, the generic host feature they care about is not "the Script Lab plugin" but:

- `sidePanel.type: "codeEditor"`
- `sidePanel.codeEditor.execution: "entrypoint"`
- a suitable `format` plus `applyStrategy`

If future maintenance makes those features more generic, that is good. Script Lab should remain thin and should avoid becoming a special-case runtime fork.

---

## Boundaries / Don'ts

- Don't make completions depend on the Pyodide worker: sources are synchronous and the worker is busy (or not loaded) during runs. Extend the generated index or the shallow inference instead.

- **Do not bypass the plugin system.** Script Lab must stay a normal plugin instance using the same coordinator, worker, and result-apply path as other plugins.
- **Do not persist Script Lab editor code per-document.** The editor buffer is global — the same script should survive tab switches and be available across any open design. Persistence uses the global `plugins` IndexedDB table (`sidePanelCode` field), not the document snapshot or context tables. The same save path now covers every `codeEditor` plugin, not just Script Lab — don't reintroduce a Script-Lab-only guard on it.
- **Do not infer mutations from logs or structured results.** Only `ctx.set_result_mutation_log(...)` should unlock Apply.
- **Do not add "run follow-up" lightly.** Reusing the previous Python namespace would materially change the reproducibility contract.
- **Do not turn `execution: "entrypoint"` into the default for all code-editor plugins without a migration pass.** Existing code-editor plugins rely on `execution: "input"` behavior.
- **Do not render side-panel tabs so that switching unmounts a popped-out plugin panel.** Its `PopOutWindow` closes on unmount; keep `SidePanel`'s keyed list of `poppedOutPluginPanels`.
- **Do not move the editor's DOM nodes into the pop-out window.** Mount into it (`PopOutWindow`); moved nodes lose Svelte's delegated event handlers. Anything that portals or reads `document` directly needs to target the popup's document instead.
- **Do not make helper UI dominate the panel.** Script Lab is an editor first; templates and reference affordances must stay compact.
- **Do not store ownership in the manifest or trust `x-foldnano-authoring`.** It only triggers the Restore as editable question; editability is the local `authoring` record field.
- **Do not let an owned plugin's version go down or repeat.** The version keys the plugin file cache; Save version only bumps up.
- **Do not run an owned plugin's draft under Script Lab's rules.** Drafts run as the plugin (`draftCode`), so what works in the editor works from the Plugins list.
- **Do not hand-edit an owned plugin's `requirements`.** They are derived from imports on create and on every save.
- **Do not special-case Script Lab inside the worker.** The special behavior belongs on the host side when selecting `pluginCodeForRun`.
- **Do not couple third-party plugin guidance to `origin: "builtin"`.** Built-in registration is a host packaging choice, not part of the public third-party plugin contract.
