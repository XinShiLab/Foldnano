"""
Nick Remover Plugin
===================
Joins all adjacent staple nicks on the same virtual helix.

A nick is where a staple strand ends (3' end) at position *i* and another
staple strand starts (5' end) at position *i+1* on the same helix.  This
plugin connects them by writing the appropriate backbone pointers in the
cadnano JSON.

Scaffold strands are intentionally left unchanged.

How it works
------------
* cadnano ``stap`` array: each entry is ``[fromVH, fromBp, toVH, toBp]``.
  - 5' end: ``fromVH == -1`` (no incoming pointer).
  - 3' end: ``toVH  == -1`` (no outgoing pointer).
  - Empty:  all four values are ``-1``.
* For each helix the plugin scans consecutive positions.  When position *i*
  is a 3' end AND position *i+1* is a 5' end, it writes the connecting
  backbone pointers between them.

Because ``applyStrategy`` is ``replacePart``, the host fully replaces the
part from the returned cadnano JSON.  Sequences and modifications from the
original design are **not** re-grafted — this plugin demonstrates a
topology-only operation.  Use Undo (Ctrl+Z) to restore the original state.

Requires: no external packages (pure Python + stdlib).
"""

from __future__ import annotations

import json

from foldnano.plugin import PluginContext


def _find_nicks(stap: list[list[int]]) -> list[tuple[int, int, int, int]]:
    """
    Return tuples (pos_3prime, pos_5prime, pos_low, pos_high) for each nick.

    A nick exists when a 3' end and a 5' end are at adjacent positions on the
    same helix.  Strands can run in either direction:

    * Left-to-right (even helices): 3' end at position *i*, 5' end at *i+1*.
    * Right-to-left (odd helices):  3' end at position *i+1*, 5' end at *i*.

    The returned tuple carries both (3'pos, 5'pos) for connection logic and
    (low, high) for the backbone pointer values.
    """
    nicks: list[tuple[int, int, int, int]] = []
    for i in range(len(stap) - 1):
        curr = stap[i]      # lower bp index
        nxt = stap[i + 1]   # higher bp index

        curr_is_3prime = curr[0] != -1 and curr[2] == -1
        curr_is_5prime = curr[0] == -1 and curr[2] != -1
        nxt_is_3prime = nxt[0] != -1 and nxt[2] == -1
        nxt_is_5prime = nxt[0] == -1 and nxt[2] != -1

        # Left-to-right strand: 3' at i, 5' at i+1
        if curr_is_3prime and nxt_is_5prime:
            nicks.append((i, i + 1, i, i + 1))

        # Right-to-left strand: 5' at i, 3' at i+1
        if nxt_is_3prime and curr_is_5prime:
            nicks.append((i + 1, i, i, i + 1))

    return nicks


def run(ctx: PluginContext) -> None:
    ctx.log("=== Nick Remover Plugin ===")

    # ------------------------------------------------------------------
    # 1. Load design
    # ------------------------------------------------------------------
    try:
        raw_json = ctx.get_part_as_cadnano_json()
    except RuntimeError as exc:
        ctx.log(f"ERROR: could not read design — {exc}")
        return

    data = json.loads(raw_json)
    vstrands = data.get("vstrands", [])
    if not vstrands:
        ctx.log("No virtual helices found — nothing to do.")
        return

    ctx.log(f"Design: '{data.get('name', '<unnamed>')}', {len(vstrands)} virtual helices")

    # ------------------------------------------------------------------
    # 2. Remove nicks on staple strands
    # ------------------------------------------------------------------
    total_nicks = 0

    for vs in vstrands:
        vh_num: int = vs["num"]
        stap: list[list[int]] = vs.get("stap", [])

        nicks = _find_nicks(stap)
        for pos_3, pos_5, low, high in nicks:
            # Connect 3' end at pos_3 → 5' end at pos_5 (adjacent bp)
            stap[pos_3][2] = vh_num   # outgoing helix  (from 3' end)
            stap[pos_3][3] = pos_5    # outgoing bp
            stap[pos_5][0] = vh_num   # incoming helix  (into 5' end)
            stap[pos_5][1] = pos_3    # incoming bp
            total_nicks += 1

        if nicks:
            ctx.log(f"  VH {vh_num}: joined {len(nicks)} nick(s)")

    ctx.log(f"Total nicks removed: {total_nicks}")

    if total_nicks == 0:
        ctx.log("Design already has no adjacent staple nicks.")

    # ------------------------------------------------------------------
    # 3. Return modified design
    # ------------------------------------------------------------------
    ctx.set_result_cadnano_json(json.dumps(data))
    ctx.set_result({"nicks_removed": total_nicks})
    ctx.log("Done. Note: applyStrategy=replacePart — sequences are not preserved.")
