# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Use `npm run check` for unit/type/build validation and `npm run test:smoke` for the real-browser smoke test.
- See `README.md` for architecture boundaries, diagnostics, controls, and terrain visibility behavior.
- Pages CI uses software WebGL: `tests/app.smoke.ts` loads the dev-only `?smoke` URL (lower pixel ratio, no shadows) and checks bounded progress instead of waiting for a full max-visibility load.

## Engine invariants

- Keep navigation and world placement in world coordinates; rebase only the rendered scene and camera, so long flights do not alter simulation positions or procedural terrain.
- Derive terrain colour from world samples and coordinates, so adjacent chunks have matching shared edges.
- Use blended biome-profile elevations for drainage before river carving, so river paths follow the visible landform without feeding carved heights back into terrain selection.
- Align coarse terrain tiles to fine-grid boundaries and keep skirts on non-nearest tiles, so streamed mesh transitions do not expose gaps or seams.
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
