# Harden write-batch rollback journaling and case-insensitive reserved paths

Status: active
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Close two high-severity `packages/core` integrity gaps without widening beyond the affected write-path and path-policy seams:
- persist rollback prerequisites before overwrite/delete/append mutations so crash recovery stays durable
- enforce one consistent reserved-path and canonical-resource comparison form on case-insensitive filesystems so mixed-case aliases cannot bypass protections or split locks

## Success criteria

- `WriteBatch` durably records backup/original-size/payload-receipt prerequisites before the matching mutation runs, then finalizes the action state after the mutation succeeds.
- Rollback/recovery still works for overwrite, delete, JSONL append, and raw/text reuse cases without requiring a new storage schema version.
- Raw-path, append-only, protected-path, and canonical resource-lock comparisons use one consistent comparison form on case-insensitive platforms, or otherwise reject the unsafe alias.
- Focused `packages/core` regressions cover the crash-window recovery metadata shape and the case-insensitive reserved-path/lock behavior.
- Required verification, required completion audits, and the scoped commit complete, or any unrelated blocker is documented precisely.

## Scope

- In scope:
- `packages/core/src/{operations/write-batch.ts,operations/canonical-resource-lock.ts,path-safety.ts,write-policy.ts}`
- directly coupled `packages/core/test/{core.test.ts,core-utilities.test.ts,canonical-resource-lock.test.ts,operations-thresholds.test.ts}`
- `agent-docs/exec-plans/active/{2026-04-23-core-write-batch-rollback-and-path-case-hardening.md,COORDINATION_LEDGER.md}`
- Out of scope:
- broader write-batch helper extraction or action-protocol cleanup already claimed by the overlapping core refactor row
- nested canonical resource ordering changes beyond the lock-key normalization needed for the reported bug
- wider vault path normalization, cross-platform casing policy, or storage-schema redesign outside this exact safety fix

## Constraints

- Technical constraints:
- Preserve existing recoverable metadata parsing rules, especially the current allowance for missing payload receipts before `status === "committed"`.
- Keep the persisted write-operation schema compatible with already-written operation files.
- On case-sensitive platforms, do not broaden reserved-path handling beyond the current exact-case behavior unless required for correctness.
- Product/process constraints:
- Treat this as high-risk persisted-state and path-safety work: capture direct proof in addition to scripted verification.
- Work safely in the shared dirty tree and avoid overlapping the active core refactor row beyond the exact reported seams.

## Risks and mitigations

1. Risk: Pre-persisting rollback data could leave actions looking applied before the mutation actually runs.
   Mitigation: Persist prerequisites first while keeping the action non-terminal until the mutation succeeds, then persist the final applied/reused state separately.
2. Risk: Case-insensitive comparison changes could accidentally weaken protections on case-sensitive platforms.
   Mitigation: Centralize the comparison form behind a platform-aware helper and keep the existing exact normalized path as the stored/display form.
3. Risk: The fix could collide conceptually with the active core refactor lane on the same files.
   Mitigation: Keep this patch narrow to the reported defects, avoid helper extraction churn, and document the overlap explicitly in the ledger row.

## Tasks

1. Register the narrow rollback/path-case hardening lane in the active plan and coordination ledger.
2. Patch `write-batch` so overwrite/delete/append actions persist rollback prerequisites before mutating the target, then finalize state after success.
3. Patch reserved-path and canonical-resource lock comparisons to use one consistent comparison form on case-insensitive platforms.
4. Add focused `packages/core` regressions for recoverable metadata and case-insensitive protection/locking behavior.
5. Run scoped verification, direct proof, required completion audits, and the scoped commit flow.

## Decisions

- Reuse the existing staged action records and recoverable parser instead of introducing a new action state or schema version for this fix.
- Use a platform-aware canonical comparison form for reserved roots and lock keys while preserving the original normalized path for storage and labels.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/core/src/operations/write-batch.ts packages/core/src/operations/canonical-resource-lock.ts packages/core/src/path-safety.ts packages/core/src/write-policy.ts packages/core/test/core.test.ts packages/core/test/core-utilities.test.ts packages/core/test/canonical-resource-lock.test.ts packages/core/test/operations-thresholds.test.ts`
- `pnpm test:smoke`
- Expected outcomes:
- `packages/core` typecheck and focused diff-aware verification pass with the new rollback and case-insensitive regressions covered.
- Direct proof shows recoverable metadata includes rollback prerequisites before mutation completion and that mixed-case reserved aliases/lock keys are normalized consistently on case-insensitive platforms.
- Actual outcomes:
- `pnpm --dir packages/core typecheck` passed.
- Focused direct-proof commands passed:
- `pnpm --dir packages/core exec vitest run --config vitest.config.ts test/core-utilities.test.ts -t "path helpers normalize, format, and classify vault paths"`
- `pnpm --dir packages/core exec vitest run --config vitest.config.ts test/operations-thresholds.test.ts -t "write-policy prepares targets by operation kind and distinguishes reuse, update, and append outcomes"`
- `pnpm --dir packages/core exec vitest run --config vitest.config.ts test/canonical-resource-lock.test.ts -t "canonical path resources fold case-insensitive aliases into one key when requested"`
- `pnpm --dir packages/core exec vitest run --config vitest.config.ts test/core.test.ts -t "WriteBatch keeps raw-copy recovery metadata durable before finalization and resumes idempotently|WriteBatch keeps text-overwrite rollback prerequisites durable before finalization and resumes idempotently|WriteBatch keeps append rollback prerequisites durable before finalization and avoids duplicate replay|WriteBatch keeps delete rollback prerequisites durable before finalization and resumes idempotently|WriteBatch resumes no-overwrite text reuses without requiring overwrite backup metadata"`
- `pnpm test:smoke` passed.
- `bash scripts/workspace-verify.sh test:diff ...` is currently blocked by unrelated `packages/assistantd` typecheck failures (`test/http-coverage.test.ts`, `test/http.test.ts`) around stale `executionDriver` / `resumeKind` literals not caused by this `packages/core` diff.
- `pnpm --dir packages/core test:coverage` is currently blocked by unrelated existing `packages/core/test/event-attachments.test.ts` failures plus the pre-existing `src/event-attachments.ts` coverage threshold miss.
- Required spawned audit passes are pending because the environment hit a Codex subagent usage limit before the mandatory `coverage-write` pass could run.
