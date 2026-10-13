---
covers:
  - src/routes/+page.svelte
  - src/routes/+page.server.ts
  - src/lib/components/landing/**
  - src/lib/assets/landing/**
  - static/hero-design.json
  - src/lib/components/AlphaAccessGate.svelte
---

# Landing Page (`/`)

The root route is the marketing/landing page for Foldnano, behind the optional beta access
gate (off when `ALPHA_ACCESS_CODE` is unset; see `docs/routes-guide.md` § Access gate). It routes visitors to `/editor` (primary) and `/docs` (secondary), and
previews a real design in an interactive 3D hero.

## Files

| File                                           | Role                                                                                                                                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/+page.svelte`                      | The whole page: header, hero, feature card grid, build-on band, footer. Feature cards are data-driven (`features` array). Wrapped in `AlphaAccessGate` (`src/lib/components/AlphaAccessGate.svelte`).                               |
| `src/routes/+page.server.ts`                   | `export { alphaAccessLoad as load }` (`src/lib/server/alphaAccessLoad.ts`) — server load checking the alpha-access cookie via `hasAlphaAccess`; the page is server-rendered per request, not prerendered.                           |
| `src/lib/components/landing/Hero3D.svelte`     | Hero visual: static illustration that cross-fades into a lazily-loaded interactive 3D canvas.                                                                                                                                       |
| `src/lib/components/landing/hero3dViewer.ts`   | The Three.js scene (only ever reached via dynamic `import()`).                                                                                                                                                                      |
| `src/lib/assets/landing/hero-illustration.svg` | Design-agnostic abstract lattice illustration, shown before the 3D loads and kept permanently on reduced-motion / small touch devices. Not a render of the featured design, so it never needs regenerating when the design changes. |
| `static/hero-design.json`                      | The featured design rendered in the hero (cadnano or foldnano JSON).                                                                                                                                                                |

## The 3D hero

- `Hero3D.svelte` renders the static illustration `<img>` immediately (it is the LCP), then
  after `requestIdleCallback` dynamically imports `hero3dViewer.ts`, which fetches
  `static/hero-design.json`, builds geometry with the editor's `buildScene()`
  (`src/lib/components/Editor/View3D/helixGeometry.ts`), and cross-fades the canvas in. A
  small spinner overlays the illustration while the 3D loads (`interactive && !ready`).
- Interaction: drag-to-rotate (OrbitControls) with slow auto-rotate that stops on first
  grab. Zoom and pan are disabled so page scroll is never hijacked.
- Skipped entirely (illustration only, no spinner) under `prefers-reduced-motion` and on
  `< md` touch devices.
- The viewer strips editor scaffolding: VH index label sprites and ghost VH cylinders are
  removed from the built scene.
- **Design-agnostic recoloring:** whatever colors the design file carries are discarded.
  All strand/crossover line batches are remapped to `STRAND_PALETTE` in
  `hero3dViewer.ts`, heaviest batch first (usually the scaffold → primary page blue), so
  any featured design matches the landing theme.
- Camera framing is adaptive: it looks roughly down the structure's shortest bounding-box
  axis and fits the larger two extents, so compact and elongated designs both frame
  reasonably. In `fill` mode the projection is view-offset so the structure sits right of
  centre, leaving room for the frosted hero text panel on the left.
- **Pinned stage + scroll-over (md+):** the 3D stage is `position: sticky`; the hero text
  panel and the frosted feature cards scroll up over it (content layer uses
  `pointer-events-none` with `pointer-events-auto` on panels/cards, so drags pass through
  the gaps). An IntersectionObserver on `#features` suspends the hero (stops the render
  loop, auto-rotate, and dragging) while cards overlay it and resumes — spinning again —
  when the user scrolls back up. On `< md` the page is a plain stacked flow.

## Swapping the featured design

1. Replace `static/hero-design.json` with any cadnano (`{name, vstrands}`) or foldnano
   (`{id, name, parts}`) design file. The loader auto-detects the format; foldnano files go
   through `migrateDocumentJson()`, so an older format version is upgraded and a newer one fails
   to load (the static illustration stays).
2. Nothing else to regenerate — `hero-illustration.svg` is a generic abstract lattice, not
   a render of this specific design, so it stays put across design swaps.
3. Dev-only preview: `/?design=/some/path.json` overrides the featured design (same-origin
   paths only; disabled in production builds).

Note: there is no `og:image` on this page. Social unfurlers get no preview image (title/
description only) — deliberate, to avoid maintaining a static render of a live 3D scene.

## Theming

The page follows the app's `.dark` class (ModeWatcher, root layout) but with its own
brand palette, not the editor's semantic tokens — colors are fixed `--landing-*` custom
properties scoped to the `.landing` root in `+page.svelte` (`bg-background` etc. are
deliberately not used here), with a `:global(.dark) .landing { ... }` override block
supplying the dark values. `.glass-panel` / `.glass-card` (bespoke to this page, not the
shared `glass-paper` utility) have their own matching dark overrides. `hero3dViewer.ts`'s
`STRAND_PALETTE` and the static hero illustration SVG (`hero-illustration.svg`) are not
theme-aware — both read acceptably on either background as-is, so there's no dark variant
for either. Fonts are the app's existing Nunito Sans (body/headline) and JetBrains Mono
(`font-heading`, used for eyebrow text and technical chips).

## Boundaries / Don'ts

- **No editor bundle in the initial route JS.** Three.js and the model layer may only be
  reached through the dynamic `import()` in `Hero3D.svelte`. Konva and Pyodide must never
  be imported from landing code at all. After touching landing code, verify: build, then
  check that no `/_app/immutable/...` chunk referenced by the prerendered
  `index.html` contains Three/Konva/Pyodide.
- The page is server-rendered (not prerendered) solely to gate on the alpha-access
  cookie via `+page.server.ts`. Keep it that way even while the gate is switched off, so
  turning it back on is only an environment change. Don't add IndexedDB/storage access or other session
  state to the page itself — the load function's only job is the access check.
- Don't link `/toc` from the landing page — it is an editor-facing page for advanced
  users, reachable from inside the editor.
- The GitHub URL is a single `GITHUB_URL` constant in `+page.svelte` — don't hardcode it
  elsewhere on the page.
- RBS/editor invariants don't apply here, but the reverse does: don't import landing
  modules from editor code.
