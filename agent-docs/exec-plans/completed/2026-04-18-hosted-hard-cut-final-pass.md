## Goal

Finish the remaining hosted hard-cut cleanup so the live hosted path is as close as possible to the wake-first end state described in the canonical HostedWake cutover guide.

Success criteria:

- remove small and medium remaining legacy surface on the live hosted path
- push the larger remaining refactors forward on disjoint seams without reopening already-landed wake-first boundaries
- keep web as canonical wake/cursor owner
- keep Cloudflare moving toward a thinner lease/alarm/run shim
- keep runtime wake-first terminology and execution flow aligned with the current architecture

## Constraints / Assumptions

- Preserve unrelated in-flight worktree edits.
- Treat the current repo state, not stale audits, as the source of truth.
- Prefer deletion and renaming of legacy compatibility surface over new abstraction.
- Do not reintroduce dispatch-shaped append/status boundaries.
- Stay careful around overlapping in-flight assistant-runtime and apps/web lanes already registered in the coordination ledger.

## Scope

Primary seams:

1. `packages/assistant-runtime`
2. `apps/cloudflare`
3. `apps/web` hosted webhook receipt / wake paths
4. `packages/hosted-execution` and adjacent docs / observability naming cleanup

## Expected verification

- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-runtime test:coverage`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/hosted-execution test:coverage`
- truthful `apps/web` and `apps/cloudflare` verification for the touched slices, likely `pnpm --dir apps/cloudflare verify` plus either `pnpm test:diff ...` or `pnpm --dir apps/web verify` depending on final scope
- required `coverage-write`
- required `task-finish-review`

## Notes

- The canonical external wake append boundary is already wake-native; do not reopen that path.
- Prioritize real production residue over naming-only or test-only residue.
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
