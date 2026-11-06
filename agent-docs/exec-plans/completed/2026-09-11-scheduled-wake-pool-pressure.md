# Shorten scheduled wake transactions and assess background staggering

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Release pooled database connections before scheduled device-wake crypto/provider waits, and identify safe background staggering boundaries without delaying exact user schedules.

## Success criteria

- Scheduled wake preparation finishes before transaction checkout; transaction work cannot call KMS, including duplicate replay after root rotation.
- Preserve consent, workspace authority, exact root revalidation, v3 dedupe, retained runtime ownership, and post-commit signal behavior.
- Explain which wake producers can be staggered and which must preserve exact timing; implement only a justified bounded change.
- Focused unit and local PostgreSQL proof, relevant typecheck, parent review, ReviewGPT, and exact-head required CI pass.

## Scope

- In scope: scheduled device-sync wake admission and mailbox crypto composition; read-only scheduling investigation and necessary owner documentation/tests.
- Out of scope: production mutations, database capacity changes, changing user reminders, new queues or scheduling owners.

## Constraints

- Technical constraints: reuse existing prepared-root lifecycle and exact-root mismatch retry; bounded concurrency and database-only critical sections.
- Product/process constraints: preserve timing and durable work ownership; use synthetic tests and public-safe architectural findings only.

## Risks and mitigations

1. A replay may need an older root or may have had its payload retired.
   Mitigation: prove live, rotated-root, retired, conflicting, and concurrent replay at the composed owner.
2. Broad staggering could delay a promised reminder or move retry authority.
   Mitigation: trace each producer and distinguish background opportunities from exact canonical deadlines before changing timing.

## Tasks

1. Trace prepared crypto, duplicate hydration, root drift, and transaction boundaries.
2. Investigate assistant, device-reconcile, maintenance, and global sweep scheduling.
3. Implement the smallest scheduled transaction correction and focused regression proof.
4. Update owner docs and run tests, local PostgreSQL proof, typecheck, and complexity review.
5. Commit, create a draft PR, mark the stable candidate Ready, and run ReviewGPT concurrently with CI.

## Decisions

- Product UX effort: Patch. Outcome: more database headroom during scheduled work. Reaches: connected-source members and unrelated requests sharing a pool. Proof: delayed synthetic KMS leaves the sole pool connection available; wake replay and consent recovery preserve outcomes.
- Source investigation and public-safe synthetic proof may be committed; private incident rows, exact production counts, and screenshots remain outside artifacts.

## Verification

- Focused scheduled wake, mailbox prepared-append, due-reconcile, and retention tests; relevant web typecheck; local PostgreSQL concurrency proof.
- Expected outcomes: no provider work while checked out, bounded root-drift recovery, exact dedupe and retained owner preservation, and no scheduling regression.

## Staggering assessment

- Global recovery sweep: a fixed phase offset in its private Temporal Schedule
  owner is the focused candidate. For a one-minute cadence, a half-interval
  phase moves the batch to the middle of the minute; steady-state recovery
  still waits less than one cadence before scheduling overhead. It moves
  overlap, not total work, and also shifts the shared mailbox handoff sweep.
  Preserve overlap/catch-up settings and prove both create and update converge.
  This public Web patch does not change the private schedule or production.
- Individual assistant timers: preserve exact reminder and accepted-input
  deadlines; `assistant` is an aggregate reason, not a background-only lane.
- Device timers: fallback reconciliation intervals differ from exact historical
  provider retry deadlines. Do not shift the shared `nextReconcileAt` blindly.
- Onboarding follow-ups: already staggered deterministically over a bounded
  member-specific window. Runtime maintenance remains idle/preemptible;
  retention uses canonical eligibility and retry deadlines.
- SDK semantics checked against the official Temporal TypeScript
  [IntervalSpec](https://typescript.temporal.io/api/interfaces/client.IntervalSpec)
  and [ScheduleSpec](https://typescript.temporal.io/api/interfaces/client.ScheduleSpec)
  references. A fixed offset is predictable; random jitter can still collide.
- Decision: land the demonstrated transaction correction first. A private
  schedule phase patch is a separate rollout candidate, with no claim that
  it eliminates synchronized individual runtime traffic.

## Candidate evidence

- All 246 focused tests passed across scheduled retention, hosted wake,
  due-reconcile sweeping, and prepared mailbox append suites. The 26-case
  retention suite ran against isolated local PostgreSQL with real local crypto.
- Regression control: running the held-KMS success case against the base
  production implementation fails the unrelated query with a pool checkout
  timeout; the candidate passes while KMS remains paused.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm complexity:diff --base HEAD` passed before the candidate commit:
  complexity debt and maximum complexity unchanged in both source files.
  Seven existing hotspots are outside the changed scheduled path.
- Parent candidate review: only the scheduled admission composition changes;
  consent/root authority stays locked, signaling stays after commit, and
  existing replay/retention tests exercise the required prepared-root API.
- Changelog not applicable: internal transaction lifetime hardening; no new
  member behavior, schedule, or measured production latency claim.
- `pnpm docs:gardening` passed with zero issues.
- ReviewGPT round 1 passed on the candidate; final-head CI is tracked on PR #3290.

- Synthetic operation-timing capture: admission plus signal-row persistence
  used 15 Prisma operations normally and 22 with one root rotation (excluding
  the signal mock's committed-row assertion). KMS failure used two reads and
  consent revocation used four operations. These are measured fixture paths,
  not a wire-SQL maximum; unchanged Temporal signal resolution was mocked.
  The due sweep remains capped at 250 candidates and five concurrent workers.

## Final review

- ReviewGPT round 1: PASS on `500ec8443fa9786e5733362dbfd442b176810f8e`;
  zero findings received, accepted, or rejected. Target, response marker,
  response hash, and external model verification matched. The reviewer
  inspected proof but did not independently execute the reported local tests.
- Parent final review: no remediation required. Production source and test
  behavior remain exactly as reviewed; the final commit only closes this plan.
- Staggering investigation is complete. A global Schedule phase change remains
  a separate private-owner rollout candidate; no timing mutation is included.
- PR: https://github.com/cobuildwithus/murph/pull/3290. Required final-head CI
  remains a merge gate. No merge, deployment, or production mutation performed.
Completed: 2026-09-11
