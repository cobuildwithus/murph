# PR 932 ReviewGPT Patch Integration

Status: active

## Goal

Finish the requested ReviewGPT patch comparison for PR 932 and retain the
smallest correct combination of the local candidate and the returned patch.

## Scope

1. Preserve delivery-owned terminal outcomes and the pre-lookup participant
   phone lock from the verified local candidate.
2. Replace structured group-reply source-reference correlation with a direct
   delivery timestamp column while keeping the ordinary effect id.
3. Share one bounded group-join provider-fence primitive between opener and
   signup-link dispatch.
4. Add the returned direct PostgreSQL race proofs and update the live testing
   map only where the scenarios are actually covered.
5. Re-run focused, diff, acceptance, product, specialist, final, CI, and
   merge-conflict gates before updating the open PR.

## Constraints

- The migration is unshipped; rewrite it directly with no compatibility or
  backfill path.
- Add no service, queue, manager, generic state machine, or dependency.
- Preserve one automatic link-free opener, no follow-ups, exact group recovery,
  exact reply occurrence time, quiet hours, line limits, deletion, and provider
  idempotency.

Updated: 2026-07-27
