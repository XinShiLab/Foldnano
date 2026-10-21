---
title: Plugin Patterns
description: Round-trip mutation, foldnano_mini mutable API, user-configurable parameters, and patterns by use case
category: plugin-development
order: 7
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

### Finding your way around the API

Two generated references list the whole surface, so you don't need to memorise it:

- **Type stubs** in the repository under `src/lib/plugin/python/stubs/`. `foldnano_mini/__init__.pyi` and `foldnano/__init__.pyi` each hold every public class, method and property of their package, with signatures and docstrings. Read them, give them to a coding agent, or point your type checker at that folder (`MYPYPATH`, or pyright's `stubPath`) to get completion and type errors in your own editor.
- **Script Lab autocomplete**, which is built from the same data. See [Script Lab](/docs/guide/script-lab).

### Loading and the active region

```python
part = load_part(json_str, active_region_id=None)  # -> MutablePart
```

`active_region_id` should usually be threaded from `ctx.active_region_id`. It enables `part.active_region`, `part.oligos_in_region(region_id)`, `part.vhs_in_region(region_id)`, and (with `replayMutationLogInRegion`) is enforced by the host as a scope constraint at apply time.

### API reference

Every public name, with what it does and whether it reads or changes the design, is on its own page: [foldnano_mini API Reference](/docs/plugin-development/foldnano-mini-api). The sections below show how the pieces fit together.

### Asking before you edit

Every structural call has a `can_*` check that returns a `Check`. It is truthy when the edit is allowed and carries a `reason` when it is not:

```python
check = part.can_create_segment(vh, 10, 30)
if check:
    part.create_segment(vh, 10, 30)
else:
    ctx.log(f"skipped: {check.reason}")
```

The edit itself runs the same check and raises `InvalidOperationError` before anything is recorded, so a refused call never leaves a half-written log. The checks cover:

- **Creating** a segment: both ends inside the region's bases, on free bases of the strand it runs along (5' below 3' is strand 0, otherwise strand 1).
- **Moving** an end (`seg.five_prime.index = 12`, or `end.can_move_to(12)` first): inside the helix, not over another segment, not reversing the segment. An end on a crossover site may only move to another matching site.
- **Connecting**: two different segments with free ends.
- **Skips and insertions** (`slot.can_set_skip()`, `slot.can_set_insertion()`): inside the segment, not at its end, with the complementary strand present, and not at a crossover site.
- **Skip and insertion positions** are also off limits for connecting, moving an end, or breaking.

Free bases are easy to find too: `vh.strand_sets[0].free_ranges()` lists them, and `ss.is_index_occupied_by(bp)` returns the segment at a base.

### Crossovers and segment ends

`part.connect(a, b)` joins any free 3' end to any free 5' end. To land on a lattice crossover site, pick a base from `vh.potential_xover_sites(strand_index)` (each site has `bp_index`, `to_vh_index` and `right`), or check afterwards with `seg.three_prime.is_constrained`. Freeform helices have no sites.

When the two ends are on the same helix and strand, one base apart, `connect` **merges** the two segments into one instead of making a crossover. Leave a gap of at least one base if you want a crossover.

Each segment has `seg.five_prime` and `seg.three_prime` end objects with `index`, `modification`, `is_free`, `connected_segment`, `connected_end` and `is_constrained`.

### Editing like the strand view

These calls do what the strand view's tools do, and each has a `can_*` check:

```python
oligo = part.get_oligo_at(vh, 0, 21)     # what's at a base (also get_segment_at, get_end_at)
part.break_at(vh, 0, 21)                 # the break tool: new 3' end at base 21
part.make_crossover(vh, 0, 21, other_vh) # click a crossover site: break both strands, cross them
part.create_crossover(oligo, vh, 1, 30)  # drag an oligo's 3' end onto a strand at base 30
part.connect_oligos(oligo_a, oligo_b)    # join a free 3' end to a free 5' end
part.remove_oligo(oligo)
part.remove_segment(seg)                 # what was downstream becomes its own oligo
part.fill_empty_strand_set(vh, 1)        # one strand along the whole helix
part.add_insert_at(vh, 30)               # the insert tool: +1 base on both strands
part.add_skip_at(vh, 35)                 # the skip tool: skip on both strands
part.remove_skip_or_insertion_at(vh, 30)
```

Modifications live on free ends, so set them on the oligo: `oligo.five_modification = "/5Bio/"`, `oligo.three_modification = "/3Cy3/"`. A connected end refuses one.

For a region, `region.set_max_base(n)` grows or shrinks it (a shrink is refused while strands reach that far), `region.reduce_unused_length()` trims it to its strands, and `region.remove_all_skips()` / `region.remove_all_insertions()` clear those in one call. A single slot goes back to a plain base with `slot.remove_skip_or_insertion()`, and `part.get_slot_at(vh, strand_index, bp)` finds a slot by position.

### Drawing an oligo along a path

`part.create_oligo` builds a whole multi-segment oligo in one call. List one `(vh, five, three)` entry per segment, from 5' to 3'; each segment's 3' end joins the next one's 5' end:

```python
oligo = part.create_oligo(
    [
        (vh_a, 10, 30),   # strand 0 on vh_a
        (vh_b, 30, 10),   # crossover at base 30, then strand 1 on vh_b
    ],
    color="#ff8800",
    name="my staple",
)
```

The whole path is checked before anything is recorded. Entries that continue each other on the same strand become a single segment, `circular=True` closes the loop, and `SegmentSpec(vh, five, three)` can stand in for a tuple when you want named fields.

### Common pitfalls

- `replayMutationLogInRegion` aborts if any op's target VH is outside the active region. Use `part.oligos_in_region(...)` / `part.vhs_in_region(...)` to filter inputs up front.
- `region.add_vh_at(...)` only exists on `LatticedRegion`. For freeform regions, use `vh.local_frame = {...}`.
- `MutableSegment.oligo_id` is resolved dynamically on each access, so it stays correct after `part.connect(...)` merges two oligos.
- Connecting two ends that are one base apart on the same strand merges the segments; the second segment no longer exists afterwards.
- Breaks behave as in the editor. Breaking at an oligo's own free end, or one base before a free 3' end, does nothing. Breaking a circular oligo opens it into one linear oligo with the same id. A piece that splits off is a new staple oligo (green, not scaffold), and a mid-segment break drops the segment's 3' modification.
- `part.remove_segment(seg)` keeps the segments before it in the oligo and moves those after it into a new oligo (returned). Removing an oligo's first segment therefore removes that oligo id.
- Crossover calls clear modifications on the ends they join, since only free ends carry one.
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
