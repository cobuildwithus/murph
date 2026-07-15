# PR 660 ambiguous Apply recovery

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Preserve the exact trial-extension operation identity across an ambiguous
  Apply response so retrying one intended extension cannot authorize another
  seven days.

## Success criteria

- The client retains the current Preview proof after transport, malformed
  response, provider, or other ambiguous Apply failures and retries byte-for-byte
  with the same proof.
- A server-confirmed stale Preview clears the unusable proof and requires a new
  Preview.
- Apply can reconcile an exact already-applied Stripe operation after the
  Preview TTL, while an expired proof can never start a new Stripe mutation.
- Focused regression tests prove ambiguous client failure, confirmed stale,
  provider-success retry, expired exact-marker recovery, and expired unmarked
  non-mutation.

## Constraints

- Reorder checks inside the existing client/service owners; add no database
  state, browser persistence, queue, scheduler, or retry abstraction.
- Preserve the existing member billing mutation lock, signed proof, Stripe
  idempotency key, and exact provider marker.
- Keep paid and other ineligible billing non-mutation guarantees unchanged.

## Verification

- Focused client/service/route tests passed with 28/28 tests; the remediation
  subset passed with 18/18 tests after coverage review.
- Hosted-web typecheck and scoped lint passed.
- `pnpm test:diff` selected the complete hosted-web verifier: architecture and
  privacy guards, dev smoke, lint, 5,048 tests, and the production Next build
  passed. Lint retained 13 unrelated warnings and no errors.
- Required coverage review added byte-identical request proof and exact
  provider call-count assertions; required frontend re-review returned zero
  findings.
- Push the remediation and run ReviewGPT correction round 2 concurrently with
  CI until PASS.
Completed: 2026-07-14
