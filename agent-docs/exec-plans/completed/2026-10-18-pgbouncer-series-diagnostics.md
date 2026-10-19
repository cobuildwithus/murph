# Diagnose unavailable PgBouncer metric families

Status: completed
Created: 2026-10-18
Updated: 2026-10-18

## Goal and invariant
Distinguish unavailable PgBouncer current-connection series at the existing database-health warning without exposing labels or changing monitoring decisions. Missing metrics remain unknown, never zero.

## Evidence and owner
The existing Postgres-state provenance describes a different family. Synthetic absent, other-branch, replica, unknown-role, and missing-pod inputs cannot currently be distinguished. Earlier monitoring PRs changed failure counting and Postgres-state normalization; inspected diffs do not provide PgBouncer provenance. Deletion or reordering cannot recover discarded observations; extend the existing parser and failed-collection warning only.

## Scope and constraints
Use existing parsed observations, fixed numeric fields, and the existing at-most-two scrape bound. No label values, extra requests, new log events, storage, schemas, retries, thresholds, alert behavior, or device-sync changes. ReviewGPT authors substantive source changes. This isolated checkout owns the patch; the other startup-observation chat keeps its own heartbeat. Internal diagnostics need no member-facing changelog.

## Tasks
1. Prove the diagnostic gap with synthetic metrics against current source.
2. Have ReviewGPT implement the smallest extension of current provenance.
3. Verify before/after parser and monitor behavior, privacy, call counts, typecheck, complexity, and parent review; publish a scoped PR.
4. Finish final ReviewGPT and required CI, merge, canonically deploy, verify serving revision, and observe for four hours through native heartbeat.

## Risks and deployment
Counts describe metric provenance, never health. Fixed numeric shape and synthetic privacy tests prevent label disclosure. No persisted contract changes or skew concern; deploy the ordinary Worker through the canonical release workflow. The underlying missing-metric cause remains unresolved until natural observations distinguish it.

## Verification
Focused database-health parser/monitor tests must expose the gap on base and pass after the change while retaining incomplete, recovered, alert and provider-count behavior. Then Cloudflare typecheck, complexity:diff, documentation/privacy checks, exact pushed-head ReviewGPT and CI. Record actual rollout and natural field exercise separately from local proof.

## Implementation evidence
ReviewGPT authored the five-file implementation using synthetic inputs. Parent review confirms the reused role summarizer adds fixed counts from already parsed points; no additional provider calls, logs, persisted fields, conditions, or recovery owner. The warning retains at most two parsed observations and includes the new field only for its missing metric.

Before applying source changes, the new tests produced 12 expected assertion failures with 132 existing/scenario assertions passing. With the patch, all 144 parser and monitor tests pass. Cloudflare typecheck and documentation drift pass. The complexity guard reports unchanged debt and maxima in both source files. The parser hotspot only gains count derivation; alert admission, snapshot evaluation, and discovery hotspots retain their existing decisions. Further extraction would add scope without improving this narrow observation.

A separate canary investigation ran 55 focused existing tests successfully; it does not establish production delivery or justify a timeout change. Production evidence, unfinished observations, and other owners remain in automation memory, outside the public repository.

## Final implementation review
Final ReviewGPT returned PASS on `09be3246fba1943c9064dd96e58db21d3ddc9f26`, with no qualifying bugs or material complexity findings. The parent reviewed the parser-to-warning path, fixed output shape, collection bound, null semantics, and composed recovery again. The reviewed source, tests, and README remain unchanged during this plan-only closeout.

Implementation is complete. Required CI on the final authored head, merge, canonical deployment, exact serving-revision verification, and the four-hour production observation remain release gates owned by the original automation chat. No deployment or production recovery is claimed by this plan. Their live status and unresolved production questions remain in automation memory.
Completed: 2026-10-18
