# Device webhook Queue partial metrics

Status: active
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Stop valid partial Cloudflare Queue observations from masquerading as total
  monitoring failures while preserving alerts for real queue API loss, dead
  letters, and provably stalled main-queue messages.

## Success criteria

- A nonzero backlog with an omitted optional oldest-message timestamp preserves
  the returned count and byte metrics and does not increment the metric-failure
  streak or page as "metrics unavailable."
- Real rejected or invalid Queue metric reads still become typed partial/failed
  observations and page after the existing consecutive-check threshold.
- Dead-letter backlog and timestamp-backed main-queue stall alerts remain
  unchanged and covered.
- Focused Cloudflare tests and typecheck pass, required ReviewGPT gates pass,
  and exact-head required CI is green before merge.

## Scope

- In scope: device-webhook Queue metric normalization, monitor tests, and the
  narrow operator-facing monitoring contract.
- Out of scope: queue consumer behavior, retry or DLQ configuration, provider
  ingestion, queue draining, new state/schema owners, or alert transport.

## Constraints

- Technical constraints: Cloudflare documents `oldestMessageTimestamp` as
  optional; unavailable age must stay unknown rather than becoming zero, while
  independent count/byte signals remain usable.
- Product/process constraints: keep the smallest rollback-compatible change,
  preserve the production-critical webhook path, and deploy only after the
  protected Worker checks pass.

## Product UX

- Effort: Patch.
- Outcome: on-call operators stop receiving false total-metrics-loss pages
  without seeing an unknown queue age represented as confirmed health.
- Reaches: the existing five-minute Queue-health observation and Linq paging
  journey only.
- Proof: provider-shaped monitor sequences preserve partial backlog data, reset
  only the real read-failure streak, keep an existing stall incident open, and
  recover only after a complete healthy sample.
- Walkthrough: an unknown-age positive backlog persists as partial without a
  page; a real read failure still pages after two checks; a timestamp-backed
  stall retains its incident and one-hour pacing across an unknown-age sample;
  an empty queue closes the incident. Result: Ready.

## Risks and mitigations

1. Risk: accepting an absent timestamp could hide a real stalled queue.
   Mitigation: retain timestamp-backed stall detection and independent DLQ/API
   failure alerts; do not infer a healthy age from missing data.
2. Risk: changing stored observation semantics could require a Durable Object
   migration or break rollback.
   Mitigation: retain the existing snapshot schema and represent the optional
   timestamp with its existing nullable field.

## Tasks

1. Prove the production failure mode against Cloudflare metrics, runtime flow,
   and the monitor's exact collection path.
2. Normalize the provider-documented optional timestamp without discarding
   valid count and byte metrics.
3. Add regressions for partial timestamps and unchanged real-failure alerts.
4. Run focused tests/typecheck, inspect the diff, and complete ReviewGPT/CI.
5. Merge the approved PR and retire the task worktree.

## Decisions

- Rejected treating the REST sentinel as a real epoch timestamp: the Worker
  binding intentionally exposes that field as optional, and zero would create
  a false decades-old stall.
- Rejected adding a second monitoring state machine: the existing nullable
  timestamp already expresses unknown age while count and byte metrics remain
  authoritative for the fields Cloudflare returned.
- Live production proof showed the Queue metrics endpoint succeeding while the
  optional age was unknown, the dead-letter queue was empty, and webhook traces
  plus hosted imports continued completing after the alert. The failure was in
  Murph's observation normalization rather than Queue delivery or credentials.
- Accepted both preliminary findings and the final round-one finding. Unknown
  age is now an existing `partial` observation with no alert condition, so it
  cannot close a real incident; the specialist coverage artifact added the
  focused failure-streak reset sequence and touched tests only.
- Refreshed Product UX purpose verdict after remediation: Ready. The smallest
  complete operator experience distinguishes successful partial telemetry from
  both confirmed queue health and actual metric-read failure.

## Verification

- Commands to run: the focused device-webhook Queue health monitor test, the
  Cloudflare typecheck, `git diff --check`, required exact-head GitHub checks,
  and the repository's preliminary/final ReviewGPT gates.
- Expected outcomes: missing optional age remains a successful observation with
  preserved backlog metrics and no false page; genuine metric rejection, DLQ
  backlog, and timestamp-backed stall tests remain green.
- Current local proof: the remediated focused monitor suite passes 11 tests,
  the Cloudflare typecheck passes, the pre-remediation full Cloudflare Node
  suite passes 2,614 tests with two skips, and `git diff --check` is clean.
