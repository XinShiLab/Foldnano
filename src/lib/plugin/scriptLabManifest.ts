import type { PluginManifest } from './types';

export const SCRIPT_LAB_ID = 'script-lab';
export const SCRIPT_LAB_FILENAME = 'script_lab.py';

export const SCRIPT_LAB_BLANK_TEMPLATE = `from foldnano.plugin import PluginContext
from foldnano_mini import load_part


def run(ctx: PluginContext) -> None:
    part = load_part(
        ctx.get_part_as_foldnano_json(),
        active_region_id=ctx.active_region_id,
    )
`;

export const SCRIPT_LAB_MUTATION_TEMPLATE = `from foldnano.plugin import PluginContext
from foldnano_mini import load_part


def run(ctx: PluginContext) -> None:
    part = load_part(
        ctx.get_part_as_foldnano_json(),
        active_region_id=ctx.active_region_id,
    )

    target = next((oligo for oligo in part.oligos if not oligo.is_scaffold), None)
    if target is None:
        ctx.log("No non-scaffold oligos found. Nothing to edit.")
        ctx.set_result(
            {
                "status": "no-op",
                "reason": "No non-scaffold oligos were available.",
                "active_region_id": ctx.active_region_id,
                "ops_emitted": 0,
            }
        )
        ctx.set_result_mutation_log(part.mutation_log)
        return

    original_color = target.color
    target.color = "#f97316"

    ctx.log(f"Recolored oligo {target.id} from {original_color} to {target.color}.")
    ctx.set_result(
        {
            "status": "ok",
            "active_region_id": ctx.active_region_id,
            "oligo_id": target.id,
            "before_color": original_color,
            "after_color": target.color,
            "ops_emitted": len(part.mutation_log),
        }
    )
    ctx.set_result_mutation_log(part.mutation_log)
`;

export const SCRIPT_LAB_ANALYSIS_TEMPLATE = `from foldnano.plugin import PluginContext
from foldnano_mini import load_part


def run(ctx: PluginContext) -> None:
    part = load_part(
        ctx.get_part_as_foldnano_json(),
        active_region_id=ctx.active_region_id,
    )

    region = part.get_region(ctx.active_region_id) if ctx.active_region_id else None
    staple_count = sum(1 for oligo in part.oligos if not oligo.is_scaffold)
    scaffold_count = sum(1 for oligo in part.oligos if oligo.is_scaffold)

    ctx.log(f"Part name: {part.name}")
    ctx.log(f"Staple oligos: {staple_count}")
    if region is not None:
        ctx.log(f"Active region: {region.name} ({region.kind})")
    else:
        ctx.log("Active region: none")

    ctx.set_result(
        {
            "part_name": part.name,
            "region_name": region.name if region is not None else None,
            "region_kind": region.kind if region is not None else None,
            "staple_oligos": staple_count,
            "scaffold_oligos": scaffold_count,
            "virtual_helices": len(part.virtual_helices),
            "ops_emitted": 0,
        }
    )
`;

export const SCRIPT_LAB_FULL_API_DEMO_TEMPLATE = `from itertools import product

from foldnano.plugin import PluginContext
from foldnano_mini import KNOWN_OPS, FreeformRegion, LatticedRegion, load_part


def run(ctx: PluginContext) -> None:
    """Full API Demo — exercises every foldnano_mini op kind on the active design.

    Sections A–H annotate / resize / restructure existing content; new VHs and
    segments created in sections F–G are removed in section I so the net
    effect on topology is minimal.
    """
    part = load_part(
        ctx.get_part_as_foldnano_json(),
        active_region_id=ctx.active_region_id,
    )

    # ── resolve active region ────────────────────────────────────────────
    region = (
        part.get_region(ctx.active_region_id)
        if ctx.active_region_id
        else (part.regions[0] if part.regions else None)
    )
    if region is None:
        ctx.log("No region found. Open a design and select a region first.")
        ctx.set_result({"status": "skipped", "reason": "no region"})
        ctx.set_result_mutation_log(part.mutation_log)
        return

    vhs = part.vhs_in_region(region.id)
    oligos = part.oligos_in_region(region.id)
    ctx.log(
        f"Active region: {region.name!r} ({region.kind}), "
        f"{len(vhs)} VHs, {len(oligos)} oligos"
    )

    # ── A  Oligo properties (set_oligo_color / set_oligo_name / set_oligo_is_scaffold) ─
    demo_oligo = next((o for o in oligos if not o.is_scaffold), None)
    if demo_oligo is not None:
        old_color = demo_oligo.color
        demo_oligo.color = "#f97316"
        ctx.log(f"[set_oligo_color]       {demo_oligo.id}: {old_color!r} → '#f97316'")

        old_name = demo_oligo.name or "(unnamed)"
        demo_oligo.name = f"{old_name} [API demo]"
        ctx.log(f"[set_oligo_name]        renamed to {demo_oligo.name!r}")

        demo_oligo.is_scaffold = demo_oligo.is_scaffold   # emit op; no semantic change
        ctx.log(f"[set_oligo_is_scaffold] is_scaffold={demo_oligo.is_scaffold} (unchanged)")
    else:
        ctx.log("[set_oligo_color/name/is_scaffold] SKIPPED — no non-scaffold oligo in region")

    # ── B  Segment modifications and slot annotations ─────────────────────
    # set_segment_modification (5' and 3') / set_slot_sequence / skip / insertion
    demo_seg = demo_oligo.segments[0] if demo_oligo and demo_oligo.segments else None
    if demo_seg is not None:
        # Modifications live on the oligo's free ends (a circular oligo has none).
        if not demo_oligo.is_circular:
            demo_oligo.five_modification = "/5BioTEG/"
            ctx.log(f"[set_segment_modification 5'] oligo {demo_oligo.id}: '/5BioTEG/'")
            demo_oligo.three_modification = "/3Cy3/"
            ctx.log(f"[set_segment_modification 3'] oligo {demo_oligo.id}: '/3Cy3/'")
        else:
            ctx.log("[set_segment_modification] SKIPPED — circular oligo has no free ends")

        lo = min(demo_seg.five_index, demo_seg.three_index)
        hi = max(demo_seg.five_index, demo_seg.three_index)
        if hi - lo >= 4:
            mid = (lo + hi) // 2
            demo_seg.slot_at(mid).seq = "A"
            ctx.log(f"[set_slot_sequence]     bp {mid} → 'A'")
            # can_set_* explains a refusal (no complementary strand, a crossover bp, ...)
            skip_check = demo_seg.slot_at(mid + 1).can_set_skip()
            if skip_check:
                demo_seg.slot_at(mid + 1).set_skip(True)
                ctx.log(f"[set_slot_skip]         bp {mid + 1} → skip=True")
            else:
                ctx.log(f"[set_slot_skip] SKIPPED — {skip_check.reason}")
            insert_check = part.can_add_insert_at(demo_seg.vh_index, mid - 1)
            if insert_check:
                part.add_insert_at(demo_seg.vh_index, mid - 1)  # the insert tool: both strands
                ctx.log(f"[add_skip_or_insertion] bp {mid - 1} → +1 base on both strands")
            else:
                ctx.log(f"[add_skip_or_insertion] SKIPPED — {insert_check.reason}")
            insertion_check = demo_seg.slot_at(mid + 2).can_set_insertion()
            if insertion_check:
                demo_seg.slot_at(mid + 2).set_insertion("GC")
                ctx.log(f"[set_slot_insertion]    bp {mid + 2} → insertion='GC'")
            else:
                ctx.log(f"[set_slot_insertion] SKIPPED — {insertion_check.reason}")
        else:
            ctx.log("[set_slot_*] SKIPPED — segment span < 5")
    else:
        ctx.log("[set_segment_modification/set_slot_*] SKIPPED — no segment available")

    # ── C  VH and region sizing (set_vh_length / set_region_max_base) ────
    if vhs:
        old_len = vhs[0].length
        vhs[0].length = old_len + 1
        ctx.log(f"[set_vh_length]         vh[{vhs[0].index}]: {old_len} → {old_len + 1}")
    else:
        ctx.log("[set_vh_length] SKIPPED — no VHs in region")

    if region.step > 0:
        old_max = region.max_base
        region.increase_length_by(region.step)
        ctx.log(f"[set_region_max_base]   {region.id!r}: {old_max} → {region.max_base}")
    else:
        ctx.log("[set_region_max_base] SKIPPED — region.step is 0")

    # ── D  Draw and connect strands (create_segment / connect) ───────────
    # create_oligo emits create_segment per entry plus a connect per junction.
    new_seg1 = new_seg2 = None
    if vhs:
        vh0 = vhs[0]
        end = region.max_base        # upper bound after extension
        step = region.step
        half = max(step // 2, 1)
        # A 1-bp gap keeps the junction a crossover; adjacent ends would merge.
        path = [(vh0, end - step, end - half - 1), (vh0, end - half + 1, end - 1)]
        path_check = part.can_create_oligo(path)
        if path_check:
            demo_path = part.create_oligo(path, color="#3b82f6", name="API demo path")
            new_seg1, new_seg2 = demo_path.segments
            ctx.log(
                f"[create_segment]×2 + [connect]  oligo {demo_path.id} on vh[{vh0.index}]: "
                f"{[(s.five_index, s.three_index) for s in demo_path.segments]}"
            )
        else:
            ctx.log(f"[create_segment/connect] SKIPPED — {path_check.reason}")
    else:
        ctx.log("[create_segment/connect] SKIPPED — no VHs in region")

    # ── E  Break and trim (break_oligo / move_terminus 5' and 3') ────────
    broken_oligo = None
    if new_seg1 is not None:
        broken_oligo = part.break_oligo(new_seg1, at_index=new_seg1.three_index)
        ctx.log(
            f"[break_oligo]           severed at index {new_seg1.three_index}; "
            f"new oligo: {broken_oligo.id!r}"
        )
        if new_seg1.length > 2:
            new_seg1.move_five_prime_to(new_seg1.five_index + 1)
            ctx.log(f"[move_terminus 5']      {new_seg1.id}: five → {new_seg1.five_index}")
            new_seg1.move_three_prime_to(new_seg1.three_index - 1)
            ctx.log(f"[move_terminus 3']      {new_seg1.id}: three → {new_seg1.three_index}")
        else:
            ctx.log("[move_terminus] SKIPPED — segment too short to trim")
    else:
        ctx.log("[break_oligo/move_terminus] SKIPPED — no connected segment to break")

    # ── F  Add virtual helices (add_vh_at_coords / add_freeform_vh) ───────
    new_lattice_vh = None
    lattice_region = region if isinstance(region, LatticedRegion) else next(
        (r for r in part.regions if isinstance(r, LatticedRegion)), None
    )
    if lattice_region is not None:
        occupied = {
            (vh.row, vh.col)
            for vh in part.vhs_in_region(lattice_region.id)
            if vh.row is not None
        }
        for r_idx, c_idx in product(range(8), range(8)):
            if (r_idx, c_idx) not in occupied:
                new_lattice_vh = lattice_region.add_vh_at(row=r_idx, col=c_idx)
                ctx.log(
                    f"[add_vh_at_coords]      vh {new_lattice_vh.id} "
                    f"at ({r_idx},{c_idx}) in {lattice_region.id!r}"
                )
                break
        else:
            ctx.log("[add_vh_at_coords] SKIPPED — 8×8 grid already full")
    else:
        ctx.log("[add_vh_at_coords] SKIPPED — no HONEYCOMB or SQUARE region")

    new_free_vh = None
    free_region = region if isinstance(region, FreeformRegion) else next(
        (r for r in part.regions if isinstance(r, FreeformRegion)), None
    )
    if free_region is not None:
        new_free_vh = free_region.add_vh_at(
            origin=(100.0, 100.0, 0.0),
            direction=(0.0, 0.0, 1.0),
            length=free_region.max_base,
        )
        ctx.log(
            f"[add_freeform_vh]       vh {new_free_vh.id} "
            f"at (100,100,0) in {free_region.id!r}"
        )
    else:
        ctx.log("[add_freeform_vh] SKIPPED — no FREEFORM region")

    # ── G  Reposition VHs (move_lattice_vh / set_vh_local_frame / reorder_vh) ─
    if new_lattice_vh is not None:
        from_row, from_col = new_lattice_vh.row, new_lattice_vh.col
        occupied_now = {
            (vh.row, vh.col)
            for vh in part.vhs_in_region(new_lattice_vh.region_id)
            if vh.row is not None and vh.id != new_lattice_vh.id
        }
        for dr, dc in [(2, 0), (0, 2), (2, 2), (-2, 0), (0, -2)]:
            tr, tc = from_row + dr, from_col + dc
            if tr >= 0 and tc >= 0 and (tr, tc) not in occupied_now:
                new_lattice_vh.move_to(col=tc, row=tr)
                ctx.log(
                    f"[move_lattice_vh]       vh {new_lattice_vh.id}: "
                    f"({from_row},{from_col}) → ({tr},{tc})"
                )
                break
        else:
            ctx.log("[move_lattice_vh] SKIPPED — no parity-safe free cell nearby")
    else:
        ctx.log("[move_lattice_vh] SKIPPED — no lattice VH was added")

    freeform_vhs = [vh for vh in part.virtual_helices if vh.is_freeform]
    if freeform_vhs:
        fvh = freeform_vhs[0]
        fvh.local_frame = {
            "origin": {"x": 0.0, "y": 0.0, "z": 0.0},
            "axis": {"x": 0.0, "y": 0.0, "z": 1.0},
            "radial0": {"x": 1.0, "y": 0.0, "z": 0.0},
        }
        ctx.log(f"[set_vh_local_frame]    vh {fvh.id} repositioned to origin (0,0,0)")
    else:
        ctx.log("[set_vh_local_frame] SKIPPED — no freeform VH in design")

    reorder_done = False
    for r in [region] + [r for r in part.regions if r.id != region.id]:
        r_vhs = part.vhs_in_region(r.id)
        if len(r_vhs) >= 2:
            part.reorder_vh(r_vhs[0], target_region_row=len(r_vhs) - 1)
            ctx.log(
                f"[reorder_vh]            vh {r_vhs[0].id} → last slot "
                f"in region {r.id!r}"
            )
            reorder_done = True
            break
    if not reorder_done:
        ctx.log("[reorder_vh] SKIPPED — no region has ≥ 2 VHs")

    # ── H  Plane and region structure ─────────────────────────────────────
    # transform_plane / add_region_and_plane / split_region
    if part.planes:
        plane = part.planes[0]
        o = plane.origin
        part.set_plane_transform(
            plane.id,
            origin=(o["x"], o["y"] + 5.0, o["z"]),
            u=(1.0, 0.0, 0.0),
            v=(0.0, 1.0, 0.0),
            normal=(0.0, 0.0, 1.0),
        )
        ctx.log(f"[transform_plane]       plane {plane.id!r}: origin.y shifted +5 nm")
    else:
        ctx.log("[transform_plane] SKIPPED — no planes")

    demo_region = part.add_region(
        kind="FREEFORM",
        name="API Demo Region",
        max_base=42,
        plane_origin=(500.0, 0.0, 0.0),
    )
    ctx.log(f"[add_region_and_plane]  new region {demo_region.id!r} (FREEFORM, max_base=42)")

    split_done = False
    for r in part.regions:
        r_vhs = part.vhs_in_region(r.id)
        if len(r_vhs) >= 2:
            split_vh = r_vhs[0]
            new_split = part.split_region(r, split_vh)
            ctx.log(
                f"[split_region]          {r.id!r} split after {split_vh.id!r}; "
                f"new region: {new_split.id!r}"
            )
            split_done = True
            break
    if not split_done:
        ctx.log("[split_region] SKIPPED — no region has ≥ 2 VHs")

    # ── I  Remove demo artifacts (remove_segment / remove_oligo / remove_vhs) ─
    if new_seg1 is not None:
        new_seg1.remove()
        ctx.log(f"[remove_segment]        removed seg {new_seg1.id!r}")

    if broken_oligo is not None:
        oligo_proxy = part.get_oligo(broken_oligo.id)
        if oligo_proxy is not None:
            oligo_proxy.remove()
            ctx.log(f"[remove_oligo]          removed oligo {broken_oligo.id!r}")

    to_remove = [v for v in [new_lattice_vh, new_free_vh] if v is not None]
    if to_remove:
        part.remove_vhs(to_remove)
        ctx.log(f"[remove_vhs]            removed {len(to_remove)} demo VH(s)")
    else:
        ctx.log("[remove_vhs] SKIPPED — no demo VHs were created")

    # ── Summary ───────────────────────────────────────────────────────────
    op_kinds = sorted({op["op"] for op in part.mutation_log})
    ctx.log(f"\\nTotal ops emitted : {len(part.mutation_log)}")
    ctx.log(f"Distinct op kinds : {len(op_kinds)} / {len(KNOWN_OPS)}")
    ctx.set_result({
        "active_region_id": region.id,
        "active_region_kind": region.kind,
        "ops_emitted": len(part.mutation_log),
        "op_kinds_covered": op_kinds,
    })
    ctx.set_result_mutation_log(part.mutation_log)
`;

const SCRIPT_LAB_ENTRYPOINT_PLACEHOLDER = `def run(ctx):
    raise RuntimeError("Script Lab executes the editor contents from the side panel.")
`;

export const scriptLabManifest: PluginManifest = {
	schemaVersion: 1,
	id: SCRIPT_LAB_ID,
	name: 'Script Lab',
	version: '1.0.0',
	description:
		'Write and run your own Python scripts against the open design. Scripts run in the plugin ' +
		"sandbox: they can't reach the internet, your GitHub account, or your other designs, and " +
		'they change the design only when you click Apply.',
	format: 'foldnano_mini',
	applyStrategy: 'replayMutationLog',
	entrypoint: SCRIPT_LAB_ENTRYPOINT_PLACEHOLDER,
	sidePanel: {
		type: 'codeEditor',
		title: 'Script Lab',
		icon: 'code',
		codeEditor: {
			filename: SCRIPT_LAB_FILENAME,
			initialCode: SCRIPT_LAB_MUTATION_TEMPLATE,
			execution: 'entrypoint',
		},
	},
};
