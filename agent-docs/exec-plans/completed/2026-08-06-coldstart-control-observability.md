# Cold-start control-plane observability

Status: completed
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
   Mitigation: require exact equality between the Web direct-ensure id and the
   launched runtime invocation id, omit ambiguous or legacy attempts, and
   report Temporal activity timing separately.
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
  row whose Web direct-ensure id exactly matches the launched runtime
  invocation id; no unique match means no sample. Warm direct wakes create no
  new runner job and are omitted. Temporal attempts use activity-to-runner
  timing from one unambiguous attempt stamp instead of a mailbox acceptance
  chosen by row order. Pre-deploy traces with a legacy direct marker but no
  exact invocation id are reported as `legacy_unclassified`, not Temporal-only.

## Review anomaly retrospective

- Original requirement: make accepted-to-runner latency causally attributable
  while adding no successful-path I/O or new recovery/state owner.
- First-reviewed shape: the report selected one mailbox trace by row order for
  an invocation-level runtime attempt. Round one correctly rejected that as
  non-causal.
- Current shape before this retrospective: the correction required a unique
  mailbox row whose direct request/response timestamps were within five seconds
  of the invocation route. Tests and docs grew substantially, but authored
  production-source churn remained 177 lines; the numerical growth threshold
  was not reached.
- Repeated mechanism: the correction still inferred mailbox-to-invocation
  identity from timestamp proximity. A later mailbox item can keep its own Web
  direct markers while inheriting an earlier invocation's route and runner
  milestones, so the same attribution ambiguity remained.
- Decision: continue only with exact identity. Reuse the existing unique
  `orchestrationAttemptId` already carried by every direct ensure from Web
  through Cloudflare into the launched runtime. Preserve the Web request id and
  the launched-invocation id as separate bounded diagnostic leaves and require
  exact equality in the report. Mismatches and missing ids are omitted. Add no
  timestamp tolerance, queue, state owner, awaited call, or recovery path; if
  the exact identity cannot be preserved at the existing trace boundary, delete
  the accepted-to-runner headline instead.
- Round 3 found that the first exact-id correction attached launch identity at
  route entry, before the UserRunner knew whether the direct request launched
  or merely woke a Temporal-owned runtime. Continue within the same
  retrospective decision: move the existing id to the successful fresh-fence
  ownership boundary. Active/warm wakes receive no launch id, stale-fence
  replacements receive it only after winning the replacement fence, and a
  Temporal-owned invocation carries an explicit false direct-launch marker so
  a later pending direct wake cannot change its owner during trace merging.
  This adds no mechanism or operation beyond the already-selected in-memory
  field propagation.
- Round 4 found that the first compatibility branch treated historical
  `triggeredByWebDirect: true` wake diagnostics as if any boolean presence were
  a current launch-owner marker. Continue fail-closed in the read-only report:
  only explicit `false` proves a current Temporal-owned launch, a launch-owned
  direct id still takes precedence, historical `true` without that id remains
  `legacy_unclassified`.
- Round 5 found that deduplicating the raw mailbox-local marker booleans before
  applying cohort precedence could omit a valid multi-item Temporal attempt
  when only its initiating row had Web direct timing. Resolve the cohort per
  row first, then deduplicate the attempt-level owner/activity/runner tuple.
  Lower-priority marker differences now collapse when the final cohort agrees;
  conflicting final cohorts or attempt-level timestamps still fail closed.
- Round 6 found that chronology-ineligible later Temporal wakes were still
  counted before ambiguity, repeating the same row-reduction ordering mechanism
  as Round 5. Requirement-level continuation decision: the startup report
  includes only activities whose start can precede the reported runner-job
  acceptance. Filter `activity <= runner` before cohort/attempt deduplication;
  then assess ambiguity only among eligible launch stamps. Multiple eligible
  activities, runner times, or final cohorts continue to fail closed. Later
  active-wake latency is not part of this cold-start report and needs no new
  measurement, state, or lifecycle for the current requirement.
- Round 7 proved chronology is not ownership even when an activity begins
  before runner acceptance: that request can reach the UserRunner only after a
  direct request has already won the fresh fence, then enter the active runtime
  as a markerless foreground wake. Requirement-level continuation decision:
  Temporal startup cohorts require launch-owned evidence already stamped at the
  successful fresh-fence boundary. Exact direct launch identity means
  `temporal_recovery`; explicit false direct ownership means `temporal_only`;
  legacy direct evidence remains `legacy_unclassified`; markerless and
  contradictory current rows are omitted. Chronology remains only a
  consistency guard after ownership is proven. Add no identifier, state,
  lifecycle, callback, I/O, timer, or awaited operation.

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
- ReviewGPT final round 3: launch-identity ownership finding accepted and
  resolved by moving the id from route entry to successful fresh-fence
  acquisition. Focused proof covers genuine direct fresh starts, active wakes,
  stale-fence replacement, Temporal-owned/direct-wake overlap, and the runtime
  merge boundary.
- Fence-owner correction: 217 focused Cloudflare tests passed with 1 opt-in
  PostgreSQL test skipped in the default lane; the assistant-runtime merge
  regression passed; the opt-in PostgreSQL report lane passed all 3 tests; and
  Cloudflare typecheck passed.
- ReviewGPT final round 4: historical-cohort compatibility finding accepted and
  resolved by limiting current Temporal ownership to explicit false. The real
  PostgreSQL fixture again contains historical true and keeps it unclassified.
- ReviewGPT final round 5: attempt-deduplication finding accepted and resolved
  by applying cohort precedence before DISTINCT. The PostgreSQL fixture covers
  differing mailbox-local markers that resolve to one cohort and a genuinely
  conflicting cohort pair that remains omitted.
- ReviewGPT final round 6: chronology-ordering finding accepted and resolved by
  filtering post-runner activity stamps before DISTINCT and ambiguity counting.
  The PostgreSQL fixture includes one valid launch plus a later active wake on
  the same attempt and still reports exactly one startup sample.
- ReviewGPT final round 7: delayed-active-wake causal finding accepted and
  resolved by requiring existing fresh-fence launch ownership before a current
  Temporal row can enter a startup cohort. The PostgreSQL fixture includes a
  Temporal activity that starts before a direct-owned runner is accepted but
  arrives later as a markerless wake; it is omitted, the direct cold sample
  remains, a genuine Temporal fresh launch emits once, and conflicting
  launch-owned evidence remains fail closed.
- Corrected default report contract: 2 passed, 1 opt-in fixture skipped.
- Corrected real PostgreSQL report fixture: 3 passed.
- ReviewGPT final round 8: PASS with no qualifying findings. Model verification
  recorded the requested `gpt-5.6-sol` target and the `gpt-5-6-pro` response
  slug against exact head `a0ff6e913e81e2f6bf8b885c120df04382ddd549`.
- Exact reviewed-head GitHub Actions: Repo Hygiene, Frontend Design Proof, Web
  Viewport Overflow, and Murph Host Support passed. A duplicate superseded
  Frontend Design Proof run was cancelled after the successful run completed.
- Parent final diff review: no remaining correctness, privacy, reliability,
  deployment, or hot-path-latency finding.
- GitHub mergeability proof: mergeable with no conflict; the PR is behind the
  moving base branch, which does not require a ReviewGPT rerun.
- `git diff --check`: passed.
- Pending: none.
Completed: 2026-08-06
