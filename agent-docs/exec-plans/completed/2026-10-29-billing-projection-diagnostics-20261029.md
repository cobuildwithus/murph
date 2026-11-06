# Explain hosted billing projection timeouts

Status: completed
Created: 2026-10-29
Updated: 2026-10-29

## Goal

Make a failed hosted billing matrix report the bounded state observed by its existing projection waiter, so an incomplete projection can be distinguished from an unexpected state without exposing identities or provider payloads.

## Scope and ownership

The existing test-only projection waiter is the owner. Its current timeout throws only a label and discards the last value. Public source confirms this observation gap. The live matrix currently reaches projection timeouts; its underlying reconciliation cause remains unproved.

Only test support, focused synthetic proof, and the owning verification documentation are in scope. Preserve the polling cadence, deadline, predicate, returned value, original read failures, provider operations and all production behavior. No new state, credentials, dependency, retry, recovery or hosted run is authorized by this diagnostic change.

## Design constraints

Use a finite closed projection of existing values in the existing failure error. Permit only validated public enums, bounded counts and presence booleans. Exclude identifiers, actual dates, arbitrary strings, members arrays and secrets. Keep normal successful waits quiet. No extra database or provider read.

## Tasks

1. Obtain a ReviewGPT-authored implementation and focused synthetic regression cases.
2. Prove the missing observation before the patch, then bounded useful evidence and unchanged polling/outcomes afterward.
3. Run focused tests, Web typecheck and relevant guards; inspect privacy and complexity.
4. Commit, open a scoped PR, run final ReviewGPT with exact-head CI, and merge once the required gates pass.
5. Verify main contains the test-only correction. Keep the live billing failure open pending a separately authorized or scheduled hosted matrix; no production deployment is needed for test support.

## Verification

ReviewGPT authored the timeout formatter and focused tests in a public-source-only packet. Parent review retained the existing reader and waiter, then added the new test file to the hermetic workflow and its existing guard. No extra read or provider operation occurs. The private formatter selects closed enum values, ID/date presence flags and counts capped at 100+; it never serializes the source object or roster.

- Before implementation: 15 diagnostic assertions failed because the timeout omitted the snapshot; 12 behavior-preservation cases passed.
- After implementation: 79 focused billing tests passed across the new waiter proof, existing live support and Checkout route. Success identity, original errors, cadence, deadline and read counts are preserved. Unknown strings and synthetic identity/date canaries remain excluded.
- Workflow guard: 39 tests and the hosted billing CI contract passed, including removal of the new proof.
- Web typecheck passed after giving the synthetic environment its ProcessEnv type; initial typecheck found only widened NODE_ENV in that fixture. Web lint passed with existing unrelated warnings. Repository tools typecheck also passed.
- Complexity diff passed. The existing provider-boundary guard hotspot remains at 23 without an added branch; the diagnostic is test support and outside that metric's source set. Parent inspected its fixed bounded field selection directly.
- Docs drift and whitespace checks passed after updating the existing owner index entry.

The helper cannot distinguish a missing billing reference from an all-null reference because the existing reader already projects both to the same shape. It can distinguish absent fields from unexpected status, plan, phase and schedule state. Live provider failure is not resolved by better diagnostics. The next scheduled or separately authorized matrix must exercise the observation; no provider-changing rerun is part of this change.

Final exact-head ReviewGPT and required CI will be recorded on the scoped PR. Test support has no runtime deployment boundary; verify the merged source and any ordinary main admission separately.
Completed: 2026-10-29
