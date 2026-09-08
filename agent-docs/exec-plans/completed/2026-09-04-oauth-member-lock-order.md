# Align device OAuth and member lock ordering

Status: completed
Created: 2026-09-04
Updated: 2026-09-05

## Goal

- Remove the device OAuth callback versus provider-credential replacement
  deadlock by making member-bound OAuth mutation consistently acquire the
  member row before the exact OAuth state row.

## Success criteria

- Callback consumption uses member-then-OAuth ordering and revalidates the
  exact state owner after both locks are held.
- Credential replacement removes only unconsumed state and cannot erase a
  consumed callback's durable cleanup claim.
- A concurrent PostgreSQL proof runs the production callback and credential
  replacement paths in the opposing schedule and both complete without a
  deadlock.
- Focused tests, hosted-Web typecheck, exact-head CI, and ReviewGPT pass.

## Scope

- In scope: device OAuth state consumption, provider-application credential
  replacement, focused unit and PostgreSQL concurrency tests, and matching
  architecture/reliability contracts.
- Out of scope: provider exchange, OAuth protocol fields, schema changes,
  retention batching, account deletion behavior, and connection persistence.

## Constraints

- Keep the existing member row and OAuth row as the only authorities; do not
  add retries, leases, queues, or persisted coordination state.
- Read the owner hint before the transaction, then revalidate the exact owner
  after member and OAuth locks are held.
- Keep transactions bounded and database-only.

## Risks and mitigations

1. Risk: An OAuth state is replaced between the owner hint and locked reread.
   Mitigation: Fail closed as missing when the locked row owner differs.
2. Risk: Credential replacement deletes a callback claim after provider work
   may have started.
   Mitigation: Delete only rows whose `consumedAt` remains null.
3. Risk: Moving the first lock lets expiry retention win while a callback is
   waiting for its member.
   Mitigation: The locked reread treats disappearance as missing; no replay or
   provider work is fabricated from the stale hint.

## Tasks

1. Capture the current callback, credential replacement, account deletion,
   and retention ownership contracts.
2. Move member-bound callback consumption to member-before-OAuth with exact
   post-lock owner revalidation.
3. Preserve consumed callback claims during credential replacement.
4. Add focused unit ordering assertions and a production-path PostgreSQL
   deadlock regression.
5. Run focused tests, typecheck, lint, complexity and privacy checks; archive
   the plan, commit, open the PR, and complete ReviewGPT plus required CI.

## Verification

- Focused Vitest for OAuth sessions and provider-application storage.
- Isolated PostgreSQL concurrency test with the production callback and
  provider-application replacement paths.
- Hosted-Web typecheck, scoped ESLint, complexity diff, diff/privacy checks,
  exact-head GitHub Actions, and final ReviewGPT.

## Completion evidence

The locked state lookup includes the prepared member id in its database
predicate, so changed ownership returns missing without a separate branch.
This keeps authority revalidation beside the exact read and the consumer below
the repository complexity threshold. PostgreSQL covers replacement-first
waiting and callback-first preservation of the consumed cleanup claim.

Product UX: Patch / Ready. Connection and credential replacement retain their
existing behavior; stale callbacks fail closed, consumed callbacks retain their
cleanup owner, and concurrent requests serialize without a deadlock.

Verification passed: 33 unit tests plus two PostgreSQL order/claim scenarios;
Web typecheck; scoped ESLint (one pre-existing unused-parameter warning);
complexity guard (no function above 20); diff and privacy review.
Required CI and ReviewGPT remain PR completion gates.
Completed: 2026-09-05
