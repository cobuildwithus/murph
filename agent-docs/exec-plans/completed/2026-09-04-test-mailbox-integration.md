# Replace simulated mailbox subscription claims with PostgreSQL proof

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Prove that concurrent subscription actions cannot both claim the same accepted
conversation input, using the persisted mailbox owner rather than a JavaScript
mock that independently enforces the expected outcome.

## Scope and decisions

- Replace the simulated race in mailbox unit tests. Retain the claim-query test
  because it also protects authority filters outside the new race scenarios.
- Extend the existing Stripe entitlement PostgreSQL suite and its lock-observation
  helpers. Its existing private hosted-integration workflow already selects this
  suite; no new harness, dependency, lane, or production behavior is needed.
- Preserve focused replay/conflict and lost-authority failure-injection tests.
- Keep fixture rows UUID-scoped in a dedicated local worktree database; cleanup
  removes only the fixture member and its cascading mailbox rows.

## Tasks

1. Add forced real-database overlap for identical and conflicting actions; assert
   one winner, durable winning claim, and replay without another claim.
2. Delete the replaced simulated race test.
3. Run focused mailbox and PostgreSQL tests, Web typecheck, and complexity diff.
4. Obtain parent candidate review, then commit and open a scoped PR.

## Verification

- Focused mailbox and PostgreSQL entitlement suites: 86 tests passed against the
  dedicated local database after all 212 migrations; final repeat after restoring
  the mutation passed all 86 tests again.
- Mutation proof: temporarily removing only the null-claim update predicate made
  both real races fail with two winners. Production source restored exactly.
- Complexity diff passed; the metric excludes test-only changes.
- Initial Web typecheck reached one unrelated fresh-checkout missing export,
  `@murphai/device-syncd/service`. Preparing that package through its existing
  build command passed, followed by a passing `pnpm --dir apps/web typecheck`.
  The parallel test-text-guards lane owns the shared Frog report.
- Parent candidate review approved the scope and focused evidence.

Public Web tests discover both files; PostgreSQL cases are opt-in locally and
selected by the existing private hosted-integration workflow after migrations.

## Risks

The database proof covers mailbox subscription admission, not Stripe provider
mutation. Existing Stripe entitlement tests continue to own those effects.
Completed: 2026-09-04
