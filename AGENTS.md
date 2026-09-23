# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Use `npm run check` for unit/type/build validation and `npm run test:smoke` for the real-browser smoke test.
- See `README.md` for architecture boundaries, diagnostics, controls, and terrain visibility behavior.
- Pages CI uses software WebGL: `tests/app.smoke.ts` loads the dev-only `?smoke` URL (lower pixel ratio, no shadows) and never waits for a full max-visibility load, so it stays inside the 30s budget.

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
