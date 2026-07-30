# Consolidate connection admission after ReviewGPT Round 3

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Make the runtime connection-established hook the only owner that can admit a
  Junction target source and its durable initial work.
- Make explicit disconnect or a newer connection epoch win over a late
  callback, with callback failure and no source admission.
- Complete the mandatory Round 3 retrospective before another exact-head
  ReviewGPT correction audit.

## ReviewGPT evidence

- Hosted connection establishment correctly no-ops when its locked account
  recheck sees a missing, disconnected, or newer account.
- Shared ingress then independently marks the Junction source connected and
  returns callback success, even though no signal or mailbox work was committed.
- The shared write contradicts the stated hook ownership and leaves a split
  account/source lifecycle.

## Smallest durable correction

- Delete shared ingress's post-hook source write.
- Require source-bearing Junction callbacks to receive an explicit committed
  admission result from the runtime hook.
- Make hosted stale establishment throw from inside the authoritative boundary.
- Commit local source admission and initial jobs in one existing SQLite
  transaction.
- Add the production-composed stale callback regression and update owner docs.

## Tasks

1. [x] Consolidate source admission under the runtime hook result.
2. [x] Add hosted and local atomic commit behavior.
3. [x] Add stale-disconnect/newer-epoch and missing-owner regression coverage.
4. [x] Complete the first-reviewed-to-current anomaly retrospective.
5. [x] Run focused verification, canonical diff, acceptance, and parent review.
   Archive this plan in the scoped commit; final exact-head ReviewGPT and CI
   remain PR gates tracked outside the implementation plan.

## Verification evidence

- Device Sync typecheck and full suite passed: 44 files, 872 tests.
- Web typecheck, touched-file lint, and hosted wake coverage passed; the full
  Web suite passed 6,976 tests with zero lint errors.
- `pnpm test:diff packages/device-syncd apps/web apps/cloudflare` passed,
  including the 219-route production Web build and Cloudflare Node and Workers
  suites.
- `pnpm verify:acceptance` passed repo-wide typechecks, guards, coverage, app
  suites, and the production build.
- Parent review verified that stale or conflicting hosted establishment rolls
  back source, signal, and mailbox state; local source plus initial work is one
  SQLite transaction; and shared ingress has no fallback source writer.
Completed: 2026-07-28
