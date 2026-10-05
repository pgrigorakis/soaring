# Project agent memory

This file holds the engine invariants established by #95 and points agents to related project guidance.

- See `README.md` for user controls and terrain visibility; see `docs/testing.md` for validation commands, test modes, capture guidance, and CI browser behavior.

## Engine invariants

- Keep navigation and world placement in world coordinates; rebase only the rendered scene and camera, so long flights do not alter simulation positions or procedural terrain.
- Derive terrain colour from world samples and coordinates, so adjacent chunks have matching shared edges.
- Choose biomes with temperature cooled by the broad continental plate, not the final height, so ridges and summits do not cut biomes into specks.
- Keep continental terrain height independent of biome profiles; sample water at common sea level and interpolate shore depth on the ground level's triangles.
- Publish every ground level around one centre snapped to the coarsest spacing, and keep inward skirts on coarser holes, so level joins never expose gaps or cracks.
- Derive fog coverage from displayed ground levels only, so pending water or tree tiles never hide land that is already drawn.
- Exclude water from thermal placement, so lift sites remain on land.
- Keep thermal sun-facing placement on a fixed azimuth, so thermal sites do not drift as the sky sun moves.
- Keep both directional lights dark at the horizon, so switching the shadow caster does not pop.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `pgrigorakis/soaring`, used through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five-label set: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` plus `docs/adr/`, both created only when needed. See `docs/agents/domain.md`.
