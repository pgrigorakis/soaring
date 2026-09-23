# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Use `npm run check` for unit/type/build validation and `npm run test:smoke` for the real-browser smoke test.
- See `README.md` for architecture boundaries, diagnostics, controls, and quality behavior.
- Pages CI uses software WebGL: the heavy smoke path in `tests/app.smoke.ts` boots the supported low quality preset so streaming + camera-drag stay inside the 30s budget.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.