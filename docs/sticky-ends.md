---
covers:
  - src/lib/model/stickyEnds/**
  - src/lib/services/stickyEnds/**
  - src/lib/components/Editor/ToolPanel/StickyEndsPanel.svelte
  - src/lib/components/Editor/StrandView/StickyEndMarkers.svelte
  - src/lib/components/Editor/View3D/stickyEndOverlay.ts
  - src/lib/commands/stickyEnds.ts
  - src/lib/model/checks/stickyPairs.ts
---

# Sticky Ends

Sticky ends are single-stranded stretches whose sequences can bind each other: an overhang on one
Part meant to hybridise with an overhang on another (or on the same Part). Foldnano finds them **by
sequence alone**; nothing marks an end as sticky. What the user may save is intent: a match they
**pair** (meant to bind, so a design check warns when an edit breaks it) or **ignore** (a
coincidence, hidden from the list and the views). See § Saved pairs.

## Detection (`src/lib/model/stickyEnds/stickyEnds.ts`)

- `singleStrandedRuns(part)` walks every oligo 5'→3' and cuts it into maximal runs of bases with
  no partner across the helix. A base is paired when the opposite strand has a slot at the same bp
  whose `seq` reaches the same insertion index (`loopIndex`); a mismatched partner still pairs.
  Strand 1 runs against the bp axis, so its insertion bases count down. Mirror oligos of repeat
  units are skipped: their base oligo stands for them.
- `findStickyMatches(runs, minLength)` returns each maximal exact complementary pairing of at least
  `minLength` bases (clamped to `MIN_STICKY_LENGTH`) once. It indexes every k-mer window, looks
  up each window's reverse complement, keeps a seed only when it can't be extended towards `a`'s
  5' end, then extends towards its 3' end, so each maximal match comes from one seed. Bases other
  than ACGT (unassigned sequence) never match.
- Two overlapping stretches of the same run are a hairpin with no loop and are dropped, except a
  side matching itself exactly: that is a **self-complementary** stretch (`self: true`), which
  binds another copy of the same strand.
- `StickyMatch.key` is built from both sides' (Part, oligo, start, length), sorted, so it stays the
  same across recomputes while the stretches don't move. Views use it for colours and hover.

`oligoBases(oligo)` lists an oligo's bases 5'→3' (insertion bases included) with their positions;
detection and saved-pair anchors both count along it.

## Saved pairs (`stickyPairs.ts`, `StickyRecords.svelte.ts`)

A `StickyRecord` is two `StickyAnchor`s and the saved `length`. An anchor names an oligo and an
`offset` from its 5' or 3' end, whichever was nearer when saved (`anchorAt`), so growing the oligo
at its far end doesn't move it; it holds no bp or helix, so moving or reshaping the oligo keeps
the pair. Circular oligos have no ends and can't be anchored (`stickyMatchBlocker`).

- **Home.** A record with both sides in one Part lives on that Part (`Part.stickyRecords`, anchors
  without `partId`), so it travels with the Part when the design is linked elsewhere and counts
  toward the link's content hash. A record joining two Parts lives in the assembly
  (`Assembly.stickyRecords`, anchors with `partId`). `stickyHomeOf` picks it.
- **Lists.** `StickyRecords` keeps `pairs` and `ignored` (`$state.raw`, replaced on change). JSON
  fields `stickyPairs` / `ignoredMatches` are optional on both Part and assembly and left out when
  empty, so format v3 needs no migration; `load` drops a malformed record instead of failing.
- **Commands** (`commands/stickyEnds.ts`): `saveStickyMatchCmd(history, doc, match, list)` and
  `removeStickyRecordCmd(history, doc, home, list, id)`, recorded as `StickyRecordSet` /
  `StickyRecordRemove` changes (`rec.stickyRecord`). A Part home carries its `partId`, so the
  linked-Part guard refuses pairing or unpairing inside a linked Part (pair there, then update);
  assembly records may join linked Parts. `FoldnanoDocument.removePart` drops the assembly records
  that name the Part.
- **Status.** `resolveRecord` finds where each side is now; `stickyPairStatus` gives `missing` (an
  oligo or Part gone, or too short), `noSequence` (a non-ACGT base), `matching` (complementary over
  the saved length), `partial` (a complementary run of at least `MIN_STICKY_LENGTH`) or `broken`.
- **Match ↔ record.** `recordCovers(sides, match)` holds when each side of the match overlaps one
  of the record's, so a match that grew or shrank by a base stays paired.
- **Checks** (`checks/stickyPairs.ts`): `checkStickyPairs(doc, part)` warns `sticky-pair-broken`
  (broken or partial) and `sticky-pair-missing` for the Part's own pairs and the assembly pairs
  touching it, anchored on the side in that Part. Ignored matches and unpaired matches are never
  checked. `DesignCheckSelection.stickyPairs` (default on) toggles it.
- **Repeat units.** Mirror oligos are skipped in detection, so pairs anchor on base oligos.

## Matcher (`StickyEndMatcher`)

`EditorViewContext.stickyEnds` owns one matcher for the open document. `matches` is a
`$derived` over every Part's runs, computed only while something shows it (the
`sticky_end_matches` highlight or the Sticky Ends panel), so a design that never uses the feature
pays nothing. Each match keeps its colour (`STICKY_COLORS`) for as long as its key exists, so an
edit elsewhere doesn't recolour it. `hoveredKey` is the panel row under the pointer.

It also resolves every saved record of the document (each Part's and the assembly's) and tags
each match `state: 'new' | 'paired' | 'ignored'` with the covering `recordId` (a pair wins over an
ignore). `shown` drops the ignored matches; the views and `marksFor` draw from it. `saved` lists
the records with their status, current match (for its colour) and `editable` (false for a linked
Part's own records).

View state: the highlight flag rides in `highlightContext`, the shortest match length in
`StrandViewContext.stickyEndMinLength`, the 3D line choice (`StickyLinkMode`) in
`stickyEndLinkMode`; all are saved with the per-design view context (not the design file). `showStickyEndsPanel` opens the tool panel.

## Display

- **Tool panel** (`StickyEndsPanel`): the length control, the highlight switch, and three groups:
  **New** (Pair / Ignore, disabled with the blocker as tooltip), **Paired** (status, Unpair; a
  linked Part's own pairs show a read-only icon) and **Ignored** (Stop ignoring). A row's click
  switches to the Part holding a side and centres the strand view on it.
  The panel opens from the Magnet button in the strand-view toolbar and shows over the 3D panels.
- **Strand view** (`StickyEndMarkers`): a band in the match colour under each matched base
  (striped when a base is in several matches), a `⇄ Part` badge by the 3' end of a side (above strand 0, below strand 1, like modification labels) whose
  partner is in another Part (the strand view shows one Part, so a line can't reach it), and a
  dashed line between the two sides of the hovered match when both are in this Part. View-only:
  `listening={false}`, so it never steals hits from editing.
- **3D** (`stickyEndOverlay.ts`): every matched stretch of every visible instance of every Part
  gets a fat-line sleeve in its match colour, a little wider than a strand and pulled in front of
  it, so the strand reads as recoloured there; each step is drawn once (the first match's colour)
  and blends once per pixel: every sleeve shares `STICKY_STENCIL_REF`, so joints, neighbouring
  matches and a hovered match over another never blend twice (the hovered one renders first). Dashed lines join the two sides across visible instances, as `StickyEndScene.linkMode` says:
  `'all'` (default) draws every pair of instances that could bind; `'nearest'` (the panel's **One
  line per instance** switch) links each instance's side to the nearest instance of the partner, from
  both sides, so A1–B1 and A2–B2 both show and a spare B3 still links to its nearest A, a line
  two instances find drawn once. A match within one Part counts its own instance as a partner. A
  self-complementary stretch only links to other instances (none when its Part is placed once),
  each pair once. The choice only shows in the panel when some Part is placed more than once;
  with one instance each both modes draw the same lines. Hovering a listed match keeps its size and fades the others instead. Positions
  are the line view's (`part.getVirtualHelixFrame` + `backbonePoint`), not the NT model or a
  relaxation. Drawn in lab space, outside the active Part's frame.

## Boundaries / Don'ts

- Don't store matches or colours in the design: they're recomputed from the sequences. Intent the
  user records (Pair / Ignore) is the only thing saved.
- Don't anchor a saved side by bp or helix: anchors count along the oligo so edits that move it
  keep the pair. Don't write `stickyRecords` outside the two commands.
- Don't put a record joining two Parts on either Part: a Part's records travel with links, and its
  anchors carry no `partId`.
- Don't compute matches when nothing shows them; keep the `enabled` gate in `StickyEndMatcher`.
- Don't add a design check for unpaired or ignored sticky ends: having sticky ends that are never
  marked is normal. Only saved pairs are checked.
- Keep `'nearest'` at most one line per instance and side: it is the uncluttered choice for
  large assemblies, where `'all'` grows as n×m lines.
- Don't grow the hovered match in 3D: overlapping sleeves turn into smears. Fade the rest.
