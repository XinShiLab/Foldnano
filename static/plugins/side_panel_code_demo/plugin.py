from __future__ import annotations

import json


def run(ctx) -> None:
    code = ctx.get_side_panel_code("")
    part = json.loads(ctx.get_part_as_foldnano_json())
    line_count = len(code.splitlines())
    char_count = len(code)

    ctx.log(f"Side panel type: {ctx.side_panel_type}")
    ctx.log(f"Received {line_count} lines / {char_count} chars from the code editor")

    artifact = {
        "filename": "analysis.py",
        "line_count": line_count,
        "char_count": char_count,
        "part_name": part.get("name"),
        "snippet": code.splitlines()[:8],
    }
    ctx.write_artifact("side_panel_code_demo.json", json.dumps(artifact, indent=2))
    ctx.set_result(artifact)
