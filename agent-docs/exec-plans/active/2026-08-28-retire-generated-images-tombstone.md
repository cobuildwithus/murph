# Retire generated-image compatibility tombstone

Status: active
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Remove the obsolete generated-image upload compatibility tombstone so the
  generic runner-effects 404 owns absent routes, while preserving the current
  private `vault_image` delivery path and its supported rollback floor.

## Success criteria

- No current source, runtime harness, or deployment guide routes the retired
  `/generated-images` upload path; one highest-boundary negative regression
  names it only to lock the generic 404 and diagnostic fallback.
- Unknown runner-effects paths continue to return 404 through the existing
  shared fallback.
- Current generated-image capture and attachment behavior remains owned by the
  private `vault_image` flow.
- Focused Cloudflare tests and typecheck pass.
- The exact pushed candidate receives the required preliminary and final
  ReviewGPT passes, and required PR checks are green before handoff.

## Scope

- In scope: delete the 410-only route, its route constant and dispatch branch,
  route-specific diagnostics, tombstone-only test harnesses, and stale current
  deployment documentation.
- Out of scope: changing private image capture, attachment delivery, legacy
  avatar input parsing, capture-retention tombstones, or the supported
  `vault_image` rollback floor.

## Constraints

- Technical constraints: keep one generic unknown-route fallback; add no
  compatibility abstraction or feature-specific replacement.
- Product/process constraints: preserve unrelated work, use the sanctioned
  task worktree and draft-PR lane, keep the PR draft, and do not merge.

## Risks and mitigations

1. Risk: a supported runner still calls the retired public upload endpoint.
   Mitigation: prove the current producer/consumer graph is empty and preserve
   the documented rollback floor that excludes pre-`vault_image` runners.
2. Risk: route deletion accidentally removes current private image delivery.
   Mitigation: limit deletion to the exact legacy path and run focused outbound
   plus hosted-local routing tests and Cloudflare typecheck.
3. Risk: stale docs imply an unsupported rollback path remains valid.
   Mitigation: remove only the public-route claim while retaining the explicit
   `vault_image` rollback contract and legacy avatar cleanup guidance.

## Tasks

1. Prove the old route has no current producer or consumer and locate its
   generic 404 owner.
2. Delete the compatibility route, route-specific diagnostics, and its isolated
   harness/tests; update current deployment documentation.
3. Run focused tests, typecheck, reference scans, diff/privacy review, and
   inspect the candidate architecture.
4. Commit and push the exact candidate, open a draft PR, run preliminary then
   final ReviewGPT sequentially on the requested lane while CI runs, and
   resolve only accepted findings within the workflow boundary.
5. Close the plan with the completion script after review and CI evidence, then
   push the final plan-only commit and report without merging.

## Decisions

- Retire the route completely instead of preserving a path-specific 404 test;
  the existing generic unknown-route tests own the absent-path contract.
- Remove the route-specific diagnostic label along with the route so requests
  to that path are classified through the generic effects-port fallback.
- Preserve all capture-retention tombstone behavior because it is unrelated to
  the removed HTTP compatibility route.

## Verification

- Commands to run: exact reference scans; focused runner-outbound and
  hosted-local tests; Cloudflare typecheck; privacy/diff inspection; PR checks;
  current-base merge-tree proof.
- Expected outcomes: no exact old-route references remain, generic 404 tests
  pass, current package types are valid, required review gates pass, required
  CI is green, and the branch cleanly merges with current `origin/main`.
