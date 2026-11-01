---
title: Wireframe Designs (Developer Preview)
description: Wireframe routing will be supported through plugins. What exists today, our current plan, what's still needed, and the early plugin API for developers
category: guide
order: 18
slug: wireframe
---

<script>
	import Callout from '$lib/components/docs/Callout.svelte';
</script>

# Wireframe Designs (Developer Preview)

<Callout type="danger" title="Not ready for designing wireframe structures">

Wireframe routing will be supported through plugins, rather than built into the main app. No routing plugin is available yet, so you can't design a wireframe structure in Foldnano today.

</Callout>

This page describes where wireframe support stands and our current plan, which may change.

## What Exists Today

- **Wireframe regions.** A design can hold a region built around a reference mesh. Foldnano shows it and lets you edit its helices and strands as in a freeform region, and it exports to oxDNA and mrDNA.
- **An early plugin API.** A plugin can read the mesh, place helices along its edges and build strands.

## Our Approach

Instead of building one router into the app, we plan to host routing methods as plugins, on top of shared tools for reading meshes and placing helices. **Established, tested methods could then run as plugins, and developers of new routing algorithms could build on the same API, so that a new method can be used in Foldnano as soon as its authors release it as a plugin.** A routed structure would then be a normal Foldnano design: you can edit it at the nucleotide level in linked 2D and 3D views, assign sequences, check the design, and export it for simulation.

## What's Still Needed

- Routing plugins that you can install and use.
- Validation: simulating wireframe structures made this way, then testing them in the lab.

## Designing A Wireframe Today?

Please use an established wireframe design tool for now.

## For Plugin Developers

An early version of the plugin API is available for developers of routing methods. See [Wireframe Plugin APIs](/docs/plugin-development/wireframe-plugins).

## Work With Us

Our core team has limited wireframe experience. If you develop wireframe methods, we would especially like your view on what a routing plugin needs, and test designs to validate against. Please contact us.
