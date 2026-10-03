---
title: File Format (.fn.json)
description: The contract for Foldnano design files, field by field, with versioning rules and a JSON Schema
category: contributors
order: 9
slug: file-format
---

# File Format (.fn.json)

A Foldnano design file (`.fn.json`) is a single JSON document. It is what Foldnano commits to GitHub, what **Export as Foldnano JSON** downloads, and what you could share with other researchers. This page is the contract for that file: what each field means, its units and conventions, and what stays stable between versions.

It is written for anyone who reads or writes these files outside the editor: analysis scripts, other design tools, reviewers checking supplementary data, and contributors changing the model.

## Machine-readable schema

Each format version has a JSON Schema (draft 2020-12), published with the app:

| Format version | Schema                                                               |
| -------------- | -------------------------------------------------------------------- |
| 1              | [`/schemas/foldnano-v1.schema.json`](/schemas/foldnano-v1.schema.json) |

The schema checks structure and types. It does not check cross-references (for example that a segment's helix exists) or the conventions described below, so a file can pass the schema and still fail to load. The schema is also stricter than the app: it rejects fields it doesn't define, while Foldnano ignores them when loading and drops them on the next save.

Foldnano's test suite validates everything the app writes against the current schema and rejects unknown fields, so the schema, this page and the app cannot drift apart silently.

## Versioning and compatibility

Every file starts with a header:

```json
{
	"format": "foldnano",
	"formatVersion": 1,
	"savedWith": { "app": "0.5.1", "commit": "8e358c7" },
	"id": "…",
	"name": "…",
	"parts": []
}
```

- `format` is always `"foldnano"`.
- `formatVersion` is an integer. It is the only field Foldnano uses to decide whether it can open a file.
- `savedWith` records the Foldnano release and source commit that last saved the file. It is provenance only; never use it to decide how to read a file.

What Foldnano does:

1. **Older files keep opening.** A newer Foldnano upgrades an older file on load. Files saved before versioning existed (no header) are version 1.
2. **Newer files are refused, never misread.** If a file's `formatVersion` is higher than the running app supports, Foldnano shows an error and does not change anything, including your local copy.
3. **The version goes up whenever an older app could lose data**, including when a new field is added, because an older app would drop the unknown field when it saved the file again.

If you write a tool that reads `.fn.json`, check `formatVersion` first and refuse versions you don't know, the same way Foldnano does.

## Conventions

- **Base-pair index (`bp`)**: an integer position along a helix, starting at 0.
- **Strand direction**: every helix has two strands. Strand 0 runs 5'→3' in the direction of increasing bp index; strand 1 runs 5'→3' towards decreasing bp index.
- **Ranges are inclusive**: a segment from bp 0 to bp 20 covers 21 positions.
- **Lengths and positions in 3D are in nanometres (nm).**
- **Identifiers** are strings (UUIDs in practice). They are unique within a file and stable across saves, so they are safe to use for diffing two versions of a design.
- **Colours** are CSS hex strings such as `"#ff0000"`.

## Top level

| Field           | Type   | Meaning                                                  |
| --------------- | ------ | -------------------------------------------------------- |
| `format`        | string | Always `"foldnano"`                                      |
| `formatVersion` | int    | File format version (see above)                          |
| `savedWith`     | object | `{ app, commit }`: which build last saved the file       |
| `id`            | string | Document id                                              |
| `name`          | string | Document name                                            |
| `parts`         | array  | The designs in this document; most editing works on the first |

## Part

A part is one DNA origami design: its helices, strands and layout.

| Field                 | Type   | Meaning                                                                           |
| --------------------- | ------ | --------------------------------------------------------------------------------- |
| `id`, `name`          | string |                                                                                   |
| `planes`              | array  | Coordinate frames that regions are laid out on                                    |
| `regions`             | array  | Lattice or freeform areas that own helices                                        |
| `virtualHelices`      | array  | The double-helix positions                                                        |
| `oligos`              | array  | The DNA strands                                                                   |
| `customModifications` | array  | Optional. User-defined end modifications, `{ name, color }`                       |
| `overlayPlacements`   | array  | Optional. Where external 3D structures were placed; display only                  |
| `repeatGroups`        | array  | Optional. Repeat units; see [Repeat groups](#repeat-groups-and-mirror-oligos)      |

Optional arrays are left out when empty.

## Planes

A plane is a coordinate frame in 3D: `origin`, and the unit vectors `u`, `v` and `normal`, each `{ x, y, z }`. Regions place their helices in plane coordinates; the plane maps them into the shared 3D space.

## Regions

A region is an area of the design with one layout rule.

| Field          | Type           | Meaning                                                                                     |
| -------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `id`, `name`   | string         |                                                                                             |
| `kind`         | string         | `"HONEYCOMB"`, `"SQUARE"` or `"FREEFORM"`                                                   |
| `planeId`      | string         | The plane this region sits on                                                               |
| `vhOrder`      | array of ids   | Display order of this region's helices (by helix `id`)                                      |
| `step`         | int            | Helix length grows in multiples of this many bp (honeycomb 21, square 32)                   |
| `turnsPerStep` | number         | Helical turns per `step`; `step / turnsPerStep` is the helical pitch in bp                  |
| `subStepSize`  | int            | Crossover spacing unit in bp                                                                |
| `twistOffset`  | number         | Phase offset of the helix twist, in degrees                                                 |
| `minBase`      | int            | First usable bp index; defaults to 0 if absent                                              |
| `maxBase`      | int            | Region length in bp. Older files call it `defaultMaxBase`; read that when `maxBase` is absent |

## Virtual helices

A virtual helix (VH) is one double-helix position. It holds two strands, which segments occupy.

| Field           | Type   | Meaning                                                                                                   |
| --------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `id`            | string | Stable identity                                                                                           |
| `index`         | int    | Helix number, unique within the part (the number cadnano shows). Segments refer to helices by this number |
| `listRow`       | int    | Row in the editor's strand view. Display only; don't use it as an identity                                |
| `regionId`      | string | The region that owns this helix                                                                           |
| `length`        | int    | Number of bp positions                                                                                    |
| `latticeCoords` | object | Lattice helices only: `{ row, col }` on the region's lattice                                              |
| `localFrame`    | object | Freeform helices only: `{ origin, axis, radial0 }` in the plane's coordinates, in nm                      |
| `strandSets`    | array  | Exactly two entries, strand 0 then strand 1                                                               |

In `localFrame`, `origin` is the position of bp 0, `axis` is the unit vector towards increasing bp index, and `radial0` is a unit vector perpendicular to the axis that fixes the rotation of the helix.

Each strand set is `{ strandIndex, segmentIds }`: the ids of every segment on that strand. It must agree with the segments' own positions.

## Oligos

An oligo is one continuous DNA strand, a staple or the scaffold, made of one or more segments joined end to end.

| Field              | Type    | Meaning                                                                                              |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| `id`               | string  |                                                                                                      |
| `name`             | string  | Empty string when unnamed                                                                            |
| `color`            | string  | Display colour                                                                                       |
| `isScaffold`       | boolean | This oligo is the scaffold strand                                                                    |
| `isSequenceLocked` | boolean | A sequence was assigned to the whole oligo (for example the scaffold) and has not been edited since |
| `segments`         | array   | The oligo's segments. The array order carries no meaning; follow the end connections                |
| `repeatGroupId`    | string  | Optional. Marks an original of a repeat group                                                        |
| `mirrorOf`         | object  | Optional. Marks a mirror oligo; see below                                                            |

## Segments

A segment is the part of an oligo that lies on a single helix strand.

| Field                 | Type   | Meaning                                                                          |
| --------------------- | ------ | -------------------------------------------------------------------------------- |
| `id`                  | string |                                                                                  |
| `inVirtualHelixIndex` | int    | The helix's `index`                                                              |
| `fivePrime`           | object | The 5' end                                                                       |
| `threePrime`          | object | The 3' end                                                                       |
| `slots`               | array  | One entry per bp position, in 5'→3' order: `{ bpIndex, seq }`                    |
| `sequence`            | string | All slot sequences joined, 5'→3'. Redundant copy of `slots`, kept for readability |

The strand follows from the ends: if the 5' end's bp index is lower than the 3' end's, the segment is on strand 0, otherwise on strand 1.

A slot's `seq` describes what is at that bp position:

- one base (`"A"`): a normal position
- empty (`""`): a **skip**, no nucleotide at this position
- several bases (`"ATT"`): the base at this position followed by **insertions**
- `"N"`: a base whose sequence has not been assigned yet

Keep `sequence` equal to the joined slots when writing a file. If the two disagree but have the same total length, Foldnano uses `sequence`.

### Segment ends

| Field                | Type           | Meaning                                                                                                          |
| -------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `segmentId`          | string         | The segment this end belongs to                                                                                  |
| `isThreePrime`       | boolean        | `true` for the 3' end                                                                                            |
| `index`              | int            | bp index of the end base (inclusive)                                                                             |
| `connectedSegmentId` | string or null | The next segment (from a 3' end) or the previous segment (from a 5' end); `null` at a free strand end             |
| `modification`       | string or null | Name of an end modification: a built-in (`Thiol`, `Biotin`, `Cy3`, `Cy5`) or one of the part's `customModifications` |
| `isConstrained`      | boolean        | Computed by Foldnano from the design; written for reference and ignored on load                                  |

Connections always run from a 3' end to the next segment's 5' end. To walk an oligo 5'→3', start at the segment whose 5' end has `connectedSegmentId: null` and follow each 3' end's `connectedSegmentId`. A scaffold that forms a closed loop has no free end; start anywhere.

## Repeat groups and mirror oligos

A repeat group copies a set of original oligos (those with its `repeatGroupId`) to other positions. Each entry in `instances` is `{ id, bpOffset }`: one copy shifted by `bpOffset` bp. (`vhMap` is reserved for future use.)

The copies are stored as ordinary oligos with a `mirrorOf` tag `{ groupId, instanceId, sourceOligoId, structure }`. `structure` is an internal fingerprint; treat it as opaque. Foldnano rebuilds mirrors from their originals, so edit the originals, not the mirrors.

Foldnano's staple exports leave mirror oligos out. If you build a staple list from a `.fn.json` yourself, decide deliberately whether to include oligos that have `mirrorOf`.

## Overlay placements

Where the user placed external 3D structures (PDB or mrDNA files) next to the design: `{ id, sourceKey, transform }`, with `transform.position` in nm and `transform.quaternion` as `[x, y, z, w]`. `sourceKey` is the PDB accession or file name. Only the placement is stored, not the structure itself, and it has no effect on the design.

## For contributors: changing the format

Any change to what `toJSON()` writes is a format change. In the same commit:

1. Increment `CURRENT_FORMAT_VERSION` in `src/lib/model/documentFormat.ts` and add a migration from the previous version to `MIGRATIONS`.
2. Add `static/schemas/foldnano-v<N>.schema.json`, keeping the older schemas, and add the version to the table on this page.
3. Add the fixture `test_files/fixtures/document_format/v<N>.fn.json`.
4. Update this page.

`DocumentFormat.spec.ts` and `DocumentSchema.spec.ts` fail until steps 1 to 3 are done; nothing checks step 4, so don't skip it.
