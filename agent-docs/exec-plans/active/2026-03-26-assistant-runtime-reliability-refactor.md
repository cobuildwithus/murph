# 2026-03-26 Assistant runtime reliability refactor

## Goal

Land the reviewed assistant reliability fixes and finish the highest-value follow-on refactors in the same assistant-runtime slice:

1. patch the confirmed correctness bugs around deferred delivery, failover cooldown visibility, status filtering, and manual receipt clobbering
2. rebuild failover execution so each provider route derives its own provider-specific turn plan instead of reusing the primary-provider plan
3. serialize assistant runtime state mutations under one shared write lock for receipts, outbox intents, diagnostics, failover state, and status snapshots
4. simplify the failover schema by removing dead `maxAttempts` configuration instead of keeping an unused policy field
5. unify manual/assistant delivery receipt fallback behavior enough to keep outbox-backed receipt state authoritative

## Constraints

- Keep `assistant-state/` file-backed and non-canonical.
- Preserve the existing provider/session model and avoid widening assistant-side canonical write authority.
- Do not revert unrelated in-flight assistant edits in the dirty tree.
- Keep lock scope explicit and narrow to assistant runtime state; do not silently broaden it into all assistant session/transcript writes unless required by a concrete race uncovered during implementation.
- Update architecture/process docs anywhere the concurrency or failover model changes materially.

## Planned shape

- Add a shared assistant-runtime write lock wrapper on top of the existing assistant state lock helper pattern.
- Route receipt, outbox, diagnostics, failover, and status snapshot read-modify-write paths through that shared lock.
- Split assistant turn planning into shared turn inputs plus per-route execution context derived for each route attempt.
- Remove `maxAttempts` from the assistant failover route schema and normalization helpers.
- Preserve the reviewed focused tests and extend them where the refactors change behavior boundaries.

## Risks

1. Rebuilding per-route planning could accidentally change first-turn bootstrap/onboarding behavior.
   Mitigation: keep shared bootstrap decisions separate from provider-specific prompt/capability derivation and pin with focused failover tests.
2. Adding a shared runtime write lock could deadlock nested helpers or hide stale state bugs.
   Mitigation: build on the existing reentrant lock helper pattern and add focused serialization coverage around outbox creation/receipt updates.
3. Removing `maxAttempts` could break config parsing/tests that still mention it.
   Mitigation: update the schema, defaults, and focused tests/docs in the same change.

## Verification

- Focused:
  - `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-channel.test.ts packages/cli/test/assistant-observability.test.ts packages/cli/test/assistant-robustness.test.ts packages/cli/test/assistant-state.test.ts --no-coverage --maxWorkers 1`
- Required:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Outcome

- Applied the reviewed assistant reliability fixes, including deferred auto-reply artifacts/cursor advancement, cooldown precedence, status session filtering, expired cooldown suppression, same-process run-lock metadata, and manual delivery receipt preservation.
- Reworked assistant failover execution so each attempted route derives its own provider-specific execution context, including transcript replay and direct-CLI/MCP capability handling.
- Added a shared assistant-runtime write lock and routed receipt/outbox/diagnostics/failover/status mutations through it.
- Removed dead assistant failover `maxAttempts` config from the runtime schema.

## Verification results

- Focused assistant runtime tests passed:
  - `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-channel.test.ts packages/cli/test/assistant-observability.test.ts packages/cli/test/assistant-robustness.test.ts packages/cli/test/assistant-state.test.ts --no-coverage --maxWorkers 1`
- Required checks:
  - `pnpm typecheck` ✅
  - `pnpm test` ❌ unrelated pre-existing failure in `packages/cli/test/canonical-write-lock.test.ts` because the spawned child process imports `packages/core/dist/constants.js` and then fails to resolve `@healthybob/contracts/dist/index.js` under `packages/core/node_modules`
  - `pnpm test:coverage` ✅
- Direct scenario evidence:
  - Seeded one older session plus 55 newer receipts, then ran the built CLI command `node packages/cli/dist/bin.js assistant status --vault <tmp> --session <older-session-id> --format json`; the output still returned the older session receipt, proving the session-filter scan no longer truncates at the newest 50 global receipts.
