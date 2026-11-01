---
title: Testing Plugins
description: Offline unit testing for foldnano.edit plugins using CPython, pytest fixtures and the self-consistency replay check, and testing in the app with Plugin Dev Mode
category: plugin-development
order: 9
slug: plugin-testing
covers:
  - src/lib/plugin/python/foldnano/edit/transport.py
  - src/lib/plugin/python/foldnano/edit/invariants.py
---

# Testing Plugins

## Testing `foldnano.edit` plugins offline

The offline transport is pure Python, so `foldnano.edit` plugins can be unit-tested in CPython without Pyodide or the browser. There are three layers:

### 1. Local invariants

`foldnano/edit/invariants.py` runs cheap validators _before_ an op is appended to the log: hex-color shape, integer endpoint distinctness, strand-set-index ∈ {0, 1}, etc. They fail fast with a clear `ValueError` / `TypeError` and never touch the JS side.

Topology edits are checked the same way, before anything is recorded: occupancy, region bounds, end moves, crossovers, breaks, and skip or insertion placement. A refused edit raises `InvalidOperationError` (a `ValueError`) with the reason, and every such call has a `can_*` twin that returns the same answer without raising, so tests can assert on either:

```python
import pytest
from foldnano.edit import InvalidOperationError, load_part

def test_occupied_range_refused(multi_region_part_foldnano_json):
    part = load_part(multi_region_part_foldnano_json)
    check = part.can_create_segment(0, 15, 25)   # strand 0 of VH 0 is taken there
    assert not check and "occupied" in check.reason
    with pytest.raises(InvalidOperationError):
        part.create_segment(0, 15, 25)
    assert part.mutation_log == []
```

These checks are kept in step with the editor's own rules by parity tests in the repository, so a log that passes them replays in the app.

```python
import pytest
from foldnano.edit import load_part

def test_bad_color_rejected(multi_region_part_foldnano_json):
    part = load_part(multi_region_part_foldnano_json)
    with pytest.raises(ValueError, match="hex color"):
        part.get_oligo("oligo-honey-only").color = "red"
    assert part.mutation_log == []  # bad write does not pollute the log
```

### 2. Real fixtures

`src/lib/plugin/python/tests/fixtures/` ships real `Part.toJSON()` snapshots:

- `minimal_part.foldnano.json`: small lattice design.
- `multi_region_part.foldnano.json`: HONEYCOMB + SQUARE + FREEFORM regions, cross-region oligos, sequences and modifications.

Load them in `pytest` and run plugins against real data:

```python
def test_my_plugin(multi_region_part_foldnano_json):
    from foldnano import PluginContext
    from my_plugin.plugin import run

    ctx = PluginContext(
        format="foldnano_edit",
        foldnano_json_in=multi_region_part_foldnano_json,
        active_region_id="region-honey",
    )
    run(ctx)
    assert ctx.mutation_log[0]["op"] == "set_oligo_color"
```

Available pytest fixtures: `minimal_part_foldnano_json`, `multi_region_part_foldnano_json`, `only_scaf_cadnano_json`.

### 3. Self-consistency replay check

`MutablePart.replay_log_into_fresh_mirror(json_str, log)` re-applies a captured log onto a fresh mirror and returns the resulting dict. Asserting it matches `part.to_json()` catches op-encoding bugs and replay determinism issues:

```python
from foldnano.edit import MutablePart, load_part

def test_replay_matches_mirror(multi_region_part_foldnano_json):
    part = load_part(multi_region_part_foldnano_json)
    part.get_oligo("oligo-honey-only").color = "#abcdef"
    new_seg = part.create_segment(vh=2, five_index=50, three_index=40)
    new_seg.slot_at(45).seq = "T"

    replayed = MutablePart.replay_log_into_fresh_mirror(
        multi_region_part_foldnano_json, part.mutation_log
    )
    assert replayed == part.to_json()
```

### Running the tests

```bash
cd src/lib/plugin/python
uv run pytest tests/ -v
```

Reference test files:

- `tests/test_foldnano_edit_offline.py`: offline transport behaviour, op recording, validation.
- `tests/test_foldnano_edit_replay_self.py`: self-consistency between mirror and replay.
- `tests/test_foldnano_edit_topology.py`: occupancy queries, segment ends, `can_*` checks, `create_oligo` and the editor-level calls.
- `tests/test_foldnano_edit_parity.py` and `tests/test_foldnano_edit_replay_host.py`: agreement with the app's own model, in both directions.
- `tests/test_foldnano_regions.py`: Plane / DesignRegion proxy surface.

### What is _not_ covered offline

- Repeat groups (mirror oligos), and the active-region limit of `replayMutationLogInRegion`: the checks don't model them.
- 3D / view-side regressions.
- Cross-plugin interactions in the editor.

Validate those by running the plugin in the app (see [Testing In The App](#testing-in-the-app)) against a real design, and confirming the result visually and with a single Undo.

---

## Testing Outside the Browser

`PluginContext` is plain Python. You can test plugins in a local CPython environment:

```python
import json
from foldnano import PluginContext

with open("my_design.json") as f:
    cadnano_str = f.read()

params = json.dumps({"palette": "rainbow", "saturation": 80, "colorize_scaffold": False})

ctx = PluginContext(
    format="cadnano_json",
    cadnano_json_in=cadnano_str,
    params_json=params,
)

from static.plugins.my_plugin.plugin import run
run(ctx)

print(ctx.logs)
print(ctx.plugin_result)
print(list(ctx.artifacts.keys()))
```

The `foldnano` and `foldnano.edit` packages live at `src/lib/plugin/python/`. Add it to your `PYTHONPATH` when running outside the browser:

```bash
PYTHONPATH=src/lib/plugin/python python my_plugin_test.py
# or:
cd src/lib/plugin/python && uv run pytest tests/ -v
```

---

## Testing In The App

Offline tests are fast and repeatable, but they don't run your plugin in Pyodide or apply its result to a real design. To check those, use [Plugin Dev Mode](/docs/plugin-development/plugin-dev-mode): link your plugin folder, and each **Run** reads the folder again, with no zipping or reinstalling.

Dev mode is the place to check:

- **Your manifest and run dialog.** **Check** lists what would stop the plugin installing or running.
- **Your dependencies.** Packages load in Pyodide, not your local Python, so something that passes in pytest can still fail here.
- **The applied result.** Check it in the strand and 3D views, and confirm one Undo reverts it.
- **Repeat groups and `replayMutationLogInRegion`.** The offline checks don't model these.

For a quick script, [Script Lab](/docs/guide/script-lab) needs no folder or manifest.

Dev mode needs a Chromium-based browser. In other browsers, use **Import zip** for each change.

---

## New Plugin Checklist

- [ ] `<plugin_dir>/plugin.py`: `run(ctx: PluginContext)` entry point, at the root of the plugin folder
- [ ] `<plugin_dir>/fplugin.json`: manifest with unique `id` (kebab-case), correct `format`, and correct `applyStrategy`, also at the root
- [ ] Zipped together with no subdirectory prefix: `cd <plugin_dir> && zip <id>.zip fplugin.json plugin.py`
- [ ] For `foldnano_json` mutations: mutate `part._raw`, return via `set_result_foldnano_json`
- [ ] For `foldnano_edit` mutations: thread `ctx.active_region_id` into `load_part`, return via `set_result_mutation_log(part.mutation_log)`
- [ ] For sequence-based computations: strip `"N"` placeholders before computing GC or other stats
- [ ] Log a summary at the end: counts of processed/skipped items
- [ ] `applyStrategy: previewOnly` unless the plugin intentionally mutates the model
- [ ] **Check** in dev mode reports no problems
- [ ] Final test: **Zip**, unlink, then **Import zip**, because a linked plugin runs in its own dev environment rather than the one an installed copy gets

### Parameters checklist

- [ ] Each `PluginParamDef` has a unique `id`
- [ ] `default` is set on every parameter
- [ ] `number` inputs: set `min`, `max`, and `step`
- [ ] Cast number params explicitly if integer arithmetic is required: `int(ctx.get_param(...))`

### Zip packaging checklist

- [ ] `fplugin.json` and all `.py` files stored at the **root level** of the zip (no subdirectory prefix)
- [ ] Entry point is named `plugin.py`
- [ ] Zip built from _inside_ the plugin directory: `cd <plugin_dir> && zip <id>.zip fplugin.json plugin.py *.py`
- [ ] Sibling module imports use plain `from <module> import ...` (no relative dot syntax)
- [ ] Any bundled `.whl` wheels listed as bare filenames in `requirements` are also present at the zip root
- [ ] The zip installs with **Import zip** in a fresh browser profile (no leftover cached version)
