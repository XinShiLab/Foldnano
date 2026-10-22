---
title: Manifest and Context API
description: Complete plugin manifest schema, wheel URL restrictions, side panel options, and PluginContext input/output methods
category: plugin-development
order: 4
slug: plugin-manifest
---

# Manifest and Context API

## Manifest Reference

```json
{
	"schemaVersion": 2,
	"id": "my-plugin",
	"name": "My Plugin",
	"version": "1.0.0",
	"format": "cadnano_json",
	"applyStrategy": "previewOnly",
	"entrypointUrl": "/plugins/my_plugin/my_plugin.zip",
	"requirements": ["numpy"],
	"description": "Optional description shown in the plugin panel.",
	"icon": "icon.svg"
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `schemaVersion` | Recommended | Manifest schema version, currently `2`. Read as `1` when missing, but include it; `icon` needs `2`. Not your plugin's version; see [Versioning](#versioning-and-unknown-fields). |
| `$schema` | No | Link to the [published JSON Schema](#machine-readable-schema) for editor support. Ignored by Foldnano. |
| `id` | Yes | Unique key used by the registry. Starts with a letter, then letters, digits, `.`, `_` or `-`, up to 64 characters; kebab-case such as `my-plugin` is recommended. Checked when the plugin is installed. |
| `name` | Yes | Display name in the panel. |
| `version` | Yes | A [semantic version](https://semver.org) such as `1.0.0` or `1.2.0-beta.1` (not `latest` or `v1`). Bump it whenever the plugin's files change. Checked when the plugin is installed. |
| `format` | Yes | `"cadnano_json"` \| `"foldnano_json"` \| `"foldnano_mini"`. (`"live"` is reserved and rejected at install time.) |
| `applyStrategy` | Yes | Must match the selected `format`. |
| `entrypoint` | Either/or | Inline Python source string. Only valid for `sidePanel.codeEditor` plugins with `execution: "entrypoint"`; see below. |
| `entrypointUrl` | Either/or | URL to a `.zip` plugin bundle. Required for every other plugin. |
| `requirements` | No | micropip package names, bare `.whl` filenames shipped in the zip, or wheel URLs fetched at activation. |
| `network` | No | Hosts your plugin may contact, or `["*"]` for any HTTPS host. Omit it for no network access; see [Network access](#network-access). |
| `description` | No | Human-readable description. |
| `icon` | No | Path of an SVG icon inside your zip, such as `"icon.svg"`. Needs `"schemaVersion": 2`; see [Plugin icon](#plugin-icon). |
| `parameters` | No | Array of `PluginParamDef`: user-configurable inputs shown in a run dialog. |
| `sidePanel` | No | Optional host-rendered side panel request. Supports `form` and `codeEditor` UIs. |
| `x-…` | No | Your own metadata (for example `"x-homepage"`). Allowed at the top level only; ignored by Foldnano. |

`entrypoint` and `entrypointUrl` are **mutually exclusive**: a manifest that sets both fails validation.

For nearly every plugin, `entrypointUrl` is required and must point to a `.zip` bundle (checked by parsed URL pathname, so `plugin.zip?v=2` is still recognized). Raw `.py` URLs are no longer accepted. `entrypointUrl` can be:

- A relative path to a `.zip` bundle served by Foldnano (e.g. `/plugins/my_plugin/my_plugin.zip`)
- An absolute URL on Foldnano's own site (see below)

The manifest **inside** the zip (`fplugin.json`) may omit `entrypointUrl` entirely, since the installer already knows the code is in the zip it just unpacked. Only a pointer manifest (a Hub entry that ships with Foldnano) needs `entrypointUrl`, and its job is purely to locate the zip: the manifest fetched from inside that zip is what actually gets registered, and its `id` must match the pointer's `id`.

The only case where inline `entrypoint` is allowed is a `sidePanel.codeEditor` plugin with `execution: "entrypoint"`; see [Code-editor execution modes](#code-editor-execution-modes) below. Such a manifest must not also set `entrypointUrl`.

### Versioning and unknown fields

`schemaVersion` tells Foldnano which version of this manifest format you wrote against. It is separate from `version`, which is your plugin's own release number.

- A manifest without `schemaVersion` is read as version 1, so plugins written before the Foldnano beta keep working. Include `"schemaVersion"` anyway: fields added later (such as `icon` in version 2) only work once you declare the version that introduced them.
- A manifest with a higher `schemaVersion` than the running app supports is refused with a request to update Foldnano, rather than having its newer fields silently ignored.
- Unknown fields are rejected, at every level, so a typo such as `"netwrok"` fails loudly instead of quietly doing nothing. Put your own metadata in top-level fields starting with `x-`.

When a field is added, `schemaVersion` goes up and the new schema is published next to the old one. Existing fields never change meaning between versions, so a manifest that works today keeps meaning the same thing.

### Machine-readable schema

Each manifest schema version has a JSON Schema (draft 2020-12), published with the app:

| Schema version | Schema |
| --- | --- |
| 1 | [`/schemas/fplugin-v1.schema.json`](/schemas/fplugin-v1.schema.json) |
| 2 | [`/schemas/fplugin-v2.schema.json`](/schemas/fplugin-v2.schema.json) (adds `icon`) |

Point `$schema` in your manifest at the one matching your `schemaVersion` (for example `"$schema": "https://<foldnano-host>/schemas/fplugin-v2.schema.json"`) and editors such as VS Code will autocomplete fields and flag mistakes as you type. The schema checks structure, types and the `format`/`applyStrategy` pairing. Foldnano checks a little more when installing (allowed URLs, field defaults and ranges, parameters versus side panel forms), so a manifest can pass the schema and still be refused; the install error says why.

### Network access

Plugins run in a sandbox with **no network access by default**. To call a web API, list its hosts in `network`:

```json
"network": ["api.example.org", "*.data.example.org"]
```

- Entries are lowercase host names, optionally with a `*.` prefix or a port (`"localhost:8000"`). Leave out `https://` and any path.
- `["*"]` on its own allows any HTTPS host. Prefer listing hosts: users see the list before they install your plugin.
- `localhost` and `127.0.0.1` are reached over `http://`, everything else over `https://`. The server has to allow cross-origin requests (CORS), because the sandbox has no origin of its own.
- PyPI access for your `requirements` is granted automatically.
- A plugin can never reach Foldnano's own server or the user's GitHub account, whatever it declares.
- Declaring network access puts your plugin in the custom environment; see [Runtime Model → Environment Tiers](/docs/plugin-development/runtime-model).

### Entrypoint URL restrictions

During the beta, `entrypointUrl` must point at Foldnano's own site: in practice, the zips bundled with its Hub. A manifest pointing at any other website is refused at install time, with a suggestion to download the zip and use **Import zip** instead. To share your plugin, share the zip.

### Wheel requirements

A `requirements` entry ending in `.whl` is handled one of two ways:

- **Bare filename** (e.g. `"pkg-1.0-py3-none-any.whl"`, no slash): the wheel must be present at the root of the plugin zip. It is stored in IndexedDB alongside the plugin at install time; activation never re-fetches it.
- **Path or URL on Foldnano's own site** (e.g. `"/plugins/cadnano_mini/v0.1.0/pkg.whl"`): fetched at activation time. Used by first-party plugins; a wheel on any other website is refused, so bundle yours in the zip.

Regular package names (e.g. `"numpy"`, `"humanize>=4"`) are installed from the Pyodide distribution or PyPI. A path, a URL, or a direct reference such as `"pkg @ https://..."` is refused for anything that isn't a `.whl`.

For bare package names, prefer packages from the pinned Pyodide distribution and develop against their exact versions; see [Packages in Pyodide 0.29](https://pyodide.org/en/0.29.4/usage/packages-in-pyodide.html). Staying within that list (unversioned) keeps your plugin in the shared standard environment; see [Runtime Model → Environment Tiers](/docs/plugin-development/runtime-model) for what that means.

### Host-rendered side panels

Plugins can request a dedicated sidebar tab by declaring `sidePanel` in the manifest. The plugin still ships only Python; the host chooses the UI:

- `type: "form"` renders manifest-declared fields in the upper section and runtime output below
- `type: "codeEditor"` renders a built-in Python editor in the upper section and runtime output below

For `type: "codeEditor"`, the optional `sidePanel.codeEditor.execution` field controls what the editor contents mean:

- `"input"` (default): the plugin's manifest entrypoint runs, and the editor contents are passed to Python via `ctx.get_side_panel_code()`
- `"entrypoint"`: the editor contents themselves are executed as the plugin source for that run

`sidePanel.icon` (`form`, `code` or `analysis`) is deprecated for packaged plugins: bundle an SVG with the top-level `icon` instead, which wins when both are set. Code-editor plugins with `execution: "entrypoint"` have no zip, so `sidePanel.icon` remains their only icon option.

### Plugin icon

Give your plugin its own icon by putting an SVG file in the zip and naming it in the manifest:

```json
"schemaVersion": 2,
"icon": "icon.svg"
```

The icon appears on your plugin's sidebar tab and on its row in the Plugins list. Foldnano checks it when the plugin is installed:

- At most 32 KB, with an `<svg>` root that has `xmlns="http://www.w3.org/2000/svg"` and a `viewBox`.
- No scripts, event handlers, `foreignObject`, `<image>` or animation elements.
- No links to other files: `href` and `url()` may only point at an `#id` in the same file.
- The path is relative to the zip root (`"icon.svg"` or `"assets/icon.svg"`) and ends in `.svg`.

Foldnano draws the icon in a single colour that follows the app theme, so design it as a monochrome glyph. A 24×24 stroke icon in the style of [Lucide](https://lucide.dev) fits in well. Code-editor plugins with `execution: "entrypoint"` have no zip, so they can't use `icon`.

### Code-editor execution modes

#### `execution: "input"`

Use this when your plugin has a fixed implementation but wants user-authored code-like text as input. In this mode, `entrypoint` or `entrypointUrl` is the real code that runs, and the editor buffer is available through `ctx.get_side_panel_code()`.

#### `execution: "entrypoint"`

Use this when the editor buffer is the full Python source of truth. In this mode, the host executes the current editor buffer as `pluginCode` for that run. This is the **only** case where a manifest may set inline `entrypoint` instead of `entrypointUrl`. The value is a placeholder never actually run, since the real source is the editor buffer. Such a manifest must not also set `entrypointUrl`. Minimal manifest shape:

```json
{
	"schemaVersion": 2,
	"id": "my-script-plugin",
	"name": "My Script Plugin",
	"version": "1.0.0",
	"format": "foldnano_mini",
	"applyStrategy": "replayMutationLog",
	"entrypoint": "def run(ctx):\n    raise RuntimeError('Editor contents execute at runtime')\n",
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

---

## PluginContext API

Every plugin receives a single `ctx: PluginContext` argument.

### Input

```python
ctx.get_part_as_cadnano_json(part_index: int = 0) -> str
    # Returns the active part as a cadnano JSON string.
    # Only valid when manifest format == "cadnano_json".

ctx.get_part_as_foldnano_json(part_index: int = 0) -> str
    # Returns the active part as a Foldnano JSON string (Part.toJSON() schema).
    # Only valid when format == "foldnano_json", "foldnano_mini", or "live".

ctx.format -> str
    # "cadnano_json" | "foldnano_json" | "foldnano_mini" | "live"

ctx.params -> dict
    # All parameter values confirmed in the run dialog.
    # Keys match the `id` fields declared in manifest.parameters.

ctx.get_param(key: str, default=None)
    # Return a single parameter value, or default if the key is absent.

ctx.side_panel_type -> str | None
    # "form" | "codeEditor" when launched from a side panel.

ctx.get_side_panel_code(default: str = "") -> str
    # Returns the current code editor contents for codeEditor side panels.
```

### Output

```python
ctx.set_result_cadnano_json(json_str: str) -> None
    # Store the modified design as cadnano JSON.

ctx.set_result_foldnano_json(json_str: str) -> None
    # Store the modified design as Foldnano JSON (Part.toJSON() schema).

ctx.set_result_mutation_log(log: list[dict]) -> None
    # Store a foldnano_mini mutation log. Only valid when format == "foldnano_mini".

ctx.active_region_id -> str | None
    # ID of the region currently active in the StrandView.

ctx.log(msg: str) -> None
    # Append a line to the plugin log (shown when the run finishes).
    # print() output is captured too, one log line per printed line.
    # The log keeps the first 5,000 lines (each up to 10,000 characters).

ctx.write_artifact(name: str, data: str | bytes) -> None
    # Store a named artifact (CSV, PDB, etc.).
    # Appears as a download link in the plugin output panel.
    # All artifacts of one run together may total at most 100 MB.

ctx.set_result(data: dict) -> None
    # Store a structured JSON-serialisable dict.
    # Displayed in the plugin output panel as formatted JSON.
```

**Common mistakes:**

- `ctx.set_artifact(...)` does not exist; use `ctx.write_artifact(name, data)`.
- Calling `get_part_as_foldnano_json()` when the manifest declares `format: "cadnano_json"` raises a `RuntimeError`.
- `set_result_cadnano_json` / `set_result_foldnano_json` set the _primary artifact_ that gets applied to the model. `write_artifact` stores _side artifacts_ (CSVs, reports) for download only.
