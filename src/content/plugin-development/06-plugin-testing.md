---
title: Testing Plugins
description: Offline unit testing for foldnano_mini plugins using CPython, pytest fixtures, and the self-consistency replay check
category: plugin-development
order: 7
slug: plugin-testing
---

# Testing Plugins

## Testing `foldnano_mini` plugins offline

The offline transport is pure Python, so `foldnano_mini` plugins can be unit-tested in CPython without Pyodide or the browser. There are three layers:

### 1. Local invariants

`foldnano_mini/invariants.py` runs cheap validators _before_ an op is appended to the log: hex-color shape, integer endpoint distinctness, strand-set-index ∈ {0, 1}, etc. They fail fast with a clear `ValueError` / `TypeError` and never touch the JS side.

```python
import pytest
from foldnano_mini import load_part

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
        format="foldnano_mini",
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
from foldnano_mini import MutablePart, load_part

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

- `tests/test_foldnano_mini_offline.py`: offline transport behaviour, op recording, validation.
- `tests/test_foldnano_mini_replay_self.py`: self-consistency between mirror and replay.
- `tests/test_foldnano_regions.py`: Plane / DesignRegion proxy surface.

### What is _not_ covered offline

- Whether the JS-side `Part` accepts a given `connect(...)` topologically.
- 3D / view-side regressions.
- Cross-plugin interactions in the editor.

Validate those by running the plugin in `pnpm dev` against a real design and confirming the resulting state visually + with a single Undo.

---

## Testing Outside the Browser

`PluginContext` is plain Python. You can test plugins in a local CPython environment:

```python
import json
from foldnano.plugin import PluginContext

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

The `foldnano` and `foldnano_mini` packages live at `src/lib/plugin/python/`. Add it to your `PYTHONPATH` when running outside the browser:

```bash
PYTHONPATH=src/lib/plugin/python python my_plugin_test.py
# or:
cd src/lib/plugin/python && uv run pytest tests/ -v
```

---

## New Plugin Checklist

- [ ] `<plugin_dir>/plugin.py`: `run(ctx: PluginContext)` entry point, at the root of the plugin folder
- [ ] `<plugin_dir>/fplugin.json`: manifest with unique `id` (kebab-case), correct `format`, and correct `applyStrategy`, also at the root
- [ ] Zipped together with no subdirectory prefix: `cd <plugin_dir> && zip <id>.zip fplugin.json plugin.py`
- [ ] For `foldnano_json` mutations: mutate `part._raw`, return via `set_result_foldnano_json`
- [ ] For `foldnano_mini` mutations: thread `ctx.active_region_id` into `load_part`, return via `set_result_mutation_log(part.mutation_log)`
- [ ] For sequence-based computations: strip `"N"` placeholders before computing GC or other stats
- [ ] Log a summary at the end: counts of processed/skipped items
- [ ] `applyStrategy: previewOnly` unless the plugin intentionally mutates the model

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
