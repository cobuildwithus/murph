# Reset all usage and suppress usage-denied typing alerts

Status: active
Created: 2026-09-13
Updated: 2026-09-13

## Outcome and ownership

Reset everyone clears current included spend for eligible paid, Family, and
container accounts, and restores Starter capacity to its full allowance even
when partly used. Existing member locks, canonical allowance reads, immutable
credit entries, and operation receipts remain authoritative. The typing monitor
excludes only exact mailbox inputs with a recorded AI-usage denial.

## Product UX

- Outcome: Reset everyone returns eligible current usage to zero.
- Reaches: Partly used, exhausted, and unused Starter accounts; paid accounts;
  replayed operations; members with separate referral or purchased credit.
- Proof: Real PostgreSQL reset and allowance readback; operation replay after
  new usage; rendered confirmation and existing batch/recovery route tests.
- Preserve: Access and consent gates, immutable history, other credit sources,
  row-reset behavior, bounded batches, and post-commit runtime wake ownership.

## Implementation

1. Derive remaining Starter grants in the existing locked member read. Append
   only the deficit to the standard Starter allowance through the canonical
   grant owner, then clear current period spend. No new schema or state owner.
2. Preserve operation receipt replay so a resumed batch never resets later
   usage or duplicates a grant; keep the credit-slot capacity guard.
3. Update Reset everyone confirmation and its owner documentation.
4. Verify and review both this change and the committed typing-alert correction.
5. Open one draft PR, establish readiness, run required ReviewGPT with CI, and
   resolve completion gates on the final pushed head.

## Verification

Passed: 105 tests across the focused Ops reset, route, rendered UI, and
PostgreSQL typing-monitor suites. Real PostgreSQL proof covers exhausted,
partial, unused, and referral-backed Starter balances, immutable history, and
operation replay after new accounted usage. Web typecheck and complexity diff
passed; the reset transaction's complexity decreased by one.

Parent source, test, ownership, and privacy review passed. Chromium confirmed
readable confirmation copy without overflow at 390px and 1280px; inspected
synthetic screenshots are attached to PR #3414. The existing Ops study renders
the real component. A hosted preview is queued.

Pending: hosted preview reachability, exact-head CI, and required final
ReviewGPT. No production reset or deployment is part of this PR. Preview upload
friction is recorded in the task's Frog entry.

## Changelog

Internal Ops maintenance and operational alerts; no public changelog entry.
