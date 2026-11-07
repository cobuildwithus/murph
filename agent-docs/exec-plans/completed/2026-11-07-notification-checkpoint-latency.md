# Release blocked notifications from idle batching

Status: completed
Created: 2026-11-07
Updated: 2026-11-07

## Goal

Outcome: already-admitted chat notifications should not spend the full idle
batching window waiting for earlier runtime state to become durable.
Reaches: notification-only and mixed system prefixes in a dirty warm runtime.
Proof: deterministic mailbox wake tests through checkpoint and subsequent import.

## Owner and invariant

The hosted runtime's existing idle-checkpoint deadline owns when unsafe system
prefixes may be imported. Preserve checkpoint-before-import, foreground priority,
mailbox ordering, delivery authority, and idempotency. Do not add a new queue,
state field, protocol, or early-admission family.

## Evidence and scope

The pre-checkpoint classifier holds generic notifications, but its blocked-page
early-checkpoint path recognizes only Ask requests. Reproduce notification-only
and mixed-prefix delay before extending that existing deadline hint. Keep device
maintenance batching unchanged. No production writes, messaging, or deployment.

## Tasks

1. Add a deterministic failing regression for a notification arriving during a
   dirty ten-minute idle window, plus a maintenance-only control.
2. Extend the existing blocked-prefix checkpoint hint to notifications without
   changing import eligibility or service authority.
3. Prove checkpoint ordering, mixed-prefix behavior, and unaffected maintenance;
   run relevant runtime tests, typecheck, and complexity review.
4. Update the runtime owner documentation and member-facing changelog; inspect
   the complete diff and make a local scoped commit.

## Risks and evolution

More timely notifications may require earlier snapshots. The existing bounded
prefetch and checkpoint owner limit work; there are no new remote calls on the
foreground reply path or model prompt changes. Failure keeps the old checkpoint
and mailbox retry owners. The change is runtime-local and compatible with older
Web/Worker protocols; old warm runtimes retain their previous timing until
replaced. Publication and actual provider delivery remain unverified locally.

## Verification

- Before the change, notification-only and mixed-maintenance regressions failed:
  no checkpoint began after the wake at one second. The maintenance-only control
  passed with a checkpoint at the ordinary ten-minute deadline.
- After the change, all four new cases pass: notification-only, notification
  behind maintenance, checkpoint failure with no system import, and unchanged
  maintenance batching. Successful notification imports occur after publication,
  in lane order, once per item.
- `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts
  packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-checkpoint-wakes.test.ts
  packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-causal-input.test.ts
  --no-coverage`: 74 tests passed after building the required capture worker.
- `pnpm --filter @murphai/assistant-runtime... build`: passed.
- `pnpm --filter @murphai/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed with unchanged complexity debt and maximum.
- Changelog generation and the production changelog archive rendering suite:
  4 tests passed. Entry: `timely-pending-chat-updates`. Its source PR list stays
  empty until a separately authorized publication creates a PR.
- Product UX: Ready for the local checkpoint-gated timing boundary. Existing
  foreground/Ask ordering tests also pass. Provider delivery remains separately
  owned and is not claimed by mock-based timing proof.
- No assembled prompt, model input, tools, or reply policy changed. A live-model
  test is not needed for this scheduling-only correction.
- Candidate review: existing deadline and admission owners retained, no protocol,
  persistent state, external call, or provider authorization change. Earlier
  snapshots are the only additional work for blocked notifications.
- External final review, CI, and deployment remain outside this local-only task.
  Old warm runtimes can retain the prior delay until replaced. No migration or
  coordinated deploy order is required; rollback restores only previous timing.
Completed: 2026-11-07
