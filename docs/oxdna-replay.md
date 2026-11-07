---
covers:
  - src/lib/model/oxdnaReplay/**
  - src/lib/components/Editor/View3D/replay/**
  - src/lib/components/Editor/ToolPanel/OxDnaReplayPanel.svelte
---

# oxDNA Trajectory Replay

The 3D view can replay an oxDNA trajectory simulated from **Foldnano's own oxDNA export**, drawn
over the design and coloured by oligo, so a strand's behaviour in simulation can be traced back to
the strand in the design. It is the import direction of `docs/oxdna-export.md`.

Everything is **session-only and render-only**: no frame, pose or mapping is written to the part,
history or storage. The user drops the `.dat` and `.top` again to replay after a reload.

Built so far: loading, mapping, playback, the mean structure, and linking between the replay and
the strand view. Per-strand analysis (flexibility, base-pair occupancy, crossover strain, bend)
shown in the 2D strand view is planned on top of the same mapping.

---

## Row → design mapping

The exporter writes rows in the order of `buildSimulationNtModel(part, { includeMirrors })`, and
each `SimulationNucleotide` carries its design identity (`segmentId`, `vhId`, `bpIndex`, `pairKey`…).
So the mapping is the NT model rebuilt on the current design; nothing is stored at export time.

`matchTopologyToDesign` (`replayMapping.ts`) validates that rebuild against the `.top` row by row:
nucleotide and strand counts, strand id, `next`/`prev` links, and the base wherever the design
assigns one (unassigned bases were a fallback, possibly random). It tries `includeMirrors: false`
first (the export default), then `true` if the part has mirrors. Any mismatch refuses the replay
with the first differing row; there is deliberately no fuzzy matching or support for trajectories
from other tools.

After loading, `OxDnaReplay` keeps `computeSimulationFreshnessSignature(part)`; when an edit changes
it, the 3D view hides the replay and the panel says the nucleotides no longer line up.

---

## Pipeline

```text
.top ──parseOxDnaTopology──► matchTopologyToDesign ──► ReplayMapping ──► buildReplayReference
.dat ──worker: scanFrameStarts (index) ─► parseOxDnaFrame (on demand) ─► OxDnaFrame (raw, ox units)
                                                                            │
                                     poseFrame(frame, reference, { alignToDesign }) ─► PosedFrame (nm)
                                                                            │
                                                     replayGeometry.update(pose) (in-place buffers)
```

- **Worker** (`oxdnaReplayWorker.ts`) owns the `File`. One pass over 8 MB `File.slice` chunks
  records the byte offset of each `t = …` header; frames are then parsed on request (r, a1, a3;
  velocities dropped) and transferred back. The trajectory is never read whole: an 8k-bp origami
  trajectory is gigabytes.
- **Interrupted runs.** A crashed or restarted oxDNA run can leave NUL padding where unflushed
  frames were, or a partly written row, with the next header on the same line. `scanFrameStarts`
  therefore treats every `t` followed by a space or `=` as a header (rows hold only numbers;
  `Infinity` is excluded), `parseOxDnaFrame` drops NUL bytes, and a frame cut off mid-row fails
  to parse. Such a frame is not fatal: the worker answers `frameError`, `OxDnaReplay.badFrames`
  records it, playback passes over it, and the mean-structure pass leaves it out and reports how
  many it skipped.
- **`OxDnaReplay`** (`OxDnaReplay.svelte.ts`) holds the playback state, a small LRU of raw frames
  plus prefetch ahead of the play head, and the shown `pose`. Playback only advances once the
  current frame has been shown.
- **Posing** (`framePose.ts`): `unwrapStrandsInPlace` undoes periodic-box shifts by walking the
  strand graph from the longest strand along base pairs (strands without pairs go to the nearest
  image of that anchor); then each frame is rigid-fit onto the design CM positions (Horn's
  quaternion method), or only centroid-matched with **Align to design** off. Sites follow oxDNA:
  backbone `r − 0.4·a1`, base `r + 0.4·a1`.
- **Geometry** (`replayGeometry.ts`): an instanced sphere per backbone site, backbone bonds and
  base sticks as `LineSegments2`. Built once per loaded trajectory; each frame rewrites the instance
  matrices and the interleaved line buffers in place.
- **Mean structure** (`meanStructure.ts`): the worker poses every frame with alignment on and
  averages the sites (`MeanStructureAccumulator`), one pass, interleaved with frame requests so
  playback keeps working; it can be cancelled. Because each frame is already fit onto the design,
  the mean is in the design's frame without re-aligning to the mean. `OxDnaReplay.displayPose` is
  the mean while **Show mean structure** is on, else the current frame; playing, stepping or
  scrubbing switches back to frames.

## Linking with the strand view

- **Hover**: `pickNucleotide` tests the pointer ray against every backbone site (cheaper than
  raycasting thousands of instanced spheres) and sets `OxDnaReplay.hoveredRow`. The hovered sphere
  is enlarged, and the panel names its oligo, helix, base and position from the 5′ end.
- **Click** selects the hovered nucleotide's oligo (`strandViewContext.selected`; Shift/⌘/Ctrl
  adds) and scrolls the strand view there (`strandToolbarController.centerOn`).
- **Strand-view selection → replay**: fully selected segments (`focusedSegments`, as for the design
  geometry) keep their colour; every other nucleotide is faded toward the background.
- **Show only selected strands** (and its **Lock**): the toolbar's `filterSegments` reaches the
  replay too. `View3D` turns it into a per-row mask and calls `ReplayGeometry.setVisible`, which
  shrinks hidden spheres to zero and packs the shown bonds and base sticks at the front of their
  buffers (`instanceCount` cuts off the rest; a bond needs both ends shown). `pickNucleotide` skips
  hidden rows, so hover and click only reach what is drawn.

## Wiring

- `View3DToolbarController.replay` holds one `OxDnaReplay` per part (created by `HelixViewer`,
  disposed on part change); `toolPanelMode === 'replay'` is the **Replay oxDNA** mode.
- `View3D` draws the replay only in that mode and hides the design meanwhile unless **Show design
  underneath** is on. Leaving the mode pauses playback; the loaded trajectory stays for the session.
- `OxDnaReplayPanel.svelte` is the tool panel: drop zone (`.dat` and `.top`, together or one at a
  time), timeline, speed, loop, display toggles, mean structure, and the hovered-nucleotide card.
- **Time readout**: a frame header's `t` is the MD step, not oxDNA time. Real time needs the run's
  `dt`, which only its oxDNA input file holds (the export writes no input file), so the panel asks
  for it (`OxDnaReplay.dt`, default `DEFAULT_OXDNA_DT`) and shows step × dt × 3.03 ps
  (`oxdnaTime.ts`).

## Video export

**Export MP4** in the panel renders frames one at a time, not by recording the screen, so the
video has an exact frame rate and no dropped frames, however slowly a large frame reads.

- `View3D` exposes `replayFrameRendererFn` (→ `View3DToolbarController.onCreateReplayFrameRenderer`):
  an offscreen `WebGLRenderer` at the chosen size, drawing the same scene with a clone of the camera
  taken when the export starts (`fitVerticalFovDeg` widens it for a narrower frame instead of
  cropping). So everything shown is kept: strand filter and lock, fading, colours, design
  underneath. Hover enlargement is off while exporting; `dispose()` puts the shown pose back.
- `OxDnaReplay.exportVideo` pauses playback, awaits each frame from the worker (`_loadFrame`,
  reading a few ahead), poses it as the replay does, and hands it to `encodeReplayVideo`
  (`replayVideoExport.ts`), which draws it with an optional step/time caption onto a 2D canvas and
  encodes it with Mediabunny (`CanvasSource`, `Mp4OutputFormat`). Unreadable frames are left out.
- The codec is the first of H.264, HEVC, VP9, AV1 the browser's WebCodecs `VideoEncoder` can
  encode at that size; without one, export reports that the browser cannot.
- Mediabunny is imported dynamically on first export, keeping it out of the editor bundle.

---

## Boundaries / Don'ts

- **Don't persist anything from a replay.** Frames, poses and the mapping are render-only, like RBS
  overrides; never feed them into `part`, history or storage.
- **Don't map rows any other way than rebuilding the export's NT model.** If the exporter's row
  order changes, this mapping changes with it; keep `matchTopologyToDesign` strict.
- **Don't let one unreadable frame stop the replay.** Parse errors (`OxDnaTrajectoryParseError`)
  are per frame; only I/O or worker failures end the replay.
- **Don't read the trajectory on the main thread or whole.** Index once in the worker; parse frames
  on demand.
- **Don't raycast the instanced spheres for picking.** Use `pickNucleotide` over the posed sites;
  the instanced mesh's bounding volumes are not kept up to date per frame.
- **Don't record the screen for video export.** Render each frame offscreen and encode it at a fixed
  timestamp; a recording drops frames whenever reading or drawing a frame takes longer than one frame.
- **Don't rebuild replay geometry per frame.** `update(pose)` rewrites buffers in place; a rebuild
  per frame leaks GPU buffers and stalls playback.
