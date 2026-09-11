# Let production candidates finish while main advances

Status: active
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and invariant

Public main merges must not cancel an active release candidate or invalidate its
exact-commit proof. Only tested protected-main history can be admitted; live
Temporal reader, routing, target and private-controller freshness remain required.

## Ownership and evidence

Host Support cancels main checks by branch. Web admission independently cancels
by workflow and rejects public head movement. Private hosted integration also
requires public-head equality and selects that moving head for build output.
Existing workflow runs, immutable SHAs, Git ancestry, and Vercel managed Git
promotion remain the owners. No persisted release state or new deploy owner.

## Scope and approach

- Keep required public main checks independent by SHA; PR cancellation unchanged.
- Preserve pending Stripe sandbox proof with GitHub queue: max; sandbox stays serialized.
- Serialize Web admission without canceling active proof; GitHub retains the newest pending run.
- Replace public-head equality with exact ancestry validation at existing boundaries.
- Build and test the requested public SHA throughout private release admission.
- Preserve exact private main, live reader lifecycle, routing, target and proof digests.
- Vercel remains the sole promotion owner; no CLI promotion or guard bypass.

## Failure and rollout

Malformed, missing, diverged, failed or mismatched evidence fails closed. A new
private controller or live reader set still needs fresh proof. Land the private
consumer first; old public code remains stricter until the public change lands.
No runtime schema or protocol change and no new credential authority.

## Verification

Focused public controller and workflow-policy tests; private admission/source and
workflow tests; applicable typechecks and private pnpm verify. Parent diff review
and required final ReviewGPT before merge readiness. Hosted production promotion
ordering remains a platform-owned integration proof, not a local mock guarantee.

## Tasks

1. Implement candidate-preserving checks and public ancestry admission.
2. Prove pinned private build output and fail-closed invalid ancestry.
3. Update durable owners, inspect privacy/complexity, commit and review.

## Progress

- Confirmed cancellation and public-head equality through current workflows and code.

- Implemented public ancestry and pinned private build selection; focused public
  controller/policy tests (78), billing workflow tests (29), private admission/source
  tests (63), tooling typecheck and complexity check pass.
- Private full verification is running. Final reviews and exact-head CI remain required.
