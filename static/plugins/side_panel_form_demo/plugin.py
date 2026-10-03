from __future__ import annotations

import json


def run(ctx) -> None:
    raw = ctx.get_part_as_foldnano_json()
    part = json.loads(raw)

    label = str(ctx.get_param("label", "demo-run"))
    top_n = int(ctx.get_param("top_n", 5))
    include_sequences = bool(ctx.get_param("include_sequences", False))
    report_mode = str(ctx.get_param("report_mode", "summary"))

    oligos = part.get("oligos", [])
    rows = []
    for oligo in oligos[:top_n]:
        sequence_preview = ""
        if include_sequences:
            sequence_preview = str(oligo.get("sequence", ""))[:24]
        rows.append(
            {
                "id": oligo.get("id"),
                "name": oligo.get("name", ""),
                "color": oligo.get("color"),
                "sequence_preview": sequence_preview,
            }
        )

    ctx.log(f"Side panel type: {ctx.side_panel_type}")
    ctx.log(f"Analysed {len(oligos)} oligos with mode={report_mode}")
    ctx.write_artifact(
        "side_panel_form_demo.json",
        json.dumps({"label": label, "report_mode": report_mode, "rows": rows}, indent=2),
    )
    ctx.set_result(
        {
            "label": label,
            "report_mode": report_mode,
            "top_n": top_n,
            "oligo_count": len(oligos),
            "preview_rows": rows,
        }
    )
