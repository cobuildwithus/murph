# Dirty runtime wake checkpoint deadline

Status: completed
Created: 2026-05-13
Updated: 2026-05-13

## Goal

- Ensure dirty hosted runtime checkpoints happen before a projected runtime wake would be missed.
- Preserve the existing single `idleCheckpointDelayMs` knob, runtime-owned checkpointing, and no new durable state.

## Success criteria

- Dirty runtime checkpoint wait ends at the earliest of external wake, idle delay, host deadline checkpoint start, projected `nextWakeAt` checkpoint start, or budget exhaustion.
- `budget_exhausted` dirty runs checkpoint immediately.
- Focused regression tests cover projected wake and budget-exhausted immediate checkpoint behavior.

## Scope

- In scope: `packages/assistant-runtime/src/hosted-runtime.ts` dirty checkpoint wait selection and focused `hosted-runtime-workspace-entrypoint` coverage.
- Out of scope: new configuration fields, new durable state, Cloudflare Durable Object scheduling changes, web workspace schema changes.

## Constraints

- Technical constraints: keep checkpoint publication inside the runtime-owned idle-shutdown path; derive deadlines from existing request/runtime projection only.
- Product/process constraints: preserve unrelated active hosted-runtime and Murph Age worktree edits.

## Risks and mitigations

1. Risk: Changing wait timing could cause extra checkpoints or miss external wake reprocessing.
   Mitigation: Keep the existing wait helper and only feed it the earliest computed checkpoint-start deadline; keep `wake` behavior unchanged.
2. Risk: Invalid wake strings could collapse the wait to immediate checkpointing.
   Mitigation: Only use finite parsed wake times.

## Tasks

1. Done: inspected current dirty wait/projection flow.
2. Done: patched checkpoint-start deadline selection to include projected `nextWakeAt`.
3. Done: short-circuited dirty wait for `budget_exhausted`.
4. Done: added focused regression tests for projected wake timing, host-deadline precedence, and budget exhaustion.
5. Done: ran focused verification and required audits.

## Decisions

- The fix should not add another config knob or persisted field; it derives all behavior from existing `deadlineAt`, `commitTimeoutMs`, projected `nextWakeAt`, `idleCheckpointDelayMs`, and runtime wake signal.

## Verification

- Passed: `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts` (52 files, 551 passed, 2 skipped after final test adjustment).
- Passed: `pnpm typecheck`.
- Passed: `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` (assistant-runtime typecheck/test plus reverse-dependent `apps/cloudflare verify`).
- Passed audits: security/privacy review, simplify review, coverage-write pass, final completion review. No findings after final review.
- Commit path: used scoped index staging for only this task's runtime/test hunks because `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` also had unrelated overlapping changes from completed plan `agent-docs/exec-plans/completed/2026-05-13-mailbox-retry-wake-no-checkpoint.md`.
Completed: 2026-05-13
