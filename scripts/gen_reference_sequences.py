#!/usr/bin/env python3
"""
Generate reference staple-sequence CSVs from published cadnano designs, using cadnano 2.5.

Usage (from the repo root):
    CADNANO_PATH=ref_cadnano25 python3 scripts/gen_reference_sequences.py

Reads:  test_files/published_cadnano_designs/*.json
Writes: test_files/fixtures/sequence_generation/cadnano_ref/<design>.csv
        test_files/fixtures/sequence_generation/cadnano_ref/_provenance.json

Sequences come from `Oligo.sequenceExport` (behind cadnano's own `NucleicAcidPart.getSequences()`),
not `Oligo.sequence()`, which silently drops sequenced bases past an unsequenced 5'-most strand.
Every design is given the same scaffold, scaf8634. `_provenance.json` records the scaffold, the
circular break point, per-design counts, and content hashes of every input/output; the two
implementations cannot drift onto different inputs without `sequence-comparison.spec.ts` noticing.

cadnano 2.5 is located via $CADNANO_PATH, then ./ref_cadnano25/ (a git
checkout is required, not an installed package, since the approved-build check pins a commit and
patched-file hashes). Requires numpy, pandas and PyQt5. See docs/sequence-csv-export.md for the two
source patches cadnano 2.5 needs on a modern Python.
"""

import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def repo_relative(path):
    """Keep provenance free of absolute paths, which differ per machine and leak home directories."""
    absolute = os.path.abspath(path)
    root = os.path.normcase(REPO_ROOT)
    try:
        inside = os.path.commonpath([os.path.normcase(absolute), root]) == root
    except ValueError:
        # Windows raises when the two sit on different drives, which is what $CADNANO_PATH
        # pointing at a checkout on another volume looks like.
        inside = False
    if inside:
        return os.path.relpath(absolute, REPO_ROOT).replace(os.sep, '/')
    # Outside the checkout: name it well enough to identify without exposing where it lives.
    head, tail = os.path.split(absolute)
    return '/'.join(filter(None, (os.path.basename(head), tail)))

DESIGNS_DIR = os.path.join(REPO_ROOT, 'test_files', 'published_cadnano_designs')
SCAFFOLD_DIR = os.path.join(REPO_ROOT, 'static', 'scaffolds')
OUTPUT_DIR = os.path.join(REPO_ROOT, 'test_files', 'fixtures', 'sequence_generation', 'cadnano_ref')

SCAFFOLD_FILE = 'scaf8634.txt'
PROVENANCE_FILE = '_provenance.json'

# Bumped whenever the rows this script produces could change, so a stale fixture set is identifiable
# from its provenance alone rather than by eye.
GENERATOR_VERSION = 3

# The cadnano build these fixtures are approved to come from (patches documented in
# docs/sequence-csv-export.md). sequence-comparison.spec.ts pins the same values.
APPROVED_CADNANO = {
    'version': '2.5.2.1',
    'commit': 'ce6ff019b88ee7728de947bd86b35861cf57848d',
    'modifiedFileSha256': {
        'cadnano/part/nucleicacidpart.py':
            'bba71f56cef4c263311c5f6e005077a14271f87de4d526a5ba9c4a12910542f2',
        'cadnano/views/pathview/pathstyles.py':
            '6ff7cb5e2fde0e0b503cfcab3fec24926eda8e80ab844c45a9dbe487cbb3707b',
    },
}

# "Staple" is a design-level idea, not cadnano's scaf/stap file-format slots; some designs route
# short non-scaffold fragments through the scaf slot. Recorded in the provenance, asserted by the spec.
INCLUSION_RULE = 'every linear oligo except the unique longest, which is taken as the scaffold'

CSV_FIELDS = ['Start', 'End', 'Sequence', 'Length', 'Color']
EXPORT_KEYS = ['Start', 'End', 'Color', 'Mod5', 'Sequence', 'Mod3', 'AbstractSequence']

UNSEQUENCED = '?'  # cadnano's own marker, from Strand.sequence(for_export=True)
ALLOWED_BASES = set('ACGT') | {UNSEQUENCED}
ENDPOINT_RE = re.compile(r'^\d+\[\d+\]$')


def resolve_cadnano_path():
    """Return the git checkout to prepend to sys.path. The approved-build check needs a checkout."""
    override = os.environ.get('CADNANO_PATH')
    if override:
        # An explicit override that does not resolve is a mistake, not a reason to quietly pick
        # something else and write fixtures from a build the caller never asked for.
        if not os.path.isdir(override):
            raise RuntimeError('CADNANO_PATH is set to %r, which is not a directory' % override)
        return override
    path = os.path.join(REPO_ROOT, 'ref_cadnano25')
    if os.path.isdir(path):
        return path
    raise RuntimeError(
        'No cadnano 2.5 checkout found. Set CADNANO_PATH, or clone one to ./ref_cadnano25 '
        '(see docs/sequence-csv-export.md).'
    )


CADNANO_PATH = resolve_cadnano_path()
sys.path.insert(0, CADNANO_PATH)

import cadnano  # noqa: E402
from cadnano.document import Document  # noqa: E402


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_text(path):
    """Hash with line endings normalised, so core.autocrlf doesn't change the digest per machine."""
    with open(path, 'rb') as f:
        return sha256_bytes(f.read().replace(b'\r\n', b'\n'))


def git_output(repo, *args):
    """Run git in `repo`, returning stripped stdout, or None when it fails."""
    try:
        return subprocess.check_output(
            ['git', '-C', repo] + list(args), stderr=subprocess.DEVNULL
        ).decode('utf-8', 'replace').strip()
    except Exception:
        return None


def cadnano_provenance():
    """
    Describe the cadnano build precisely enough to notice a changed one.

    A commit alone isn't enough: the checkout is always dirty (two patched files), so `rev-parse
    HEAD` looks clean regardless of what was edited. The fingerprint is each modified file's
    normalised content hash rather than a `git diff` hash, which varies by git version and line
    endings.
    """
    info = {
        'source': repo_relative(CADNANO_PATH),
        'module': repo_relative(os.path.dirname(os.path.abspath(cadnano.__file__))),
        'version': getattr(cadnano, '__version__', 'unknown'),
    }

    commit = git_output(CADNANO_PATH, 'rev-parse', 'HEAD')
    if commit:
        info['commit'] = commit

    status = git_output(CADNANO_PATH, 'status', '--porcelain')
    if status is not None:
        info['dirty'] = bool(status)
        # Split on the status code rather than slicing a fixed column: git_output strips the whole
        # payload, which removes the leading space from the first porcelain line only.
        info['modifiedFiles'] = sorted(
            parts[1].strip()
            for parts in (line.split(maxsplit=1) for line in status.splitlines())
            if len(parts) == 2
        )
        info['modifiedFileSha256'] = {
            name: sha256_text(os.path.join(CADNANO_PATH, name))
            for name in info['modifiedFiles']
            if os.path.isfile(os.path.join(CADNANO_PATH, name))
        }
    return info


def check_approved_build(info):
    """
    Refuse to overwrite the fixtures from a cadnano build that is not the approved one.

    Set ALLOW_UNAPPROVED_CADNANO=1 to override deliberately — for example when upgrading cadnano,
    in which case update APPROVED_CADNANO here and the matching pins in sequence-comparison.spec.ts.
    """
    problems = []
    if info.get('version') != APPROVED_CADNANO['version']:
        problems.append('version %r, approved %r' % (info.get('version'), APPROVED_CADNANO['version']))
    if info.get('commit') != APPROVED_CADNANO['commit']:
        problems.append('commit %r, approved %r' % (info.get('commit'), APPROVED_CADNANO['commit']))
    if info.get('modifiedFiles') != sorted(APPROVED_CADNANO['modifiedFileSha256']):
        problems.append('modified files %r' % (info.get('modifiedFiles'),))
    elif info.get('modifiedFileSha256') != APPROVED_CADNANO['modifiedFileSha256']:
        for name, digest in sorted(APPROVED_CADNANO['modifiedFileSha256'].items()):
            actual = info.get('modifiedFileSha256', {}).get(name)
            if actual != digest:
                problems.append('%s hashes to %s, approved %s' % (name, actual, digest))

    if not problems:
        return
    if os.environ.get('ALLOW_UNAPPROVED_CADNANO') == '1':
        print('  WARNING: unapproved cadnano build, continuing because ALLOW_UNAPPROVED_CADNANO=1')
        for problem in problems:
            print('    - %s' % problem)
        return
    raise SystemExit(
        'Refusing to write fixtures from an unapproved cadnano build:\n  '
        + '\n  '.join(problems)
        + '\nSet ALLOW_UNAPPROVED_CADNANO=1 to override, then update APPROVED_CADNANO and the '
          'pins in sequence-comparison.spec.ts.'
    )


def load_scaffold():
    """Return (name, sequence, sha256) for the common test scaffold."""
    path = os.path.join(SCAFFOLD_DIR, SCAFFOLD_FILE)
    with open(path) as f:
        return SCAFFOLD_FILE, f.read().strip(), sha256_text(path)


def select_scaffold(oligos):
    """The scaffold is the unique longest oligo; a tie is refused, not broken by iteration order."""
    ordered = sorted(oligos, key=lambda o: o.length(), reverse=True)
    scaffold = ordered[0]
    rest = ordered[1:]
    if rest and rest[0].length() == scaffold.length():
        raise RuntimeError(
            'two oligos tie for longest (%d nt); the scaffold choice is not reproducible'
            % scaffold.length()
        )
    return scaffold, rest


def break_circular_scaffold(part, scaffold):
    """
    Break the crossover entering VH0, so the linearised scaffold starts there. Returns the break as
    structured {'from': {vh, bp}, 'to': {vh, bp}} data so the spec can verify the connection before
    disconnecting anything. Test/reference-only; the app must never infer a CSV export cut point.

    The walk starts at strand5p(), cadnano's arbitrary pick for a circular oligo, and stops at the
    first VH0 pass. If that starting point ever shifts, the break lands on a different pass and
    every staple sequence rotates — check `linearizedAt` in the provenance diff before accepting it.
    """
    visited = set()
    curr = scaffold.strand5p()
    while curr is not None and curr not in visited:
        visited.add(curr)
        if curr.idNum() == 0:
            incoming = curr.connection5p()
            if incoming is None:
                break
            record = {
                'from': {'vh': incoming.idNum(), 'bp': incoming.idx3Prime()},
                'to': {'vh': curr.idNum(), 'bp': curr.idx5Prime()},
            }
            part.removeXover(incoming, curr)
            print('    Broke vh%d[%d] -> vh%d[%d]' % (
                record['from']['vh'], record['from']['bp'],
                record['to']['vh'], record['to']['bp'],
            ))
            return record
        curr = curr.connection3p()
    raise RuntimeError('circular scaffold has no VH0 crossover; no reproducible break point')


def export_rows(oligos):
    """
    Run cadnano's own exporter over `oligos` and return one dict per oligo.

    Circular oligos raise CircularOligoException inside cadnano, so they must be filtered out first.
    """
    out = {key: [] for key in EXPORT_KEYS}
    for oligo in oligos:
        oligo.sequenceExport(out)

    # zip() stops at the shortest column, so a column cadnano failed to append to would silently
    # truncate every row instead of failing. Check the shape before transposing.
    expected = len(oligos)
    ragged = {key: len(values) for key, values in out.items() if len(values) != expected}
    if ragged:
        raise RuntimeError('exporter returned %d oligo(s) but columns %r' % (expected, ragged))

    return [dict(zip(EXPORT_KEYS, values)) for values in zip(*(out[key] for key in EXPORT_KEYS))]


def validate_row(row, expected_length):
    """Reject a structurally malformed row here, where the cause is still visible."""
    where = row['Start']
    if not ENDPOINT_RE.match(row['Start']) or not ENDPOINT_RE.match(row['End']):
        raise RuntimeError('%s: endpoints must look like vh[bp], got %r -> %r'
                           % (where, row['Start'], row['End']))
    if not isinstance(expected_length, int) or expected_length <= 0:
        raise RuntimeError('%s: oligo length must be a positive integer, got %r'
                           % (where, expected_length))
    if len(row['Sequence']) != expected_length:
        # Most likely a multi-base insertion, or a modification injected into the sequence.
        raise RuntimeError('%s: exported sequence is %d nt but the oligo is %d nt'
                           % (where, len(row['Sequence']), expected_length))
    stray = set(row['Sequence'].upper()) - ALLOWED_BASES
    if stray:
        raise RuntimeError('%s: sequence contains %s, expected only ACGT and %r'
                           % (where, sorted(stray), UNSEQUENCED))
    if row['Mod5'] or row['Mod3']:
        raise RuntimeError('%s: 5%s/3%s modifications are not supported by this reference (%r, %r)'
                           % (where, "'", "'", row['Mod5'], row['Mod3']))


def sort_key(row):
    """Deterministic order: cadnano's oligo iteration order is not stable across runs."""
    def parse(end):
        vh, _, rest = end.partition('[')
        return int(vh), int(rest.rstrip(']'))
    return parse(row['Start']) + parse(row['End'])


def process_design(json_path, scaffold_name, scaffold_seq):
    """Load a design, apply the test scaffold, and return (rows, meta)."""
    app = cadnano.app()
    doc = app.document = Document()
    doc.readFile(json_path)

    part = doc.activePart()
    if part is None:
        raise RuntimeError('no active part')
    oligos = list(part.oligos())
    if not oligos:
        raise RuntimeError('no oligos')

    scaffold, others = select_scaffold(oligos)
    route_length = scaffold.length()
    was_circular = scaffold.isCircular()
    print('  Scaffold route: %d nt, circular=%s' % (route_length, was_circular))
    if len(scaffold_seq) < route_length:
        raise RuntimeError(
            'scaffold %s is %d nt but the route is %d nt; it would not cover the route'
            % (scaffold_name, len(scaffold_seq), route_length)
        )

    linearized_at = None
    if was_circular:
        linearized_at = break_circular_scaffold(part, scaffold)
        if scaffold.isCircular():
            raise RuntimeError('scaffold still circular after the break')

    # Circular oligos have no terminus to label and cadnano refuses to export them. Foldnano's side
    # excludes them too; the counts are compared so the two cannot exclude different oligos.
    circular = [o for o in others if o.isCircular()]
    linear = [o for o in others if not o.isCircular()]
    if circular:
        print('  %d circular oligo(s) excluded' % len(circular))
    for oligo in linear:
        if oligo.strand5p() is None:
            raise RuntimeError("linear oligo with no 5' strand; cannot label its endpoints")

    scaffold.applySequence(scaffold_seq)

    exported = export_rows(linear)
    if len(exported) != len(linear):
        raise RuntimeError('exporter returned %d rows for %d oligos'
                           % (len(exported), len(linear)))

    rows = []
    seen = set()
    for oligo, row in zip(linear, exported):
        validate_row(row, oligo.length())
        route = (row['Start'], row['End'])
        if route in seen:
            raise RuntimeError('%s -> %s appears twice; routes must be unique'
                               % (row['Start'], row['End']))
        seen.add(route)
        rows.append({
            'Start': row['Start'],
            'End': row['End'],
            'Sequence': row['Sequence'],
            'Length': oligo.length(),
            'Color': row['Color'],
        })

    rows.sort(key=sort_key)

    meta = {
        'scaffoldFile': scaffold_name,
        'scaffoldLength': len(scaffold_seq),
        'scaffoldRouteLength': route_length,
        'scaffoldCircular': was_circular,
        'linearizedAt': linearized_at,
        'inclusionRule': INCLUSION_RULE,
        'oligos': len(rows),
        'oligoNt': sum(r['Length'] for r in rows),
        'unsequencedNt': sum(r['Sequence'].count(UNSEQUENCED) for r in rows),
        'circularExcluded': len(circular),
        'sourceSha256': sha256_text(json_path),
    }
    return rows, meta


def write_csv(rows, path):
    # LF explicitly: csv defaults to CRLF, which would make the fixtures differ by line ending alone
    # depending on which platform last regenerated them.
    with open(path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    scaffold_name, scaffold_seq, scaffold_sha = load_scaffold()
    print('Scaffold: %s (%d nt), applied to every design' % (scaffold_name, len(scaffold_seq)))

    cadnano_info = cadnano_provenance()
    print('cadnano %s from %s' % (cadnano_info.get('version'), cadnano_info['source']))
    if cadnano_info.get('dirty'):
        print('  checkout is patched: %s' % ', '.join(cadnano_info.get('modifiedFiles', [])))
    check_approved_build(cadnano_info)

    design_files = sorted(f for f in os.listdir(DESIGNS_DIR) if f.endswith('.json'))
    print('Found %d design(s)\n' % len(design_files))

    designs = {}
    generated = []
    failed = []
    for filename in design_files:
        name = os.path.splitext(filename)[0]
        print('Processing: %s' % filename)
        try:
            rows, meta = process_design(
                os.path.join(DESIGNS_DIR, filename), scaffold_name, scaffold_seq
            )
        except Exception:
            traceback.print_exc()
            failed.append(name)
            continue
        generated.append((name, rows))
        designs[name] = meta
        print('  %d oligos ready' % len(rows))

    if failed:
        print('\nAborted: %d design(s) failed; nothing written.' % len(failed))
        print('Failed: %s' % ', '.join(failed))
        return 1

    # Stage the complete set beside the destination, then move each file into place. A temporary
    # directory on the same volume makes each individual replacement atomic; the set as a whole is
    # not, which the install loop below handles explicitly.
    staging = tempfile.mkdtemp(prefix='.cadnano_ref-', dir=os.path.dirname(OUTPUT_DIR))
    try:
        for name, rows in generated:
            path = os.path.join(staging, name + '.csv')
            write_csv(rows, path)
            designs[name]['csvSha256'] = sha256_text(path)

        # No timestamp: it would change on every regeneration even when nothing else did, so a
        # rerun could never be checked for a byte-identical result. The hashes identify the inputs.
        provenance = {
            'generatorVersion': GENERATOR_VERSION,
            'sequenceSource': 'cadnano Oligo.sequenceExport (NucleicAcidPart.getSequences)',
            'unsequencedMarker': UNSEQUENCED,
            'inclusionRule': INCLUSION_RULE,
            'cadnano': cadnano_info,
            'python': sys.version.split()[0],
            'scaffoldSha256': scaffold_sha,
            'designs': designs,
        }
        provenance_path = os.path.join(staging, PROVENANCE_FILE)
        with open(provenance_path, 'w', newline='\n') as f:
            json.dump(provenance, f, indent='\t', sort_keys=True)
            f.write('\n')

        # Individual replacements are atomic; the set is not. Any exception in this block, including
        # the stale-CSV removal below, restores every touched file from its `rollback` backup. A
        # killed process bypasses this handler; installing CSVs before the provenance bounds that
        # case, since a leftover provenance describing the old set fails the spec's hash checks.
        expected = {name + '.csv' for name, _ in generated} | {PROVENANCE_FILE}
        stale = [
            filename
            for filename in sorted(os.listdir(OUTPUT_DIR))
            if filename.endswith('.csv') and filename not in expected
        ]
        touched = []  # (filename, existed_before)
        rollback = tempfile.mkdtemp(prefix='.cadnano_ref_bak-', dir=os.path.dirname(OUTPUT_DIR))
        try:
            csv_names = sorted(name + '.csv' for name, _ in generated)
            for filename in csv_names + [PROVENANCE_FILE]:
                destination = os.path.join(OUTPUT_DIR, filename)
                existed = os.path.exists(destination)
                if existed:
                    shutil.copy2(destination, os.path.join(rollback, filename))
                os.replace(os.path.join(staging, filename), destination)
                touched.append((filename, existed))
                print('Written %s' % filename)

            # A design removed from the corpus must not leave its CSV behind to be compared later.
            for filename in stale:
                destination = os.path.join(OUTPUT_DIR, filename)
                shutil.copy2(destination, os.path.join(rollback, filename))
                os.remove(destination)
                touched.append((filename, True))
                print('Removed stale %s' % filename)
        except Exception:
            for filename, existed in reversed(touched):
                destination = os.path.join(OUTPUT_DIR, filename)
                if existed:
                    # Covers both a replaced install file and a removed stale file: either way the
                    # backup holds what belongs at `destination`.
                    shutil.copy2(os.path.join(rollback, filename), destination)
                elif os.path.exists(destination):
                    # No previous version to restore: the file is new, so removing it is the undo.
                    os.remove(destination)
            print('Install failed; rolled back %d file(s).' % len(touched))
            raise
        finally:
            shutil.rmtree(rollback, ignore_errors=True)
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    print('\nDone: %d design(s).' % len(designs))
    return 0


if __name__ == '__main__':
    sys.exit(main())
