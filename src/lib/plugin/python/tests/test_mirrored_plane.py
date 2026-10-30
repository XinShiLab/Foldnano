"""Mirrored (left-handed) plane bases are refused, matching opDispatch on the host."""

from __future__ import annotations

import pytest

from foldnano_mini import load_part

# The old Side (YZ) base plane: u x v = -X, opposite its normal.
MIRRORED = {"u": (0.0, 1.0, 0.0), "v": (0.0, 0.0, -1.0), "normal": (1.0, 0.0, 0.0)}


def test_set_plane_transform_refuses_a_mirrored_basis(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    plane = part.planes[0]
    log_len = len(part.mutation_log)
    with pytest.raises(ValueError, match="mirrored"):
        part.set_plane_transform(plane.id, (0.0, 0.0, 0.0), **MIRRORED)
    assert len(part.mutation_log) == log_len
    part.set_plane_transform(plane.id, (0.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0), (1.0, 0.0, 0.0))
    assert len(part.mutation_log) == log_len + 1


def test_add_region_refuses_a_mirrored_plane(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    log_len = len(part.mutation_log)
    with pytest.raises(ValueError, match="mirrored"):
        part.add_region(
            "FREEFORM",
            "Side",
            42,
            plane_u=MIRRORED["u"],
            plane_v=MIRRORED["v"],
            plane_normal=MIRRORED["normal"],
        )
    assert len(part.mutation_log) == log_len
