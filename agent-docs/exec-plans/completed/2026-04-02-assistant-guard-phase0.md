# Assistant Guard Phase 0

## Goal

Land the first runtime simplification step for assistant turns by stopping the canonical write guard from blocking otherwise-legitimate committed core writes just because the temporary per-process receipt is missing.

## Why now

- The current guard falsely blocks read-only or unrelated turns when a separate legitimate Murph process commits a protected canonical write during a guarded Codex turn.
- The user explicitly prefers the simpler runtime shape and is willing to loosen tamper protection for assistant turns.

## Scope

- `packages/assistant-core/src/assistant/canonical-write-guard.ts`
- Focused guard-result serialization if the blocked-turn contract changes
- Focused regression coverage under CLI assistant tests

## Non-goals

- Full provider/runtime unification
- Removing provider traits, direct CLI workspaces, or provider-native resume
- Reworking the entire assistant tool/runtime surface

## Intended behavior

- A newly committed core write operation that touches protected canonical paths should be treated as authoritative enough for assistant-turn restore/reconciliation, even when the temporary guard receipt is missing.
- Missing guard receipts for those committed operations should become diagnostics rather than turn-fatal authorization failures.
- The guard should still revert unexplained direct protected diffs that cannot be justified by committed core operations.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused assistant-service regression proof for the concurrent committed-write path

## Outcome

- Landed the Phase 0 guard relaxation in `canonical-write-guard.ts` so newly committed protected writes can be preserved from durable metadata even when the temporary per-process receipt copy is missing.
- Added focused assistant-service regression coverage for both a real inbox capture with the temporary receipt copy removed and the intentionally relaxed metadata-only preserved-write case.
- `pnpm typecheck` passed.
- `pnpm test` and `pnpm test:coverage` still fail in pre-existing unrelated lanes: `packages/inboxd/test/idempotency-rebuild.test.ts` (`openInboxRuntime rejects runtime rows missing canonical attachment ids`) and `apps/web/scripts/dev-smoke.ts` (active Next smoke lock/process already present).
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
