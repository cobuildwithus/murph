# Retell account-deletion cleanup

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Fix security finding `cand-E0027-01` so hosted account deletion deletes every
  Retell call object before local phone-call ownership is erased.
- Preserve a durable local retry owner whenever provider deletion is ambiguous
  or local completion persistence fails.

## Success criteria

- Active calls are stopped and all known Retell call objects, including
  terminal calls, are deleted before the local account transaction.
- A confirmed provider deletion clears its local provider identifier; any
  ambiguous failure leaves that identifier intact and blocks account deletion.
- Recovered provider identifiers are persisted before provider cleanup.
- Focused failure/retry coverage, truthful owner verification, required
  completion audits, parent final review, and a scoped commit all pass.

## Scope

- `apps/web/src/lib/phone-calls/account-deletion.ts`
- `apps/web/src/lib/phone-calls/retell-runtime.ts`
- Focused hosted-web phone-call and account-deletion tests
- Current architecture, security, account-deletion, and testing docs where the
  durable provider-deletion contract changes

## Constraints

- Keep Retell credentials and provider payloads out of logs and persisted
  diagnostics.
- Do not add a queue or new database state when the existing phone-call row can
  remain the retry owner.
- Keep cleanup bounded, abortable, and fail closed before the destructive local
  transaction.
- Preserve unrelated working-tree and coordination-ledger work.

## Tasks

1. Prove the current provider-reference erasure path and the pinned Retell
   delete/error contract.
2. Implement stop-then-delete cleanup for every durable Retell identifier,
   retaining the identifier on ambiguous failure.
3. Add focused terminal-call, retry, ordering, batching, and runtime request
   coverage; update durable docs.
4. Run scoped verification and required completion audits, resolve actionable
   findings, inspect the final diff, and finish through the scoped commit path.

## Decisions

- Reuse `HostedPhoneCall.providerCallId` as the bounded retry owner. Clear it
  only after Retell confirms deletion or confirms that the object is absent.
- Include every Retell row with a provider identifier in cleanup, regardless of
  local terminal status, while retaining reconciliation for unbound active
  reservations.
- Keep the current checkout because the completion-audits skill prohibits
  switching worktrees without an explicit user request and the checkout is
  clean with no overlapping phone-call lane.
- Treat only Retell's documented exact missing-asset 422 response as confirmed
  absence. Generic 404s and all other 422s remain ambiguous and retain local
  retry ownership.

## Verification

- Focused hosted-web account-deletion and Retell runtime tests: 106 passed.
- Hosted-web typecheck: passed.
- Changed-scope repository verification: passed, including repository guards,
  lint with pre-existing warnings only, 5,112 web tests with 139 skipped, dev
  smoke, and the Next production build.
- Required `coverage-write` audit: one Retell 422 contract gap found and fixed.
- Required local `deep-review`: one generic-404 fail-open edge found and fixed;
  re-review found no remaining production defects.
- Parent final diff and failure-path review: passed.
Completed: 2026-07-15
