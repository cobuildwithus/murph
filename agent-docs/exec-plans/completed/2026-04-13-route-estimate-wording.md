# Clarify Route Estimate Precision Wording

Goal (incl. success criteria):
- Update the route-estimate CLI descriptions and assistant prompt wording so they explain that more specific place text can improve geocoding but does not guarantee a cleaner provider label.
- Keep the change wording-only: no routing behavior changes.
- Land matching test updates so the help/prompt contract is explicit.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits, especially the active local-hosted-dev lane.
- Avoid overstating Mapbox behavior; describe it as a likely improvement, not a guarantee.

Key decisions:
- Clarify both command help and assistant guidance at the source.
- Recommend suburb/state/postcode or coordinates for higher precision.
- Explicitly note that provider display labels can still stay broad even when the routed point is correct.

State:
- in_progress

Done:
- Located the route command definitions and assistant prompt route-estimation text.

Now:
- Patching wording and matching tests.

Next:
- Run targeted verification, required audits, and finish with a scoped commit.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any external docs also mirror this wording and need a follow-up pass later.

Working set (files/ids/commands):
- `packages/cli/src/commands/route.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/cli/test/incur-smoke.test.ts`
- `packages/assistant-engine/test/system-prompt.test.ts`
- `pnpm typecheck`
- `pnpm test:diff ...`
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
