# Database health telemetry incident remediation

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Keep genuine production database-pressure conditions fail-closed and recurring.
- Report PlanetScale telemetry loss as a monitoring outage, not as evidence that
  the database itself is degraded.
- Send one acknowledged operator page per unresolved telemetry-notification
  window while retaining paced exact-body retries for failed or ambiguous
  delivery. Recovery before acknowledgment coalesces instead of creating a
  notification backlog.
- Preserve a bounded, allowlisted record of which required metric families were
  absent so the next provider-side outage is diagnosable without raw payloads.

## Evidence

- The production control database remained within its configured connection
  capacity and had no waiting or idle-in-transaction sessions during the live
  investigation.
- The supplied bounded sample export contained only
  `required_metrics_missing` failures, followed by successful samples without a
  database restart.
- The operator messages repeated every 30 to 35 minutes and used generic
  database-pressure openings even though the only condition was unavailable
  monitoring telemetry.
- Existing persisted samples and warnings identify the failure class but not
  the missing required metric family, so provider-specific root-cause proof is
  unavailable for the completed incident.

## Success criteria

- Two consecutive telemetry failures still open and page a monitoring incident.
- After both destinations acknowledge that page, continued telemetry failures
  do not admit recurrent pages until a successful sample closes the incident.
- A failed or ambiguous first page remains pending and retries under the existing
  30-minute provider-attempt fence with the same body and idempotency keys.
- A successful sample closes and rearms telemetry only after any unresolved page
  is acknowledged; intervening recovered gaps remain part of that notification.
- Real gauge and direct-migration conditions retain their existing recurrence,
  ordering, and retry behavior.
- Telemetry-only copy is calm and explicit that the monitor is blind; it does
  not claim the database is under pressure.
- Missing metric diagnostics contain only canonical allowlisted PlanetScale
  metric names and never raw response data, labels, targets, credentials, chat
  identities, or provider prose.

## Scope

- Cloudflare database-health metric parsing, alert admission, and focused tests.
- Current Cloudflare and reliability owner documentation.

## Constraints

- No metric is made optional and no missing value is treated as zero.
- No new state owner, queue, dependency, external service, or table. One
  additive metadata-row migration may retain a bounded owed-page obligation
  inside the existing Durable Object owner.
- Preserve the existing transactional sample/admission boundary, global attempt
  fence, destination health checks, and exact-body retry contract.
- Do not deploy from this repository; production deployment remains owned by the
  private deployment workflow after merge.

## Tasks

1. [x] Add bounded missing-family evidence to parse failures and monitoring
   conditions.
2. [x] Admit telemetry-only pages once per unresolved notification window,
   preserve current-pressure priority at the first eligible provider slot, and
   make historical copy truthful while leaving genuine unsafe recurrence
   unchanged.
3. [x] Add focused parser, retry, recurrence, recovery, and copy regressions.
4. [x] Update the durable operational contract and run focused verification.
5. [x] Push the exact candidate, open the PR, and complete ReviewGPT plus CI.

## Verification log

- Focused Node Vitest after review remediation: 4 files and 74 tests passed.
- Focused Workers-runtime Vitest: 1 file and 1 test passed.
- Cloudflare package typecheck passed.
- Raw health/model/vault log guard passed.
- Agent docs drift guard initially required the material owner-doc updates to be
  indexed; `agent-docs/index.md` was synchronized and the rerun passed.
- `git diff --check` passed.
- Preliminary ReviewGPT returned one accepted high-severity owed-page finding
  and one accepted coverage finding. The implementation now retains a bounded
  telemetry obligation behind older pending and direct-only pages across
  restart and recovery. The attached coverage patch was downloaded from the
  owned review thread, read in full, limited to one focused test file, and
  passed `git apply --check`; its full-outage-copy and malformed-label scenarios
  were incorporated and executed.
- Final ReviewGPT round 1 independently found the same owed-page loss. No
  additional finding was reported. Later rounds reviewed each correction on a
  new exact pushed head.
- Parent rollout review replaced the schema-version bump with idempotent
  additive columns at the existing version, preserving compatibility with the
  previously deployed Worker during overlap or rollback.
- Final ReviewGPT round 2 required a second anomaly retrospective after proving
  that two recovered threshold epochs cannot both fit one bounded obligation and
  that early telemetry admission could overtake current pressure. The chosen
  contract coalesces all thresholds before acknowledgment into one unresolved
  notification with the first threshold's evidence, holds unadmitted telemetry
  outside a closed provider fence,
  includes current unsafe evidence at the first eligible sample, labels
  historical telemetry with its own observation time, and normalizes a
  telemetry pending body acknowledged by the rollback Worker. Focused repeated-
  threshold, restart, both-recipient, current-pressure-ordering, exact-copy, and
  legacy-ack tests cover that decision.
- Final ReviewGPT round 3 found that current post-ack monitoring conditions could
  still enter a concrete-pressure pending body, whose later success could clear a
  different rearmed obligation. The correction deletes that fallback: alert
  admission includes monitoring only from the durable obligation and cannot
  create an empty body. A focused two-window regression proves the first page to
  both recipients, a pressure-only ambiguous recurrence, recovery, a distinct
  rearmed missing-family obligation across restart, exact old-body retry without
  clearing it, and delivery of the second page to both recipients.
- Final ReviewGPT round 4 found that the closed-fence hold also suppressed a newly
  opened incident's current concrete pressure. The correction retained that
  pressure in an exact pending body while keeping telemetry-only plus
  acknowledged-incident recurrence on the fresh eligible-sample path. Final
  ReviewGPT round 5 confirmed the pressure-loss fix but found that the
  intermediate pressure-only body created a second avoidable page and 30-minute
  telemetry delay. The accepted net-deletion correction now retains one combined
  body with exact identity and truthful telemetry evidence across recovery and
  restart, clears the obligation after both recipients acknowledge it, and
  produces no second provider attempt. The focused close/reopen, mixed-threshold,
  recovery, restart, and both-recipient regression covers the correction. Final
  ReviewGPT round 6 found that `incidentOpen` still misclassified an unadmitted
  telemetry incident as an acknowledged recurrence when pressure began on the
  following sample. The accepted correction derives admission from the existing
  zero alert sequence instead: pressure appearing before the first page creates
  the same combined immutable body. A focused delayed-pressure, recovery,
  restart, both-recipient, acknowledgment, and no-second-attempt regression
  covers the path. Final ReviewGPT round 7 found the neighboring direct-error
  priority branch still used `incidentOpen` and could strip pressure plus
  telemetry from that first page when a direct-error delta appeared on the later
  sample. The accepted correction applies the same zero-sequence admission fact
  there while preserving direct-only promotion behind an older admitted page.
  A focused three-condition, recovery, restart, both-recipient,
  acknowledgment, and no-second-attempt regression covers the path. Final
  ReviewGPT round 8 found that the deliberately retained direct-only path could
  split an already owed telemetry fact from a non-replayable direct-error page,
  forcing a second provider fence and acknowledgment lifecycle. The accepted
  correction retains both durable non-replayable conditions in one immutable
  body while still excluding replayable gauges, and derives the page check time
  from promoted deferred direct evidence even when telemetry is also present.
  Focused inside-fence and deferred-promotion regressions prove exact identity,
  restart, recovery, both recipients, condition-local times, obligation cleanup,
  and no second telemetry page. Final ReviewGPT round 9 found that the broadened
  deferred-time predicate could date an aggregate containing both old deferred
  errors and a new current delta to only the older sample. The accepted local
  correction restores the current-delta distinction: pure deferred promotion
  uses the stored time, while a mixed aggregate uses the latest included check
  and telemetry retains its separate observation time. Focused telemetry-bearing
  and direct-only regressions cover both timestamp branches. ReviewGPT round 10
  found the same aggregate-provenance mechanism in the original telemetry
  threshold and required a new retrospective before remediation: mixed partial
  and unavailable checks were labeled using only the threshold observation.
  The continuation decision applies one rule across aggregates: count, category,
  time, and evidence presented as one fact must describe the same represented
  observations. The telemetry page will summarize the entire first two-check
  threshold window, count incomplete versus unavailable checks, union canonical
  missing families actually observed on partial checks, label that union as
  observed evidence, and identify the threshold time as the window end. One
  bounded per-sample monitoring-evidence value in the existing sample table is
  sufficient to compose the existing obligation across restart; no backlog,
  second identity, queue, scheduler, or lifecycle owner is added. Required proof
  covers both mixed orders and two partial checks with different families,
  including exact both-recipient delivery, restart/retry, and acknowledgment.
- Final ReviewGPT round 11 reviewed the complete sensitive patch on the exact
  pushed candidate and passed with no qualifying finding. Requested-model
  verification confirmed the response model.
- All required GitHub Actions checks passed on that exact candidate, including
  release app verification, package coverage, build/typecheck, host matrices,
  hosted billing proof, repo hygiene, and frontend proof.
- The parent final review found no additional defect in the partial-observation
  parser, bounded evidence migration, alert admission, immutable retry identity,
  both-recipient acknowledgment, or obligation cleanup paths. The worktree was
  clean at the reviewed commit.
- After fetching the latest `main`, GitHub reported the candidate mergeable and
  a local merge-tree proof completed without conflicts.
Completed: 2026-08-09
