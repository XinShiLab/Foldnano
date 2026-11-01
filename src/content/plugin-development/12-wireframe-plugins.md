---
title: Wireframe Plugin APIs (Developer Preview)
description: The early API for writing routing plugins for wireframe regions. Creating a region, the referenceGeometry shape, reading and storing a mesh, placing helices along edges, and example plugins
category: plugin-development
order: 12
slug: wireframe-plugins
covers:
  - src/lib/plugin/python/foldnano/region.py
  - src/lib/components/Editor/ToolPanel/ReferenceMesh*.svelte
---

<script>
	import Callout from '$lib/components/docs/Callout.svelte';
</script>

# Wireframe Plugin APIs (Developer Preview)

<Callout type="danger" title="Developer Preview: for developers of routing methods">

**The API works and is tested, but it may change as more routing methods use it.** So far we have tried it only with a method that chooses crossovers on a fixed set of helices.

**The examples here show how the API works. They are not routing methods.** They place helices, but not a scaffold path, crossovers or vertex design that would fold. No wireframe structure made this way has been simulated or tested in the lab yet.

</Callout>

Foldnano represents, shows and edits wireframe regions, and routing methods run as plugins. A routing plugin reads a mesh from a wireframe region, or generates one, and then builds helices and strands with [`foldnano.edit`](/docs/plugin-development/foldnano-edit-api). For where wireframe support stands overall, see [Wireframe Designs](/docs/guide/wireframe).

Your plugin decides how many helices an edge gets, their lengths and roll, the scaffold path, and what happens at each vertex. The app does none of this for you.

## Create A Wireframe Region

The **Wireframe** card on the start screen, greyed and marked **API preview**, always creates a wireframe region. The other ways in need [Plugin dev mode](/docs/plugin-development/plugin-dev-mode): open the **Plugins** panel, switch to the **Dev** tab, and turn it on. **Add Wireframe Region** then appears under **Add Region**, and you can drop a `.ply` file on the empty editor.

The switch only controls those entry points. With it off, a design that already has a wireframe region opens and edits as usual, and a plugin can still create one with `part.add_region`.

The tool panel asks for:

1. **Base plane.** The region's helices and its mesh are placed relative to this plane. Mesh x, y and z map to the plane's U, V and W.
2. **Reference mesh.** Optional. Click the drop area or drop a `.ply` file on it.
3. **Scale.** A PLY file has no unit, so you say how many nanometres one file unit stands for. The panel shows the resulting size and edge lengths, and the 3D view shows a live preview.

Dropping one `.ply` file on the empty editor opens the same panel with the mesh filled in. Nothing is created until you confirm.

### Mesh Files

Foldnano reads **ASCII PLY** files: vertices, faces and edges. Other properties, such as colors and normals, are ignored. Binary PLY is refused, so re-export as ASCII from your modelling tool. A mesh can have up to 1,000 vertices, 2,000 faces and 3,000 listed edges. A routing plugin usually places at least one helix per edge, and the strand view slows down with thousands of helices.

### Manage The Mesh

Select a wireframe region and open the 3D view. The **Mesh** button in the 3D toolbar opens a panel where you can:

- add a mesh, if the region has none
- replace it, with a preview first
- remove it
- show or hide it in the 3D view

Adding, replacing and removing are undoable and saved with the design. Showing or hiding is a view setting and is not saved.

The mesh is drawn in the 3D view only, in orange, and it moves with the region's plane. It can't be clicked, and it doesn't appear in the plane or strand views.

Faces are drawn simply, as a fan of triangles from each face's first vertex, so a concave polygon can fill outside its outline. Triangles and other convex faces are exact, and the edge lines are always right.

### Helices In The Plane View

Helices are placed as in a [freeform region](/docs/guide/creating-a-design), at any position and angle, and you edit strands as usual. The plane view does not offer the rotate handle or direction field, because those edits would flatten a helix into the plane.

The plane view looks along +W, so depth shows as opacity: helices at more negative W are nearer and more solid, and helices at more positive W are fainter. Where helices overlap, the nearer one is on top and takes the click.

## What A Wireframe Region Is

A wireframe region is a freeform region with its own kind (`'WIREFRAME'`) that can also hold a reference mesh. Three rules shape how you write a plugin:

- **Helices and the mesh share one coordinate system.** Mesh coordinates are in nm, in the region's frame: x, y and z run along the plane's U, V and W. Pass a vertex directly to `add_vh_at` and the helix starts there. Moving the plane moves both.
- **The mesh is a reference.** Nothing keeps it in step with the helices. Editing helices doesn't change the mesh, and changing the mesh doesn't change helices.
- **A virtual helix is the space available, not the length of the DNA.** Every virtual helix in a region spans the region's `max_base`, and strands can fill any part of it, so each edge can have its own length of dsDNA. Set `region.max_base` to fit the longest edge, then create strands only over the bases each edge needs. Giving one virtual helix a different length is refused.

## The `referenceGeometry` Shape

A saved design stores the mesh on the region, as `referenceGeometry`:

```json
{
	"id": "region-1",
	"kind": "WIREFRAME",
	"referenceGeometry": {
		"unit": "nm",
		"mesh": {
			"vertices": [
				[0, 0, 0],
				[10, 0, 0],
				[0, 10, 0]
			],
			"faces": [[0, 1, 2]],
			"edges": []
		}
	}
}
```

The other region fields are left out here. These rules apply to a saved file and to anything a plugin stores:

| Field | Rule |
| --- | --- |
| `referenceGeometry` | Optional, and allowed only on a `WIREFRAME` region. |
| `unit` | Always `"nm"`. |
| `mesh` | Optional. A region can have geometry with no mesh. |
| `vertices` | Required with `mesh`. Each is three finite numbers. |
| `faces` | Required with `mesh`, and may be empty. Each lists three or more vertex indices. |
| `edges` | Required with `mesh`, and may be empty. Each lists two vertex indices. |

**`edges` holds only the edges a file states.** A mesh made of faces usually has an empty `edges` list, because its edges are implied by the sides of its faces. `mesh.all_edges()` gives you all of them.

In Python you get the same data as `ReferenceGeometry` and `ReferenceMesh`, imported from `foldnano`. Both are immutable and check their values when built. To change a mesh, build a new one and store it. See the [API reference](/docs/plugin-development/foldnano-edit-api#regions-and-planes) for every member.

## Getting A Mesh

There are two ways for a mesh to reach your plugin:

- **The user adds it to the region**, from a PLY file, with the **Mesh** button in the 3D view. Your plugin reads `region.reference_geometry`. The user sets the scale when adding it, so the values you read are already in nm.
- **Your plugin builds it**, from parameters or a calculation, and stores it with `region.set_reference_geometry`.

Plugin parameters can't take a file yet, so a plugin can't ask for a mesh file when it runs. Always handle a region with no mesh: `reference_geometry` can be `None`, and so can its `mesh`.

## Listing The Edges

Most routing plugins start with the mesh's edges. `mesh.edges` holds only the edges a file states, so use `mesh.all_edges()`, which adds the sides of the faces and gives each distinct edge once, as a sorted vertex pair:

```python
for a, b in mesh.all_edges():
    start, end = mesh.vertices[a], mesh.vertices[b]
```

## Example: Read A Mesh

This plugin edits nothing. It reports on the active region's mesh and offers it as a download, which is also how you would hand a mesh to an external tool.

**`fplugin.json`**

```json
{
	"schemaVersion": 2,
	"id": "wireframe-mesh-report",
	"name": "Wireframe Mesh Report",
	"version": "1.0.0",
	"format": "foldnano_edit",
	"applyStrategy": "previewOnly",
	"description": "Report on the active wireframe region's reference mesh."
}
```

**`plugin.py`**

```python
import math

from foldnano import PluginContext
from foldnano.edit import load_part


def run(ctx: PluginContext) -> None:
    part = load_part(ctx.get_part_as_foldnano_json(), active_region_id=ctx.active_region_id)
    region = part.active_region
    if region is None or region.kind != "WIREFRAME":
        raise ValueError("Select a wireframe region first.")
    geometry = region.reference_geometry
    if geometry is None or geometry.mesh is None:
        raise ValueError("This region has no reference mesh.")

    mesh = geometry.mesh
    edges = mesh.all_edges()
    lengths = [math.dist(mesh.vertices[a], mesh.vertices[b]) for a, b in edges]
    ctx.log(f"{len(mesh.vertices)} vertices, {len(mesh.faces)} faces, {len(edges)} edges")
    ctx.log(f"Edge lengths: {min(lengths):.2f} to {max(lengths):.2f} {geometry.unit}")

    ctx.write_artifact("reference-mesh.ply", mesh.to_ply())
    ctx.set_result({"vertices": len(mesh.vertices), "edges": len(edges)})
```

<Callout type="tip" title="Try the examples in Script Lab">

You don't need to package a plugin or write a manifest to try the examples on this page. Paste the `plugin.py` code into [Script Lab](/docs/guide/script-lab), click **Run**, then **Apply** if the example edits the design. Script Lab is off by default, so [turn it on](/docs/guide/script-lab#turning-it-on) first.

You only need `fplugin.json` when you package the code as a plugin. Script Lab has no parameter form, so the cube example uses its default edge length.

</Callout>

## Example: One Helix Per Edge

This plugin places a double-stranded helix along each edge of the active region's mesh. It stops short of each vertex so helices don't collide, and lengthens the region if the longest edge needs it.

**`fplugin.json`**

```json
{
	"schemaVersion": 2,
	"id": "helix-per-edge",
	"name": "Helix Per Edge",
	"version": "1.0.0",
	"format": "foldnano_edit",
	"applyStrategy": "replayMutationLogInRegion",
	"description": "Demo: one double-stranded helix along each mesh edge."
}
```

**`plugin.py`**

```python
import math

from foldnano import BACKBONE_RISE_NM, PluginContext
from foldnano.edit import load_part

GAP_NM = 1.5  # keeps helices apart at each vertex


def run(ctx: PluginContext) -> None:
    part = load_part(ctx.get_part_as_foldnano_json(), active_region_id=ctx.active_region_id)
    region = part.active_region
    if region is None or region.kind != "WIREFRAME":
        raise ValueError("Select a wireframe region first.")
    if region.reference_geometry is None or region.reference_geometry.mesh is None:
        raise ValueError("This region has no reference mesh.")
    if region.virtual_helices:
        raise ValueError("This region already has helices. Use an empty region.")
    mesh = region.reference_geometry.mesh

    # Work out every edge first, because the region's length must fit the longest.
    placements = []
    for a, b in mesh.all_edges():
        start, end = mesh.vertices[a], mesh.vertices[b]
        length = math.dist(start, end)
        bp = int((length - 2 * GAP_NM) / BACKBONE_RISE_NM)
        if bp < 2:
            ctx.log(f"Skipped edge {a}-{b}: too short for a helix.")
            continue
        direction = tuple((e - s) / length for s, e in zip(start, end))
        origin = tuple(s + d * GAP_NM for s, d in zip(start, direction))
        placements.append((origin, direction, bp))
    if not placements:
        raise ValueError("Every edge is too short for a helix.")

    longest = max(bp for _, _, bp in placements)
    if region.max_base < longest:
        missing = longest - region.max_base
        region.increase_length_by(math.ceil(missing / region.step) * region.step)

    for origin, direction, bp in placements:
        vh = region.add_vh_at(origin, direction)
        part.create_oligo([(vh.index, 0, bp - 1)], color="#3366cc")
        part.create_oligo([(vh.index, bp - 1, 0)], color="#cc3366")

    ctx.set_result({"helices": len(placements), "longest_bp": longest})
    ctx.set_result_mutation_log(part.mutation_log)
```

## Example: Build The Mesh In The Plugin

This plugin needs an open design, but no selected region or file. It generates a cube from a parameter, creates a new wireframe region, stores the mesh on it and places the helices.

It uses `replayMutationLog`, because `replayMutationLogInRegion` refuses edits outside the region that was active when the plugin ran.

**`fplugin.json`**

```json
{
	"schemaVersion": 2,
	"id": "wireframe-cube",
	"name": "Wireframe Cube",
	"version": "1.0.0",
	"format": "foldnano_edit",
	"applyStrategy": "replayMutationLog",
	"description": "Demo: a new wireframe region holding a cube and one helix per edge.",
	"parameters": [
		{
			"id": "edge_nm",
			"label": "Edge length (nm)",
			"type": "number",
			"default": 30,
			"min": 15
		}
	]
}
```

**`plugin.py`**

```python
import itertools
import math

from foldnano import BACKBONE_RISE_NM, PluginContext, ReferenceGeometry, ReferenceMesh
from foldnano.edit import load_part

GAP_NM = 1.5
STEP = 21  # a wireframe region's length changes in steps of 21 bases


def run(ctx: PluginContext) -> None:
    part = load_part(ctx.get_part_as_foldnano_json(), active_region_id=ctx.active_region_id)
    size = float(ctx.get_param("edge_nm", 30))

    vertices = [(x, y, z) for x, y, z in itertools.product((0.0, size), repeat=3)]
    edges = [
        (a, b)
        for a, b in itertools.combinations(range(len(vertices)), 2)
        if math.isclose(math.dist(vertices[a], vertices[b]), size)
    ]

    bp = int((size - 2 * GAP_NM) / BACKBONE_RISE_NM)
    region = part.add_region("WIREFRAME", "Cube", math.ceil(bp / STEP) * STEP)
    region.set_reference_geometry(ReferenceGeometry(mesh=ReferenceMesh(vertices, edges=edges)))

    for a, b in edges:
        start, end = vertices[a], vertices[b]
        direction = tuple((e - s) / size for s, e in zip(start, end))
        origin = tuple(s + d * GAP_NM for s, d in zip(start, direction))
        vh = region.add_vh_at(origin, direction)
        part.create_oligo([(vh.index, 0, bp - 1)], color="#3366cc")
        part.create_oligo([(vh.index, bp - 1, 0)], color="#cc3366")

    ctx.set_result({"helices": len(edges), "bp_per_edge": bp})
    ctx.set_result_mutation_log(part.mutation_log)
```

This mesh has edges and no faces, so it draws as lines in the 3D view.

## Going Further

A real router needs what these examples leave out. These calls are the starting points:

| To do this | Use |
| --- | --- |
| Run a strand from one edge's helix to the next | `part.connect_oligos(from_oligo, to_oligo)`, or list several helices in one `part.create_oligo` path |
| Mark the scaffold | `part.create_oligo(..., is_scaffold=True)` |
| Add a crossover between helices | `part.create_crossover(...)` |
| Set a helix's rotation about its axis | `vh.roll_deg` |
| Tilt or move a helix after placing it | `vh.local_frame` |
| Place more than one helix on an edge | Call `add_vh_at` for each, at the offsets your bundle needs |

Each edit has a matching `can_*` check where it could be refused. See [Asking before you edit](/docs/plugin-development/plugin-patterns#asking-before-you-edit).

## What Else To Know

- **Undo.** Applying a `replayMutationLog` result is one undo step, whatever the plugin did.
- **Exports.** Helices in a wireframe region export to oxDNA and mrDNA like freeform helices. Cadnano export needs a lattice and is not available. The mesh itself is not written to any export.
- **Mixed designs.** A part can hold wireframe regions next to lattice and freeform ones. Check `region.kind`, not the deprecated `part.lattice_type`, which describes only the first region.
- **Other formats.** A `foldnano_json` plugin can read the mesh too, from the parsed region's `reference_geometry`, or set `referenceGeometry` in the JSON it returns. Cadnano JSON holds lattice regions only, so `cadnano_json` plugins don't work on a wireframe region.
- **Testing.** Build a region in your test with `part.add_region("WIREFRAME", ...)`, then follow [Testing Plugins](/docs/plugin-development/plugin-testing).

## Work With Us

If you develop wireframe methods, we would like to hear what a routing plugin needs that is missing here. Please contact us.
