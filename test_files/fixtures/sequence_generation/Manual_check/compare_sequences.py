#!/usr/bin/env python3
"""
Compare Foldnano vs cadnano staple-sequence CSVs.

Usage (run from this directory):
    python3 compare_sequences.py

Reads:
    c/<design>.csv  — cadnano 2.5 reference (staples only, 5 columns)
    f/<design>.csv  — Foldnano export (staples + scaffold, 7 columns)

For each matching design, filters the scaffold out of the Foldnano output
(longest sequence = scaffold), then compares staple sequences by Start-End key.
Normalises unsequenced positions: space and '?' → 'N'.

Note: Foldnano intentionally includes the scaffold in its CSV export; cadnano does not.
"""

import csv
import os
import sys


def load_csv(path):
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def normalize_seq(seq):
    """Replace unsequenced markers with N for comparison."""
    return seq.replace('?', 'N').replace(' ', 'N')


def compare(name, c_path, f_path):
    c_rows = load_csv(c_path)
    f_rows = load_csv(f_path)

    # Foldnano includes the scaffold; remove it (longest sequence).
    if f_rows:
        max_len = max(int(r['Length']) for r in f_rows)
        f_staples = [r for r in f_rows if int(r['Length']) < max_len]
        scaffold_count = len(f_rows) - len(f_staples)
    else:
        f_staples = []
        scaffold_count = 0

    c_map = {(r['Start'], r['End']): r for r in c_rows}
    f_map = {(r['Start'], r['End']): r for r in f_staples}

    matches = 0
    mismatches = []
    missing = []   # in cadnano ref but not in Foldnano
    extra = []     # in Foldnano but not in cadnano ref

    for key, c_rec in c_map.items():
        f_rec = f_map.get(key)
        if f_rec is None:
            missing.append(key)
            continue

        c_seq = normalize_seq(c_rec['Sequence'])
        f_seq = normalize_seq(f_rec['Sequence'])
        c_len = int(c_rec['Length'])
        f_len = int(f_rec['Length'])

        # All-N reference means cadnano returned None (unsequenced region); only check length.
        if c_seq == '' or all(ch == 'N' for ch in c_seq):
            if c_len == f_len:
                matches += 1
            else:
                mismatches.append((key, 'length', c_len, f_len, c_seq[:30], f_seq[:30]))
        elif c_seq == f_seq and c_len == f_len:
            matches += 1
        else:
            mismatches.append((key, 'seq', c_len, f_len, c_seq[:50], f_seq[:50]))

    for key in f_map:
        if key not in c_map:
            extra.append(key)

    print(f'\n{"="*60}')
    print(f'  {name}')
    print(f'{"="*60}')
    print(f'  cadnano staples : {len(c_rows)}')
    print(f'  Foldnano total  : {len(f_rows)}  (scaffold rows removed: {scaffold_count})')
    print(f'  Foldnano staples: {len(f_staples)}')
    print(f'  Matches         : {matches}')
    print(f'  Mismatches      : {len(mismatches)}')
    print(f'  Missing in Fold : {len(missing)}')
    print(f'  Extra in Fold   : {len(extra)}')

    for key, kind, c_len, f_len, c_seq, f_seq in mismatches[:5]:
        print(f'\n  MISMATCH {key}:')
        if kind == 'length':
            print(f'    cadnano len={c_len}  Foldnano len={f_len}')
        else:
            print(f'    cadnano  (len={c_len}): {c_seq}')
            print(f'    Foldnano (len={f_len}): {f_seq}')
    if len(mismatches) > 5:
        print(f'  ... and {len(mismatches) - 5} more mismatches')

    for key in missing[:5]:
        print(f'  MISSING: {key}')
    if len(missing) > 5:
        print(f'  ... and {len(missing) - 5} more missing')

    ok = len(mismatches) == 0 and len(missing) == 0
    print(f'\n  {"✓ PASS" if ok else "✗ FAIL"}')
    return ok


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    c_dir = os.path.join(here, 'c')
    f_dir = os.path.join(here, 'f')

    if not os.path.isdir(c_dir) or not os.path.isdir(f_dir):
        print('ERROR: expected subdirectories c/ and f/ next to this script')
        sys.exit(1)

    c_names = {os.path.splitext(f)[0] for f in os.listdir(c_dir) if f.endswith('.csv')}
    f_names = {os.path.splitext(f)[0] for f in os.listdir(f_dir) if f.endswith('.csv')}
    common = sorted(c_names & f_names)
    only_c = sorted(c_names - f_names)
    only_f = sorted(f_names - c_names)

    print(f'Designs in c/ and f/: {len(common)}')
    if only_c:
        print(f'Only in c/ (no Foldnano output): {only_c}')
    if only_f:
        print(f'Only in f/ (no cadnano ref): {only_f}')

    results = {}
    for name in common:
        results[name] = compare(
            name,
            os.path.join(c_dir, name + '.csv'),
            os.path.join(f_dir, name + '.csv'),
        )

    passed = sum(results.values())
    failed = len(results) - passed
    print(f'\n{"="*60}')
    print(f'Done: {passed} passed, {failed} failed out of {len(results)} designs.')
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
