# Diagnose stalled Junction workout-stream sync without dropping data

Status: completed
Created: 2026-08-23
Updated: 2026-08-23

## Goal

- Ship one production diagnostic release that identifies whether a Junction
  workout stream is empty or exceeds the admitted timestamp bound, including
  the exact bounded cardinality metadata needed to design a data-preserving fix.

## Success criteria

- Existing device-sync retry, terminalization, and canonical-import behavior is
  unchanged.
- `device-sync.job_failed` records the workout-stream timestamp cardinality
  kind, observed count, and configured maximum without identifiers, timestamps,
  metric values, or raw provider payloads.
- Focused reducer, device-sync service, and hosted-runtime log tests pass, along
  with the affected package typechecks.
- The guarded PR is reviewed, green, merged, deployed, and the next production
  failure reveals the exact malformed shape.

## Scope

- In scope: bounded reducer error metadata, device-sync diagnostic projection,
  hosted-runtime log projection, focused tests, PR/review/CI, production runner
  deployment, and read-only post-deploy observation.
- Out of scope: dropping or skipping provider workouts, mutating canonical
  health data, changing job retry semantics, or implementing the recovery fix
  before the diagnostic evidence arrives.

## Constraints

- Technical constraints: use the existing structured failure channel and the
  receiver's additive metadata contract; keep the change runner-only; retain
  exact current failure behavior.
- Product/process constraints: preserve provider and canonical data, log no
  direct identifiers or raw health payloads, use the repository worktree/PR and
  production deployment gates.

## Risks and mitigations

1. Risk: diagnostic fields expose more health information than required.
   Mitigation: emit only cardinality kind and integer counts; never emit workout
   identity, timestamps, series values, metric arrays, or raw response bodies.
2. Risk: an additive log field is rejected by the deployed Web receiver.
   Mitigation: use field names admitted by the existing generic metadata-key
   contract and cover the emitted request through the shared parser.
3. Risk: instrumentation changes failure or recovery behavior.
   Mitigation: preserve the existing error message, job code, retryability, and
   throw point; assert these through the service boundary.

## Tasks

1. Trace the bounded reducer failure through device-sync and hosted logging.
2. Add a typed cardinality error and safe diagnostic projection.
3. Add focused reducer, service, and hosted log tests.
4. Verify, review, merge, and deploy the exact candidate.
5. Query the next matching production failure and classify the root cause for
   the recovery-preserving fix.

## Decisions

- Keep this release diagnostic-only so production evidence determines the fix.
- Emit exact counts because they are bounded aggregate metadata and distinguish
  an empty provider response from a policy overflow without exposing samples.
- Reuse the generic hosted redacted-metadata contract to avoid a Web deployment.

## Verification

- Commands to run: focused Vitest files for importers, device-syncd, assistant
  runtime, and hosted-execution parsing; affected package typechecks; repository
  PR gates and exact-head CI.
- Expected outcomes: all checks pass, emitted logs contain the three new fields,
  and privacy assertions prove no raw workout or provider payload escapes.
Completed: 2026-08-23
