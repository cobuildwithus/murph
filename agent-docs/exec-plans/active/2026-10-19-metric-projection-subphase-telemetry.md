# Metric projection subphase telemetry

Status: active
Created: 2026-10-19
Updated: 2026-10-19

## Goal

Attribute the full rebuild's `query-metric-projection` interval to fixed
suboperations through the existing CLI timing pipeline. This is telemetry only:
no optimization, no behavior change and no speedup claim.

## Evidence

Private-safe aggregates for 2026-10-17 through 2026-10-20 00:00 UTC: twelve
rebuilds spent 38,005 ms in `query-metric-projection`, with a 23,400 ms maximum.
The operation is synchronous in-memory derivation with no provider or database
await. CPU, GC, descheduling and data cardinality are unknown. Two local
optimization candidates were rejected without shipping. A two-limb FNV hash
conflicts with recorded container CPU evidence. A redundant-dedupe patch
measured about 5% on a synthetic fixture. Neither explains the severe stage.

## Scope

- In scope: five fixed nested phase names in the portable vocabulary. An
  optional observer seam in the shared `buildMetricProjection` owner, wired only
  by the Node-only rebuild owner. Focused tests, a dense mechanism benchmark,
  and owner docs.
- Out of scope: optimization, new counts or labels, transport or cap changes,
  monitoring infrastructure, Patterns or retire-feature contracts,
  browser-replica or experiment-reader timing, and performing deployments.
  The parent owns the authorized release and post-deploy observation.

## Decisions

- Names: `query-metric-samples`, `query-metric-evidence`,
  `query-metric-extract`, `query-metric-precedence` and `query-metric-targets`.
  They are appended, so slice-based compatibility tests keep their bases.
- `MetricProjectionStep` is declared in `metrics/projection.ts`. The rebuild
  passes `startCliPhase` directly, so the type checker requires every step name
  to be an admitted phase without the shared owner importing Node timing.
- The seam follows the browser-replica `onSourceStep` pattern: synchronous,
  best-effort and failure-swallowing. It returns an end callback, so steps end in
  `finally`. If absent, the existing direct path runs.
- Targets are timed in the rebuild owner with `timeCliPhaseSync`.
- ReviewGPT's untracked `bench/metric-projection.ts` was removed. It compared a
  bundled baseline with the rejected dedupe candidate and does not measure
  instrumentation. `bench/metric-projection-dense.ts` was repurposed into the
  disabled/enabled mechanism benchmark.
- Changelog: not applicable. Internal diagnostic telemetry only, with no
  member-visible outcome.

## Verification

- Query focused tests: `metric-projection-steps`, `wearable-source-health-query`,
  `browser-entry-boundary`, `query-projection-concurrency`,
  `personal-pattern-timing`, `query-projection-load-timing`,
  `metric-aggregate-equivalence`, `wearable-metric-dedupe`,
  `browser-vault-metric-points`, `blood-test-focused` and
  `wearables-sleep-pattern-runtime`.
- Runtime-state `cli-timing.test.ts`, plus the history-backed check run with
  `MURPH_CLI_METRIC_PHASE_COMPAT_BASE` at the pre-admission base.
- Transport and caps: assistant-engine `cli-timing-{transport,profile}` and
  Cloudflare `usage-record-port`.
- Typecheck: query (including tests), runtime-state and the query bench.
- Mechanism benchmark: rotated default, inactive-observer and enabled runs on
  the same dense fixture, with complete-output parity and no asserted threshold.
- Final review, exact-head CI and closure belong to the parent.

## Rollout

Consumer-first, per `docs/hosted-runtime-log-database.md` § Metric projection
subphases: Web, then the Cloudflare worker, then the runner image. The older
unmerged-candidate blocker in that doc does not apply here. This task authorizes
a reviewed merge plus the normal main-only protected deployment, after green
ReviewGPT and green exact-head CI. The parent owns that release. No gate has
passed and nothing is deployed yet. Release proof is still pending.

After a verified deployment, the parent runs an immediate check and then a check
every 30 minutes for four hours. That is separate from the 24-hour and 72-hour
sampling windows, which also start only after verified production deployment.
App heartbeat scheduling tools are currently unavailable. That blocks scheduling
the observations, not deployment authority.
