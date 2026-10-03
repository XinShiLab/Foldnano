from foldnano.plugin import PluginContext
import json


def run(ctx: PluginContext) -> None:
    data = json.loads(ctx.get_part_as_cadnano_json())
    vstrands = data.get("vstrands", [])

    helix_count = len(vstrands)
    total_bases = sum(len(vs.get("scaf", [])) for vs in vstrands)

    # Count occupied scaffold slots (non-null entries)
    occupied = 0
    for vs in vstrands:
        for slot in vs.get("scaf", []):
            if slot != [-1, -1, -1, -1]:
                occupied += 1

    occupancy_pct = round(100 * occupied / total_bases, 1) if total_bases > 0 else 0.0

    ctx.log(f"Helices : {helix_count}")
    ctx.log(f"Bases   : {total_bases}")
    ctx.log(f"Occupancy: {occupancy_pct}%")
    ctx.log("(Installed from a local .zip — no network fetch needed)")

    ctx.set_result({
        "helices": helix_count,
        "bases": total_bases,
        "occupancy_pct": occupancy_pct,
    })
