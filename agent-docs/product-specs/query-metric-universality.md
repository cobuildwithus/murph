# Universal Metric Queryability

Last verified: 2026-06-12
Status: Specified, implementation pending

## Invariant (the whole point)

**Queryability is a property of the canonical data, not of a registry.**
Every metric-bearing canonical event in the vault yields a query metric
point through one generic extraction rule. The wearable summary pipeline is
a curated presentation layer that additionally produces conflict-resolved
values for the metrics it owns — it gates nothing else.

This extends the Data Capture Posture
(`agent-docs/product-specs/companion-app.md`) one layer up: the vault
already guarantees "sparse data always lands"; the query layer must
guarantee "what lands is queryable." A member's caffeine, glucose summary,
height, or cycle length must never be captured but invisible to metric
queries.

Utmost priority throughout: clean, simple, long-term maintainable and
composable architecture with minimal complexity.

## Problem today

`packages/query/src/metrics/index.ts` has three extraction paths into
`MetricPoint`:

1. `metric_sample` ledger entities → generic (synthesizes a custom metric
   definition when the key is unknown — see `metricSampleMetricPoints`,
   `resolveMetricDefinition(...) ?? createCustomMetricDefinition(...)`).
2. `measurement`/`test` events → generic (`measurementMetricPoints`; same
   open-world posture, qualifiers preserved in context).
3. `observation` events → **no generic path**. They only become metric
   points by surviving a triple registry: the importers wearable metric
   catalog (`@murphai/importers/device-providers/metric-catalog`, consumed
   by `packages/query/src/wearables/candidates.ts: mapScalarMetric`), then
   one of the four summary kind sets
   (`packages/query/src/wearables/types.ts: SLEEP/RECOVERY/BODY/ACTIVITY_METRIC_KEYS`),
   then the hand-enumerated evidence fields
   (`packages/query/src/metrics/projection.ts: sleepMetricEvidence` et al.).

Three lists that drift silently. Concretely dropped today despite landing
in the vault: `caffeine`, `water`, `mindfulness-minutes`,
`heart-rate-recovery-one-minute`, `afib-burden`,
`sleep-breathing-disturbance`, `glucose`/`lowest-glucose`/`highest-glucose`
dailies, `temperature-deviation`, `basal-body-temperature`, `height`,
`period-length-days`, `cycle-length-days`. Each future resource pays the
same enrollment tax; each forgotten enrollment is this bug again.

## Design

### 1. Generic observation extraction (the new case)

In `metricPointsFromCanonicalEntity`, handle `entity.kind === "observation"`
exactly in the mold of the existing `metric_sample` path: read
`attributes.metric` / `attributes.value` / `attributes.unit`, resolve
`resolveMetricDefinition(key) ?? createCustomMetricDefinition(key, unit)`,
normalize value/unit, emit one scalar point with an observation source kind.
Skip non-numeric values. No allowlist.

### 2. Precedence, not gatekeeping (the one deliberate coupling)

For metrics the wearable summary evidence already emits (e.g. `spo2`,
`hrv-rmssd`, `total-sleep-minutes`), the summary-sourced point is the
conflict-resolved answer to the same question — it must win, and raw
observation points for those metrics must not double-count beside it.

Hard requirements:

- The ownership set MUST be derived from the same place the evidence
  functions get their keys — never a second hand-written list (that would
  recreate the drift bug this spec exists to kill). The clean move is to
  make the evidence functions table-driven: each summary kind declares one
  `[metricKey, summaryField]` table, `*MetricEvidence` iterates it, and the
  ownership set is the union of the tables. That is also a small
  simplification of `projection.ts` (four copy-paste functions become one).
- Mind the key-namespace mismatch: evidence emits keys like `hrv-rmssd`
  while observation events carry `hrv`; both `spo2` paths collide directly.
  The precedence rule must operate on normalized metric keys as they appear
  on actual points, and the implementer must map summary-owned observation
  keys (`hrv`, `spo2`, `lowest-spo2`, ...) to suppression correctly —
  decide and document whether suppression is by key alone or by
  (key, effective date), and prove the choice with the double-count tests
  below. Prefer the simplest rule that passes the tests.

### 3. Projection version bump

`QUERY_PROJECTION_SQLITE_VERSION` 9 -> 10 (or current+1) so existing
projections rebuild and historical observations gain their points. No
migration code (rebuildable projection, established pattern). Do NOT change
the wearable summary envelope shape and do NOT touch the stored-codec
contract from PR #146 — this design deliberately requires neither.

### 4. Explicit non-goals

- No new CLI commands, vault paths, or stores — points flow to the existing
  `query_metric_points` projection and existing read paths.
- No importer changes; no new enrollments in the wearable catalog or kind
  sets (the catalog keeps its real job: units, aliases, plausibility).
- No dismantling of the summary pipeline, candidates, or conflict
  resolution.
- Browser-replica parity: verify whether the browser vault replica builds
  metric points through the same `extractMetricPoints` seam; if it has its
  own path, it must get the same rule or the divergence must be documented.

## Verification (minimum proof set)

`pnpm test:diff packages/query packages/cli`, plus targeted tests proving:

1. Observation events for `caffeine`, `height`, and `glucose` surface
   through the production read path (`listMetricPointsRuntime` /
   projection rebuild), with correct units; unknown metric keys synthesize
   custom definitions.
2. No double-counting: with a vault containing both wearable summaries and
   raw observation events for `spo2`/`hrv`, exactly one point per
   (metric, day) survives, and it is the summary-resolved one.
3. A projection at the previous version is detected stale and rebuilt at
   the new version (follow the existing literal-pin + stale-store test
   patterns in `packages/query/test/query.test.ts`).
4. The ownership set cannot drift: a test asserts it equals the set of
   keys the evidence builders actually emit.

## Workflow

Standard repo workflow: worktree (`murph-*` naming), exec plan +
COORDINATION_LEDGER row, required completion audits per
`agent-docs/operations/completion-workflow.md` (simplify is likely
warranted given the projection.ts table-driven refactor; coverage-write;
task-finish-review; security-privacy-review not required — local
rebuildable state, no trust boundary), `scripts/finish-task`, push, open a
PR. Do not merge. The post-CI external deep-review loop is run by the
requester, not the implementer.
