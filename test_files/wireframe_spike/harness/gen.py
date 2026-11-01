"""Usage: gen.py <router_dir> <empty_part.json> <out.json>"""
import importlib.util, json, sys, time

router_dir, empty_path, out_path = sys.argv[1:4]
spec = importlib.util.spec_from_file_location("wireframe_router", f"{router_dir}/wireframe_router.py")
wr = importlib.util.module_from_spec(spec)
sys.modules["wireframe_router"] = wr
spec.loader.exec_module(wr)
from foldnano.edit import load_part

VARIANTS = {
    "octahedron_default_roll": (lambda: wr.octahedron(19.0), dict(optimise_roll=False)),
    "octahedron": (lambda: wr.octahedron(19.0), dict()),
    "octahedron_1nt_linkers": (lambda: wr.octahedron(19.0), dict(linker_nt=1)),
    "octahedron_5nt_linkers": (lambda: wr.octahedron(21.0), dict(linker_nt=5)),
    "tetrahedron_doubled_1p2nm": (lambda: wr.tetrahedron_doubled(19.0), dict(doubled_sep_nm=1.2)),
    "tetrahedron_doubled_2p4nm": (lambda: wr.tetrahedron_doubled(19.0), dict(doubled_sep_nm=2.4)),
    "torus_140_helices": (lambda: wr.torus(10, 7, 19.0), dict()),
}
empty = open(empty_path).read()
out = {}
for name, (mesh, opts) in VARIANTS.items():
    part = load_part(empty)
    region = part.regions[0]
    t = time.time()
    facts = wr.build_wireframe(part, region, mesh(), **opts)
    out[name] = dict(facts=facts, log=part.mutation_log, pythonSeconds=round(time.time() - t, 2), mirror=part.to_json())
    print(name, facts, out[name]["pythonSeconds"], "ops", len(part.mutation_log))

# Negative control: same helices, but the scaffold and staples join helices in a shuffled order,
# so most crossovers span the whole structure. Topologically legal, geometrically wrong.
import random
part = load_part(empty)
region = part.regions[0]
vertices, edges, normals = wr.octahedron(19.0)
helices = []
for u, v in edges:
    axis = wr._unit(wr._sub(vertices[v], vertices[u]))
    mid = wr._mul(wr._add(vertices[u], vertices[v]), 0.5)
    helices.append(region.add_vh_at(origin=wr._sub(mid, wr._mul(axis, 20.5 * wr.RISE_NM)), direction=axis))
sc = [part.create_segment(h, 0, 41, color="#0066cc", is_scaffold=True) for h in helices]
lo = [part.create_segment(h, 20, 0, color="#f97316") for h in helices]
hi = [part.create_segment(h, 41, 21, color="#f97316") for h in helices]
order = list(range(12))
random.Random(3).shuffle(order)
for i in range(12):
    part.connect(sc[order[i]], sc[order[(i + 1) % 12]])
    part.connect(lo[order[i]], hi[order[(i + 5) % 12]])
out["negative_control_shuffled"] = dict(facts={"helices": 12}, log=part.mutation_log, mirror=part.to_json())


# Script Lab entry point with a stub context.
class Ctx:
    active_region_id = load_part(empty).regions[0].id
    def get_part_as_foldnano_json(self): return empty
    def log(self, m): print("ctx.log:", m)
    def set_result(self, r): print("ctx.result:", r)
    def set_result_mutation_log(self, l): print("ctx.log ops:", len(l))
wr.run(Ctx())
json.dump(out, open(out_path, "w"))
