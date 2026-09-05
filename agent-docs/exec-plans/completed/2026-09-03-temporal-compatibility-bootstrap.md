# Temporal Compatibility Controller Bootstrap

## Outcome

Make the protected public Temporal compatibility gate dispatch the exact current
private `main` controller before PR #2683 expands the producer fixture, so the
full release-admission change can be evaluated against the live supported-reader
set instead of the retired static reader policy.

## Root Cause

The compatibility workflow intentionally executes trusted default-branch code.
PR #2683 therefore cannot use its own controller changes during required PR
validation: the current default controller dispatches an immutable private tag
whose static reader matrix rejects a producer field added by that same PR. The
new private-main controller and its dynamic reader discovery exist, but they can
only become the trusted evaluator after a separate compatible bootstrap lands.

## Constraints

- Keep the producer fixture and all runtime code unchanged.
- Preserve trusted default-branch execution, same-repository human authority,
  exact public-head revalidation, exact returned-run ownership, bounded token
  lifetime, and fail-closed cancellation.
- Dispatch and revalidate one exact private `main` SHA; never execute public PR
  code in the protected environment and never guess a private workflow run.
- Add no compatibility bypass, static replacement policy, queue, persisted
  state, dependency, or production deployment mutation.

## Work

- [x] Replace the pinned private tag policy with exact private `main` resolution.
- [x] Add deterministic controller and workflow contract coverage, including
  private-head movement and bounded cancellation behavior.
- [x] Update the durable security, reliability, orchestration, architecture, and
  test-map contracts for the bootstrap boundary.
- [x] Run focused tests, syntax/docs/diff checks, repository-wide typecheck, and
  complexity/privacy review.

## Verification

- `node --check scripts/hosted-orchestration-compatibility.mjs` passed.
- `node --test scripts/hosted-orchestration-compatibility.test.mjs` passed
  37/37.
- `pnpm docs:drift` passed.
- `pnpm typecheck` passed across all workspace packages and apps.
- `pnpm complexity:diff` passed with zero added complexity debt and a maximum
  changed-file complexity of 19.
- `git diff --check` passed.

## Result

The trusted controller now resolves private `main` immediately before dispatch,
binds the returned first-attempt workflow run to that exact commit, accepts only
the fixed private workflow and attested reader matrix, and revalidates both the
public pull-request head and private `main` before success. The producer fixture
is unchanged, so the incumbent required check can validate this bootstrap. The
follow-on PR can then add the expanded fixture under the newly trusted live-reader
controller without a bypass or static replacement policy.

Status: completed
Updated: 2026-09-03
Completed: 2026-09-03
Completed: 2026-09-03
