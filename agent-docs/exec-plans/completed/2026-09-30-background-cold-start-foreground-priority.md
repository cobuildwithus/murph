# Foreground priority during background cold startup

Status: completed
Created: 2026-09-30
Updated: 2026-09-30

## Outcome and invariants

Foreground admission can cancel an unlaunched background startup and use its normal
standby or cold allocation path. Background retains cold startup and never claims
pristine standby inventory. Keep the configured pool unchanged, one workspace writer,
exact target retirement, existing admission checks, and durable mailbox recovery.

## Evidence and ownership

A foreground ensure encountered a starting system-mailbox owner and returned
starting_fence_preserved. The existing claim precedes container readiness; standby
allocation is reachable only for fresh ownership. The background preparation therefore
held foreground admission despite having no launch authority yet.

Postgres remains the only ownership authority. Under the existing member/owner locks,
an admitted default claim transitions a starting system-mailbox owner with no workspace
version to retiring. Launch preparation uses the same locks: either launch wins and
foreground wakes the existing child, or retirement wins and stale launch is rejected.
RunnerContainer cancels readiness before waiting on its lifecycle lock, then proves
exact retirement before Postgres release and fresh foreground allocation.

## Scope and decisions

- Remove the superseded warm-only background implementation and deployment restriction.
- No schema, RPC shape, queue, pool sizing, or new persistent owner.
- Retain short foreground startup rechecks for launch-won and mixed-version cases.
- If no standby is available, foreground uses the existing cold fallback after exact stop;
  this can discard partial cold-start work. No absolute latency guarantee.
- Deploy cancellation-capable Cloudflare before Web starts prioritizing claims. Old
  Cloudflare remains safe but may wait for startup before stopping it. Rollback preserves
  the existing retiring state and recovery protocol.

## Product UX (Patch)

Outcome: foreground can proceed past unfinished background preparation.
Reaches: cold background alone; foreground overlap; launch-won active promotion; empty
pool; denied admission; uncertain stop; delayed stale background launch.
Proof: real Postgres lock races, container cancellation/retirement tests, orchestration
handoff tests, relevant typechecks, exact-head CI and final ReviewGPT. Production
message timing remains a post-deploy check; no deployment is included.

## Tasks

1. Replace warm-only policy with canonical pre-launch priority and readiness cancellation.
2. Prove both race orders, exact stop failures, background cold progress and pool isolation.
3. Update owner docs/changelog; run focused verification, typechecks and complexity review.
4. Obtain requested Opus review, final exact-head ReviewGPT and CI; update the existing PR.

## Verification

- Implementation complete: canonical conditional retirement, cancellable readiness,
  supplied-admission refresh and one-second foreground rechecks behind a starting background owner.
- Focused Cloudflare proof: 421 tests passed across runtime orchestration, native
  container lifecycle and standby lifecycle/coordinator suites. The orchestration
  suite passed again after the admission helper cleanup (60 tests).
- Real PostgreSQL proof: 76 tests passed on an isolated loopback database, including
  both lock acquisition orders, stale launch rejection, exact target release and
  denied foreground admission.
- Cloudflare and Web typechecks passed. Changelog validation: 39 tests passed.
- Complexity guard passed: no added debt; runtime processing maximum 20, owner
  maximum 15; existing runner lifecycle hotspots unchanged.
- Product UX: Ready for PR review. Both cold-only background and foreground with
  ready/empty standby inventory retain progress. Uncertain stop never grants a
  replacement; already-prepared background keeps the existing promotion path.
- Actual Claude Opus 5.5 review confirmed the fence and cancellation boundaries.
  Accepted immediate canonical re-admission after competing retirement/release,
  narrower background-only fast rechecks and stronger pool-exclusion proof.
  Added a 32-caller PostgreSQL burst proving one retirement and one successor.
  Rejected extra failure-reconciliation calls and idle cleanup policy: the public
  Temporal contract already retries activity errors and recovers retiring owners.
  Preemption covers all unlaunched preparation, including retained warm targets;
  no extra persistent readiness fact was introduced. Intentional cancellation
  retains existing startup-failure diagnostics; no paging rule change is in scope.
- Exact-head ReviewGPT/CI remain pending. No production
  deployment or external timing guarantee is included. Earlier warm-only evidence
  is superseded.

## Completion boundary

Implementation and local verification are complete. Opus findings were triaged
against current owners; the bounded release-race correction and focused proof
landed. The current main branch was merged without conflicts, preserving its
provider-egress changes. The PR retains its required exact-head external review
and CI gates, which are recorded in the PR evidence after this implementation
snapshot. Deployment remains separate.
Completed: 2026-09-30
