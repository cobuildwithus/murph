# Cold-start control-plane observability

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Make the accepted-to-runner-job interval attributable to its Cloudflare
  control-plane phases.
- Make runtime-processing retry reasons available as private aggregate
  telemetry.
- Report direct web cold starts separately from Temporal recovery attempts so
  recovery tails do not distort the direct-start percentile.

## Success criteria

- The runtime trace distinguishes Durable Object dispatch, consent-lock wait,
  health-data admission, and runner-state read time using timestamps captured
  around existing operations.
- Retry reasons are written to a private aggregate dataset only on the existing
  `retry_later` path, without identifiers or payloads.
- Operators have a repeatable aggregate report with causal direct cold starts
  separate from Temporal-recovery and Temporal-only activity timing.
- The successful hot path gains no new network, storage, timer, or awaited
  operation.
- Focused tests, typechecking, exact-head CI, and required review gates pass.

## Scope

- In scope:
  - Hosted runtime latency phase schema, parsing, and Cloudflare timestamp
    capture.
  - A Cloudflare Analytics Engine binding for aggregate retry-reason counts.
  - A read-only operator report over existing ingress trace rows.
  - Focused validation of the already-shipped accepted-attempt failure recheck.
- Out of scope:
  - New queues, schedulers, retry owners, or synchronous telemetry calls.
  - Changes to member-visible behavior or retry delays.
  - A duplicate accepted-attempt failure callback. The existing callback
    already claims a bounded recheck and signals the owning Temporal workflow.
  - A new operations UI.

## Constraints

- Timestamp capture may use only in-process clock reads and immutable object
  updates around operations that already exist.
- Analytics Engine writes must be unawaited and occur only after the runtime
  has already chosen `retry_later`.
- Aggregate dimensions must not include member, mailbox, attempt, or payload
  identifiers.
- Health-data admission outcomes must not enter the retry analytics destination,
  even without identifiers; the prior 60-second denial response remains local
  to the consent boundary.
- Keep Cloudflare execution, Web product state, and Temporal recovery ownership
  boundaries unchanged.

## Risks and mitigations

1. Risk: extra observability increases cold-start latency.
   Mitigation: add no I/O or await to successful processing; verify the diff and
   tests explicitly assert the write occurs only on `retry_later`.
2. Risk: new timestamps are misread as independent clocks.
   Mitigation: use the existing epoch-millisecond trace convention and derive
   only same-request intervals with chronology guards in the report.
3. Risk: mixed direct and recovery samples preserve the misleading tail.
   Mitigation: require one Web-owned request/response marker pair matching the
   current Cloudflare route, omit ambiguous attempts, and report Temporal
   activity timing separately.
4. Risk: duplicate recovery machinery creates multiple correctness owners.
   Mitigation: retain the existing accepted-attempt failure recheck and validate
   its focused concurrency and route tests instead of adding another path.

## Tasks

1. Extend the hosted latency schema and parser with control-plane timestamps.
2. Capture those timestamps around the existing Durable Object, consent,
   health-data admission, and state-read operations.
3. Add private retry-reason aggregate telemetry and deployment configuration.
4. Add and document the cohort-aware read-only latency report.
5. Run focused tests, typechecking, diff and latency-path review.
6. Commit and push the candidate, open the PR, run ReviewGPT with CI, resolve
   accepted findings, and close this plan.

## Decisions

- The separate recovery PR requested for item 3 is intentionally unnecessary:
  the production path already emits `runner.accepted_attempt_failed`, claims a
  cooldown-protected recheck, and signals the owning Temporal workflow before
  runtime-log persistence. A duplicate path would violate single ownership.
- Use Analytics Engine for retry aggregates because `writeDataPoint()` is a
  synchronous, immediate enqueue API and does not require `await` or
  `waitUntil`. The write is off the successful path and excludes health-data
  admission outcomes.
- Use a checked-in aggregate SQL report instead of a new operations screen.
  This keeps production request paths untouched and makes cohort definitions
  reviewable and repeatable.
- A runtime attempt is invocation-level and can be fanned out to more than one
  mailbox trace. Direct accepted-to-runner latency therefore uses only the one
  row whose Web-only response marker matches the current direct request and
  Cloudflare route within five seconds; no unique match means no sample. Warm
  direct wakes create no new runner job and are omitted. Temporal attempts use
  activity-to-runner timing from one unambiguous attempt stamp instead of a
  mailbox acceptance chosen by row order.

## Verification

- Hosted-execution latency contract test: 32 passed.
- Cloudflare control-plane, retry telemetry, production Durable Object,
  deploy-config, and local-config tests: 147 passed.
- Hosted-local harness environment tests: 94 passed.
- Existing accepted-attempt failure emission tests: 23 passed.
- Existing accepted-attempt failure Web callback tests: 62 passed.
- Cloudflare, hosted-execution, and hosted-local-harness typechecks: passed.
- The aggregate cold-start SQL report executed successfully through the
  read-only production helper and returned only cohort/phase aggregates.
- Exact SQL PostgreSQL fixture: 3 passed, including backlog-versus-causal row
  selection, racing-direct omission, Temporal deduplication, missing stamps,
  reversed phases, and invalid chronology.
- ReviewGPT preliminary specialists: coverage findings accepted and resolved;
  the production Durable Object binding, non-zero timestamp boundaries, exact
  SQL fixture, and retry query/writer schema contract are now covered.
- ReviewGPT final round 1: privacy and causal-attribution findings accepted and
  resolved; consent denial emits no analytics/log event and the report no
  longer selects the oldest mailbox row or reports warm accepted-to-runner
  latency.
- Corrected Cloudflare focused tests: 121 passed, 1 opt-in PostgreSQL test
  skipped in the default lane; the opt-in PostgreSQL lane passed all 3 report
  tests.
- Corrected Cloudflare typecheck: passed.
- `git diff --check`: passed.
- Pending: corrected-head ReviewGPT, exact-head CI, parent final review, plan
  closure, and mergeability proof.
