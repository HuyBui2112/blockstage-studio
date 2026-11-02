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
Editor document Save uses the CAS repository with v7 additive draft stores and revision sidecars; never
restore an unguarded snapshot writer. Save/remove and matching preference changes
are transactional. Tombstoned IDs cannot be reused. Documents provides saved
catalogue/rename/delete, explicit discard and Recovery. Draft protection is separate
from explicit Save; switching protects drafts without promoting them to Saved.
Lifecycle operations lock their workspace; Save alone still permits editing.
Never auto-save pristine placeholders on switch or reuse a component asset ID
as its new working document ID. Library provenance lives in revision metadata.
Committed local revision increases on Undo/Redo; savedRevision is not a storage token.
Draft controller coalesces committed snapshots only (750ms idle / 5s maximum delay).
Never rebase a stale writer to a freshly-read token. Save retires its own stream;
document delete retires all streams atomically. Recovery claims use displayed
epoch/revision and create a fresh stream; conflicting Saved bases require copy.
Recovery copy clears library publication binding. Keep bounded retention without
automatic eviction; report protection failures and retain local edits for retry/JSON.
Documents Storage is a read-only origin health probe except explicit persist()
opt-in. Never request persistence on mount, call quota an exact disk measurement,
or delete user data to resolve quota. Missing API and denied/error remain distinct.
Portable backup v1 contains one document v2, optional component-copy definitions
and ordered resource/profile fingerprints only. Never embed game assets or profile
geometry. Restore reports compatibility first, requires acknowledgement for missing
data, creates fresh IDs and atomically adds document/revision/library/preference.
Never overwrite/treat copies as links or restore a local publication binding
implicitly. Unknown string states are preserved; unsupported fields/payload/versions
are rejected. Keep aggregate input budgets before recursive schemas.
Structure NBT import is a bounded blocks-only 26.2/4903 subset via a cancellable
worker: raw/gzip, registry-validated exact states, complete logical pairs, explicit
air vs sparse omission. Reject entities, block-entity payloads, multiple palettes,
unknown fields/version instead of dropping them. Report stored size vs editor
content bounds and unchanged 48-cell export policy. Confirm creates a new atomic
Saved document after protecting current work; cancel never mutates the document.
Duplicate/clipboard/repeat B01–B03 use shared copy-plan and B08 copy-action session/UI with immutable source
identity plus document/epoch/local revision, stable per-operation nested IDs,
aggregate budgets before expansion and the exact preview candidate on apply.
Keep whole groups/pairs/component copies and provenance; originals stay occupied.
Free entities are not implicitly duplicated. Never bypass stale/cancel/policy
guards or recompute neighbors after the final copy preview. Clipboard v1 is
an independent in-memory, strict 26.2/4903 snapshot with an integer anchor; paste
uses destination base and fresh IDs. Repeat count means NEW copies; signed nonzero
integer spacing is anchor-to-anchor on World axes. Check aggregate multiplied
budget before expansion; reject any collision atomically, never partially repeat.
Copy UI uses a session-owned clipboard and per-operation placement key. Pointer
stages targets; Enter/Confirm commits and Esc/Cancel cancels, with viewport focus
restored. Inputs retain native shortcuts. World-only copy controls must stay
explicit, Preview read-only, and ≤1000px overlays must not cover the copy panel.
B04/B05 primitive-plan supports the B09 primitive UI subset: inclusive axis-aligned line / XY-XZ-YZ anchor
planes and solid/hollow boxes, canonical min corner and stable X-fastest enumeration. Use the verified
Design template with an explicit ID, no RNG or duplicate pair rules. Full logical
footprints may extend out of the anchor plane; reject overlaps instead of skipping
parts. Count occupied cells and objects before expansion. B09 Build uses the selected
block Design state, World start/end fields and pointer-staged end; Enter/Confirm
commits the exact finalized neighbor preview once, Esc/Cancel preserves the document.
Invalidate on document/epoch/revision, scope, palette/catalog, resource or policy
changes; Preview stays read-only. B09 now includes replace/count controls but
has scripted small-room journey evidence. Full house/builder acceptance remains
partial; diagonal/oblique primitives remain unsupported.
Hollow boxes place a one-anchor shell, never carve existing interior content or
fill it with air. Enumerate disjoint caps/perimeters directly, not the full volume;
count with temporary exact arithmetic and bound before expansion. Thin dimensions
1/2 have no interior. A future dimensions UI must reject zero/negative lengths
before corner conversion; reversed/negative coordinate corners remain valid.
Material replacement uses the finite exact-ID contract in core/capabilities.ts:
same declared family and identical complete property domains, preserving every
string property and occupied cell. Tags, suffixes and appearance grant no permission.
Whole selected roots retain pairs/groups/component-copy identity and provenance;
any incompatible match rejects the batch. Preview/commit share the finalized
neighbor candidate and stale/cancel/policy guards. This K02 subset does not close
the release palette/runtime/participant contract or G01 capability registry.
Placed block/state counts are read-only stored-cell counts, with explicit air
separate from non-air; bed/door pairs count two cells, never inferred survival
items. Counts retain unknown string states without requiring assets/profile.
Acquisition mapping, payload replacement and game/world proof remain unsupported.
New logical roots created in active isolation join its membership; Undo prunes
removed IDs and Redo includes restored roots. View controls never change draft
protection/history/revision. Locked owners remain placement surfaces while ray
selection skips to the nearest eligible cell. Protect final neighbor patches too.
Materials targets use one registry index and deduplicated source states. Bound
rendered count rows; exporting counts or changing count scope never edits a document.

Visibility is a finite V01/V02/V04 root-owner session subset: hide/lock/isolate
never change document/history. Locked roots stay drawn and placement surfaces but
are not selectable; eligible cell rays may select behind them. Hidden roots remain
occupied for full collision checks. Reject any final candidate that changes a
hidden, locked or outside-isolate root, including indirect neighbor updates.
Frame uses visible blocks; full export/counts remain document based. Document
Undo/Redo remain available, with selection pruned by policy. Optional inclusive
integer Y range filters cells; only fully contained roots remain selectable/editable.
Partial groups/pairs draw their in-range cells but are protected as whole roots.
Changed/new footprints outside the active Y range are rejected before commit.
Clear Y restores the range only; Reset clears all view flags. Filtering uses cell
coordinates, not mesh clipping; free entities remain visible. Automatic floor/roof
layers and arbitrary clip planes remain unsupported; full K05 remains partial.
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
