---
title: Script Lab
description: Write and run your own Python scripts against the open design, and apply their edits as one undoable step
category: guide
order: 13
slug: script-lab
---

<script>
	import Callout from '$lib/components/docs/Callout.svelte';
</script>

# Script Lab

**Script Lab** is a built-in Python code editor in a side panel. You write a short script, run it against the open design, and either read its output (analysis) or apply the changes it made (editing). It uses the same sandboxed in-browser Python runtime as [plugins](/docs/guide/plugins-for-users): a script can't reach the internet, your GitHub account, or your other designs, so nothing leaves your browser. It does see the open design, and its changes land only when you click **Apply**, as one undoable step. Only run code you understand, especially code copied from someone else.

Use it for one-off checks and quick batch edits that don't deserve a full plugin.

## Turning It On

Script Lab ships with Foldnano but is **off by default**.

1. Open the **Plugins** panel from the icon rail on the left edge of the editor.
2. On the **My Plugins** tab, find **Script Lab** (marked **Core**) and switch it on.
3. A new **Script Lab** icon appears in the icon rail. Click it (or **Open Panel** on the plugin card) to open the editor.

Core plugins can be switched off again but not removed.

## The Editor

| Control | What it does |
| --- | --- |
| **Run** | Runs the current editor contents. Activates the Python runtime first if needed. |
| **Stop** | Stops a running script |
| **Clear** | Clears the editor down to a minimal `run(ctx)` skeleton that loads the design |
| **Reset** | Clears the output pane, discards an unapplied result, and returns an errored run to ready (same as **Reset** in the Plugins panel) |
| **Help** (book icon) | Loads a starter script and shows a quick API reference (below) |
| **More** (**⋯**) | Opens a menu with the editor font size (**A−** / **A+**), **Restore default script** (the Mutation Starter), and **Download**, which saves the script as a `.py` file |
| **Pop out** (arrow icon, next to **Python**) | Moves the editor and output into a separate browser window (see [Working In A Separate Window](#working-in-a-separate-window)) |

The editor and output pane are split; drag the divider to resize them. Your script is kept in browser storage, so it survives reloads and is the same whichever design is open.

The editor suggests API names as you type. After a `.` it lists what that object offers, so `part.` shows the part's collections and methods, and inside `for oligo in part.oligos:` the line `oligo.` shows oligo properties such as `color`. Each suggestion shows its type or signature; properties marked *settable* record a change when you assign to them. Press **Tab** or **Enter** to insert a suggestion, or **Ctrl+Space** to open the list anywhere.

### Working In A Separate Window

The side panel is narrow. To give a longer script more room, click the **Pop out** icon next to the **Python** badge. The toolbar, editor and output move into their own browser window, which you can resize or drag to a second screen while the design stays in view in the main window.

![Script Lab panel header with an arrow pointing to the Pop out icon, right of the Python badge](/screenshots/guide/script-lab/03-pop-out-button.webp)

*The **Pop out** icon sits next to the **Python** badge.*

![Script Lab in its own window over the editor, with a script in the editor and the Apply tab open; the main window's side panel shows the Script Lab is open in a separate window placeholder with Show window and Bring back buttons](/screenshots/guide/script-lab/04-pop-out-window.webp)

*The popped-out window has the same controls as the side panel, which now offers to bring the editor back.*

Everything works the same in the popped-out window: **Run**, the output tabs, and **Apply**, which changes the design in the main window as one undoable step. You can switch the side panel to another tab, such as **Source Control**, and the window stays open.

To return the editor to the side panel, click **Bring back** in the side panel, click the panel icon in the window's header, or close the window. **Show window** brings a window that's hidden behind others to the front.

Good to know:

- **Your script moves with it.** Only the editor's own undo history (`Ctrl/Cmd + Z` while typing) starts over each time it moves.
- **Design shortcuts stay in the main window.** Keys such as undo for the design, delete, or switching tools work when the main window has focus, not the popped-out one.
- **Notifications and confirmation dialogs open in the main window.** If a click in the popped-out window seems to do nothing, check the main window.
- **Closing or reloading the main tab closes the window too.**
- **If nothing opens,** your browser blocked the pop-up. Allow pop-ups for this site, then click **Pop out** again.

## Starter Scripts

The **Help** menu offers three starters. Loading one replaces the editor contents.

| Starter | Shows how to |
| --- | --- |
| **Load Mutation Starter** | Load the part, recolor one staple, and return the change so it can be applied |
| **Load Analysis Starter** | Inspect the part and report counts without changing anything |
| **Load Full API Demo** | Exercise every kind of `foldnano_mini` edit on the active design (it makes many changes, so try it on a scratch design) |

The same menu lists the essentials:

- `ctx.get_part_as_foldnano_json()`: the current part
- `ctx.active_region_id`: the region active in the strand viewer, if any
- `ctx.log("...")`: print to the console
- `ctx.set_result({...})`: show structured JSON output
- `ctx.set_result_mutation_log(part.mutation_log)`: make the run's edits applicable
- `load_part(...)` from `foldnano_mini`, then `part.oligos`, `part.virtual_helices`, `part.regions`, and `part.get_region(...)`

For the full API, see [Plugin API](/docs/plugin-development/plugin-api).

## Output And Apply

After a run, the output pane shows tabs for whatever the script produced:

| Tab | Contents |
| --- | --- |
| **Console** | Everything printed with `ctx.log` |
| **Result** | The JSON passed to `ctx.set_result` |
| **Artifacts** | Downloadable files the script wrote |
| **Apply** | The proposed design change, with **Apply** / **Cancel** |

The **Apply** tab appears only when the script returned a non-empty mutation log with `ctx.set_result_mutation_log(...)`, and it opens automatically. Applying records the whole change as **one undoable step** (`Ctrl/Cmd + Z`). A run that returns no mutation log says so and offers nothing to apply, which is normal for analysis scripts.

![Script Lab panel after running the Mutation Starter: the Console tab shows the runtime line and a Recolored oligo message](/screenshots/guide/script-lab/01-after-run-console.webp)

*After a run, the Console tab shows what the script logged.*

![Script Lab panel with the Apply tab open: a replayMutationLog result with 1 op and Cancel and Apply buttons](/screenshots/guide/script-lab/02-after-run-apply.webp)

*The Apply tab shows the proposed change; Apply records it as one undoable step.*

<Callout type="warning">

If you edit the design after a run, the pending result is marked **stale** because the design changed since the script ran. **Discard** it and run the script again rather than applying an outdated change.

</Callout>

## Every Run Starts Fresh

Each run executes the editor contents in a fresh Python namespace against a fresh snapshot of the design. Variables from a previous run are **not** kept, so a script's result depends only on its own code and the current design. The Python runtime itself stays loaded between runs, so later runs start faster.

## Using Packages

Scripts can import the scientific packages that ship with the Python runtime, such as `numpy`, `scipy` and `networkx`. Script Lab loads them on the first run that imports them, and the Console shows a line such as `[env] loaded numpy` followed by its version. That first run takes a few seconds longer.

Packages that don't ship with the runtime can't be imported from Script Lab, because scripts have no internet access. The Console says so when an import fails. To use such a package, turn the script into a plugin zip and list the package under `requirements` (see the [plugin quickstart](/docs/plugin-development/plugin-quickstart)).
