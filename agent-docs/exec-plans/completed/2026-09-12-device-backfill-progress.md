# Bounded Junction backfill progress

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal

- Finish cheap initial history without spending one durable job per day/resource.
- Preserve canonical import units, source authorization, bounded provider requests,
  foreground cancellation, checkpoint replay, and future retry times.

## Success criteria

- Synthetic provider/service replay finishes with fewer durable jobs and no lost
  or duplicated day/resource coverage. Slow/error cases remain bounded.

## Scope

- In scope: Junction full-job continuation fragmentation and focused proof.
- Out of scope: new schedulers, concurrency, larger global limits, production mutation.

## Constraints

- Junction owns resource/date cursors; Device Sync owns durable jobs; hosted
  runtime owns finite passes and checkpoint continuation. Keep these owners.
- Product UX patch: connected history becomes available sooner. Cover new and
  resumed history, sparse/empty data, foreground yield, and exact recovery.
- Use existing scalar suffixes and persisted shapes, with no migration or dependency.

## Risks and mitigations

1. Batching could skip history or delay foreground work.
   Mitigation: preserve complete import units, bounded work, and replayable suffixes.

## Tasks

1. Reproduce excessive job count through the actual provider entrypoint.
2. Correct the current provider boundary with finite, abortable work.
3. Prove cursor preservation, failure recovery, source fencing, and cold replay.
4. Run tests/typecheck, review complexity/diff, update owner docs and changelog,
   and complete the scoped commit and required review.

## Decisions

- Prefer coalescing existing complete units over adding another progress store.
- Deployment is separate from local verification. Keep private runtime evidence
  out of this plan and all synthetic fixtures.

## Verification

- Focused Device Sync provider/service tests, package typecheck, complexity diff,
  and parent review. Record measured results as work completes.

## Evidence and implementation

- Reproduction failed at base: 14 cheap daily HTTP reads required 14 durable
  jobs. The same synthetic backfill/reconcile now requires one job and still
  requests all 14 distinct days.
- Existing source-scoped 60-day coverage proof now fits within the hosted
  100-job pass budget; every nonterminal successor is checked for absent
  completion evidence.
- Production change: a provider-local bounded loop over the unchanged complete
  unit executor, with the existing 16-unit ceiling and a five-second admission
  budget. Resource transitions, workout streams, future retries, and same-cursor
  adaptive retries keep their queue boundary.
- Eight focused tests prove cheap-work limits, elapsed and foreground yield,
  old scalar suffixes, future retries, SQLite restart/provider retry through
  final sync completion, and canonical import replay without duplicate writes.
  Five affected provider suites passed 204 tests before the additional canonical
  replay proof. All 15 selected Junction service history tests passed.
- Device Sync and Web typechecks passed; all 10 changelog page tests passed.
  Complexity guard passed with unchanged debt
  and maximum; the pre-existing unit executor was renamed without body changes.
- Product UX: Ready for review from synthetic provider and durable service
  proof. Live performance and mailbox convergence require deployment.

## Final review

- Final ReviewGPT round 1 passed on the unchanged production implementation;
  no findings were accepted or rejected. Parent review confirms the finite loop
  adds no state owner and preserves the unchanged unit executor.
- CI exposed three timezone assertions that still assumed one job per day,
  plus the public changelog's internal-branding rule. Local reproduction
  confirmed both. The three corrected timezone tests and all 49 changelog
  registry/page tests pass; Device Sync typecheck passes again.
- Post-review edits only correct those test expectations, remove the internal
  provider name from public copy, and close this plan. Required final-head CI
  remains a PR completion gate; rollout and live convergence are separate.
Completed: 2026-09-12
