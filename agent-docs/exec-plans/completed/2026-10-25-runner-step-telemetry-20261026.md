# Preserve runtime processing failure location

Status: completed
Created: 2026-10-26
Updated: 2026-10-25

## Goal

Distinguish which existing runtime startup operation fails using the current persisted processing-summary pipeline, without changing execution or recovery behavior.

## Success criteria

- ReviewGPT authors a minimal observation using a finite source-owned operation vocabulary.
- Focused synthetic tests prove failures at different operations produce distinguishable persisted metadata, preserve thrown results, and do not pollute normal success or concurrent commands.
- Existing parser accepts the metadata without widening raw-text permissions; late parallel failures cannot mutate a detached summary.
- Parent review, focused tests, Cloudflare typecheck, final ReviewGPT and required exact-head CI pass before merge and canonical deployment.

## Scope and constraints

- Existing runtime-processing steps, request-local diagnostics, and runner.processing_finished telemetry only.
- No raw error messages, identifiers, payloads, stacks, new monitoring state, callbacks, retry changes, timeout changes, or recovery actions.
- Runtime actions and public responses stay under existing owners.

## Evidence and decision

- The step catch emits its operation name only to Worker logs; the durable summary records broad fresh_start/threw without that location. Historical Worker-log access is unavailable in this environment.
- Existing synthetic processing/summary tests pass (74 tests); no evidence justifies altering startup policy.
- This is independent of retention admission ordering in the existing orchestration PR; it changes no admission decision.

## Tasks

1. Obtain and inspect ReviewGPT-authored observation and regression proof.
2. Prove the old observation gap and the corrected metadata path; run focused tests and typecheck.
3. Commit a reviewed candidate, open draft PR, then run final ReviewGPT with required CI.
4. Merge and deploy only after gates pass; verify serving revision and natural affected outcomes.

## Verification

- ReviewGPT authored the patch and proof in a verified GPT-6 Pro response. The parent inspected all changes: one finite operation type and one catch-path scalar assignment; no execution policy changed.
- Before implementation, focused processing/summary proof had 18 failures and 76 passes because operation metadata was absent. With the patch, all 94 tests pass under Node 24.22.1.
- Cloudflare typecheck passed after the standard local Prisma client generation prerequisite. Its initial failure was only missing generated Prisma types, already covered by an existing Frog entry.
- Complexity guard passed: production maximum 20 to 20, debt zero to zero, no hotspots over 20. Diff whitespace and privacy checks pass.
- The parser already accepts the field and rejects unsafe diagnostic values. Valid success, recovered standby failure, timeout retries, exact thrown identity, concurrent commands and late sibling snapshot behavior are exercised.
- Implementation and focused proof are complete. Final exact-head review, required CI, merge/deployment and natural production observation remain external completion gates; their results belong to the PR and sweep memory.
- Observation heartbeat capability remains unavailable; do not imply four-hour observation has completed.
Completed: 2026-10-25
