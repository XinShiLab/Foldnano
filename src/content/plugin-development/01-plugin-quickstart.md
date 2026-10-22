---
title: Plugin Quick Start
description: Write and install your first Foldnano plugin in under five minutes
category: plugin-development
order: 1
slug: plugin-quickstart
---

# Plugin Quick Start

This guide is for developers and AI agents writing plugins for Foldnano. A plugin is Python code plus a manifest that tells Foldnano how to run it and whether it can modify the design.

## Minimal Plugin

Every file/URL-delivered plugin is a single zip bundle with `fplugin.json` and `plugin.py` at its root. Start with a plugin folder:

**`my_plugin/plugin.py`**

```python
from foldnano.plugin import PluginContext

def run(ctx: PluginContext) -> None:
    ctx.log("Hello from my plugin")
    ctx.set_result({"status": "ok"})
```

**`my_plugin/fplugin.json`**

```json
{
	"schemaVersion": 2,
	"id": "my-plugin",
	"name": "My Plugin",
	"version": "1.0.0",
	"format": "cadnano_json",
	"applyStrategy": "previewOnly",
	"description": "One-line description shown in the plugin panel."
}
```

The manifest inside the zip doesn't need `entrypointUrl`. The installer already knows `plugin.py` is in the zip.

Zip the two files together **from inside the folder** (no directory prefix):

```bash
cd my_plugin
zip my_plugin.zip fplugin.json plugin.py
```

Install it with the **Import zip** button in the Plugin panel (or by opening the `.zip` file directly).

### Sharing your plugin

Share the `.zip` file itself, for example by email, a lab file share, or a release on GitHub. Your users install it with **Import zip**. During the beta, Foldnano installs plugins only from a local zip or from its own Hub, not from links to other websites; a manifest whose `entrypointUrl` points at another site is refused.

## What Happens When It Runs

1. Foldnano reads the manifest.
2. The plugin runtime loads the Python entrypoint in a [Pyodide](https://pyodide.org/en/0.29.4/index.html) worker (CPython in WebAssembly; see [Runtime Model](/docs/plugin-development/runtime-model) for what does and doesn't work there).
3. Foldnano passes the active design to Python in the format declared by the manifest.
4. The plugin logs messages, writes artifacts, returns structured results, or returns a design mutation.
5. If the plugin is mutating, the user chooses whether to apply the result.

Preview-only plugins are the safest starting point. They can inspect a design and produce reports without changing the model.

## Adding More Files

The zip isn't limited to one file: add helper modules, data tables, or a `.whl` wheel at the zip root (subfolders are fine too). Everything ships in the same bundle as `fplugin.json` and `plugin.py`. Keep the zip at **50 MB or less**, and under **200 MB** once unpacked.

Use the testing guide before distributing a mutating plugin.
