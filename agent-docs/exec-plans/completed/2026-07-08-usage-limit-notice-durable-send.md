# Usage-Limit Notice Durable Send

## Goal

Fix the hosted AI usage-limit notice state machine so `limitNoticeSentAt` represents a notice that has actually passed through the Linq send path, not only a pre-send claim. A member who crosses or later hits the usage gate should receive the once-per-period notice unless an existing Linq delivery idempotency row already owns that send.

## Constraints

- Keep the fix scoped to hosted usage/Linq notification state.
- Reuse existing Linq delivery idempotency primitives instead of adding a queue, scheduler, or table.
- Do not expose member ids, local paths, message bodies, or secrets in code, tests, logs, or artifacts.
- Preserve phone-number deliverability rules for reciprocal, low-volume service replies.

## State

- Investigation found a period marker could be written before route lookup/provider send.
- If execution stopped after that marker, later denied inbound messages saw the marker and planned no notice.
- Current implementation is being changed in a separate worktree/branch.

## Verification

- Focused hosted usage/Linq tests.
- Hosted web package typecheck/verify as required by the task router.
- Parent local review before commit.
- PR ReviewGPT loop after PR creation.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
