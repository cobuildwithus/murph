# Hosted Member Reset Script

## Goal

Add a guarded per-member hosted reset script that can be run first in dry-run
mode and then against one explicit member id.

## Scope

- Add a hosted web admin script for one-member reset inspection/execution.
- Reuse existing hosted account deletion, Temporal, Cloudflare, crypto, mailbox,
  and device cleanup boundaries where safe.
- Preserve billing/login/legal continuity and avoid raw identifiers in logs.

## Non-Goals

- No production mutation during implementation.
- No batch reset orchestration.
- No self-serve user-facing reset UI.
- No ad hoc SQL outside the script.

## Plan

1. Inspect existing hosted deletion and runtime cleanup helpers.
2. Implement dry-run and execute modes for one member id.
3. Add fail-closed checks for billing/login/crypto continuity and row counts.
4. Verify with typecheck/tests or focused script checks.

## Decisions

- Preserve member, active billing, Stripe billing ref, Privy/wallet identity,
  channel routing, email authorization, consent, Stripe events, control crypto
  roots, device webhook trace tombstones, and hosted internal request nonces.
- Delete runtime/workspace/mailbox rows, hosted web sessions, skipped AI usage
  accounting rows, Linq daily state, invites, device sync rows, device sessions,
  and device/ingress/runtime crypto roots.
- Recreate exactly one fresh hosted workspace and fresh device/ingress/runtime
  roots in the reset transaction.
- Treat device connections as resettable state; users must reconnect wearables
  and devices after reset.
- Execute mode leaves the member suspended by default. Use explicit
  `--unsuspend-after-reset --confirm-unsuspend-after-reset <id>` for a canary or
  when the operator is ready for the member to message again.
- `--resume-suspended-reset` is the rerun path after a failed reset that already
  suspended the member.
- Manual Temporal or Cloudflare cleanup skips require exact same-member
  confirmation flags.

## Verification

- `pnpm --dir apps/web typecheck:prepared`
- `pnpm --dir apps/web admin:reset-member -- --help`
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/reset-hosted-member-runtime-script.test.ts --no-coverage`
- `pnpm test:diff apps/web/scripts/reset-hosted-member-runtime.ts apps/web/package.json apps/web/test/reset-hosted-member-runtime-script.test.ts`
Status: completed
Updated: 2026-06-04
Completed: 2026-06-04
