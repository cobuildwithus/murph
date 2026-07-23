# Remove hosted Linq pool serialization

Status: completed
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Stop rejecting activation or first-contact routing merely because another
  member is choosing a shared Linq home line at the same time.
- Keep the routing path small: serialize only same-member decisions, treat
  active-member limits as advisory, and claim daily proactive capacity
  atomically without making the user retry.

## Success criteria

- New route assignment has no global pool advisory lock or pool-busy error.
- Concurrent requests for one member still converge through the existing
  per-member transaction lock.
- Concurrent signup-welcome capacity claims internally try another eligible
  line before suppressing the welcome.
- A small concurrent overshoot of an active-member target is accepted instead
  of adding coordination state.
- Focused tests, canonical verification, required product review, CI, and both
  ReviewGPT stages pass for the exact PR head.

## Scope

- Hosted Linq home-line routing, advisory-lock helpers, and operator rehoming.
- Focused hosted-web routing, line-store, and concurrency tests.
- Current architecture, reliability, deliverability, and testing documentation
  that describes the removed lock.

## Constraints

- Preserve same-member route stability and existing-route reuse.
- Preserve the atomic daily proactive-conversation cap.
- Preserve ordinary bounded retries for genuine transient failures.
- Do not add a queue, lease, lock manager, new persisted state, or user-visible
  retry path.
- Avoid webhook files owned by the active hosted-ingress repair lane.

## Tasks

1. Delete global pool lock acquisition and the two-phase pool-claim branches.
2. Add bounded in-request fallback when an atomic daily capacity claim loses.
3. Update focused regressions and remove the obsolete PostgreSQL pool-lock test.
4. Update current documentation to distinguish advisory balancing from atomic
   deliverability capacity.
5. Run canonical verification, product review, preliminary specialist review,
   parent final review, final ReviewGPT, CI, and mergeability proof.
6. Close the plan and create the exact pushed head for the final PR gate.

## Decisions

- Keep `activeMemberLimit` as a best-effort selection input for now; its
  configured value remains deploy-compatible, but it no longer serializes all
  members or creates a hard admission failure.
- Keep the daily proactive limit as the only atomic shared-pool capacity gate
  because it protects deliverability and already has a lock-free conditional
  update.
- Manual rehome changes route ownership but does not send or open a proactive
  conversation. It therefore checks only member ownership and target
  assignability; applying proactive-send quotas there would require needless
  shared coordination around a non-sending operation.
- Retry a failed atomic claim once on the same line to absorb a UTC-day rollover
  race, then try the remaining daily-eligible lines within the same request.
  Genuine thrown database failures continue through the existing bounded
  service retry path.

## Verification

- Focused hosted-web routing/store/ops tests: 244 passed.
- Hosted-web TypeScript check: passed.
- Direct PostgreSQL final-slot concurrency proof: passed; one of two concurrent
  claims won and the persisted counter stopped at the configured limit.
- Post-remediation `pnpm test:diff <touched paths>`: passed, including 6,275
  hosted-web tests, lint, development smoke, and the production build.
- `pnpm docs:drift`: passed after refreshing the durable-doc index.
- Post-remediation `pnpm verify:acceptance`: passed, including repository
  guards, workspace typechecks, 6,275 hosted-web tests, package coverage, app
  verification, package boundaries, and the production build.
- Independent `product-experience-review`: `NO FINDINGS`.
- Preliminary `completion-specialists`: findings. Accepted the two coverage
  gaps by proving real PostgreSQL blocking overlap and the all-claims-lost
  fallback. Resolved the rehome concern by deleting the obsolete non-atomic
  assignment-count gate: manual rehome does not send, while the actual
  proactive-send counter remains the hard atomic owner.
- Parent final review: no findings after inspecting activation, inbound
  first-contact routing, retry/fallback behavior, the atomic line-row claim,
  and manual rehome.
Completed: 2026-07-23
