"""Roll of freeform helices: ``vh.roll_deg`` and the shared radial0 convention."""

from __future__ import annotations

import pytest

from foldnano import parse_foldnano_json
from foldnano_mini import FreeformRegion, load_part
from foldnano_mini import mutations as M


def test_add_vh_at_uses_plane_normal_as_roll_zero(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    free = part.get_region("region-free")
    assert isinstance(free, FreeformRegion)
    in_plane = free.add_vh_at(origin=(0.0, 0.0, 0.0), direction=(1.0, 0.0, 0.0))
    assert part.mutation_log[-1]["radial0"] == [0.0, 0.0, 1.0]
    assert in_plane.roll_deg == pytest.approx(0.0)
    standing = free.add_vh_at(origin=(5.0, 0.0, 0.0))
    assert part.mutation_log[-1]["radial0"] == [1.0, 0.0, 0.0]
    assert standing.roll_deg == pytest.approx(0.0)


def test_roll_deg_setter_emits_local_frame_and_keeps_origin_and_axis(
    multi_region_part_foldnano_json: str,
) -> None:
    part = load_part(multi_region_part_foldnano_json)
    vh = part.get_vh(3)
    assert vh is not None
    vh.roll_deg = 90
    assert vh.roll_deg == pytest.approx(90.0)
    frame = vh.local_frame
    assert frame is not None
    assert frame["origin"] == {"x": 0.0, "y": 0.0, "z": 0.0}
    assert frame["axis"] == {"x": 0.0, "y": 0.0, "z": 1.0}
    # +Z helix: positive roll turns radial0 from +X toward axis x radial0 = +Y.
    assert frame["radial0"]["y"] == pytest.approx(1.0)
    op = part.mutation_log[-1]
    assert op["op"] == M.OP_SET_VH_LOCAL_FRAME
    assert op["vhId"] == vh.id


@pytest.mark.parametrize("deg", [-135.0, -30.0, 45.0, 180.0])
def test_roll_deg_round_trips(multi_region_part_foldnano_json: str, deg: float) -> None:
    part = load_part(multi_region_part_foldnano_json)
    free = part.get_region("region-free")
    assert isinstance(free, FreeformRegion)
    vh = free.add_vh_at(origin=(0.0, 0.0, 0.0), direction=(0.6, 0.8, 0.0))
    vh.roll_deg = deg
    assert vh.roll_deg == pytest.approx(deg)


def test_roll_deg_on_lattice_vh(multi_region_part_foldnano_json: str) -> None:
    part = load_part(multi_region_part_foldnano_json)
    vh = part.get_vh(0)
    assert vh is not None
    assert vh.roll_deg is None
    with pytest.raises(ValueError, match="lattice"):
        vh.roll_deg = 30


def test_local_frame_is_normalized_and_degenerate_frames_are_rejected(
    multi_region_part_foldnano_json: str,
) -> None:
    part = load_part(multi_region_part_foldnano_json)
    vh = part.get_vh(3)
    assert vh is not None
    vh.local_frame = {
        "origin": {"x": 0, "y": 0, "z": 0},
        "axis": {"x": 0, "y": 0, "z": 2},
        "radial0": {"x": 1, "y": 0, "z": 1},
    }
    assert vh.local_frame == {
        "origin": {"x": 0.0, "y": 0.0, "z": 0.0},
        "axis": {"x": 0.0, "y": 0.0, "z": 1.0},
        "radial0": {"x": 1.0, "y": 0.0, "z": 0.0},
    }
    log_len = len(part.mutation_log)
    with pytest.raises(ValueError, match="parallel"):
        vh.local_frame = {
            "origin": {"x": 0, "y": 0, "z": 0},
            "axis": {"x": 0, "y": 0, "z": 1},
            "radial0": {"x": 0, "y": 0, "z": 3},
        }
    assert len(part.mutation_log) == log_len


def test_parse_api_roll_deg(multi_region_part_foldnano_json: str) -> None:
    part = parse_foldnano_json(multi_region_part_foldnano_json)
    assert part.get_vh(3).roll_deg == pytest.approx(0.0)
    assert part.get_vh(0).roll_deg is None


def test_reference_switches_to_u_at_the_plane_view_threshold() -> None:
    from foldnano._frame import reference_radial0

    # |axis.z| = 0.954 is drawn standing (>= 0.9): roll 0 is about +U, not about -U.
    assert reference_radial0((0.3, 0.0, 0.954))[0] > 0.9
    # |axis.z| = 0.85 is drawn lying: roll 0 is the projected plane normal.
    assert reference_radial0((0.527, 0.0, 0.85))[2] > 0.5
