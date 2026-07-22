# Hosted ask continuation repair

Status: completed
Created: 2026-07-21
Updated: 2026-07-22

## Goal

Ensure a completed hosted-group ask is claimed exactly once and resumed into
the originating personal conversation, including after a later foreground turn.

## Success criteria

- A pending `continue-assistant-ask` mailbox item is eligible for the ordinary
  personal-runtime claim path and advances beyond zero attempts.
- A later personal-chat turn reconciles any older completed ask before the
  assistant answers from stale request state.
- Replays cannot duplicate the continuation or provider delivery.
- Redacted runtime state distinguishes pending, attempted, retryable-failed,
  and terminal delivery outcomes, and exposes a stuck-zero-attempt signal.
- Focused regression coverage proves import, foreground reconciliation,
  continuation delivery, replay idempotency, and stuck-item diagnostics.

## Constraints

- Preserve foreground personal-chat authority and the mailbox as the sole
  durable queue.
- Reuse the existing system-mailbox claim and outbox idempotency owners; do not
  add another persisted state owner or scheduler.
- Do not publish or advance the expensive idle workspace snapshot when an Ask
  request or completion arrives.
- Keep group answers, health details, member identifiers, route locators, and
  provider identifiers out of committed fixtures and logs.
- Preserve the active mailbox-consumption lane's `consumedAt` ownership; avoid
  changing its database or acknowledgement contract.

## Approach

1. Reproduce the zero-attempt pending completion through the workspace runtime
   entrypoint and trace the exact route-action eligibility check.
2. Start the existing detached group reader from the dirty-window mailbox wake,
   then let the ordinary system wake or a subsequent foreground personal-chat
   pass claim a completed Ask.
3. Extend redacted runtime diagnostics and a bounded stuck-item warning at the
   existing system-mailbox owner.
4. Add focused tests for claim, reconciliation, idempotent replay, and delivery
   error state; update the hosted runtime protocol if behavior changes.
5. Run diff-aware verification, direct scenario proof, required completion
   audits, parent final review, scoped commit, PR CI, and ReviewGPT.

## Risks and mitigations

1. Risk: foreground reconciliation sends the answer twice after a crash.
   Mitigation: retain the stable completion delivery key and claim/record
   transitions; test replay before and after the durable checkpoint boundary.
2. Risk: broad system-mailbox draining delays current user turns.
   Mitigation: claim only the continuation action needed for the foreground
   request and preserve existing preemption checks.
3. Risk: diagnostics expose group or health content.
   Mitigation: emit only action, state, a delayed-first-attempt boolean, attempt
   count, and stable redacted error codes.

## Verification

- `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-workspace-assistant-phase.test.ts --reporter=dot`: passed; 76 files, 1,784 passed, 2 skipped.
- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-system-mailbox-notification.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts ARCHITECTURE.md docs/contracts/00-invariants.md agent-docs/references/hosted-runtime-protocol.md agent-docs/index.md`: passed; Assistant Runtime and Cloudflare owner/dependent lanes green.
- `pnpm docs:drift`: passed.
- `pnpm verify:acceptance`: passed; full typecheck, coverage, app verification,
  package-boundary, production-build, and architecture/privacy guard lanes green.
- Direct dirty-window entrypoint regression proves the detached Ask starts and
  completes while both the snapshot builder and workspace checkpoint request
  count remain zero; exactly one snapshot occurs only after the test requests
  shutdown.
- Coverage-write accepted one test-only strengthening for claim-before-personal
  ordering and stable-key delivery, with no unresolved findings.

## Decisions

- This is a standard high-risk reliability change because it touches persisted
  runtime state, retries, user-visible messaging, and idempotency.
- Use an isolated PR lane and the existing mailbox/outbox owners only.
- Internal assistant-phase commits remain local staging boundaries; the routine
  idle workspace snapshot schedule is unchanged.
Completed: 2026-07-22
