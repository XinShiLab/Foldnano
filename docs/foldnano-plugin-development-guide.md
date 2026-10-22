---
covers:
  - src/lib/plugin/python/foldnano/**
  - src/lib/plugin/python/foldnano_mini/**
  - src/lib/plugin/manifestValidation.ts
  - src/lib/plugin/envClassification.ts
  - src/lib/plugin/types.ts
  - src/lib/plugin/core_plugins/**
---

# Foldnano Plugin Development Guide

This guide is for developers and AI agents writing plugins for the Foldnano web app. It covers the full plugin authoring workflow, the Python API, and reference patterns drawn from the bundled demo plugins (see the table below).

For the system-level architecture (bridge, registry, coordinator, worker protocol) see [python-plugin-system.md](python-plugin-system.md).

---

## Quick Start

A plugin is one zip containing a manifest and an entry point:

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

Build and install:

```bash
cd my_plugin
zip my_plugin.zip fplugin.json plugin.py
```

Click **Import zip** in the Plugin panel and select `my_plugin.zip` — done, no
hosting needed. Share the zip itself with your users: during the beta,
Foldnano installs plugins only from a local zip or from its own bundled Hub,
not from other websites.

Foldnano's own bundled plugins follow the same format — their sources live in
`static/plugins/<dir>/` and `pnpm build:plugins` packages each dir into
`/plugins/<dir>/<dir>.zip`, injecting the matching
`src/lib/plugin/core_plugins/<name>.fplugin.json` as the zip's manifest.

---

## Choosing a Format

| Question                                                            | Use                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| I only need helix topology and colors                               | `cadnano_json`                                                |
| I need sequences, oligo names, or modifications                     | `foldnano_json`                                               |
| I need to mutate the model and preserve sequences                   | `foldnano_json` with `replacePartKeepAnnotationsWhereMatched` |
| I want to write code that mutates the part directly (one undo step) | `foldnano_mini` with `replayMutationLog` / `…InRegion`        |

**`cadnano_json`** is a lossy format — it carries helix topology and staple colors but drops sequences, modifications, oligo names, and the explicit scaffold flag (which is re-derived from lattice parity on import).

**`foldnano_json`** is the lossless `Part.toJSON()` snapshot. It includes everything: per-slot sequences, skip/insert structure, modifications, oligo names, `isScaffold` flag, and UUIDs. It is the only format that exposes sequence data to plugins.

**`foldnano_mini`** is the mutable API. The plugin operates on a `MutablePart` whose mutations are captured as a structured op log; the host replays the log against the real JS-side `Part` under one undo step. This is the only format that lets you express _direct_ edits (`oligo.color = '#f00'`, `part.create_segment(...)`, `part.connect(a, b)`) instead of producing a whole-part snapshot. See [Writing plugins with `foldnano_mini`](#writing-plugins-with-foldnano_mini).

**`live`** is reserved for a future phase (direct in-worker model proxy access) and is not currently installable. Manifests that declare `format: "live"` are rejected at install time.

---

## Choosing an Apply Strategy

| Strategy                                          | When to use                                                                                                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `previewOnly`                                     | Analysis-only plugins that produce logs, CSV reports, or other artifacts without mutating the design. The model is never touched.                                                                     |
| `replacePartKeepAnnotationsWhereMatched`          | Whole-part replacement for `foldnano_json` plugins when sequences, modifications, and names should be re-grafted onto matched segments after the replace.                                             |
| `replacePart`                                     | Whole-part replacement for `foldnano_json` plugins when annotation re-grafting would be incorrect. Shows a data-loss warning before apply.                                                            |
| `replaceRegion` / `replaceRegionKeepAnnotations…` | Region-scoped replacement for `cadnano_json` plugins. Cross-region links are re-grafted automatically. Region replacement must preserve the region's VH index set; creating new VHs is not supported. |
| `replayMutationLog`                               | Replay a `foldnano_mini` mutation log against the existing part. One undo step covers the whole run.                                                                                                  |
| `replayMutationLogInRegion`                       | As above, but every op's target VH must belong to the active region; otherwise the replay aborts cleanly.                                                                                             |

For `foldnano_json` mutations, **always prefer `replacePartKeepAnnotationsWhereMatched`** unless you are intentionally changing the topology. It ensures sequences assigned before the run survive the apply.

For `foldnano_mini` mutations, choose `replayMutationLogInRegion` when your plugin only touches the active region (the host enforces the scope) and `replayMutationLog` when it touches the whole part.

For `cadnano_json` region replacement, treat the active region's VH numbering as fixed. A `replaceRegion*` plugin may rewrite topology within those helices, but it must not introduce brand-new VHs for that region.

Install-time validation enforces the supported combinations:

- `cadnano_json`: `previewOnly`, `replaceRegion`, `replaceRegionKeepAnnotationsWhereMatched`
- `foldnano_json`: `previewOnly`, `replacePart`, `replacePartKeepAnnotationsWhereMatched`
- `foldnano_mini`: `previewOnly`, `replayMutationLog`, `replayMutationLogInRegion`

---

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
	"description": "Optional description shown in the plugin panel."
}
```

| Field           | Required | Notes                                                                                                                                                                                                                                                                            |
| --------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | Yes      | Unique key used by the registry: a letter, then letters, digits, `.`, `_` or `-` (at most 64). Use kebab-case.                                                                                                                                                                   |
| `schemaVersion` | No\*     | Manifest schema version, currently `2`; read as `1` when missing, but always include it. Not your plugin's version. Unknown fields are rejected; top-level `x-` fields are allowed for your own metadata. Schema: `static/schemas/fplugin-v1.schema.json`.                       |
| `name`          | Yes      | Display name in the panel.                                                                                                                                                                                                                                                       |
| `version`       | Yes      | Semver (`1.0.0`, `1.2.0-beta.1`), validated at install. **Must be bumped whenever plugin files change** (entrypoint or wheels) — the host caches file assets keyed on this version, so omitting a bump means users will run stale cached files until they clear browser storage. |
| `format`        | Yes      | `"cadnano_json"` \| `"foldnano_json"` \| `"foldnano_mini"`. (`"live"` is reserved for a future phase and is rejected at install time — do not use it.)                                                                                                                           |
| `applyStrategy` | Yes      | Must match the selected `format`. `cadnano_json` supports only `"previewOnly"` and `"replaceRegion"*`; `foldnano_json` supports only `"previewOnly"` and `"replacePart"*`; `foldnano_mini` supports only `"previewOnly"` and `"replayMutationLog"*`.                             |
| `entrypoint`    | Special  | Placeholder inline source — **only** valid for `sidePanel.codeEditor` plugins with `execution: "entrypoint"` (see below). Mutually exclusive with `entrypointUrl`.                                                                                                               |
| `entrypointUrl` | Yes\*    | URL of the plugin `.zip` bundle, fetched once at install time. \*The manifest **inside** a zip may omit it — the installer knows the files are in the zip.                                                                                                                       |
| `requirements`  | No       | micropip package names, bundled wheel filenames, or wheel URLs. See **Wheel requirements** below.                                                                                                                                                                                |
| `network`       | No       | Hosts your plugin needs to contact, e.g. `["api.example.org"]`, or `["*"]` for any HTTPS host. Omit it if you need no network: undeclared requests are blocked. See **Network access** below.                                                                                    |
| `description`   | No       | Human-readable description.                                                                                                                                                                                                                                                      |
| `parameters`    | No       | Array of `PluginParamDef` — declares user-configurable inputs shown in a run dialog. See [User-Configurable Parameters](#user-configurable-parameters).                                                                                                                          |
| `sidePanel`     | No       | Optional host-rendered side panel request. Supports only built-in `form` and `codeEditor` UIs.                                                                                                                                                                                   |

`entrypoint` and `entrypointUrl` are **mutually exclusive** — setting both is a
validation error. Inline `entrypoint` is only legal for code-editor plugins with
`execution: "entrypoint"` (Script-Lab-like); every other plugin is delivered as
a zip and needs `entrypointUrl` pointing at it (except inside the zip itself,
where the field may be omitted). Raw `.py` entrypoint URLs are **no longer
supported**.

`entrypointUrl` can be:

- A relative path to a `.zip` bundle (e.g. `/plugins/my_plugin/my_plugin.zip`) served from `static/`
- An absolute URL on Foldnano's own origin. Other websites are refused; share a zip instead.

The `.zip` check uses the parsed URL pathname, so cache-busting query strings
(`my_plugin.zip?v=2`) work.

### Wheel requirements

`requirements` entries ending in `.whl` come in two flavors:

- **Bundled wheels** — bare filenames (e.g. `"mypkg-1.0-py3-none-any.whl"`, no slash). The file must sit at the plugin zip's root; it is extracted and stored at install time, no network needed at activation.
- **Wheels served by Foldnano** — paths (e.g. `/plugins/shared/pkg.whl`) or URLs on Foldnano's own origin, fetched at activation and cached in IndexedDB. Used by first-party plugins; a wheel on any other website is refused, so bundle yours in the zip.

Regular micropip package names (e.g. `"numpy"`, `"humanize>=4"`) are installed from the Pyodide distribution or PyPI. Before installing, users see your requirements grouped by source (Pyodide distribution, PyPI, bundled, provided by Foldnano), with PyPI packages flagged as third-party code Foldnano doesn't review; prefer distribution packages where you can. Paths, URLs and direct references (`"pkg @ https://…"`) are refused for anything that isn't a `.whl`.

### Network access

Plugins run in a sandbox with **no network by default**. To call a web API,
declare its host names in `network`:

```json
"network": ["api.example.org", "*.data.example.org"]
```

- Entries are bare, lowercase host names, optionally with a `*.` prefix or a
  port (`"localhost:8000"`). No `https://` and no paths.
- `"*"` (alone) allows any HTTPS host. Prefer listing hosts: users see the
  declaration before they install, and a short list is easier to trust.
- `localhost` and `127.0.0.1` are reached over `http://`; everything else over
  `https://`. The server must allow cross-origin requests (CORS), because the
  sandbox has no origin of its own.
- PyPI access for your `requirements` is granted automatically; you don't need
  to declare it.
- A plugin can never reach Foldnano's own server or the user's GitHub account,
  whatever it declares.
- Declaring any network access puts the plugin in the **custom environment**
  (below), so it doesn't share a runtime with other plugins.

### Standard vs custom environment

Your `requirements` and `network` decide which of two runtimes your plugin lands in
(`classifyEnv` in `src/lib/plugin/envClassification.ts`; the tier is shown as a
badge in the plugin list, install dialog, and Hub):

- **Standard environment** — a persistent Python runtime shared by all
  standard-tier plugins, defined by the pinned Pyodide version (see
  `docs/python-plugin-system.md` § Environment tiers). Your plugin qualifies
  when every requirement is either an **unversioned name from the Pyodide
  distribution** (e.g. `"numpy"`, `"pandas"`) or a **standard extra** — a
  first-party pinned wheel referenced by bare name, currently
  `"cadnano2_5_mini"`. Standard plugins activate side by side with no
  reinstall when the user switches between them. **Prefer staying
  standard-tier**: it is the fastest and most predictable experience.
- **Custom environment** — anything else routes here: any declared `network`, off-dist PyPI names
  (their versions float), any version specifier (even one matching the dist
  version, e.g. `"numpy==1.26.4"`), or any `.whl` entry. Custom plugins get a
  dedicated runtime, but **only one custom-environment plugin can be active at
  a time** — activating yours evicts the previous one (the user is asked to
  confirm if it is busy), and switching pays a full teardown + reinstall.

Practical consequences for authors:

- **Avoid version pins unless you truly need them.** A pin both demotes your
  plugin to the custom tier and forfeits concurrent activation.
- **Ship wheels only when the library isn't in the Pyodide distribution.** A
  wheel makes the plugin custom-tier. Give wheel-shipped modules distinctive
  (namespaced) names rather than generic ones.
- **Don't rely on import-time state persisting or resetting between runs.**
  Your plugin's own modules are re-imported fresh each run, but installed
  dependencies keep whatever state earlier runs (or, in the standard tier,
  other plugins) left in them.
- **Don't mutate global library configuration.** In the standard tier, calls
  like `np.seterr(...)`, `pd.set_option(...)`, `warnings.filterwarnings(...)`,
  or monkey-patching a shared module change behavior for every other standard
  plugin in the session. If you must change a global setting, save the previous
  value and restore it before `run(ctx)` returns (e.g. `with np.errstate(...):`).

### Host-rendered side panels

Plugins can request a dedicated sidebar tab by declaring `sidePanel` in the manifest. The plugin still ships only Python; the host chooses the UI:

- `type: "form"` renders manifest-declared fields in the upper section and runtime output below
- `type: "codeEditor"` renders a built-in Python editor in the upper section and runtime output below

For `type: "codeEditor"`, the optional `sidePanel.codeEditor.execution` field controls what the editor contents mean:

- `"input"` (default) — the plugin's manifest entrypoint runs, and the editor contents are passed to Python via `ctx.get_side_panel_code()`
- `"entrypoint"` — the editor contents themselves are executed as the plugin source for that run

### Plugin icon

Bundle an SVG in your zip and name it with the top-level `icon` field (manifest `schemaVersion` 2):

```json
{ "schemaVersion": 2, "icon": "icon.svg", ... }
```

It appears on your sidebar tab and your row in the Plugins list. Requirements: at most 32 KB, an `<svg>` root with `xmlns="http://www.w3.org/2000/svg"` and a `viewBox`, and no scripts, event handlers, `foreignObject`, `<image>`, animations or links to other files (`href` and `url()` may only point at `#ids` in the same file). Foldnano draws it in a single colour that follows the app theme, so design it as a monochrome glyph (a 24×24 stroke icon like [Lucide](https://lucide.dev)'s works well). Code-editor plugins with `execution: "entrypoint"` have no zip and can't use `icon`.

`sidePanel.icon` (`form`, `code` or `analysis`) is **deprecated** for packaged plugins: it still works when there is no top-level `icon`, but new plugins should bundle an SVG. Code-editor plugins with `execution: "entrypoint"` have no zip, so for them `sidePanel.icon` remains the only option. Arbitrary icon URLs and plugin-defined UI are intentionally unsupported.

### Choosing a code-editor execution mode

#### `execution: "input"`

Use this when your plugin has a fixed implementation but wants user-authored code-like text as input.

Example use cases:

- a Python plugin that reads a small filter expression
- a plugin that accepts a generated snippet and interprets it
- a plugin that provides a "mini language" but still controls execution itself

In this mode:

- `entrypoint` or `entrypointUrl` is the real code that runs
- the editor buffer is available through `ctx.get_side_panel_code()`

#### `execution: "entrypoint"`

Use this when the editor buffer is the full Python source of truth.

Example use cases:

- Script-Lab-like dynamic script runners
- plugins that let the user author a complete `run(ctx)` implementation at runtime

In this mode:

- the host executes the current editor buffer as `pluginCode` for that run
- the same editor buffer is still available through `ctx.get_side_panel_code()`

If you want a third-party plugin that behaves like Script Lab, this is the mode to use. See [script-lab.md](script-lab.md) for the reference implementation on the host side.

Minimal manifest shape:

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
    # Raises RuntimeError if called with the wrong format.

ctx.get_part_as_foldnano_json(part_index: int = 0) -> str
    # Returns the active part as a Foldnano JSON string (Part.toJSON() schema).
    # Only valid when format == "foldnano_json", "foldnano_mini", or "live".
    # Raises RuntimeError if called with the wrong format.

ctx.format -> str
    # "cadnano_json" | "foldnano_json" | "foldnano_mini" | "live"

ctx.params -> dict
    # All parameter values confirmed in the run dialog.
    # Keys match the `id` fields declared in manifest.parameters.
    # Empty dict when the plugin declares no parameters.

ctx.get_param(key: str, default=None)
    # Return a single parameter value, or default if the key is absent.
    # Number inputs arrive as Python float (or int when step is 1 and the
    # value has no fractional part — always cast explicitly if you need int).

ctx.side_panel_type -> str | None
    # "form" | "codeEditor" when launched from a side panel.

ctx.get_side_panel_code(default: str = "") -> str
    # Returns the current code editor contents for codeEditor side panels.
    # For execution="input" plugins, this is usually the primary purpose of
    # the editor. For execution="entrypoint" plugins, this returns the same
    # source code the host executed for that run.
```

### Output

```python
ctx.set_result_cadnano_json(json_str: str) -> None
    # Store the modified design as cadnano JSON.
    # The host applies it via applyStrategy after user confirmation.

ctx.set_result_foldnano_json(json_str: str) -> None
    # Store the modified design as Foldnano JSON (Part.toJSON() schema).
    # The host applies it via applyStrategy after user confirmation.

ctx.set_result_mutation_log(log: list[dict]) -> None
    # Store a foldnano_mini mutation log. Only valid when format == "foldnano_mini".
    # The host replays the log under one undo step via replayMutationLog[InRegion].

ctx.active_region_id -> str | None
    # ID of the region currently active in the StrandView (None if no region is selected).
    # Pass this into load_part(...) so the mutable part exposes oligos_in_region().

ctx.log(msg: str) -> None
    # Append a line to the plugin log (shown when the run finishes).
    # Also prints to stdout — print() calls are captured too, one log line per printed line.

ctx.write_artifact(name: str, data: str | bytes) -> None
    # Store a named artifact (CSV, PDB, etc.).
    # Appears as a download link in the plugin output panel.
    # name must be a non-empty string.

ctx.set_result(data: dict) -> None
    # Store a structured JSON-serialisable dict.
    # Displayed in the plugin output panel as formatted JSON.
    # Keys and values must be JSON-serialisable.
```

**Common mistakes:**

- `ctx.set_artifact(...)` does not exist — use `ctx.write_artifact(name, data)`.
- Calling `get_part_as_foldnano_json()` when the manifest declares `format: "cadnano_json"` raises a `RuntimeError`.
- `set_result_cadnano_json` / `set_result_foldnano_json` set the _primary artifact_ that gets applied to the model. `write_artifact` stores _side artifacts_ (CSVs, reports) for download only.

---

## The foldnano.io Parse API

Use `parse_foldnano_json()` to get a typed object hierarchy instead of working with raw dicts.

```python
from foldnano.io import parse_foldnano_json

part = parse_foldnano_json(ctx.get_part_as_foldnano_json())
```

### PartData

```python
part.name          # str — part name
part.id            # str — part UUID
part.lattice_type  # "HONEYCOMB" | "SQUARE"
part.max_base      # int — number of bp slots per helix
part.virtual_helices  # list[VirtualHelixProxy]
part.oligos           # list[OligoProxy]
part._raw             # dict — the original JSON dict; mutate this for round-trip changes

part.get_vh(index)    # -> VirtualHelixProxy | None
part.get_oligo(id)    # -> OligoProxy | None
```

### OligoProxy

```python
oligo.id                  # str — UUID
oligo.color               # str — hex color e.g. "#0066cc"
oligo.is_scaffold         # bool
oligo.is_sequence_locked  # bool
oligo.name                # str | None
oligo.segments            # list[OligoSegmentProxy] — ordered 5'→3'

oligo.sequence            # str — concatenated sequence across all segments
oligo.is_circular         # bool — True when last segment's 3' connects to first's 5'
```

### OligoSegmentProxy

```python
seg.id                       # str — UUID
seg.vh_index                 # int — which VirtualHelix this segment lives on
seg.five_prime_index         # int — bp index of 5' end on the helix
seg.three_prime_index        # int — bp index of 3' end on the helix
seg.five_prime_modification  # str | None — e.g. "/5Alex488N/"
seg.three_prime_modification # str | None
seg.connected_from_segment_id # str | None — upstream segment ID (None = global 5')
seg.connected_to_segment_id   # str | None — downstream segment ID (None = global 3')
seg.slots                     # list[dict] — per-bp records: {"bpIndex": int, "seq": str}
seg.sequence                  # str — pre-computed sequence for this segment

seg.length                    # int — abs(three_prime_index - five_prime_index) + 1
seg.is_free_five_prime        # bool — True when this is the oligo's global 5' end
seg.is_free_three_prime       # bool — True when this is the oligo's global 3' end
```

### VirtualHelixProxy

```python
vh.index    # int — VH index unique within the part
vh.row      # int — lattice row
vh.col      # int — lattice column
vh.length   # int — number of bp slots
vh.strand_set_segment_ids  # list[list[str]] — [ss0_ids, ss1_ids]
                            # ss0 runs 5'→3' (ascending), ss1 runs 3'←5' (descending)

vh.parity_is_even  # bool — True when row % 2 == col % 2
                   # Even parity → ss0 is scaffold; odd → ss1 is scaffold
```

---

## Round-Trip Mutation Pattern

For `foldnano_json` plugins that mutate the design:

```python
import json
from foldnano.io import parse_foldnano_json
from foldnano.plugin import PluginContext

def run(ctx: PluginContext) -> None:
    # 1. Parse into typed proxies
    part = parse_foldnano_json(ctx.get_part_as_foldnano_json())

    # 2. Build a lookup from oligo id → index in _raw["oligos"]
    raw_oligos = part._raw.get("oligos", [])
    id_to_idx = {o["id"]: i for i, o in enumerate(raw_oligos)}

    # 3. Mutate _raw in-place using proxy objects to find what to change
    for oligo in part.oligos:
        if oligo.is_scaffold:
            continue
        idx = id_to_idx.get(oligo.id)
        if idx is not None:
            raw_oligos[idx]["color"] = "#ff0000"  # example: paint everything red

    # 4. Return the modified _raw
    ctx.set_result_foldnano_json(json.dumps(part._raw))
```

**Key rule:** Use the proxy objects (`.oligos`, `.segments`, etc.) for reading and finding things. Mutate `part._raw` for writing. Do not mutate proxy attributes — they are read-only views and changes will not be serialised back.

---

## Writing plugins with `foldnano_mini`

`foldnano_mini` is a mutable, ergonomic Python API. You assign to attributes and call methods on the part — each mutation is recorded as a structured op in `part.mutation_log`, and the host replays the log against the real JS-side `Part` inside one history transaction. The final state is one undo step regardless of how many ops you emit.

```python
from foldnano.plugin import PluginContext
from foldnano_mini import LatticedRegion, load_part

def run(ctx: PluginContext) -> None:
    part = load_part(
        ctx.get_part_as_foldnano_json(),
        active_region_id=ctx.active_region_id,
    )

    # Direct attribute writes record ops automatically.
    for oligo in part.oligos_in_region(part.active_region_id):
        if not oligo.is_scaffold:
            oligo.color = "#ff8800"

    # Structural mutations are method calls.
    region = part.get_region(part.active_region_id)
    if isinstance(region, LatticedRegion):
        new_vh = region.add_vh_at(row=4, col=2)
        seg = part.create_segment(
            vh=new_vh, five_index=0, three_index=20, color="#33cc66",
        )
        seg.slot_at(5).seq = "A"

    ctx.set_result_mutation_log(part.mutation_log)
```

### Discovering the API

You don't have to memorise the surface:

- **Type stubs.** `src/lib/plugin/python/stubs/foldnano_mini/__init__.pyi` (and `stubs/foldnano/__init__.pyi`) list every public class, method and property with signatures and docstrings, generated from the bundled sources. Read them directly, hand them to a coding agent, or set `MYPYPATH` / pyright `stubPath` to that `stubs` folder for editor completion and type checking outside Foldnano.
- **Script Lab autocomplete.** Typing `.` after `ctx`, `part`, or anything derived from them (`part.active_region.`, `for oligo in part.oligos: oligo.`) lists that object's members; **Ctrl+Space** opens the list anywhere.

### Loading and the active region

```python
part = load_part(json_str, active_region_id=None)  # -> MutablePart
```

`active_region_id` should usually be threaded from `ctx.active_region_id`. It enables `part.active_region`, `part.oligos_in_region(region_id)`, `part.vhs_in_region(region_id)`, and (with `replayMutationLogInRegion`) is enforced by the host as a scope constraint at apply time.

### MutablePart surface

```python
part.regions             # list[MutableRegion]   — LatticedRegion | FreeformRegion
part.planes              # list[MutablePlane]
part.virtual_helices     # list[MutableVirtualHelix]
part.oligos              # list[MutableOligo | MirrorOligo] — mirrors are read-only copies
part.real_oligos         # list[MutableOligo] — every oligo except mirrors (Part.realOligos)
part.repeat_groups       # list[MutableRepeatGroup]
part.active_region       # MutableRegion | None
part.mutation_log        # list[dict] — JSON-serialisable op records
part.lattice_type        # 'HONEYCOMB' | 'SQUARE' | 'FREEFORM' (from first region)
part.max_base            # int

part.get_region(id)      # -> MutableRegion | None
part.get_vh(index)       # -> MutableVirtualHelix | None
part.get_oligo(id)       # -> MutableOligo | MirrorOligo | None
part.get_repeat_group(id) # -> MutableRepeatGroup | None
part.oligos_in_region(region_id)
part.vhs_in_region(region_id)

# Structural mutations (each raises InvalidOperationError when its can_* check refuses)
part.create_segment(vh, five_index, three_index, color="#0066cc")  # strand set derived: 0 if 5'<3', else 1
part.create_oligo([(vh, five, three), ...], color=..., name=..., circular=False)  # -> MutableOligo
part.connect(seg_from, seg_to)        # 3'→5'; adjacent ends merge into one segment
part.break_oligo(seg, at_index)       # -> MutableOligo holding the 3' side
part.remove_oligo(oligo)
part.remove_segment(seg)              # -> MutableOligo split off downstream, or None
part.fill_empty_strand_set(vh, strand_index)  # -> MutableSegment over the whole strand
part.create_repeat_group([oligo, ...], bp_offset)  # -> MutableRepeatGroup (see Repeat groups)

# Editor-level edits (named after the host Part methods / commands)
part.get_segment_at(vh, strand_index, bp)     # hit test -> MutableSegment | None
part.get_oligo_at(vh, strand_index, bp)       # -> MutableOligo | None (Part.getOligoByVh)
part.get_end_at(vh, strand_index, bp)         # 5'/3' end at that bp -> MutableSegmentEnd | None
part.get_slot_at(vh, strand_index, bp)        # -> MutableSlot | None
part.add_skip_at(vh, bp), part.add_insert_at(vh, bp, count=1)  # skip / insert tools, both strands
part.remove_skip_or_insertion_at(vh, bp)
part.break_at(vh, strand_index, bp)           # break tool -> MutableOligo holding the 3' side
part.connect_oligos(from_oligo, to_oligo)     # free 3' → free 5' (Part.connectTwoOligos)
part.create_crossover(from_oligo, vh, strand_index, bp)  # 3' end onto a strand (Part.createCrossover)
part.make_crossover(vh, strand_index, bp, to_vh)         # at a potential site (makeCrossoverCmd)
part.reorder_vh(vh, target_region_row)
part.add_region(kind, name, max_base, ...)  # -> MutableRegion; also creates a plane
part.split_region(region_id, split_after_vh_id)
part.set_plane_transform(plane_id, origin, u, v, normal)
part.remove_vhs([index, ...])
part.to_json()                        # full snapshot of the in-worker mirror

# Checks (truthy Check with .reason) and crossover sites
part.can_create_segment(vh, five_index, three_index)
part.can_create_oligo([(vh, five, three), ...], circular=False)
part.can_connect(seg_from, seg_to)
part.can_break_oligo(seg, at_index), part.can_break_at(vh, strand_index, bp)
part.can_connect_oligos(a, b), part.can_create_crossover(...), part.can_make_crossover(...)
part.can_fill_empty_strand_set(vh, strand_index)
part.can_create_repeat_group([oligo, ...], bp_offset)
part.potential_xover_sites(vh)        # [strand 0 sites, strand 1 sites]
```

### Properties that record ops

**Oligo and segment property ops (14 original)**

| Read/write attribute               | Op kind                               |
| ---------------------------------- | ------------------------------------- |
| `oligo.color = '#…'`               | `set_oligo_color`                     |
| `oligo.name = '…'`                 | `set_oligo_name`                      |
| `oligo.is_scaffold = True/False`   | `set_oligo_is_scaffold`               |
| `seg.five_modification = '/5…/'`   | `set_segment_modification`            |
| `seg.three_modification = '/3…/'`  | `set_segment_modification`            |
| `seg.slot_at(bp).seq = '…'`        | `set_slot_sequence`                   |
| `seg.slot_at(bp).set_skip(True)`   | `set_slot_skip`                       |
| `seg.slot_at(bp).set_insertion(…)` | `set_slot_insertion`                  |
| `seg.remove()`                     | `remove_segment`                      |
| `oligo.remove()`                   | `remove_oligo`                        |
| `region.add_vh_at(row, col)`       | `add_vh_at_coords` (LatticedRegion)   |
| `vh.local_frame = {…}`             | `set_vh_local_frame` (FreeformRegion) |
| `part.create_segment(...)`         | `create_segment`                      |
| `part.connect(seg_from, seg_to)`   | `connect`                             |
| `part.remove_vhs([...])`           | `remove_vhs`                          |

**Strand editing ops (new)**

| Method call                       | Op kind         |
| --------------------------------- | --------------- |
| `part.break_oligo(seg, at_index)` | `break_oligo`   |
| `seg.move_five_prime_to(idx)`     | `move_terminus` |
| `seg.move_three_prime_to(idx)`    | `move_terminus` |

**VH and region sizing ops (new)**

| Method / assignment                | Op kind               |
| ---------------------------------- | --------------------- |
| `vh.length = n`                    | `set_vh_length`       |
| `region.set_max_base(n)`           | `set_region_max_base` |
| `region.increase_length_by(delta)` | `set_region_max_base` |

**VH geometry ops (new)**

| Method call                                            | Op kind           |
| ------------------------------------------------------ | ----------------- |
| `vh.move_to(col, row)`                                 | `move_lattice_vh` |
| `freeform_region.add_vh_at(origin, direction, length)` | `add_freeform_vh` |
| `part.reorder_vh(vh, target_region_row)`               | `reorder_vh`      |

**Plane and region structure ops (new)**

| Method call                                                | Op kind                |
| ---------------------------------------------------------- | ---------------------- |
| `part.set_plane_transform(plane_id, origin, u, v, normal)` | `transform_plane`      |
| `part.add_region(kind, name, max_base, ...)`               | `add_region_and_plane` |
| `part.split_region(region_id, split_after_vh_id)`          | `split_region`         |

**Repeat group ops**

| Method call                             | Op kind                  |
| --------------------------------------- | ------------------------ |
| `part.create_repeat_group(oligos, off)` | `create_repeat_group`    |
| `group.add_instance(off)`               | `add_repeat_instance`    |
| `group.remove_instance(instance)`       | `remove_repeat_instance` |
| `group.detach()`                        | `detach_repeat_group`    |
| `group.delete()`                        | `delete_repeat_group`    |

The full op vocabulary is `KNOWN_OPS` in `foldnano_mini/mutations.py`.

`add_skip_or_insertion` is the editor's skip / insert tool (`OligoSegment.addSkipOrInsertion`): `count` -1 skips, n > 0 appends n Ns to **both** strands, keeping their bases. Prefer it (`part.add_skip_at` / `add_insert_at`) over `set_slot_insertion`, which replaces the slot and turns the complementary base into Ns. `slot.seq = …` refuses writes that change the slot's length, since `set_slot_sequence` touches one strand and would leave the two out of step.

### Additional proxy APIs

The proxies mirror the host's domain model (`Part` / `Oligo` / `OligoSegment` / `SegmentEnd` /
`StrandSet`) in snake_case, so `seg.three_prime.connected_end` reads like
`seg.threePrime.connectedEnd` in TypeScript. Keep new `foldnano_mini` API to that shape.

**`MutableOligo`**

```python
oligo.is_circular  # bool — True when every segment's 3' connects back within the same oligo
oligo.five_prime   # MutableSegmentEnd | None — the free 5' end (None when circular)
oligo.three_prime  # MutableSegmentEnd | None — the free 3' end
oligo.five_modification = "/5Bio/"   # on the free 5' end; refused on a circular oligo
oligo.three_modification = "/3Cy3/"  # on the free 3' end
oligo.remove()     # same as part.remove_oligo(oligo)
```

**`MutableSlot`**

```python
slot.remove_skip_or_insertion()  # back to a plain base on both strands (set_slot_skip, skip=False)
```

**`MutableSegment`**

```python
seg.five_prime, seg.three_prime  # MutableSegmentEnd
seg.in_virtual_helix             # MutableVirtualHelix
seg.in_strand_index              # 0 | 1
seg.low_index, seg.high_index    # bp range regardless of direction
seg.oligo                        # MutableOligo
seg.move_five_prime_to(idx)      # same as seg.five_prime.index = idx; emits move_terminus op
seg.move_three_prime_to(idx)     # same as seg.three_prime.index = idx
```

`seg.five_index` / `seg.five_modification` (and the 3' versions) remain as shorthands for the
end proxies. Modifications live only on free ends: setting one on a connected end raises, and
the oligo-level `oligo.five_modification` / `three_modification` is the natural place to set them.
`seg.remove()` is `part.remove_segment(seg)`.

**`MutableSegmentEnd`** (`SegmentEnd`)

```python
end.index = idx            # move the end (move_terminus); refused per end.can_move_to(idx)
end.can_move_to(idx)       # Check — port of SegmentEnd.canMoveTo (see below)
end.modification           # get / set (set_segment_modification)
end.is_three_prime, end.segment, end.in_virtual_helix, end.in_strand_index
end.is_free                # no connection
end.connected_segment      # MutableSegment | None
end.connected_end          # the 5' end this 3' end joins (or vice versa)
end.is_constrained         # connected across a lattice crossover site (recomputed, never stored)
end.is_adjacent_to(other)  # same VH and strand, 1 bp apart (a connect would merge)
```

**`MutableVirtualHelix`**

```python
vh.length = n         # resize helix; emits set_vh_length op
vh.move_to(col, row)  # move to new lattice cell (LatticedRegion only); validates parity
vh.strand_sets        # [MutableStrandSet, MutableStrandSet]
vh.segments_at(bp, strand_index=None)  # segments covering bp (both strands by default)
vh.potential_xover_sites(strand_index)  # list[CrossoverSite(bp_index, to_vh_index, right)]
vh.is_even_parity     # alias of vh.parity_is_even
```

**`MutableStrandSet`** (`StrandSet`)

```python
ss.strand_index, ss.virtual_helix
ss.segments, ss.segment_ids       # sorted by low bp
ss.is_empty
ss.is_index_occupied(bp)          # bool
ss.is_index_occupied_by(bp)       # MutableSegment | None
ss.is_range_occupied(a, b)        # inclusive, either order
ss.segments_in_range(a, b)
ss.free_ranges()                  # [(low, high), ...] inside the region's [min_base, max_base)
```

### Occupancy, checks and crossover sites

Queries read an occupancy index derived from the offline mirror. Every op bumps a generation
counter on `MutablePart`; the index (and the crossover-site cache) rebuilds lazily on the next
query after it moved, so a run of writes costs nothing extra and no op can leave it stale. A query
after an edit pays one O(segments) rebuild.

Each mutating call runs its check first and raises `InvalidOperationError` (a `ValueError`) with
the check's reason **before** recording anything, so a script can try-and-fall-back:

```python
check = part.can_create_segment(vh, 10, 30)
if check:
    part.create_segment(vh, 10, 30)
else:
    ctx.log(check.reason)
```

The checks predict what the host accepts on replay (the host stays authoritative); a parity golden
keeps them aligned (see Testing below). What they enforce:

| Call                               | Rule (host source)                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_segment` / `create_oligo`  | both ends inside the VH region's `[min_base, max_base)`; range free on its strand set (`Part.createOligo`)                                                                                                |
| `end.index = …`, `move_*_prime_to` | `0 <= idx < vh.length`; swept range free of other segments; segment keeps its direction; a constrained end only to a matching site toward the same VH with the same `right` flag (`SegmentEnd.canMoveTo`) |
| `connect`                          | different segments, both ends free (`Part.connectSegmentEnds`)                                                                                                                                            |
| `break_oligo` / `break_at`         | bp inside the segment; a mid-segment break may not leave a 1-nt segment before a connected 3' end (`VirtualHelix.createNewSegment`)                                                                       |
| `create_crossover`                 | free 3' end; not within one segment, onto a 3' end, or onto the bp after a free 5' end; not onto a connected 5' end (`Part.createCrossover`)                                                              |
| `make_crossover`                   | a potential site toward `to_vh`; both strands present; the receiving strand not at or 1 nt before its 3' end (`makeCrossoverCmd`)                                                                         |
| `slot.set_skip` / `set_insertion`  | slot inside the segment; complementary strand present; a skip needs both slots unmodified, an insertion can't go on a skip (`OligoSegment.addSkipOrInsertion`)                                            |

Python is **stricter than replay** on skips and insertions (the editor enforces these, the model
doesn't yet): no skip/insertion at a segment end or at a bp where either strand has a constrained
crossover end; no connect, move, or mid-segment break that puts an end on a skip/insertion bp.

**Connections are unrestricted**, as on the host: any free 3' end may join any free 5' end. A
connection is _constrained_ when the two ends sit on different strand indices at the same bp and
the first end's VH has a potential crossover site there pointing at the other VH (the `right` flag
isn't compared). Pick a bp from `vh.potential_xover_sites(strand_index)` before connecting, or
read `end.is_constrained` afterwards. Sites are a port of `latticeOffsets.ts` /
`calcPotentialXoverSites` in `foldnano_mini/lattice.py`; freeform VHs have none.

**Editor-level edits run on a scratch copy.** `create_crossover`, `make_crossover` and
`connect_oligos` break and then connect, and what the host refuses after the break depends on
what the break left. `foldnano_mini/editing.py` runs each once on a cheap copy of the mirror
(oligos and segments copied, slot lists shared) and either refuses with the host's reason or
records the resulting ops, so `can_*` and the call never disagree. They port the host
literally, including its quirks: `create_crossover` compares only the target oligo's 5' _index_
with the bp (on any helix), and a break one bp after an internal segment's connected 5' end
lands the crossover on that 5' end. Like the editor, they clear modifications on ends they join.

**Breaks follow `Oligo.breakOligoAt`.** At the oligo's own free 5'/3' end, or one bp before a
free 3' end, a break does nothing. Breaking a circular oligo opens it in place (same id). A
split-off oligo is a staple colored `#26bf40`, and a mid-segment break drops the 3'
modification (both new 3' ends are fresh). `remove_segment` breaks at both ends of the segment:
what was downstream becomes a new oligo, and removing an oligo's first segment removes that
oligo id.

**Adjacent ends merge.** `connect` between ends on the same VH and strand, 1 bp apart, merges
the two segments: the 3'-side segment extends over the other, takes its slots and 3' connection,
and the other segment is removed. Use a 1-bp gap (or `create_oligo`, which emits one segment for
consecutive adjacent entries) when you mean a crossover.

**`create_oligo`** takes one `(vh, five, three)` entry per segment, 5' → 3' (a plain tuple or a
`SegmentSpec`; `vh` is a proxy or an index). Each 3' end joins the next entry's 5' end. The whole
path is validated first (bounds, occupancy, entries overlapping each other, junctions on a
skip/insertion), so an invalid path raises before anything is logged. It emits
`create_segment` × n + `connect` × (n − 1) (+1 with `circular=True`); color, name and scaffold
flag land on the resulting oligo. Repeat-group mirror oligos count as ordinary oligos at their
current positions.

**`MutableRegion` (LatticedRegion and FreeformRegion)**

```python
region.max_base            # int — current max base index
region.min_base            # int — current min base index (usually 0)
region.step                # int — base-index step for this lattice type (21 for HONEYCOMB, 32 for SQUARE)
region.set_max_base(n)     # grow or shrink; the change must be a multiple of step, and a shrink
                           # is refused while strands reach n (can_set_max_base)
region.increase_length_by(delta)  # grow by delta (must be a multiple of region.step)
region.reduce_unused_length()     # shrink to the strands, rounded up to step, at least 2 steps
region.remove_all_skips()         # -> count; region.remove_all_insertions() likewise
```

**`FreeformRegion`** (additional method beyond `LatticedRegion`)

```python
freeform_region.add_vh_at(origin, direction=[0,0,1], length=None)
    # Add a freeform VH at the given origin (nm). Returns MutableVirtualHelix.
    # Emits add_freeform_vh op.
```

**`MutablePlane`**

```python
plane.id      # str
plane.name    # str
plane.origin  # dict with x, y, z (nm)
plane.u       # dict with x, y, z — horizontal axis unit vector
plane.v       # dict with x, y, z — vertical axis unit vector
plane.normal  # dict with x, y, z — normal vector

# read-only: move a plane with part.set_plane_transform(plane.id, origin, u, v, normal)
```

Access planes via `part.planes` (list of `MutablePlane`) or `part.set_plane_transform(plane_id, ...)`.

### Repeat groups and mirror oligos

A repeat group (the editor's **Duplicate as linked mirror copies**) is a set of originals copied
at each instance's bp offset along the same VHs. The copies, **mirror oligos**, are regenerated
from their originals, never edited (`docs/repeat-units.md`). `foldnano_mini` rebuilds them in
Python after every op, the same way the host does when it replays the log, so `part.oligos` and
the occupancy queries always show where the mirrors are now.

```python
group = part.create_repeat_group([a, b], 21)    # mirrors built immediately
group.add_instance(42)                          # -> RepeatInstance(id, bp_offset)
group.can_add_instance(63)                      # Check, e.g. "Copy 3 of Repeat 1: ..."
group.instances, group.originals, group.mirrors, group.mirrors_of(instance)
group.remove_instance(instance)                 # removing the last one deletes the group
group.detach()                                  # mirrors become ordinary, editable oligos
group.delete()                                  # mirrors removed, originals kept

a.repeat_group                                  # MutableRepeatGroup | None (originals only)
mirror.is_mirror                                # True
mirror.mirror_of                                # MirrorInfo(group, instance, source)
mirror.source                                   # the original, as a MutableOligo
```

- **Mirrors are read-only.** They come back as `MirrorOligo`, and their segments, ends and slots
  as `SegmentView` / `SegmentEndView` / `SlotView`: the same reads as the mutable proxies, no
  setters or edit methods. Writing to one raises `InvalidOperationError` ("Mirror oligos can't be
  edited. Edit the original instead."), as does any edit that would change one indirectly, such
  as a skip on the strand opposite a mirror. Iterate `part.real_oligos` when editing every oligo.
- **Edits to an original follow to its mirrors.** Color, name, scaffold flag, modifications and
  bases are copied over at once; any other edit (moving an end, connecting, breaking, skips)
  rebuilds them. If a rebuilt copy can't be placed (it would overlap a strand, lose a lattice
  crossover site, or leave a skip unpaired), the edit raises "Copy N of Repeat M: ..." and is
  neither applied nor logged. The matching `can_*` check predicts it.
- **Membership follows the host:** both halves of a broken original stay in the group,
  connecting an ordinary oligo to an original pulls it into the group, and two groups can't be
  joined.
- **Mirror ids** are `<source id>@<instance id>` in Python, stable across rebuilds. The host gives
  its mirrors its own ids, so don't carry a mirror id out of the run.

### Identifiers

Entities carry stable string ids that are **shared with the JS-side `Part`**:

- `vh.id`, `oligo.id`, `seg.id` are the canonical handles in both layers.
- Mutation ops reference targets by id — `vhId`, `oligoId`, `segmentId`, plus `vhIds: list[str]` for `remove_vhs`.
- Creation ops (`add_vh_at_coords`, `create_segment`) carry the new id (`newVhId`, `newOligoId`, `newSegmentId`) generated in Python. The JS factory **adopts that id verbatim** when it builds the corresponding entity, so subsequent ops can reference the new entity directly without index-prediction or any client-side mapping table.
- Python allocates new ids against the current offline mirror, so ids created earlier in the same plugin run are also considered when generating later ids.
- The JS replay layer and core model still reject duplicate ids as a hard invariant. That path is a safety net for malformed logs, manual log construction, or future non-Python callers; plugin authors should not rely on replay-time collisions to resolve themselves.

Replay correctness no longer depends on Python predicting JS-side numbering. Helpers like `part.get_vh(int)` and `part.remove_vhs([int, …])` accept indices for ergonomics, but the wire op records the resolved `vhId` strings.

For newly added lattice VHs in offline mode, `vh.index` is a **mirror-local** value and may differ from the eventual host-side JS index after replay. Use `vh.id` as the only cross-runtime stable identifier.

The older replay-only reference fields (`vhRefId`, `vhIndex`, `vhIndices`, `vhRefIds`, `newVhIndex`) are no longer part of the `foldnano_mini` mutation contract.

### Output

```python
ctx.set_result_mutation_log(part.mutation_log)
ctx.set_result({"ops_emitted": len(part.mutation_log), ...})  # optional summary
```

Use `ctx.set_result_foldnano_json(part.to_json_string())` instead if you want the existing `replacePart*` / `replaceRegion*` strategies to apply the result. (`set_result_foldnano_json` requires a JSON **string**; `part.to_json()` returns a dict, so call `to_json_string()` or wrap it in `json.dumps(...)`.) The two output methods are mutually exclusive: pick the one that matches your manifest's `applyStrategy`.

### Common pitfalls

- `replayMutationLogInRegion` aborts if any op's target VH is outside the active region. Use `part.oligos_in_region(...)` / `part.vhs_in_region(...)` to filter inputs up front.
- `LatticedRegion.add_vh_at(row, col)` adds a VH at a lattice cell; `FreeformRegion.add_vh_at(origin, direction, length)` adds a VH at a 3D position. They emit different ops (`add_vh_at_coords` vs `add_freeform_vh`). Do not call `add_vh_at` on the wrong region type.
- `vh.move_to(col, row)` validates **lattice parity** — (Δrow + Δcol) must be even. Moving to a wrong-parity cell raises `ValueError`.
- `region.increase_length_by(delta)` requires `delta` to be a multiple of `region.step` (21 for HONEYCOMB, 32 for SQUARE). Non-step-multiple values are rejected. Use `region.set_max_base(n)` if you know the target value.
- `part.break_oligo(seg, at_index)` is a **no-op** on circular oligos (returns `None`). Check `oligo.is_circular` before calling if unsure.
- `part.split_region(region_id, split_after_vh_id)` requires the region to have at least 2 VHs; the VH identified by `split_after_vh_id` becomes the last VH of the original region.
- `MutableSegment.oligo_id` is resolved dynamically on each access, so it stays correct after `part.connect(...)` merges two oligos.
- `part.connect(a, b)` between adjacent ends (same VH and strand, 1 bp apart) merges `b` into `a`; `b`'s proxy is stale afterwards.
- Validation errors (bad hex color, out-of-range index, etc.) raise immediately and do **not** pollute `part.mutation_log` — the op is rejected before recording. Topology refusals raise `InvalidOperationError`; call the matching `can_*` first to branch instead.

---

## Testing `foldnano_mini` plugins offline

The offline transport is pure Python, so `foldnano_mini` plugins can be unit-tested in CPython without Pyodide or the browser. There are three layers:

### 1. Local invariants

`foldnano_mini/invariants.py` runs cheap validators _before_ an op is appended to the log: hex-color shape, integer endpoint distinctness, strand-set-index ∈ {0, 1}, etc. They fail fast with a clear `ValueError` / `TypeError` and never touch the JS side. The topology checks (occupancy, bounds, crossover and skip rules; see [Occupancy, checks and crossover sites](#occupancy-checks-and-crossover-sites)) run the same way and raise `InvalidOperationError`.

```python
import pytest
from foldnano_mini import load_part

def test_bad_color_rejected(multi_region_part_foldnano_json):
    part = load_part(multi_region_part_foldnano_json)
    with pytest.raises(ValueError, match="hex color"):
        part.get_oligo("oligo-honey-only").color = "red"
    assert part.mutation_log == []  # bad write does not pollute the log
```

These are intentionally a _subset_ of what the JS-side `Part` enforces — they catch authoring mistakes early but are not a substitute for full JS validation.

### 2. Real fixtures

`src/lib/plugin/python/tests/fixtures/` ships real `Part.toJSON()` snapshots (also used by `example_all_ops.py`):

- `minimal_part.foldnano.json` — small lattice design.
- `multi_region_part.foldnano.json` — HONEYCOMB + SQUARE + FREEFORM regions, cross-region oligos, sequences and modifications.

Load them in `pytest` and run plugins against real data:

```python
def test_my_plugin(multi_region_part_foldnano_json):
    from foldnano import PluginContext
    from my_plugin.plugin import run

    ctx = PluginContext(
        format="foldnano_mini",
        foldnano_json_in=multi_region_part_foldnano_json,
        active_region_id="region-honey",
    )
    run(ctx)
    assert ctx.mutation_log[0]["op"] == "set_oligo_color"
```

The fixtures are loaded by `conftest.py`; available pytest fixtures: `minimal_part_foldnano_json`, `multi_region_part_foldnano_json`, `only_scaf_cadnano_json`.

### 3. Self-consistency replay check

`MutablePart.replay_log_into_fresh_mirror(json_str, log) -> dict` re-applies a captured log onto a fresh mirror loaded from the original JSON, and returns the resulting dict. Asserting it matches `part.to_json()` catches op-encoding bugs and replay determinism issues without any JS runtime:

```python
from foldnano_mini import MutablePart, load_part

def test_replay_matches_mirror(multi_region_part_foldnano_json):
    part = load_part(multi_region_part_foldnano_json)
    part.get_oligo("oligo-honey-only").color = "#abcdef"
    new_seg = part.create_segment(vh=2, five_index=50, three_index=40)  # 5'>3' → strand set 1
    new_seg.slot_at(45).seq = "T"

    replayed = MutablePart.replay_log_into_fresh_mirror(
        multi_region_part_foldnano_json, part.mutation_log
    )
    assert replayed == part.to_json()
```

This proves your sequence of ops is **deterministic and self-consistent**: replaying it from scratch produces the same mirror state. It does _not_ prove the JS-side replay produces an equivalent `Part` — for that, run the plugin in the browser and inspect the result.

### Running the tests

```bash
cd src/lib/plugin/python
uv run pytest tests/ -v
```

Reference test files:

- `tests/test_foldnano_mini_offline.py` — offline transport behaviour, op recording, validation.
- `tests/test_foldnano_mini_replay_self.py` — self-consistency between mirror and replay.
- `tests/test_foldnano_mini_topology.py` — occupancy queries, end proxies, `can_*` checks, `create_oligo`.
- `tests/test_foldnano_mini_parity.py` — the checks, crossover sites, and the results of
  editor-level edits, against the host. Its golden
  (`tests/fixtures/foldnano_mini_parity.golden.json`) is written by
  `src/lib/plugin/foldnanoMiniParity.spec.ts` from the real `Part`; after changing a host rule,
  regenerate with `UPDATE_FOLDNANO_MINI_PARITY=1 pnpm vitest run src/lib/plugin/foldnanoMiniParity.spec.ts`
  and make the Python side agree.
- `tests/test_foldnano_mini_replay_host.py` — the other direction: a scenario using the editing API
  writes its log and predicted state (seeded ids) to `tests/fixtures/foldnano_mini_replay.golden.json`,
  and `src/lib/plugin/foldnanoMiniReplay.spec.ts` replays it on the real `Part` and compares, ids
  included. Every entity the host creates during an op must take its id from the op
  (`break_oligo.newSegmentId`, `remove_segment.newOligoId`, ...). Regenerate with
  `UPDATE_FOLDNANO_MINI_REPLAY=1 pnpm test:python`.
- `tests/test_foldnano_mini_repeat.py` — repeat groups: mirror rebuilds, read-only mirrors, group
  ops. Its scenario writes `tests/fixtures/foldnano_mini_repeat_replay.golden.json`, which
  `src/lib/plugin/foldnanoMiniRepeatReplay.spec.ts` replays on the real `Part` (mirrors compared by
  source and instance). Regenerate with `UPDATE_FOLDNANO_MINI_REPEAT=1 pnpm test:python`.
- `tests/test_foldnano_regions.py` — Plane / DesignRegion proxy surface.

### All-ops example script

`src/lib/plugin/python/example_all_ops.py` is a standalone CPython script that exercises every op kind in order against the `multi_region_part.foldnano.json` fixture (embedded inline). Run it from `src/lib/plugin/python/`:

```bash
cd src/lib/plugin/python
python example_all_ops.py
```

It uses `assert` statements and prints `ok: <description>` for each op, then finishes with a self-consistency replay check. Every op kind in `KNOWN_OPS` must appear in the log. This script is the authoritative reference for the full API surface.

> **Note:** This script runs in CPython against the offline transport. It is not a ScriptLab script — it imports `foldnano_mini` directly and embeds fixture JSON inline. See [ScriptLab Full API Demo](#scriptlab-full-api-demo) for the in-browser equivalent.

### ScriptLab Full API Demo

The built-in Script Lab plugin ships a **Full API Demo** starter template (accessible via **Script Lab Help → Load Full API Demo** in the side panel toolbar). Unlike `example_all_ops.py`, this template operates on your current active region and design — it discovers available VHs, oligos, and regions dynamically before exercising each op group.

The template is organized into 9 sections (A–I) guarded by `SKIPPED` fallbacks when preconditions are not met:

| Section | Ops covered                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------- |
| A       | `set_oligo_color`, `set_oligo_name`, `set_oligo_is_scaffold`                                                    |
| B       | `set_segment_modification`, `set_slot_sequence`, `set_slot_skip`, `add_skip_or_insertion`, `set_slot_insertion` |
| C       | `set_vh_length`, `set_region_max_base`                                                                          |
| D       | `create_segment` (×2), `connect` via `create_oligo`                                                             |
| E       | `break_oligo`, `move_terminus` (5' + 3')                                                                        |
| F       | `add_vh_at_coords`, `add_freeform_vh`                                                                           |
| G       | `move_lattice_vh`, `set_vh_local_frame`, `reorder_vh`                                                           |
| H       | `transform_plane`, `add_region_and_plane`, `split_region`                                                       |
| I       | `remove_segment`, `remove_oligo`, `remove_vhs` (cleanup of demo artifacts)                                      |

The template ends with `ctx.set_result_mutation_log(part.mutation_log)` so you can click **Apply** to see the mutations take effect in the editor — or **Undo** to revert all of them in one step.

### What is _not_ covered offline

- Host rules the `can_*` checks don't model: `replayMutationLogInRegion`'s active-region scope.
- 3D / view-side regressions.
- Cross-plugin interactions in the editor.

Validate those by running the plugin in `pnpm dev` against a real design and confirming the resulting state visually + with a single Undo.

---

## Handling Unsequenced Designs

Sequences are assigned per-oligo. When no scaffold sequence has been applied, oligo sequences contain `"N"` placeholder characters rather than real bases. Always strip placeholders before computing sequence-based statistics:

```python
seq = oligo.sequence or ""
real_seq = seq.replace("N", "")

if not real_seq:
    # Skip — oligo has no real sequence yet
    continue

gc = (real_seq.count("G") + real_seq.count("C")) / len(real_seq)
```

**Do not** check `if not seq` — `"NNNNN"` is truthy but represents an unsequenced oligo. A plugin that computes GC on all-N sequences will produce gc=0.0 and incorrectly style those oligos as AT-rich.

For analysis plugins that produce per-oligo reports, leave GC columns blank for unsequenced oligos rather than reporting 0%.

---

## Patterns by Use Case

### Analysis / report (previewOnly)

```python
"""
Use when: computing statistics, producing CSVs, flagging design warnings.
Strategy: previewOnly — model is never mutated.
Format: foldnano_json for anything sequence-related; cadnano_json for topology stats.
"""
import csv, io, re
from foldnano.io import parse_foldnano_json
from foldnano.plugin import PluginContext

def run(ctx: PluginContext) -> None:
    part = parse_foldnano_json(ctx.get_part_as_foldnano_json())
    staples = [o for o in part.oligos if not o.is_scaffold]

    rows = []
    for oligo in staples:
        real_seq = (oligo.sequence or "").replace("N", "")
        gc = (real_seq.count("G") + real_seq.count("C")) / len(real_seq) if real_seq else None
        rows.append({"name": oligo.name or "", "gc": f"{gc:.3f}" if gc is not None else ""})

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["name", "gc"], lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    ctx.write_artifact("report.csv", buf.getvalue())
    ctx.set_result({"total_staples": len(staples)})
```

### Color mutation (replacePartKeepAnnotationsWhereMatched)

```python
"""
Use when: changing colors based on some property.
Strategy: replacePartKeepAnnotationsWhereMatched — sequences survive the apply.
Format: foldnano_json to access per-oligo data; cadnano_json if coloring by topology only.
"""
import json
from foldnano.io import parse_foldnano_json
from foldnano.plugin import PluginContext

def run(ctx: PluginContext) -> None:
    part = parse_foldnano_json(ctx.get_part_as_foldnano_json())
    raw_oligos = part._raw.get("oligos", [])
    id_to_idx = {o["id"]: i for i, o in enumerate(raw_oligos)}

    for oligo in part.oligos:
        if oligo.is_scaffold:
            continue
        # ... compute color ...
        color = "#cc3300"
        idx = id_to_idx.get(oligo.id)
        if idx is not None:
            raw_oligos[idx]["color"] = color

    ctx.set_result_foldnano_json(json.dumps(part._raw))
```

### Multi-file plugin

Zip is the only packaged format, so a multi-file plugin is just a zip with more files in it.

**Directory layout:**

```
my_plugin/
  fplugin.json    ← manifest (ships inside the zip; may omit entrypointUrl)
  plugin.py       ← entry point (must be named plugin.py)
  helper.py       ← any number of supporting modules
  data.py
```

**Build the zip from inside the directory** (no subdirectory prefix):

```bash
cd my_plugin
zip my_plugin.zip fplugin.json plugin.py helper.py data.py
```

Bundled core plugins skip the manual `zip` step — `pnpm build:plugins` packages
every `static/plugins/<dir>/` source dir and injects its `core_plugins`
manifest as the zip's `fplugin.json`.

**`plugin.py`** — import sibling modules the normal way:

```python
from foldnano.plugin import PluginContext
from helper import do_thing      # resolves to /plugin_run/helper.py
from data import LOOKUP_TABLE    # resolves to /plugin_run/data.py

def run(ctx: PluginContext) -> None:
    result = do_thing(LOOKUP_TABLE)
    ctx.set_result(result)
```

The worker extracts the zip to `/plugin_run/` and adds that path to `sys.path`, so all files land at the same level and relative imports work without any special setup.

**When to split into multiple files:**

- Separate data logic from presentation (as in `crossover_analyzer`: `analyzer.py` + `report.py`)
- Reusable utilities shared across helper functions
- Large lookup tables or constants

Avoid splitting just to split — if the logic fits comfortably in one file, keep it in one file.

### Topology mutation (`cadnano_json` region replacement)

For cadnano_json plugins that change strand connectivity, work directly on the `vstrands` array:

```python
import json
from foldnano.plugin import PluginContext

def run(ctx: PluginContext) -> None:
    data = json.loads(ctx.get_part_as_cadnano_json())

    for vstrand in data.get("vstrands", []):
        stap = vstrand["stap"]
        # ... mutate stap entries ...

    ctx.set_result_cadnano_json(json.dumps(data))
```

If that `cadnano_json` plugin uses `replaceRegion` or `replaceRegionKeepAnnotationsWhereMatched`, do not add new `vstrands` beyond the active region's existing VH set. Region replacement currently assumes stable VH numbering inside the replaced region and rejects attempts to introduce new VHs there.

---

## User-Configurable Parameters

Plugins can declare a `parameters` array in their manifest to collect user input before each run. When parameters are present, clicking **Run** opens a dialog pre-filled with defaults (or the values from the previous run). Plugins with no `parameters` array fire immediately on **Run** with no dialog.

For sidepanel plugins, use `sidePanel.form.fields` instead. It uses the same field schema, but renders in a dedicated sidebar tab rather than the popup dialog. `parameters` and `sidePanel.form.fields` cannot be combined in the same manifest.

For code-editor sidepanel plugins, `parameters` may still be useful when you want a small popup for stable scalar options while the sidebar editor holds larger free-form input. The important distinction is:

- `parameters` / `ctx.params` are explicit structured values confirmed through the popup dialog
- `sidePanel.codeEditor` provides a persistent editor surface in the sidebar

### PluginParamDef schema

```json
{
	"id": "threshold", // key in ctx.params / ctx.get_param()
	"label": "Score threshold", // label in the run dialog
	"type": "number", // "string" | "number" | "boolean" | "select"
	"default": 0.5, // pre-filled value
	"description": "Minimum score to include", // hint text below the input
	"required": true, // prevent submit when empty/NaN
	"min": 0, // number only
	"max": 1,
	"step": 0.01,
	"options": [
		// select only
		"fast",
		{ "value": "thorough", "label": "Thorough (slow)" }
	]
}
```

All fields except `id`, `label`, and `type` are optional.

### Parameter constraint rules

Parameter constraints are checked when a manifest is submitted for installation or replacement and
when a user submits parameter values. Manifest defaults are validated more strictly, while
submitted form values may first be converted to the expected type.

- **`number`:** If provided, `min`, `max`, and `step` must be finite numbers. `step` must be greater
  than `0`, and `min` cannot be greater than `max`. Fractional and negative values are allowed for
  `min`, `max`, and `default`. `step` may also be fractional, but must remain positive because it
  describes the distance between valid values, not the direction in which values move. Submitted
  values and defaults must satisfy any provided `min` and `max` limits and follow the configured
  `step`, starting from `min` or from `0` if no `min` is provided. Small floating-point differences
  are tolerated.
- **`select`:** `options` must contain at least one option. An option can be either a string or an
  object such as `{ "value": "...", "label": "..." }`. Values and labels cannot be empty, and
  option values must be unique. Submitted values and defaults must exactly match one of the
  available option values.
- **`boolean`:** A manifest `default` must be a real JSON boolean: `true` or `false`. Submitted
  values may also use the strings `"true"`, `"false"`, `"1"`, or `"0"`. The string comparison is
  case-insensitive. Any other value is rejected.
- **`string`:** There are no additional constraints beyond the normal required-field and type
  checks. A manifest `default` must be a string.
- **Manifest defaults vs. submitted values:** Manifest defaults are checked without type
  conversion. For example, `"default": "5"` is invalid for a `number` parameter. Submitted values
  are converted only according to the rules for their parameter type. For example, the numeric form
  value `"5"` becomes the number `5` before its constraints are checked.
- **Empty fields:** An empty required field is rejected. An empty optional `number`, `boolean`, or
  `select` field becomes `null` in `ctx.params`. An empty optional `string` remains `""`.

### Full manifest example

```json
{
	"schemaVersion": 2,
	"id": "my-filter",
	"name": "My Filter",
	"version": "1.0.0",
	"format": "cadnano_json",
	"applyStrategy": "previewOnly",
	"entrypointUrl": "/plugins/my_filter/plugin.py",
	"parameters": [
		{
			"id": "threshold",
			"label": "Score threshold",
			"type": "number",
			"default": 0.5,
			"min": 0,
			"max": 1,
			"step": 0.01,
			"description": "Minimum score to include"
		},
		{
			"id": "mode",
			"label": "Analysis mode",
			"type": "select",
			"options": ["fast", "thorough"],
			"default": "fast"
		},
		{
			"id": "label",
			"label": "Output label",
			"type": "string",
			"default": "run_1"
		},
		{
			"id": "verbose",
			"label": "Verbose logging",
			"type": "boolean",
			"default": false
		}
	]
}
```

### Python-side usage

```python
from foldnano.plugin import PluginContext

def run(ctx: PluginContext) -> None:
    threshold = float(ctx.get_param("threshold", 0.5))
    mode      = ctx.get_param("mode", "fast")
    label     = ctx.get_param("label", "run_1")
    verbose   = bool(ctx.get_param("verbose", False))

    ctx.log(f"params: threshold={threshold}  mode={mode!r}  label={label!r}  verbose={verbose}")
    # ... rest of plugin logic ...
```

Or access all values at once:

```python
ctx.log(str(ctx.params))
# → {'threshold': 0.5, 'mode': 'fast', 'label': 'run_1', 'verbose': False}
```

### Type coercion

The dialog sends values as JavaScript types. By the time they reach Python:

| Dialog input type | Python type received                       |
| ----------------- | ------------------------------------------ |
| `number`          | `float` (may be integral, e.g. `72.0`)     |
| `boolean`         | `bool`                                     |
| `string`          | `str`                                      |
| `select`          | `str` (the `value` of the selected option) |

Always cast `number` values explicitly if your logic requires an integer:

```python
n_helices = int(ctx.get_param("n_helices", 8))
```

### Values are remembered between runs

`paramValues` is stored in `PluginState` (reactive, not persisted to IndexedDB). After the user confirms the dialog, the panel writes back the entered values. The next time **Run** is clicked, the dialog opens pre-filled with those values — not the manifest defaults. Defaults are only used on the very first run after installation.

### Demo: Staple Colorizer

`staple_colorizer` (v1.1.0) exercises all four input types across five parameters. Install its manifest, activate, and click **Run** to see the dialog. Change **Palette style** to "Uniform" and **Base hue** to 0 for an all-red design — check the log output to confirm Python received the exact values you entered.

---

| Plugin                  | Format          | Strategy                                   | What it shows                                                                                                                                                                    |
| ----------------------- | --------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello_world`           | `cadnano_json`  | `replaceRegionKeepAnnotationsWhereMatched` | Minimal inline entrypoint                                                                                                                                                        |
| `design_stats`          | `cadnano_json`  | `previewOnly`                              | CSV artifact, numpy, synthetic fallback design                                                                                                                                   |
| `staple_colorizer`      | `cadnano_json`  | `replaceRegionKeepAnnotationsWhereMatched` | **Parameters** (select, number, boolean); HSL palette, `stap_colors` mutation                                                                                                    |
| `nick_remover`          | `cadnano_json`  | `replaceRegion`                            | Nick detection, strand connectivity mutation                                                                                                                                     |
| `sequence_report`       | `foldnano_json` | `previewOnly`                              | Per-oligo CSV with GC, homopolymer runs, mods; N-placeholder handling                                                                                                            |
| `gc_colorizer`          | `foldnano_json` | `replacePartKeepAnnotationsWhereMatched`   | GC-based color gradient; `_raw` round-trip mutation                                                                                                                              |
| `crossover_analyzer`    | `cadnano_json`  | `previewOnly`                              | **Zip bundle**: 3 modules; crossover counting; CSV + summary artifact                                                                                                            |
| `staple_colorizer_mini` | `foldnano_mini` | `replayMutationLogInRegion`                | `foldnano_mini` port of `staple_colorizer`; recolors active region only; one undo step                                                                                           |
| `mutation_test`         | `foldnano_mini` | `replayMutationLog`                        | Exercises a broad slice of the `foldnano_mini` op vocabulary; used to verify JS replay end-to-end                                                                                |
| `pyOrigamiBreak`        | `cadnano_json`  | `replaceRegion`                            | Real-world custom-tier plugin: `numpy`/`pandas`/`matplotlib` + the `cadnano2_5_mini` standard-extra wheel; thermodynamic staple-break optimization with a 9-parameter run dialog |
| `side_panel_form_demo`  | `foldnano_json` | `previewOnly`                              | `sidePanel.type: "form"` — manifest-declared fields render in a dedicated sidebar tab instead of the popup run dialog                                                            |

Source files: `static/plugins/<plugin_name>/plugin.py` (or zip for `crossover_analyzer` / `pyOrigamiBreak`)
Manifests: `src/lib/plugin/core_plugins/<plugin_name>.fplugin.json`

---

## Error Handling

Wrap the input step in a `try/except` to produce a clean error log instead of a raw traceback:

```python
def run(ctx: PluginContext) -> None:
    try:
        raw_json = ctx.get_part_as_foldnano_json()
    except RuntimeError as exc:
        ctx.log(f"ERROR: could not read design — {exc}")
        return

    part = parse_foldnano_json(raw_json)
    # ...
```

If `run()` raises an uncaught exception the worker catches it, sets `plugin.status = 'error'`, and preserves any logs captured before the exception. The traceback is shown in the error message.

### Why a returned result might not offer Apply

For `replacePart*` / `replaceRegion*` strategies, a successful run that returns a result is not enough by itself to show the **Apply** button. Before `pendingApply` is created, the host runs two checks against the returned JSON:

- **Result validation** — shape-checks the result against the declared `format` (well-formed `vstrands` / `Part.toJSON()` shape, valid references). Some issues are auto-repaired (e.g. a one-sided connection pointer is cleared when the other end is free), but malformed shapes are rejected.
- **Design verification** — reconstructs the result the same way Apply would (on a throwaway copy, never your real design) and checks for dangling references, out-of-range segments, non-reciprocal connections, and — for region strategies — that the active region's VH index set is unchanged from before the run.

If either check fails, the plugin panel shows the specific error (naming the offending field or ID) instead of an Apply button, and the design is left untouched. This is why, for example, a `replaceRegion*` plugin that adds or removes a virtual helix from the active region will run successfully but never offer Apply — see **Choosing an Apply Strategy** above.

---

## Testing Outside the Browser

`PluginContext` is plain Python. You can test plugins in a local CPython environment:

```python
import json
from foldnano.plugin import PluginContext

# Load a real design file
with open("my_design.json") as f:
    cadnano_str = f.read()

# Optionally supply parameter values (mirrors what the run dialog would send)
params = json.dumps({"palette": "rainbow", "saturation": 80, "colorize_scaffold": False})

ctx = PluginContext(
    format="cadnano_json",
    cadnano_json_in=cadnano_str,
    params_json=params,
)

# Import and run the plugin
from static.plugins.my_plugin.plugin import run
run(ctx)

print(ctx.logs)
print(ctx.plugin_result)
print(list(ctx.artifacts.keys()))
```

For `foldnano_json` plugins, the input is a `Part.toJSON()` snapshot — you can export one from a running design using the browser console or the editor's export tools.

For `foldnano_mini` plugins, instantiate the context with `format="foldnano_mini"` and `foldnano_json_in=<snapshot>`; after `run(ctx)` returns, `ctx.mutation_log` holds the recorded ops. See [Testing `foldnano_mini` plugins offline](#testing-foldnano_mini-plugins-offline) for a richer testability story (invariants, fixtures, self-consistency replay).

The `foldnano` and `foldnano_mini` packages live at `src/lib/plugin/python/`. Add it to your `PYTHONPATH` when running outside the browser, or run the existing pytest suite via `uv`:

```bash
PYTHONPATH=src/lib/plugin/python python my_plugin_test.py
# or:
cd src/lib/plugin/python && uv run pytest tests/ -v
```

---

## Distributing a Plugin

The same zip works for both distribution channels. It must be **50 MB or smaller**, and at most **200 MB once unpacked**. At run time the log keeps the first 5,000 lines, and one run's artifacts may total at most 100 MB (see `docs/python-plugin-system.md` § Size limits).

### Zip layout

```
my_plugin.zip
├── fplugin.json      ← manifest (required, at the zip root — the authoritative copy)
├── plugin.py         ← Python entrypoint (required, exactly this name)
└── my_dep-1.0-py3-none-any.whl   ← optional bundled wheel dependency
```

The manifest inside the zip may omit `entrypointUrl` — the installer knows the
files are in the zip:

```json
{
	"schemaVersion": 2,
	"id": "my-local-plugin",
	"name": "My Local Plugin",
	"version": "1.0.0",
	"format": "cadnano_json",
	"applyStrategy": "previewOnly"
}
```

### Channel 1 — hand out the zip file

The user clicks **Import zip** in the plugin panel (or opens the `.zip` via the
file dialog). No server or hosting required; works offline.

### Channel 2 — ship it with Foldnano

First-party plugins live in this repo: sources in `static/plugins/<dir>/`, a
pointer manifest in `src/lib/plugin/core_plugins/`, and the Hub installs them.
The pointer's `id` must match the inner manifest's `id`. Pointer manifests for
zips on other websites are refused during the beta.

### Bundled wheel dependencies

List wheel filenames (not URLs) in `requirements`:

```json
{
	"requirements": ["my_dep-1.0-py3-none-any.whl"]
}
```

The installer extracts the `.whl` file from the zip and stores it in IndexedDB alongside the plugin zip. No network access is needed at activate time.

### Caveats

- **Clearing browser data removes installed plugins.** Users must re-import the zip (or reinstall from the Hub).
- **Always bump `manifest.version` when releasing a new version.** The host caches file assets keyed on `manifest.version`; stale files are served until the version changes.
- Wheels bundled inside the zip are stored directly in IndexedDB rather than fetched over HTTP.
- Plugins installed before the zip unification show **needs-reinstall** in the panel; ship users the zip again.

---

## Checklist: New Plugin

- [ ] `plugin.py` with a `run(ctx: PluginContext)` entry point, at the zip root
- [ ] `fplugin.json` at the zip root with unique `id` (kebab-case), correct `format`, and correct `applyStrategy`
- [ ] Zip built from inside the plugin dir (`zip <id>.zip fplugin.json plugin.py …`); for bundled core plugins, `pnpm build:plugins` does this
- [ ] For `foldnano_json` mutations: mutate `part._raw`, return via `set_result_foldnano_json`
- [ ] For `foldnano_mini` mutations: thread `ctx.active_region_id` into `load_part`, return via `set_result_mutation_log(part.mutation_log)`, pair with `replayMutationLog` or `replayMutationLogInRegion`
- [ ] For sequence-based computations: strip `"N"` placeholders before computing GC or other stats
- [ ] Log a summary at the end: counts of processed/skipped items
- [ ] `ctx.set_result({...})` with the key aggregate numbers (shown in the output panel)
- [ ] `applyStrategy: previewOnly` unless the plugin intentionally mutates the model

### Additional checklist for plugins with parameters

- [ ] Each `PluginParamDef` has a unique `id` (the key Python will see in `ctx.params`)
- [ ] `default` is set on every parameter (used on first run and as the dialog pre-fill)
- [ ] `number` inputs: set `min`, `max`, and `step` so the spinner behaves sensibly
- [ ] `select` inputs: `options` array is non-empty
- [ ] Plugin reads params at the top of `run()` and logs them so the user can confirm receipt
- [ ] Cast number params explicitly if integer arithmetic is required: `int(ctx.get_param(...))`

### Additional checklist for `sidePanel.type: "codeEditor"` plugins

- [ ] Decide whether the editor buffer is input data or executable source
- [ ] For input-data workflows: omit `sidePanel.codeEditor.execution` or set `"input"`
- [ ] For Script-Lab-like workflows: set `sidePanel.codeEditor.execution` to `"entrypoint"`
- [ ] If using `"entrypoint"`, provide a placeholder inline `entrypoint` (this is the only case where inline `entrypoint` is allowed; `entrypointUrl` must be absent); the editor buffer becomes the real source at run time
- [ ] Document clearly for users whether the script is expected to define `run(ctx)`
- [ ] If the plugin is mutating and uses `foldnano_mini`, ensure examples call `ctx.set_result_mutation_log(part.mutation_log)`

### Zip packaging checklist

- [ ] `fplugin.json` and all `.py` files stored at the **root level** of the zip (no subdirectory prefix)
- [ ] Entry point is named `plugin.py`
- [ ] Zip built from _inside_ the plugin directory: `cd <id> && zip <id>.zip fplugin.json *.py`
- [ ] Bundled wheels listed as bare filenames in `requirements` and present at the zip root
- [ ] For a first-party Hub plugin: pointer manifest's `entrypointUrl` is a `/plugins/…` path ending in `.zip`, and its `id` matches the inner manifest
- [ ] Sibling module imports in `plugin.py` use plain `from <module> import ...` (no relative dot syntax)
