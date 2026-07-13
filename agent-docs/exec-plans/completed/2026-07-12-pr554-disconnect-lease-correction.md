# Complete the device disconnect lease fence after final review

Status: completed
Created: 2026-07-12
Updated: 2026-07-13

## Goal

- Make the existing hosted device disconnect lease the single connection
  mutation fence from provider revoke dispatch through terminal disconnect.

## Success criteria

- An active token refresh prevents disconnect before any provider revoke call.
- A claimed or unresolved disconnect lease prevents refresh, reconcile,
  reconnect, and hosted runtime connection or credential writes.
- Browser and hosted disconnects always impose a total provider-revoke deadline
  below the disconnect lease lifetime.
- An expired non-null disconnect lease is adopted as ambiguous-effect evidence
  and terminalized without replaying provider revoke.
- Terminal disconnect still commits one durable signal and mailbox receipt and
  preserves manual-removal guidance when upstream state is uncertain.
- No new table, queue, service, scheduler, or lifecycle abstraction is added.
- Focused regressions, typechecks, full diff verification, required audits,
  corrected-head ReviewGPT, and exact-head CI pass.

## Scope

- Hosted device-sync disconnect, token refresh, reconcile scheduling, runtime
  apply, reconnect fencing, matching tests, and directly matching durable docs.
- No provider API expansion, credential schema change, background recovery
  worker, or unrelated wearable lifecycle behavior.

## Decisions

- Keep `disconnectLeaseOwner` and `disconnectLeaseExpiresAt` as the durable
  pending-effect evidence; expiry permits recovery adoption, not unrelated
  mutation or a second provider call.
- Clear only an expired refresh lease while claiming disconnect so a late
  refresh result loses authority before provider revoke begins.
- Reuse the existing connection advisory lock and terminal disconnect
  transaction for recovery and receipt persistence.
- Apply the existing 20-second provider-revoke timeout by default on every
  disconnect entrypoint, leaving the two-minute lease as a bounded recovery
  margin.

## Tasks

1. Add store-level lease mutual exclusion and expired-disconnect adoption.
2. Fence refresh, reconcile, runtime apply, and reconnect writers.
3. Default provider revoke to the existing bounded timeout and terminalize
   recovered leases without provider replay.
4. Add ordering, recovery, deadline, writer-fence, and reconnect regressions.
5. Run focused verification, full serial diff verification, completion audits,
   scoped finish-task commit/push, final corrected-head ReviewGPT, and CI.

## Verification

- Focused hosted web device-sync suites and web typecheck.
- Full serial `pnpm test:diff` for every corrected path.
- Security/privacy, coverage-write, deep review, and parent final review.
- `git diff --check`, identifier/privacy scan, corrected-head ReviewGPT, and
  exact-head GitHub aggregate checks.

## Results

- Refresh and disconnect claims are mutually exclusive under the existing
  connection advisory lock; final refresh persistence also rechecks that no
  disconnect lease exists.
- Reconnect, manual and scheduled reconcile, due-reconcile sweep, and hosted
  runtime connection writes now fail closed while disconnect evidence remains.
- Every disconnect entrypoint supplies the existing 20-second revoke deadline;
  expired disconnect evidence is adopted and terminalized without provider
  replay, with a durable warning, signal, and mailbox receipt.
- Coverage-write audit added the missing late-refresh persistence interleaving
  regression. Security/privacy and deep-logic audits found no remaining
  actionable finding and no new secret, auth, dependency, schema, or logging
  surface.
- Focused verification passed 212 tests initially and 90 tests after the final
  coverage correction. Web typecheck passed. Final `pnpm test:diff` passed the
  web build and all guards with 381 test files passed, one skipped, 4,487 tests
  passed, and 135 skipped.
Completed: 2026-07-13
