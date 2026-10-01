# Keep paused checkpoint requests alive in the outbound Worker

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal and reproduced cause

Unblock the authorized unified runner merge and protected rollout. The prior request-owned deferred promise fixed a hibernated control-object context, but the actual outbound Worker has no pending I/O while awaiting that promise. Workerd cancels the request as hung. An ordinary Wrangler regression reproduces the same error for two Worker requests while two Durable Object requests resume successfully.

## Implementation

Keep only the shared release flag. Each waiting checkpoint polls it using a short request-owned timer, preserving pending I/O and avoiding callbacks across request contexts. Exit on abort and keep the original abort rejection before the real checkpoint handler. Extend the existing real-workerd regression to cover both request contexts through the actual barrier implementation after the separate control object hibernates.

## Verification and completion

- Before: expanded real-workerd regression fails with hung-request errors for both Worker requests.
- After: all four real-workerd requests resume; both focused files pass (25 tests). Cloudflare typecheck, docs drift, complexity and diff checks pass. Changed source has no hotspots above 20, maximum 15 unchanged.
- Parent review: the existing barrier object remains captured across release/re-arm, all waits observe explicit release, aborted requests cannot publish, and each wait has only one pending timer with at most a 25 ms release-observation delay. Production imports remain excluded by existing controls. Final ReviewGPT is exempt for test-only tooling; no member-visible changelog applies.
- Merge the test-only follow-up after exact-head CI, then rerun private integration before the companion merge and protected production rollout. No production deployment is claimed by this plan.
Completed: 2026-09-05
