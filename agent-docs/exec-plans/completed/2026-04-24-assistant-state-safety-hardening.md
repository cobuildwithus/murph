# Assistant state safety hardening

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Fix the reported assistant runtime state safety gaps around secret sidecars, portable failover/receipt/outbox redaction, redaction field-name coverage, session write consistency, outbox/receipt repairability, transcript write locking, and failover route ids.

## Success criteria

- Session secret sidecars fail closed when their embedded `sessionId` does not match the requested session and merge callers cannot bypass that invariant.
- Portable failover, receipt, and outbox records persist only bounded sanitized error/message/metadata summaries.
- Structured redaction catches common non-header secret field names in nested data.
- Session sidecar updates are staged so the previous committed pair is not removed before the redacted session write succeeds.
- Outbox dedupe paths repair missing receipt linkage/final state after earlier partial writes.
- Transcript appends serialize through the shared assistant runtime write lock.
- Failover route ids no longer hash secret-bearing custom header values.
- Focused regressions cover the reported secret, redaction, partial-write, locking, and route-id behaviors.

## Scope

- `packages/assistant-engine/src/assistant/{state-secrets,failover,turns,redaction,store}.ts`
- `packages/assistant-engine/src/assistant/store/persistence.ts`
- `packages/assistant-engine/src/assistant/outbox/dispatch-state.ts`
- directly coupled `packages/assistant-engine/test/**`
- directly coupled `packages/cli/test/assistant-state.test.ts` expectation for malformed sidecar quarantine on an OpenAI-compatible session
- `packages/operator-config/src/assistant/redaction.ts` and `packages/operator-config/src/assistant-cli-contracts.ts` only if directly required
- `packages/runtime-state/src/assistant-local-state-descriptors.ts` only if directly required
- this plan plus `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Preserve unrelated dirty-tree edits.
- Existing active rows already mention `failover.ts` and `store/persistence.ts`; keep this lane limited to persisted-state safety and coordinate through the ledger.
- Do not introduce new persisted state classes or dependency changes.
- Keep portable records compact and inspectable without retaining raw provider/delivery payloads.
- If exact-task commit staging would absorb unrelated dirty work, close the plan safely and report the blocker.

## Risks and mitigations

1. Risk: Failover or outbox behavior changes can break replay/idempotency.
   Mitigation: Keep public state shape compatible where possible and add focused repair/regression tests.
2. Risk: Sanitizers can over-redact useful status data.
   Mitigation: Preserve error codes, families, event types, and scalar keys while redacting sensitive values and capping free text.
3. Risk: Atomic write changes can introduce stale sidecars.
   Mitigation: Validate sidecar `sessionId` on read/merge and stage sidecar promotion after the main session write succeeds.

## Tasks

1. Inspect current persistence helpers and relevant tests.
2. Implement narrow helpers for sidecar identity validation and portable assistant-state sanitization.
3. Stage session sidecar writes around the main session write.
4. Make outbox dedupe/transition paths repair receipts.
5. Lock transcript appends through the shared assistant runtime write lock.
6. Add regression tests for all reported cases.
7. Run focused checks, required audits, and close the plan.

## Decisions

- Use a shared assistant portable-state sanitizer for failover, receipt, and outbox persisted error/detail/metadata fields rather than adding per-callsite redaction regexes.
- Treat session secret sidecar `updatedAt` as part of the committed session/sidecar identity pair so stale sidecars fail closed after partial writes.
- Centralize outbox receipt repair in `assistant/outbox/receipt-repair.ts` so dedupe and dispatch transitions share the same persisted timeline/disposition behavior.
- Include non-sensitive custom header values in failover route identity while still excluding sensitive header values.
- Keep receipt repair timestamps monotonic when reconciling older outbox intents against newer receipts.
- Sanitize failover persisted error codes and receipt metadata keys, not only messages and metadata values.
- Dedupe receipt timeline repair events by transition identity so queued/sent repairs stay idempotent while repeat attempts/retries/failures remain visible.
- Validate secret sidecars only for sessions that can consume them; non-OpenAI sessions tolerate stale leftover sidecars from failed cleanup.

## Verification

- PASS: `pnpm --dir packages/assistant-engine exec vitest run test/assistant-state-secrets.test.ts test/assistant-store-persistence.test.ts test/redaction.test.ts test/turn-receipt-redaction.test.ts test/failover.test.ts test/outbox-dispatch-state.test.ts test/assistant-outbox-runtime.test.ts test/assistant-runtime-locking.test.ts --config vitest.config.ts --no-coverage` (8 files, 72 tests)
- PASS: `pnpm --dir packages/assistant-engine exec vitest run test/assistant-state-secrets.test.ts test/assistant-store-persistence.test.ts test/redaction.test.ts test/turn-receipt-redaction.test.ts test/failover.test.ts test/outbox-dispatch-state.test.ts test/assistant-outbox-runtime.test.ts test/assistant-runtime-locking.test.ts --config vitest.config.ts --no-coverage` after final audit fixes (8 files, 73 tests)
- PASS: `pnpm --dir packages/assistant-engine exec vitest run test/failover.test.ts test/assistant-outbox-runtime.test.ts test/outbox-dispatch-state.test.ts --config vitest.config.ts --no-coverage` (3 files, 36 tests)
- PASS: `pnpm --dir packages/assistant-engine exec vitest run test/failover.test.ts test/turn-receipt-redaction.test.ts --config vitest.config.ts --no-coverage` after the second final-audit fixes (2 files, 11 tests)
- PASS: `pnpm --dir packages/assistant-engine exec vitest run test/assistant-state-secrets.test.ts test/assistant-store-persistence.test.ts test/redaction.test.ts test/turn-receipt-redaction.test.ts test/failover.test.ts test/outbox-dispatch-state.test.ts test/assistant-outbox-runtime.test.ts test/assistant-runtime-locking.test.ts --config vitest.config.ts --no-coverage` after the second final-audit fixes (8 files, 73 tests)
- PASS: `pnpm --dir packages/assistant-engine exec vitest run test/outbox-dispatch-state.test.ts --config vitest.config.ts --no-coverage` after repeat-transition receipt repair fix (1 file, 10 tests)
- PASS: `pnpm --dir packages/assistant-engine exec vitest run test/assistant-state-secrets.test.ts test/assistant-store-persistence.test.ts test/redaction.test.ts test/turn-receipt-redaction.test.ts test/failover.test.ts test/outbox-dispatch-state.test.ts test/assistant-outbox-runtime.test.ts test/assistant-runtime-locking.test.ts --config vitest.config.ts --no-coverage` after repeat-transition receipt repair fix (8 files, 74 tests)
- PASS: `pnpm --dir packages/assistant-engine exec vitest run test/assistant-store-persistence.test.ts --config vitest.config.ts --no-coverage` after non-OpenAI sidecar tolerance fix (1 file, 10 tests)
- PASS: `pnpm --dir packages/cli exec vitest run test/assistant-state.test.ts --config vitest.workspace.ts --no-coverage` after correcting the coupled malformed-sidecar fixture to use an OpenAI-compatible target (1 file, 33 tests)
- PASS: `pnpm --dir packages/assistant-engine exec vitest run test/assistant-state-secrets.test.ts test/assistant-store-persistence.test.ts test/redaction.test.ts test/turn-receipt-redaction.test.ts test/failover.test.ts test/outbox-dispatch-state.test.ts test/assistant-outbox-runtime.test.ts test/assistant-runtime-locking.test.ts --config vitest.config.ts --no-coverage` after non-OpenAI sidecar tolerance fix (8 files, 75 tests)
- PASS: `pnpm --dir packages/assistant-engine typecheck` before final audit fixes; the fresh `test:diff` run also passed assistant-engine typecheck after final audit fixes.
- PASS: `pnpm typecheck`
- PASS: `pnpm --dir packages/assistant-engine test:coverage` (99 files, 898 tests)
- PASS: `git diff --check` over the scoped plan/code/test files
- PASS: scoped diff scan for direct personal identifiers over the plan/code/test files
- PARTIAL: `bash scripts/workspace-verify.sh test:diff <scoped assistant-engine files>` passed dependency policy, workspace boundary checks, stale-name guard, `packages/assistant-cli` typecheck, and `packages/assistant-engine` typecheck; then failed in unrelated `packages/assistant-runtime` hosted-runtime channel type errors.
- PARTIAL: fresh `bash scripts/workspace-verify.sh test:diff <scoped assistant-engine files>` after final audit fixes passed affected typechecks, `packages/assistant-cli` tests, `packages/assistant-engine` tests, `packages/assistant-runtime` tests, and `packages/assistantd` tests; then failed in unrelated `packages/cli/test/vault-cli-wiring.test.ts` (`cli.serve` undefined in `installVaultCliSchemaIndex`).
- PARTIAL: final `bash scripts/workspace-verify.sh test:diff <scoped assistant-engine files> packages/cli/test/assistant-state.test.ts` passed affected typechecks, `packages/assistant-cli` tests, `packages/assistant-engine` tests, `packages/assistant-runtime` tests, and `packages/assistantd` tests; then failed in unrelated `packages/cli/test/vault-cli-wiring.test.ts` (`cli.serve` undefined in `installVaultCliSchemaIndex`) and unrelated `packages/cli/test/incur-smoke.test.ts` root-config/default-vault failures.
Completed: 2026-04-24
