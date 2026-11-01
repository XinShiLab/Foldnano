"""Wireframe spike: a throwaway A-trail-style router on foldnano.edit (not a validated method).

Paste into Script Lab with an empty freeform region active, or import it from a harness.
Every vertex must have degree 4 (doubled edges count twice).
"""

from __future__ import annotations

import math
import random

from foldnano.plugin import PluginContext
from foldnano.edit import load_part

RISE_NM = 0.3317
RADIUS_NM = 0.852
TWIST_DEG = 360 / 10.5
SCAFFOLD_COLOR = "#0066cc"
STAPLE_COLOR = "#f97316"


def _add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def _sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def _mul(a, s):
    return tuple(x * s for x in a)


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _unit(a):
    return _mul(a, 1 / math.sqrt(_dot(a, a)))


def octahedron(edge_nm):
    a = edge_nm / math.sqrt(2)
    vertices = [(a, 0, 0), (-a, 0, 0), (0, a, 0), (0, -a, 0), (0, 0, a), (0, 0, -a)]
    edges = [(i, j) for i in range(6) for j in range(i + 1, 6) if i // 2 != j // 2]
    return vertices, edges, list(vertices)


def tetrahedron_doubled(edge_nm):
    """Each vertex has degree 3, so doubling a perfect matching makes every vertex degree 4."""
    a = edge_nm / (2 * math.sqrt(2))
    vertices = [(a, a, a), (a, -a, -a), (-a, a, -a), (-a, -a, a)]
    edges = [(0, 1), (0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3), (2, 3)]
    return vertices, edges, list(vertices)


def torus(n_major, n_minor, edge_nm):
    """A 4-regular grid on a torus: the scale test (2 * n_major * n_minor helices)."""
    major = n_major * edge_nm / (2 * math.pi)
    minor = n_minor * edge_nm / (2 * math.pi)
    vertices, normals = [], []
    for i in range(n_major):
        for j in range(n_minor):
            th, ph = 2 * math.pi * i / n_major, 2 * math.pi * j / n_minor
            normal = (math.cos(ph) * math.cos(th), math.cos(ph) * math.sin(th), math.sin(ph))
            vertices.append(((major + minor * math.cos(ph)) * math.cos(th), (major + minor * math.cos(ph)) * math.sin(th), minor * math.sin(ph)))
            normals.append(normal)
    idx = lambda i, j: (i % n_major) * n_minor + (j % n_minor)
    edges = []
    for i in range(n_major):
        for j in range(n_minor):
            edges += [(idx(i, j), idx(i + 1, j)), (idx(i, j), idx(i, j + 1))]
    return vertices, edges, normals


def _cyclic_incidence(vertices, edges, normals):
    """Edge ids around each vertex in rotation order, seen from outside the surface."""
    incident = {v: [] for v in range(len(vertices))}
    for eid, (u, v) in enumerate(edges):
        incident[u].append(eid)
        incident[v].append(eid)
    for v, eids in incident.items():
        if len(eids) != 4:
            raise ValueError(f"vertex {v} has degree {len(eids)}, expected 4")
        n = _unit(normals[v])
        ref = None

        def angle(eid):
            nonlocal ref
            a, b = edges[eid]
            d = _sub(vertices[b if a == v else a], vertices[v])
            d = _unit(_sub(d, _mul(n, _dot(d, n))))
            if ref is None:
                ref = d
            return math.atan2(_dot(_cross(ref, d), n), _dot(ref, d))

        eids.sort(key=lambda e: (angle(e), e))
    return incident


def _partner(incident, choice, v, eid):
    order = incident[v]
    i = order.index(eid)
    return order[(i + 1) % 4 if (i + choice[v]) % 2 == 0 else (i - 1) % 4]


def _circuits(edges, incident, choice):
    seen, circuits = set(), []
    for start in range(len(edges)):
        if start in seen:
            continue
        circuit, eid, at = [], start, edges[start][1]
        while True:
            seen.add(eid)
            a, b = edges[eid]
            circuit.append((eid, b if a == at else a, at))
            next_eid = _partner(incident, choice, at, eid)
            a, b = edges[next_eid]
            at = b if a == at else a
            eid = next_eid
            if eid == start:
                break
        circuits.append(circuit)
    return circuits


def non_crossing_circuit(edges, incident, seed=1):
    """Pick one of the two adjacent pairings per vertex so the scaffold is a single circuit."""
    rng = random.Random(seed)
    for _ in range(200):
        choice = {v: rng.randint(0, 1) for v in incident}
        count = len(_circuits(edges, incident, choice))
        improved = True
        while count > 1 and improved:
            improved = False
            for v in rng.sample(list(incident), len(incident)):
                choice[v] ^= 1
                new_count = len(_circuits(edges, incident, choice))
                if new_count < count:
                    count, improved = new_count, True
                else:
                    choice[v] ^= 1
        if count == 1:
            return choice, _circuits(edges, incident, choice)[0]
    raise ValueError("no single non-crossing circuit found")


def _rodrigues(v, axis, deg):
    t = math.radians(deg)
    return _add(_add(_mul(v, math.cos(t)), _mul(_cross(axis, v), math.sin(t))), _mul(axis, _dot(axis, v) * (1 - math.cos(t))))


class _Helix:
    def __init__(self, vh, origin, axis, radial0):
        self.vh, self.origin, self.axis, self.radial0 = vh, origin, axis, radial0
        self.roll = 0.0

    def point(self, bp, strand):
        r0 = _rodrigues(self.radial0, self.axis, self.roll)
        r1 = _cross(self.axis, r0)
        t = math.radians(strand * 180 + TWIST_DEG * bp)
        center = _add(self.origin, _mul(self.axis, bp * RISE_NM))
        return _add(center, _add(_mul(r0, RADIUS_NM * math.cos(t)), _mul(r1, RADIUS_NM * math.sin(t))))


def _optimise_rolls(helices, xovers):
    by_helix = {}
    for x in xovers:
        by_helix.setdefault(x[0], []).append(x)
        by_helix.setdefault(x[3], []).append(x)
    def cost(eid):
        return sum(
            math.dist(helices[a].point(ba, sa), helices[b].point(bb, sb)) ** 2
            for a, ba, sa, b, bb, sb in by_helix.get(eid, [])
        )
    for _ in range(12):
        for eid, helix in helices.items():
            best = min(range(0, 360, 5), key=lambda r: (setattr(helix, "roll", float(r)), cost(eid))[1])
            helix.roll = float(best)


def build_wireframe(part, region, mesh, bp=42, linker_nt=0, doubled_sep_nm=1.2, optimise_roll=True):
    """Build helices, the scaffold circuit and staples; returns measured facts for the report."""
    vertices, edges, normals = mesh
    incident = _cyclic_incidence(vertices, edges, normals)
    choice, circuit = non_crossing_circuit(edges, incident)
    k = linker_nt
    needed = bp + 2 * k
    target = max(region.max_base, -(-needed // region.step) * region.step)
    if target != region.max_base:
        region.set_max_base(target)

    parallel = {}
    for eid, (u, v) in enumerate(edges):
        parallel.setdefault(frozenset((u, v)), []).append(eid)

    helices = {}
    for eid, tail, head in circuit:
        tail_p, head_p = vertices[tail], vertices[head]
        axis = _unit(_sub(head_p, tail_p))
        mid = _mul(_add(tail_p, head_p), 0.5)
        group = parallel[frozenset((tail, head))]
        if len(group) > 1:
            side = _unit(_cross(axis, _unit(_add(normals[tail], normals[head]))))
            sign = 1 if group.index(eid) == 0 else -1
            # Sides must follow the edge, not the traversal direction, to stay apart.
            if tail > head:
                sign = -sign
            mid = _add(mid, _mul(side, sign * doubled_sep_nm / 2))
        origin = _sub(mid, _mul(axis, (k + (bp - 1) / 2) * RISE_NM))
        vh = region.add_vh_at(origin=origin, direction=axis)
        frame = vh.local_frame
        radial0 = (frame["radial0"]["x"], frame["radial0"]["y"], frame["radial0"]["z"])
        helices[eid] = _Helix(vh, origin, axis, radial0)

    scaffold_hi, scaffold_lo = bp + 2 * k - 1, k
    staple_low_3, staple_high_5 = 0, bp + k - 1

    # Scaffold transitions come from the circuit; staples prefer the other pairing at a vertex.
    transitions = [(circuit[i][0], circuit[(i + 1) % len(circuit)][0], circuit[i][2]) for i in range(len(circuit))]
    in_at = {(eid, head): True for eid, _, head in circuit}
    staple_pairs = []
    complementary = 0
    for v, order in incident.items():
        other = 1 - choice[v]
        pairs = [(order[i], order[(i + 1) % 4]) for i in ((0, 2) if other == 0 else (1, 3))]
        if all(((a, v) in in_at) != ((b, v) in in_at) for a, b in pairs):
            complementary += 1
            for a, b in pairs:
                inn, out = (a, b) if (a, v) in in_at else (b, a)
                staple_pairs.append((out, inn))
        else:
            staple_pairs += [(out, inn) for inn, out, at in transitions if at == v]

    xovers = [(a, scaffold_hi, 0, b, scaffold_lo, 0) for a, b, _ in transitions]
    xovers += [(out, staple_low_3, 1, inn, staple_high_5, 1) for out, inn in staple_pairs]
    if optimise_roll:
        _optimise_rolls(helices, xovers)
        for helix in helices.values():
            helix.vh.roll_deg = helix.roll

    m = bp // 2
    scaffold = {
        eid: part.create_segment(helices[eid].vh, scaffold_lo, scaffold_hi, color=SCAFFOLD_COLOR, is_scaffold=True)
        for eid, _, _ in circuit
    }
    low = {eid: part.create_segment(h.vh, k + m - 1, staple_low_3, color=STAPLE_COLOR) for eid, h in helices.items()}
    high = {eid: part.create_segment(h.vh, staple_high_5, k + m, color=STAPLE_COLOR) for eid, h in helices.items()}
    for a, b, _ in transitions:
        part.connect(scaffold[a], scaffold[b])
    for out, inn in staple_pairs:
        part.connect(low[out], high[inn])

    return {
        "helices": len(helices),
        "scaffoldNt": len(helices) * (bp + k),
        "vertices": len(vertices),
        "complementaryVertices": complementary,
    }


def run(ctx: PluginContext) -> None:
    part = load_part(ctx.get_part_as_foldnano_json(), active_region_id=ctx.active_region_id)
    region = part.get_region(ctx.active_region_id)
    if region is None or region.kind != "FREEFORM" or region.virtual_helices:
        raise ValueError("Activate an empty freeform region first.")
    facts = build_wireframe(part, region, octahedron(19.0), bp=42)
    ctx.log(f"Built {facts}")
    ctx.set_result({"status": "ok", **facts})
    ctx.set_result_mutation_log(part.mutation_log)
