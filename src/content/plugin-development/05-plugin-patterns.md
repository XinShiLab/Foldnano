---
title: Plugin Patterns
description: Round-trip mutation, foldnano_mini mutable API, user-configurable parameters, and patterns by use case
category: plugin-development
order: 6
slug: plugin-patterns
---

# Plugin Patterns

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
            raw_oligos[idx]["color"] = "#ff0000"

    # 4. Return the modified _raw
    ctx.set_result_foldnano_json(json.dumps(part._raw))
```

**Key rule:** Use the proxy objects (`.oligos`, `.segments`, etc.) for reading and finding things. Mutate `part._raw` for writing. Do not mutate proxy attributes: they are read-only views and changes will not be serialised back.

---

## Writing plugins with `foldnano_mini`

`foldnano_mini` is a mutable, ergonomic Python API. You assign to attributes and call methods on the part; each mutation is recorded as a structured op in `part.mutation_log`, and the host replays the log against the real JS-side `Part` inside one history transaction.

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

### Loading and the active region

```python
part = load_part(json_str, active_region_id=None)  # -> MutablePart
```

`active_region_id` should usually be threaded from `ctx.active_region_id`. It enables `part.active_region`, `part.oligos_in_region(region_id)`, `part.vhs_in_region(region_id)`, and (with `replayMutationLogInRegion`) is enforced by the host as a scope constraint at apply time.

### MutablePart surface

```python
part.regions             # list[MutableRegion]   : LatticedRegion | FreeformRegion
part.virtual_helices     # list[MutableVirtualHelix]
part.oligos              # list[MutableOligo]
part.active_region       # MutableRegion | None
part.mutation_log        # list[dict] : JSON-serialisable op records
part.lattice_type        # 'HONEYCOMB' | 'SQUARE' | 'FREEFORM' (from first region)
part.max_base            # int

part.get_region(id)      # -> MutableRegion | None
part.get_vh(index)       # -> MutableVirtualHelix | None
part.get_oligo(id)       # -> MutableOligo | None
part.oligos_in_region(region_id)
part.vhs_in_region(region_id)

# Structural mutations
part.create_segment(vh, five_index, three_index, color="#0066cc")
part.connect(seg_from, seg_to)        # 3'→5'
part.remove_vhs([index, ...])
part.to_json()                        # full snapshot of the in-worker mirror
```

### Properties that record ops

| Read/write attribute | Op kind |
| --- | --- |
| `oligo.color = '#…'` | `set_oligo_color` |
| `oligo.name = '…'` | `set_oligo_name` |
| `oligo.is_scaffold = True/False` | `set_oligo_is_scaffold` |
| `seg.five_modification = '/5…/'` | `set_segment_modification` |
| `seg.three_modification = '/3…/'` | `set_segment_modification` |
| `seg.slot_at(bp).seq = '…'` | `set_slot_sequence` |
| `seg.slot_at(bp).set_skip(True)` | `set_slot_skip` |
| `seg.slot_at(bp).set_insertion(…)` | `set_slot_insertion` |
| `seg.remove()` | `remove_segment` |
| `oligo.remove()` | `remove_oligo` |
| `region.add_vh_at(row, col)` | `add_vh_at_coords` (lattice only) |
| `vh.local_frame = {…}` | `set_vh_local_frame` (freeform) |

### Common pitfalls

- `replayMutationLogInRegion` aborts if any op's target VH is outside the active region. Use `part.oligos_in_region(...)` / `part.vhs_in_region(...)` to filter inputs up front.
- `region.add_vh_at(...)` only exists on `LatticedRegion`. For freeform regions, use `vh.local_frame = {...}`.
- `MutableSegment.oligo_id` is resolved dynamically on each access, so it stays correct after `part.connect(...)` merges two oligos.
- Validation errors raise immediately and do **not** pollute `part.mutation_log`.

---

## User-Configurable Parameters

Plugins can declare a `parameters` array in their manifest to collect user input before each run.

### PluginParamDef schema

```json
{
	"id": "threshold",
	"label": "Score threshold",
	"type": "number",
	"default": 0.5,
	"description": "Minimum score to include",
	"required": true,
	"min": 0,
	"max": 1,
	"step": 0.01,
	"options": ["fast", { "value": "thorough", "label": "Thorough (slow)" }]
}
```

All fields except `id`, `label`, and `type` are optional.

### Python-side usage

```python
def run(ctx: PluginContext) -> None:
    threshold = float(ctx.get_param("threshold", 0.5))
    mode      = ctx.get_param("mode", "fast")
    verbose   = bool(ctx.get_param("verbose", False))
    ctx.log(f"params: threshold={threshold}  mode={mode!r}  verbose={verbose}")
```

### Type coercion

| Dialog input type | Python type received |
| --- | --- |
| `number` | `float` (may be integral, e.g. `72.0`) |
| `boolean` | `bool` |
| `string` | `str` |
| `select` | `str` (the `value` of the selected option) |

Always cast `number` values explicitly if your logic requires an integer:

```python
n_helices = int(ctx.get_param("n_helices", 8))
```

---

## Patterns by Use Case

### Analysis / report (previewOnly)

```python
import csv, io
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
        color = "#cc3300"
        idx = id_to_idx.get(oligo.id)
        if idx is not None:
            raw_oligos[idx]["color"] = color

    ctx.set_result_foldnano_json(json.dumps(part._raw))
```

### Multi-file plugin (shared helpers, extra modules)

Every plugin ships as a zip, so growing beyond one file just means adding more files at the zip root: no format change is needed.

**Directory layout:**

```
static/plugins/my_plugin/
  fplugin.json    ← manifest (source of truth once zipped)
  plugin.py       ← entry point (must be named plugin.py)
  helper.py
  my_plugin.zip   ← built from the files above
```

**Build the zip from inside the directory** (no subdirectory prefix):

```bash
cd static/plugins/my_plugin
zip my_plugin.zip fplugin.json plugin.py helper.py
```

**Manifest** (`fplugin.json`, at the zip root; omit `entrypointUrl`, since the installer already knows the code is in this zip):

```json
{
	"schemaVersion": 1,
	"id": "my-plugin",
	"name": "My Plugin",
	"version": "1.0.0",
	"format": "cadnano_json",
	"applyStrategy": "previewOnly"
}
```

**`plugin.py`**: import sibling modules the normal way:

```python
from helper import do_thing

def run(ctx):
    result = do_thing()
    ctx.set_result(result)
```

The worker extracts the zip to `/plugin_run/` and adds that path to `sys.path`, so all files land at the same level and relative imports work.

To share this plugin, share the `.zip`; users install it with **Import zip**. See the [quick start](/docs/plugin-development/plugin-quickstart) for why links to other websites aren't supported during the beta.

### Handling unsequenced designs

Always strip `"N"` placeholder characters before computing sequence-based statistics:

```python
seq = oligo.sequence or ""
real_seq = seq.replace("N", "")

if not real_seq:
    continue  # Skip: oligo has no real sequence yet

gc = (real_seq.count("G") + real_seq.count("C")) / len(real_seq)
```

**Do not** check `if not seq`: `"NNNNN"` is truthy but represents an unsequenced oligo.
