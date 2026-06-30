# Linq Family Review Fixes

## Goal

Fix review findings in the Linq/iMessage Family invite acceptance flow so
provider retries remain safe and wrong-phone tokens do not surface as webhook
failures.

## Scope

- Make phone-based Family invite acceptance idempotent for the same already
  accepted phone member.
- Classify expected Family invite mismatch/not-acceptable errors as intentional
  Linq ignores.
- Add focused tests for retry after a failed Family welcome send and for
  wrong-phone token handling.

## Invariants

- Family invite acceptance remains token-scoped, expiring before first
  acceptance, seat-checked, and bound to the invited phone.
- Accepted-by-same-member retry may recreate only the same welcome reply; it
  must not create a generic signup invite.
- Wrong-phone tokens must not leak account state through webhook failures or
  provider retries.

## Verification

- Run focused hosted web Family/Linq tests for the touched behavior.
- Run diff checks and report any unrelated app-wide typecheck blockers.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
