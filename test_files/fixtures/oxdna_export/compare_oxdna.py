#!/usr/bin/env python3
"""
Compare Foldnano vs tacoxDNA oxDNA output files.
Usage: python3 compare_oxdna.py
Run from test_files/fixtures/oxdna_export/ directory.
"""
import os
import numpy as np


def parse_top(path):
    lines = open(path).readlines()
    header = lines[0].split()
    n_nts, n_strands = int(header[0]), int(header[1])
    # index → (strand_id, base, next_3prime, prev_5prime)
    nts = []
    strands = {}  # strand_id → [global_nt_index, ...]
    for i, line in enumerate(lines[1:]):
        parts = line.split()
        sid, base, nxt, prv = int(parts[0]), parts[1], int(parts[2]), int(parts[3])
        nts.append((sid, base, nxt, prv))
        strands.setdefault(sid, []).append(i)
    return n_nts, n_strands, nts, strands


def parse_dat(path):
    lines = open(path).readlines()
    # First 3 lines: t=, b=, E=
    data = []
    for line in lines[3:]:
        vals = list(map(float, line.split()))
        if len(vals) >= 9:
            pos = np.array(vals[0:3])
            a1  = np.array(vals[3:6])
            a3  = np.array(vals[6:9])
            data.append((pos, a1, a3))
    return data


def strand_lengths_sorted(strands):
    return sorted(len(v) for v in strands.values())


def intra_strand_backbone_distances(dat, top_nts):
    """Return list of distances between consecutive nucleotides in topology order."""
    dists = []
    for i, (sid, base, nxt, prv) in enumerate(top_nts):
        if nxt >= 0:
            d = np.linalg.norm(dat[nxt][0] - dat[i][0])
            dists.append(d)
    return dists


def compare(name, taco_dir, fold_dir):
    tp = f"{taco_dir}/{name}.top"
    fp = f"{fold_dir}/{name}.top"
    td_path = f"{taco_dir}/{name}.dat"
    fd_path = f"{fold_dir}/{name}.dat"

    if not os.path.exists(tp):
        print(f"\n=== {name} ===  [SKIP: no Taco reference]")
        return
    if not os.path.exists(fp):
        print(f"\n=== {name} ===  [SKIP: no Foldnano output]")
        return

    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")

    tt_nts, tt_strands_n, tt_top, tt_strands = parse_top(tp)
    fn_nts, fn_strands_n, fn_top, fn_strands = parse_top(fp)

    nt_ok = tt_nts == fn_nts
    st_ok = tt_strands_n == fn_strands_n
    print(f"  Nucleotides : Taco={tt_nts:5d}  Foldnano={fn_nts:5d}  {'✓' if nt_ok else '✗ MISMATCH'}")
    print(f"  Strands     : Taco={tt_strands_n:5d}  Foldnano={fn_strands_n:5d}  {'✓' if st_ok else '✗ MISMATCH'}")

    taco_lens = strand_lengths_sorted(tt_strands)
    fold_lens = strand_lengths_sorted(fn_strands)
    if taco_lens == fold_lens:
        print(f"  Strand sizes: ✓ match")
    else:
        print(f"  Strand sizes: ✗ DIFFER")
        print(f"    Taco (first 10): {taco_lens[:10]}")
        print(f"    Fold (first 10): {fold_lens[:10]}")

    td = parse_dat(td_path)
    fd = parse_dat(fd_path)

    if len(td) != len(fd):
        print(f"  Cannot compare .dat: count mismatch ({len(td)} vs {len(fd)})")
        return

    # Bounding boxes
    taco_pos = np.array([p for p, a1, a3 in td])
    fold_pos = np.array([p for p, a1, a3 in fd])
    t_bbox = taco_pos.max(0) - taco_pos.min(0)
    f_bbox = fold_pos.max(0) - fold_pos.min(0)
    print(f"  Taco bbox   : [{t_bbox[0]:.2f}, {t_bbox[1]:.2f}, {t_bbox[2]:.2f}] oxDNA units")
    print(f"  Fold bbox   : [{f_bbox[0]:.2f}, {f_bbox[1]:.2f}, {f_bbox[2]:.2f}] oxDNA units")

    # Intra-strand backbone distances (check for reasonable bond lengths)
    t_bd = intra_strand_backbone_distances(td, tt_top)
    f_bd = intra_strand_backbone_distances(fd, fn_top)
    if t_bd:
        print(f"  Taco backbone bonds: mean={np.mean(t_bd):.4f}  max={np.max(t_bd):.4f}  (expect ~0.76)")
    if f_bd:
        print(f"  Fold backbone bonds: mean={np.mean(f_bd):.4f}  max={np.max(f_bd):.4f}  (expect ~0.76)")

    # Axial rise (z-spacing between consecutive same-strand nucleotides)
    # For a vertical helix, consecutive nucleotides should differ by ~OXDNA_BASE_BASE = 0.3898
    t_z = [abs(td[tt_top[i][2]][0][2] - td[i][0][2]) for i in range(min(200, len(tt_top)))
           if tt_top[i][2] >= 0]
    f_z = [abs(fd[fn_top[i][2]][0][2] - fd[i][0][2]) for i in range(min(200, len(fn_top)))
           if fn_top[i][2] >= 0]
    if t_z:
        print(f"  Taco |Δz| per bond  : mean={np.mean(t_z):.4f}  (expect ~0.3898 for single helix, smaller for crossovers)")
    if f_z:
        print(f"  Fold |Δz| per bond  : mean={np.mean(f_z):.4f}")

    # a1 and a3 vector dot products between Taco and Foldnano for same-index nucleotides.
    # These are only meaningful if the nucleotide ORDERING is the same (it may not be).
    # We compute them anyway as a crude check.
    n_sample = min(200, len(td))
    a1_dots = [float(np.dot(td[i][1], fd[i][1])) for i in range(n_sample)]
    a3_dots = [float(np.dot(td[i][2], fd[i][2])) for i in range(n_sample)]
    print(f"  a1 dot[0:{n_sample}]: mean={np.mean(a1_dots):+.3f}  min={np.min(a1_dots):+.3f}  max={np.max(a1_dots):+.3f}")
    print(f"  a3 dot[0:{n_sample}]: mean={np.mean(a3_dots):+.3f}  min={np.min(a3_dots):+.3f}  max={np.max(a3_dots):+.3f}")
    if abs(np.mean(a1_dots)) < 0.3:
        print(f"  ⚠ a1 dots near zero — nucleotide ordering differs between tools (expected for different strand traversal order)")

    # --- Geometry self-check for Foldnano (most important!) ---
    # For each strand in Foldnano, check that backbone bond distances are reasonable
    bad_bonds = [(i, fn_top[i][2], float(np.linalg.norm(fd[fn_top[i][2]][0] - fd[i][0])))
                 for i in range(len(fn_top)) if fn_top[i][2] >= 0
                 and np.linalg.norm(fd[fn_top[i][2]][0] - fd[i][0]) > 1.5]
    if bad_bonds:
        print(f"\n  ✗ Foldnano has {len(bad_bonds)} backbone bonds > 1.5 oxDNA units:")
        for i, j, d in bad_bonds[:5]:
            sid_i = fn_top[i][0]
            sid_j = fn_top[j][0]
            print(f"    nt {i} (strand {sid_i}) → nt {j} (strand {sid_j}) : dist={d:.3f}")
        if len(bad_bonds) > 5:
            print(f"    ... and {len(bad_bonds)-5} more")
    else:
        print(f"\n  ✓ All Foldnano backbone bonds ≤ 1.5 oxDNA units")

    # Also check Taco
    taco_bad = [(i, tt_top[i][2], float(np.linalg.norm(td[tt_top[i][2]][0] - td[i][0])))
                for i in range(len(tt_top)) if tt_top[i][2] >= 0
                and np.linalg.norm(td[tt_top[i][2]][0] - td[i][0]) > 1.5]
    if taco_bad:
        print(f"  ⚠ Taco also has {len(taco_bad)} backbone bonds > 1.5 (these need relaxation per tacoxDNA warnings)")
    else:
        print(f"  ✓ All Taco backbone bonds ≤ 1.5 oxDNA units")


if __name__ == '__main__':
    taco = 'Taco'
    fold = 'Foldnano'
    # Find all designs that have both outputs
    taco_bases = {f[:-4] for f in os.listdir(taco) if f.endswith('.top')} if os.path.isdir(taco) else set()
    fold_bases = {f[:-4] for f in os.listdir(fold) if f.endswith('.top')} if os.path.isdir(fold) else set()
    all_names = sorted(taco_bases | fold_bases)
    for name in all_names:
        compare(name, taco, fold)
    print(f"\n{'='*60}")
    print("Done.")
