# Attribute rejected hosted checkpoint stages

## Outcome and invariant

Identify which existing Web checkpoint stage rejects a request, without changing checkpoint authority, publication, responses, retries, or user outcomes. Operational telemetry only; no member-visible changelog.

## Evidence and ownership

A generic invalid-request checkpoint response cannot distinguish request parsing, runtime authority resolution, publication, and response parsing. The existing snapshot-stage log only identifies the callback. Synthetic route cases must establish this ambiguity. Later checkpoints do not prove that an earlier exact source state was accepted.

The existing checkpoint route and Vercel failure-log pipeline own the observation. Use fixed schema, stage, and bounded error class only, once on an authenticated failed request. No IDs, values, payloads, paths, arbitrary errors, or new I/O. Keep unauthenticated failures under the existing handler. Do not attach diagnostic fields to public errors or persisted state.

PR #3723 changes timing and unchanged-snapshot bookkeeping in this route and publication owner; its inspected diff does not classify rejection stages. This independent diagnostic must compose without changing that owner. PR #3719 concerns delayed Linq delivery, and #3728 event-read cost; neither owns this question. Preserve all foreign worktrees.

## Smallest change

Have ReviewGPT add failure-stage observation at the route boundary using the existing metadata-only logging pattern. Reordering or deletion cannot recover erased historical stage information. No schema, migration, shared abstraction, new state, protocol, queue, retries, configuration, dependencies, or provider operations.

## Verification

- Extend real route composition tests for different failures with the same HTTP 400; assert distinct stages, exact unchanged response, no new observation on success or pre-auth failure, and logging-failure isolation.
- Include malformed and sentinel-bearing private synthetic values; assert exact allowlisted metadata.
- Run focused internal-route/publication tests, Web typecheck, lint/privacy/docs/complexity/diff checks.
- Parent review, scoped commit/draft PR, final ReviewGPT on stable pushed candidate concurrently with required CI.
- If telemetry-only gates pass, normal protected merge and canonical Web admission; verify exact serving revision and natural traffic without provoking failures.

## Status

ReviewGPT implemented the route and 15 composed cases. Parent extracted the same
failure-isolated warning into one private local helper to keep the request
callback within the complexity threshold; no shared logging layer or new owner.

Original route: 12 new diagnostic assertions fail while existing response
assertions pass; three quiet-path cases pass. Patched route: all 140 focused
internal-route/publication tests pass. Schema and publication failures have
identical 400 response bytes/headers but distinct stages; all five stages,
response construction after signal scheduling, hostile synthetic fields,
success/conflict silence, pre-auth silence and throwing logger are covered.
Parent source comparison proves the existing authenticated body identical after
removing observation and inlining the two local temporaries; auth/first-invocation
and asynchronous signal owner are byte-identical. No awaited operations added.

Web typecheck, focused lint, docs drift, raw-log privacy guard and whitespace
checks pass. Complexity: debt remains zero, maximum 19 to 20, no hotspots above
20. The private helper isolates classification/logging without moving product
logic. Existing reader/caller contracts and public responses are unchanged;
only new Web emits the optional event. No production traffic generated.

Candidate and final parent reviews complete. Final ReviewGPT round 1 passed
with zero findings on `a103e63ecab320c127949f7fefa656f2818dbced`; exact
prompt/attachment/head/response identity and explicit 6 Pro selection verified,
with more than 180 seconds elapsed. No source remediation required.

PR #3733 retains this immutable first-reviewed head. The closeout changes only
this plan, its index reference, and the required public-safe Frog record for
PostgreSQL service-image rate limits encountered during exact-head CI. Both CLI
matrices and the billing boundary passed on the reviewed candidate; three Web
jobs failed in container initialization before tests because of registry rate
limits. Final-head CI, any bounded retry, protected telemetry-only merge and
canonical Web deployment remain separate gates tracked on the PR and automation
handoff. This completed plan records implementation evidence, not deployment
success. No functional fix, production replay or state mutation is included.
Status: completed
Updated: 2026-09-28
Completed: 2026-09-28
