# Preserve lost-result recovery while reducing cleanup reads

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal and protected invariant

Reduce unnecessary idle-cleanup owner calls without delaying canonical lost-result
completion recovery or weakening exact native stop authority.

## Owners and evidence

Postgres remains runtime ownership authority. Native invocation receipts prove
execution completion, not canonical acknowledgment. The existing container
lifecycle alarm owns recovery and the locked native health check owns stop safety.
The original early warmth veto prevents main's newly added recovery: the same
reactivation/warmth matrix fails both warm cases on the PR and passes all four
against the actual merge-base-side implementation. No production data is needed.

## Scope and decisions

- Preserve the existing PR, published history, and both sides of documentation conflicts.
- Keep early local vetoes when there is no bound completed native receipt.
- For completed receipts, retain canonical reconciliation before warmth, including
  the existing short retry on failed or ambiguous completion. No new state, cache,
  acknowledgment field, scheduler, or RPC is introduced.
- Keep owner calls outside the lifecycle lock and the final locked local checks.
- No Web/schema change or deployment ordering dependency; old controllers retain
  their prior behavior. Parent coordinates merge and production deployment.
- Savings are narrower than the original patch: a completed warm native invocation
  still needs canonical reconciliation. Do not claim measured production savings.

## Product patch

Outcome: drained lost-result owners recover without waiting for another message.
Reaches: warm and expired shells, including Durable Object reactivation.
Proof: composed lifecycle tests preserve canonical release, no early destruction,
short recovery retries, and unchanged no-receipt request suppression.

## Tasks

1. Reconcile current base and reproduce the warm recovery regression.
2. Narrow the preflight using existing native receipt evidence; extend recovery proof.
3. Run focused suites, Cloudflare typecheck, complexity and doc guards.
4. Complete candidate review, original-PR evidence, required ReviewGPT and exact-head CI.

## Verification

- Baseline differential: four recovery matrix cases pass on the base; two warm
  cases fail with the original PR preflight. Exact source restored afterward.
- Four focused lifecycle/completion/container/outbound suites pass: 765 tests.
- Cloudflare typecheck passes after the documented local Prisma generation.
- Complexity guard passes: debt 67 to 67, maximum 72 to 72; existing hotspots
  are unchanged and outside this correction. Documentation drift passes.
- Product replay: Ready at the deterministic lifecycle boundary. Warm/expired and
  reactivated shells recover matching completions; failure retains the 60-second
  retry and no destruction; no-completed-receipt warmth suppresses owner polls.
- No public changelog: preserve the existing recovery contract while narrowing an
  internal request optimization. No member-visible feature or protocol change.
- Merge and shipment remain pending final ReviewGPT, exact-head CI and the
  release coordinator's protected deployment and operational verification.
Completed: 2026-10-20
