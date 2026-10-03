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

The editor and output pane are split; drag the divider to resize them. Your script is kept in browser storage, so it survives reloads and is the same whichever design is open.

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
