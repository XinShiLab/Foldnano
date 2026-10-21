---
title: Parse API Reference
description: The foldnano.io Parse API – PartData, OligoProxy, OligoSegmentProxy, VirtualHelixProxy
category: plugin-development
order: 5
slug: plugin-api
---

# Parse API Reference

Use `parse_foldnano_json()` to get a typed object hierarchy instead of working with raw dicts.

```python
from foldnano.io import parse_foldnano_json

part = parse_foldnano_json(ctx.get_part_as_foldnano_json())
```

## PartData

```python
part.name          # str: part name
part.id            # str: part UUID
part.lattice_type  # "HONEYCOMB" | "SQUARE"
part.max_base      # int: number of bp slots per helix
part.virtual_helices  # list[VirtualHelixProxy]
part.oligos           # list[OligoProxy]
part._raw             # dict: the original JSON dict; mutate this for round-trip changes

part.get_vh(index)    # -> VirtualHelixProxy | None
part.get_oligo(id)    # -> OligoProxy | None
```

## OligoProxy

```python
oligo.id                  # str: UUID
oligo.color               # str: hex color e.g. "#0066cc"
oligo.is_scaffold         # bool
oligo.is_sequence_locked  # bool
oligo.name                # str | None
oligo.segments            # list[OligoSegmentProxy]: ordered 5'→3'

oligo.sequence            # str: concatenated sequence across all segments
oligo.is_circular         # bool: True when last segment's 3' connects to first's 5'
```

## OligoSegmentProxy

```python
seg.id                       # str: UUID
seg.vh_index                 # int: which VirtualHelix this segment lives on
seg.five_prime_index         # int: bp index of 5' end on the helix
seg.three_prime_index        # int: bp index of 3' end on the helix
seg.five_prime_modification  # str | None: e.g. "/5Alex488N/"
seg.three_prime_modification # str | None
seg.connected_from_segment_id # str | None: upstream segment ID (None = global 5')
seg.connected_to_segment_id   # str | None: downstream segment ID (None = global 3')
seg.slots                     # list[dict]: per-bp records: {"bpIndex": int, "seq": str}
seg.sequence                  # str: pre-computed sequence for this segment

seg.length                    # int: abs(three_prime_index - five_prime_index) + 1
seg.is_free_five_prime        # bool: True when this is the oligo's global 5' end
seg.is_free_three_prime       # bool: True when this is the oligo's global 3' end
```

## VirtualHelixProxy

```python
vh.index    # int: VH index unique within the part
vh.row      # int: lattice row
vh.col      # int: lattice column
vh.length   # int: number of bp slots
vh.strand_set_segment_ids  # list[list[str]]: [ss0_ids, ss1_ids]
                            # ss0 runs 5'→3' (ascending), ss1 runs 3'←5' (descending)

vh.parity_is_even  # bool: True when row % 2 == col % 2
                   # Even parity → ss0 is scaffold; odd → ss1 is scaffold
```
