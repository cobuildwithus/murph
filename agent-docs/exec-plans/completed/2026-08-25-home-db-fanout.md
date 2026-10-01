# Bound hosted Home database fanout

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Reduce authenticated Home's composed peak database concurrency without weakening independent fallback behavior or adding another data owner.

## Success criteria

- Initial-onboarding/contact and messaging/routing advisory projections no longer overlap.
- Either projection can still succeed when the other rejects.
- Normal authenticated Home peak is mechanically bounded below five simultaneous page/layout database owners.
- When both completion markers are present, the losing connected-app resolver is not started.
- Focused Home tests, exact-head ReviewGPT, and required PR checks resolve.

## Scope

- In scope: Home server-component orchestration and focused composed-concurrency/error tests.
- Out of scope: combining owner projections, changing authentication/access/usage/consent checks, device completion per-connection crypto fanout, or UI redesign.

## Constraints

- Technical constraints: preserve `allSettled`-equivalent independent results; serialize only advisory reads; keep device completion priority when URL markers conflict.
- Product/process constraints: member-visible reliability/performance patch with Product UX and coverage specialist lenses plus sensitive final ReviewGPT.

## Risks and mitigations

1. Risk: Naive promise chaining lets one advisory failure suppress the other.
   Mitigation: settle each operation independently while sequencing their start.
2. Risk: Serialization adds latency.
   Mitigation: restrict it to two advisory projections and prove required access/usage/consent work remains parallel.

## Tasks

1. Add a deferred-promise composed-concurrency test and sibling-failure regressions.
2. Sequence the two advisory projections and avoid starting the losing completion resolver.
3. Run focused Home/layout tests and Product UX walkthrough for ordinary, degraded, and dual-marker paths.
4. Commit, push, open the draft PR, launch both ReviewGPT stages in parallel with CI, resolve findings, close this plan, and push the final scoped commit.

## Decisions

- Prefer sequencing over a combined projection because existing owners have different crypto/failure boundaries.

## Verification

- Commands to run: focused dashboard Home page/layout/device completion tests, Web typecheck when needed, and `git diff --check`.
- Expected outcomes: peak start count is bounded, sibling failure remains isolated, and visible fallback behavior is unchanged.
Completed: 2026-08-25
