# PR 607 Durable Usage Notice Route

## Goal

Correct PR #607's ReviewGPT finding by deriving proactive thread usage-limit
notice targets from durable provider-accepted assistant inputs instead of the
transient mailbox import batch.

## Constraints

- Keep PR #570 as the stacked base and preserve PR #607's exact-thread-only
  delivery behavior.
- Treat durable assistant input events as the route-provenance source of truth.
- Never combine direct, missing, invalid, or different-thread input provenance
  into a group delivery target.
- Keep usage persistence and notice delivery outside the foreground reply path.
- Delete the redundant transient notice-target projection rather than adding a
  second fallback or persisted state owner.

## Plan

1. Carry the provider-accepted assistant input IDs into the existing deferred
   usage flush.
2. Resolve one exact group route from durable input events after the foreground
   checkpoint, choosing the newest accepted message only when all inputs prove
   the same route.
3. Delete transient mailbox/batch notice-target plumbing.
4. Add restart, backlog, direct, mixed, missing, and invalid-route regressions.
5. Verify, commit, push, and rerun ReviewGPT and CI on the corrected head.

## Verification

- The four changed assistant-runtime files passed together: 404/404 tests. The
  coverage-audit improvement that reverses accepted-ID order then passed its
  exact named regression independently.
- Assistant runtime, Cloudflare, and web typechecks passed. The full assistant
  runtime sweep passed 1,569 tests and hit one unrelated foreground-wake timing
  timeout; that exact test passed independently after concurrent load ended.
- Documentation drift, `git diff --check`, and the privacy scan passed.
- Required security/privacy re-audit found zero medium-or-higher findings.
  Required coverage-write found no unresolved material gap and strengthened
  the durable timestamp-order proof.
- ReviewGPT and GitHub CI remain the pushed-head gates.

## State

Implementation, local verification, and specialist audits complete; ready for
the scoped commit, push, ReviewGPT rerun, and CI.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
