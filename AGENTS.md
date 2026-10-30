# Blockstage Studio — agent working agreement

## Read first and resolve authority

- Read this file, `README.md`, and the current implementation before editing.
- The canonical documents, in reading order, are `docs/01_PRODUCT_GOALS.md`,
  `docs/02_TECHNICAL_DESIGN.md`, and `docs/03_STATUS_AND_ROADMAP.md`.
- Product goals describe the destination; technical design describes current
  contracts; status/roadmap describes evidence, gaps, dependencies and acceptance.
- The user's current request sets scope. A roadmap entry is a proposal, not an
  instruction to implement every milestone or make commits.
- Distinguish implemented behavior, proposed design, public-source facts, and
  unverified game behavior. Inspect source and tests before repeating old reports.
- Keep these three documents current instead of adding overlapping milestone
  reports. Preserve useful sources and verification limits when consolidating.
- User-reported issue intake is in `docs/04_CURRENT_ISSUES.md`. Read relevant
  entries before fixes; separate observations, hypotheses and verified causes.
  This appendix links to the canonical roadmap rather than replacing it.

## Current milestone and product direction

Blockstage is a local-first, block-native architectural CAD tool for Minecraft Java.
The implemented foundation includes resources, Architecture/Component editors,
read-only Preview, logical multi-block objects, grid-safe transforms, groups,
independent reusable component copies, atomic undo/redo, v2 NBT/datapack export,
Design/Context placement, component yaw previews and bounded support diagnostics.
See `docs/02_TECHNICAL_DESIGN.md` for exact contracts and
`docs/03_STATUS_AND_ROADMAP.md` for evidence and remaining gates. Preview and
commit must use the same pure placement plan; warnings are not world simulation.
Editor click selection uses nearest non-air occupied cells, not mesh triangles.
Placement keeps mesh surfaces except explicit chain cell-face targeting. Lantern
Context is vertical-face only; dry vanilla/soul support diagnostics are finite.
Bulk state editing uses all selected logical leaves, shared legal values and
bounded cross-ID semantics. Groups/components never flatten implicitly; Mixed
is distinct from false. Validate final batch footprints and commit one undo step.
Auto connections are opt-in per session/workspace, off after reload. Use generated
26.2 neighbor predicates; dynamic/missing shapes preserve explicit states with a
reason. Preview and commit share the planner, and undo includes affected neighbors.
Banner base-color/static pose and inactive conduit are partial special renderers;
do not claim banner patterns, cloth animation, active conduit or payload export.
Documentation is consolidated; future implementation starts from a user-authorized
slice. Do not treat the proposed next slice as already active.

- Reuse the existing React/TypeScript/Three.js base and verified asset pipeline.
- Keep existing project data and import/export/domain code intact during changes.
  Do not silently migrate, delete, or overwrite user projects.
- Do not expose fake transforms or inactive controls. Preview must stay isolated
  from committed data and each placement/transform/group action must be atomic.
- Kits, sockets, physics, extra schematic formats, cloud, AI, desktop packaging,
  and a Fabric bridge remain outside the current editor milestone.

## Data contracts

- Minecraft Java **26.2 / DataVersion 4903** is the supported game profile.
- Coordinates: **+Y up, +X east, +Z south**. A block occupies integer cell `(x,y,z)`;
  its render center is `(x+.5,y+.5,z+.5)`. One unit is one block.
- Block IDs and legal string properties from the versioned game profile are the
  source of truth. Runtime numeric state IDs, textures, and meshes are not.
- Keep registry data, asset packs, blockstates, block-entity payloads, and world
  behavior separate. A resource pack override must not change document blockstates.
- Tags and creative tabs are browsing facets, not proof of safe material substitution.
- Never silently drop unknown properties or NBT. Unsupported rendering needs a
  visible fallback/reason; a registry entry does not imply render/export support.
- Only the existing static bindings are supported for entities; do not claim
  animation, equipment, arbitrary variants, or game simulation.
- Assets are user-supplied. Never commit or ship Mojang JARs, extracted textures,
  generated game profiles, private worlds, or browser storage.

## Architecture and performance

- Keep pure domain logic in `src/core`, import/persistence in `src/io`, resource
  orchestration in `src/resources`, UI in `src/ui`, and GPU work in `src/viewport`
  and `src/render`. React components must not parse archives or implement game rules.
- Preview/session state is separate from saved projects. Choosing an asset, changing
  a pack, or moving the camera must not mutate a project or its history.
- Resolve enabled packs by an explicit, deterministic precedence. Use one shared
  effective asset index; avoid sorting/scanning all packs for every texture lookup.
- Parse archives in a worker, validate external input, bound memory/work, persist
  successfully before publishing changes, and recover from storage/import failures.
- Reuse GPU objects across unchanged content; dispose textures, geometry, materials,
  URLs, listeners, workers, and animation frames at their ownership boundary.
- Render on demand; continuous frames are justified by navigation/animation only.
  Avoid React updates and scene rebuilds for unchanged hover/diagnostic values.
- Measure before adding complexity or dependencies. CPU flatten time and software
  browser smoke are not evidence of real GPU FPS or million-block performance.

## UI and interaction standards

- The 3D viewport is primary. Use restrained dark surfaces, intentional spacing,
  legible typography, a consistent icon system, and a small accent palette.
- Keep the permanent UI quiet: concise labels, useful counts, clear selection,
  contextual controls. Put explanations in tooltips, help, or expandable details;
  avoid repeated paragraphs, raw JSON forms, and walls of diagnostics.
- Use accessible names for icon buttons, visible keyboard focus, native semantics,
  responsive panels, explicit loading/empty/error states, and adequate contrast.
- Show real previews when available; do not disguise random color swatches as
  accurate Minecraft textures. Mark partial/unsupported appearances honestly.
- Navigation is Blender-inspired: MMB orbit, Shift+MMB pan, Ctrl+MMB/wheel zoom,
  Home frame all, numpad views/projection, Shift+grave fly. Provide on-screen
  alternatives. Minecraft Y is vertical even though Blender usually uses Z-up.
- Route input by focus and interaction state. Do not intercept typing in fields.
  Camera/view state is independent of the document and asset selection.
- Future editing: `G` move, `R` legal rotation, `S` resize/repeat (never float voxel
  scaling); isolated preview, explicit atomic commit, cancel without mutation,
  one undo action, collision rejection by default, legal per-family adapters.
- Group rotations must transform cell positions and states together. Use doubled
  integer pivots (`pivot2`) and reject incompatible parity instead of rounding away
  errors. Clockwise yaw maps north to east and `(x,z)` to `(-z,x)` about the pivot.
- Design placement, player-like placement, and neighbor/world updates are different
  policies. Game-exact claims require fixtures from the matching game/runtime.

## Development and collaboration

- Use Windows-native tools. Inspect `.node-version`, `package.json`, and the lockfile;
  reuse Node **24.19.0**, pnpm **11.20.0**, and existing Java/mise configuration.
- Prefer PowerShell 7 when executable; do not change system settings to obtain it.
  `fnm exec --using 24.19.0 pnpm.cmd <script>` works with the installed toolchain.
- Inspect Git status/diff, preserve unrelated changes, add no global dependencies,
  and never reset, commit, push, publish, or rewrite history without user instruction.
- The user authorizes subagents for this work. Delegate bounded independent tasks
  with explicit file ownership. Use economical models for mechanical checks/docs
  and stronger models for rendering/data correctness. Avoid duplicate exploration.
- Write/read this agreement before delegating implementation. Share contract changes
  with other agents and review their diffs before integration.

## Validation and reporting

- Use `pnpm typecheck`, `pnpm lint`, targeted tests, and `pnpm build` as appropriate;
  `pnpm check` is the existing complete code gate. Keep meaningful regression tests.
- Run the matching native-browser smoke for resource import, actual 3D appearance,
  pack precedence/toggling/removal, persistence/reload, and keyboard/mouse navigation.
- Test failed/unsupported imports and absence of assets/profile. Verify the production
  output does not contain game assets. Inspect screenshots for layout and readability.
- State exactly what passed, what remains partial/unverified, and how to reproduce.
  Update current implementation docs; do not turn research hypotheses into claims.
- A future game placement/export claim requires a Minecraft 26.2 world readback;
  loading NBT with game classes alone is useful evidence but does not meet that gate.
