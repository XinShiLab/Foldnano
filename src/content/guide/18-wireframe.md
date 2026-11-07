---
title: Wireframe Designs (Experimental)
description: Experimental. Create a wireframe region from a mesh, route it with a plugin (pyDAEDALUS is the first), and manage the reference mesh
category: guide
order: 18
slug: wireframe
covers:
  - src/lib/components/Editor/ToolPanel/ReferenceMesh*.svelte
---

<script>
	import Callout from '$lib/components/docs/Callout.svelte';
</script>

# Wireframe Designs (Experimental)

<Callout type="warning" title="Experimental: one routing method so far">

Wireframe routing runs as plugins, rather than being built into the main app. **One routing method is available so far, the pyDAEDALUS plugin (DX edges), and more are in progress.** pyDAEDALUS runs the published DAEDALUS routing, but wireframe designs from Foldnano plugins have not been extensively tested in the lab yet, so simulate your design before ordering staples.

</Callout>

A **wireframe region** holds a design built around a mesh: helices follow the edges of a shape you bring. Foldnano shows and edits these designs, and a routing plugin builds them.

## Our Approach

Instead of building one router into the app, we host routing methods as plugins, on top of shared tools for reading meshes and placing helices. **Established, tested methods can run as plugins, and developers of new routing algorithms can build on the same API, so that a new method can be used in Foldnano as soon as its authors release it as a plugin.**

A plugin built on a published method keeps that method's routing. What Foldnano adds is turning that routing into its own helices and strands.

## Create A Wireframe Region

Start from the **Wireframe** card on the empty editor, or use **Add Region** → **Add Wireframe Region** on an open design. The tool panel asks for:

1. **Base plane.** The region's helices and its mesh are placed relative to this plane. Mesh x, y and z map to the plane's U, V and W.
2. **Reference mesh.** Click the drop area or drop a `.ply` file on it. A routing plugin needs one.
3. **Scale.** A PLY file has no unit, so you say how many nanometres one file unit stands for. The panel shows the resulting size and edge lengths, and the 3D view shows a live preview.

Dropping one `.ply` file on the empty editor opens the same panel with the mesh filled in. Nothing is created until you confirm.

## Mesh Files

Foldnano reads **ASCII PLY** files: vertices, faces and edges. Other properties, such as colors and normals, are ignored. Binary PLY is refused, so re-export as ASCII from your modelling tool. A mesh can have up to 1,000 vertices, 2,000 faces and 3,000 listed edges. A routing plugin usually places at least one helix per edge, and the strand view slows down with thousands of helices.

The original [pyDAEDALUS repository](https://github.com/lcbb/pyDAEDALUS/tree/master/PLY_Files) has example meshes you can try.

## Route It With A Plugin

1. Open the **Plugins** panel and install **pyDAEDALUS: DX Wireframe Routing** from the Hub's **Community Plugins**. See [Plugins](/docs/guide/plugins-for-users).
2. Select the wireframe region. It must have a mesh and no helices yet.
3. Run the plugin and choose the **minimum edge length**. Edges are rounded to whole helix turns.

The mesh must be closed: every edge shared by exactly two faces. pyDAEDALUS sets the size of the structure from the edge length, so it rescales the region's mesh to match the helices. Larger meshes take longer: a tetrahedron takes about a second, a mesh with hundreds of edges can take minutes.

The result is a normal Foldnano design. You can edit it in the linked views, check it, and [export it](/docs/guide/simulation-export) for simulation.

## Manage The Mesh

Select a wireframe region and open the 3D view. The **Mesh** button in the 3D toolbar opens a panel where you can:

- add a mesh, if the region has none
- replace it, with a preview first
- remove it
- show or hide it in the 3D view

Adding, replacing and removing are undoable and saved with the design. Showing or hiding is a view setting and is not saved.

The mesh is drawn in the 3D view only, in orange, and it moves with the region's plane. It can't be clicked, and it doesn't appear in the plane or strand views.

Faces are drawn simply, as a fan of triangles from each face's first vertex, so a concave polygon can fill outside its outline. Triangles and other convex faces are exact, and the edge lines are always right.

## The Mesh Is A Reference

Changing the mesh never changes helices, and changing helices never changes the mesh. A routing plugin reads the mesh and decides what to build. After that, the helices are the design.

## Helices In A Wireframe Region

Helices are placed as in a [freeform region](/docs/guide/creating-a-design), at any position and angle, and you edit strands as usual. The plane view does not offer the rotate handle or direction field, because those edits would flatten a helix into the plane.

The plane view looks along +W, so depth shows as opacity: helices at more negative W are nearer and more solid, and helices at more positive W are fainter. Where helices overlap, the nearer one is on top and takes the click.

Every virtual helix in a region spans the same range of bases, which is the space available for strands. The dsDNA on it can be any length, so each edge can have its own.

## For Plugin Developers

The plugin API for wireframe regions is an early version and may change. See [Wireframe Plugin APIs](/docs/plugin-development/wireframe-plugins).

## Work With Us

Our core team has limited wireframe experience. If you develop wireframe methods, we would especially like your view on what a routing plugin needs, and test designs to validate against. Please contact us.
