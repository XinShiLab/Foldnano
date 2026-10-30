---
title: Plugin Dev Mode
description: Link a plugin folder on your computer and run it in Foldnano as you edit it, without zipping or reinstalling
category: plugin-development
order: 10
slug: plugin-dev-mode
---

# Plugin Dev Mode

Dev mode lets you keep a plugin in a folder on your computer, edit it in your own editor (VS Code, PyCharm, any other), and run it in Foldnano against real designs. There is no zipping, no version bump and no reinstall between edits: each **Run** reads the folder again.

Dev mode needs a Chromium-based browser (Chrome, Edge, Brave, Arc). It reads the folder with the File System Access API, which Safari and Firefox don't support yet. In other browsers, package the plugin as a zip and use **Import zip**.

## Link a folder

1. Open the **Plugins** panel and switch to the **Dev** tab.
2. Turn on **Plugin dev mode**.
3. Click **Link plugin folder…** and pick the folder that has `fplugin.json` and `plugin.py` at its top level.
4. Review what the manifest declares (format, apply strategy, packages, network access) and click **Link**.

The plugin appears in the Dev tab with a **dev · linked** badge. Click **Activate**, then **Run**.

Foldnano stores only the browser's permission to read the folder, never the files. It writes to the folder only when you create a new plugin there (below).

## Start a new plugin

Pick an empty folder (or one with only a `plugin.py`) in **Link plugin folder…**, and Foldnano opens a **New plugin** form instead:

- **Name** and **Id** (the id follows the name until you edit it), **Version**, **Description**.
- **Format** and **What it does to the design**: only the apply strategies that format allows are offered.
- **Requirements** and **Network access**, if the plugin needs them.
- **Add API stubs for editor autocomplete** writes the `foldnano` and `foldnano_mini` type stubs into `.foldnano-stubs/` and a `pyrightconfig.json`, so VS Code (Pylance), Zed (basedpyright) and other Pyright-based editors complete and type-check the plugin API. Neither is part of the plugin. The config turns off the "could not be resolved from source" warning (the packages only exist inside Foldnano) and uses the `standard` checking mode; set `typeCheckingMode` to `strict` in `pyrightconfig.json` if you want more checks.

The form checks the manifest as you type and shows a preview of `fplugin.json`. **Create and link** asks for permission to write to the folder, writes `fplugin.json` and a starter `plugin.py` that already runs (an existing `plugin.py` is kept), and links the folder. The manifest includes a `$schema` line, so editors that understand JSON Schema check `fplugin.json` as you edit it.

## The edit loop

Edit any file in the folder, save, and click **Run**. Each run:

- reads the whole folder again, so edited, added, renamed and deleted modules are all picked up;
- re-reads `fplugin.json`, so a new parameter appears in the run dialog (values you already chose are kept);
- runs through the same checks as an installed plugin, so a manifest error shows up as it would on install.

`print()` output appears in the run's **Console** while the run is still going. Tracebacks name files by their path in your folder (for example `my-plugin/helpers.py`), so you can jump to the line.

## What Foldnano reads

Everything in the folder except:

- dot-files and dot-folders such as `.git`, `.venv`, `.vscode` and `.DS_Store`;
- `__pycache__`, `node_modules`, `venv`, `env` and `site-packages` folders;
- `*.pyc`, `*.pyo` and `*.zip` files, and `pyrightconfig.json`.

The rest must fit the plugin zip limit (50 MB). Keep large test data outside the plugin folder.

## The dev environment

A linked plugin runs in its own Python environment, separate from installed plugins:

- Code edits reuse the running environment, so runs start quickly.
- When `requirements` or `network` change, Foldnano asks you to accept the change, then builds a fresh environment on the next run. Rebuilt wheels in the folder also trigger a fresh environment.
- **Stop** and run timeouts only end the dev environment; installed plugins keep running.
- **Restart env** builds a fresh environment on request, for example when module-level state got stuck.
- One linked plugin is active at a time. Activating another one takes over the dev environment.

The run log's first line names the environment an installed copy would get, for example `dev (would run as: custom)`. See [Runtime Model](/docs/plugin-development/runtime-model) for what standard and custom mean.

## Check and package

- **Check** lists what would stop the plugin installing or running (no `plugin.py`, no `run(ctx)` function, an `fplugin.json` that isn't valid) together, then manifest problems as an install reports them, then notes: packages that come from PyPI, why the plugin would run in the custom environment, wheels in the folder that `requirements` doesn't list, and which files are ignored.
- **Zip** downloads the folder as the plugin zip that **Import zip** expects, without the ignored files.

## Let a coding agent run it (experimental)

A coding agent working in a linked folder (Claude Code, Codex, Cursor or a plain script) can run Python on the open design without anyone clicking **Run**. This is off until you turn on **Agent runs** (marked *Experimental*) under the **Plugin dev mode** switch. See [Agent Runs](/docs/plugin-development/agent-runs) for how to set it up, how it works, and the risks, including that the agent can send your design to its AI provider.

## Permission, moved folders and unlinking

- After a reload, Chromium may ask again for permission to read the folder when you click **Activate** or **Run**. Each browser tab asks separately.
- If you move or rename the folder, click **Re-link** and pick it again. The folder must still declare the same plugin `id`.
- **Unlink** forgets the folder. Your files are not touched.
- A plugin id can't be linked and installed at the same time. Remove the installed copy first, or unlink before installing the released zip.
- Turning dev mode off stops and hides every linked plugin; turning it back on brings them back.

## When you're done

Click **Zip** (or zip the folder's contents yourself, as described in [Plugin Quick Start](/docs/plugin-development/plugin-quickstart)), then unlink and test the zip with **Import zip**.
