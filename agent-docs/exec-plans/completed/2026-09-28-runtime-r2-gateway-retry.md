# Retry transient snapshot gateway responses

Status: completed
Created: 2026-09-28

## Outcome and scope

A transient 502 or 504 during snapshot upload receives one existing bounded
retry before execution falls back to durable recovery. Both conditional direct
PUT and managed multipart uploads use the same corrected status classifier.

## Design and boundaries

Add only 502 and 504 to the existing retryable status set. Preserve two attempts,
jitter, the original presigned deadline, cancellation, immutable upload binding,
and completion verification. An HTTP error followed by 412 still fails closed.
No schema, scheduler, state owner, or wire protocol changes.

Old and new Worker/container versions remain compatible. The normal managed
Cloudflare rollout must converge runner images to deliver the correction.
Persistent failures continue through existing durable runtime recovery.

## Completed evidence

- Both synthetic 502-to-success fixtures fail on the original classifier.
- All 280 runner-platform tests pass, including the 30-case HTTP response,
  upload-mode and outcome matrix plus cancellation, expiry and authority checks.
- Cloudflare and repository-tools typechecks pass. Existing Frog #2378 covers
  ordinary Prisma generation required by the fresh checkout.
- All 10 changelog rendering tests pass. Complexity and documentation checks
  pass; the existing upload function remains at complexity 27, with no branch added.
- The Web-only ESLint configuration ignores Cloudflare paths and is not lint proof.
- Parent final review confirms the two-entry correction and preserved ownership.
- Mountain ReviewGPT returned PASS on
  `c2ef47d2b3faaa3eec72dd2f21067c863ed6cb06`, after more than four minutes.
  The selected GPT-6 Pro model, exact committed turn, archive and response digest
  were verified. No findings were received or accepted. The review traced both
  upload modes, retry bounds, conflicts, cancellation, authority and publication.

## Tooling recovery and release handoff

Earlier review attempts were invalid. Upstream PR #3713 now owns the complete
UI, capture and dependency-context repair. Base reconciliation selected its exact
patch and lockfile; the temporary branch-only tooling proof was removed. Combined
tooling tests passed (50 before that removal). No separate tooling behavior
remains in this PR. The task-owned Frog entry records that upstream resolution.

Required CI passed on the previous candidate. Final documentation closure needs
its own required CI; the valid review remains applicable because production code
is unchanged. Merge and production deployment are explicitly authorized and
remain gated on final-head CI. Use the protected private Cloudflare deployment
workflow with full predeploy gates, gradual rollout, smoke and convergence proof.

## Privacy

All fixtures and committed evidence are synthetic. No production rows, private
identifiers, incident timestamps or raw logs are included.
Updated: 2026-09-28
Completed: 2026-09-28
