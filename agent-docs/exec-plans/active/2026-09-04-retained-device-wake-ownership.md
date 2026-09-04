# Retained device-wake ownership

Status: active
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Let the scheduled device-sync recovery sweep recognize a payload-retired wake that is still owned by an exact runtime retry after the canonical handled frontier advances past it.

## Success criteria

- Runtime checkpoint progress reports the earliest real pending mailbox sequence independently from the first pending item that blocks the handled frontier.
- Web accepts a structurally exact scheduled-v3 duplicate only when that row is the runtime-reported first pending sequence and the imported watermark covers it.
- Missing, different, malformed, never-imported, or payload-bearing ownership claims continue to fail closed.
- Focused runtime and PostgreSQL tests reproduce the composed retained-retry state and pass.
- Package typechecks and required exact-head PR checks pass.

## Architecture and ownership

- Runtime remains the sole owner of retained retry state and derives both checkpoint projections from its existing system-mailbox state.
- Web remains the mailbox and schedule-admission owner and consumes the existing exact sequence projection; it does not infer retry state from the handled watermark.
- No canonical state, schema, queue, scheduler, repair job, or second retry owner is added.

## Evidence

- Production-safe aggregates showed payload-retired scheduled-v3 rows covered by the imported and handled watermarks while their checkpoint first-pending sequence had advanced, causing deterministic dedupe conflicts.
- Runtime currently excludes retained device retries from both `firstPendingSeq` and handled-frontier calculation.
- Web currently requires both exact `firstPendingSeq` equality and `lane_seq = consumed_seq + 1`, coupling ownership proof back to the handled frontier.

## Risks and mitigations

1. Risk: Web could accept a completed or unrelated retired row.
   Mitigation: retain exact first-pending sequence equality, imported/high-water bounds, scheduled-v3 identity checks, and the complete payload-retirement shape.
2. Risk: retained retries could pin ordinary system-mailbox progress again.
   Mitigation: derive the handled frontier from a separate blocking-pending accumulator that still excludes retained device retries.
3. Risk: mixed runtime/Web versions could weaken ownership.
   Mitigation: reuse an existing scalar that every runtime version overwrites; either skew direction fails closed until both sides publish and consume the corrected semantics.

## Tasks

1. Completed: added focused regressions for split runtime progress and behind-frontier Web acceptance.
2. Completed: decoupled runtime first-pending identity from handled-frontier blocking.
3. Completed: changed Web's lane consistency check from exact first-unhandled equality to an at-or-behind bound while preserving exact runtime ownership proof.
4. Completed: updated the durable runtime protocol, reliability contract, and verification map.
5. Completed locally: ran focused runtime/Web tests, the real-PostgreSQL replay, both owner typechecks, documentation checks, and the complexity ratchet.
6. Remaining: parent final review, exact-head CI, ReviewGPT, merge, coordinated deployment, and production convergence proof.

## Product UX

- Effort: Patch.
- Outcome: an existing connected device can resume its already-owned retry instead of the settings request failing because recovery rejected the same durable wake.
- Recovery remains bounded and invisible; the fix does not create a new provider request owner or user-facing workflow.

## Product UX walkthrough

- Person and path: an existing member saves device settings while the scheduled recovery sweep encounters a payload-retired wake that the runtime still owns as a local retry.
- Expected experience: the exact duplicate is treated as already accepted, the sweep does not convert it into a request failure, and the existing device retry remains responsible for completion.
- Failure and recovery: a missing or inconsistent runtime ownership projection still fails closed; no provider work is recreated and no alternate scheduler is introduced.
- Result: Pass locally. The production-shaped PostgreSQL case accepts the exact behind-frontier owner, and the 205-test Web wake/recovery slice preserves the route and sweeper behavior. Production convergence remains a post-deploy gate.

## Changelog

- Not applicable: this is an internal recovery correction that restores the existing connected-device promise without new copy, surface, capability, or member-visible behavior.

## Verification

- Passed: `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-mailbox-state.test.ts packages/assistant-runtime/test/hosted-runtime-mailbox-checkpoint.test.ts` (31 tests).
- Passed: local PostgreSQL migrations plus the focused `device-sync-scheduled-wake-retention-postgres.test.ts` command from the testing map (16 tests).
- Passed: focused Web wake and recovery slice (205 tests).
- Passed: `pnpm --dir packages/assistant-runtime typecheck` and `pnpm --dir apps/web typecheck`.
- Passed: `pnpm complexity:diff`, `pnpm docs:drift`, `pnpm docs:gardening`, and `git diff --check`.
- Remaining: exact-head CI and ReviewGPT.
