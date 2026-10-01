# Expose bounded hosted device-sync pass queue diagnostics

Status: completed
Created: 2026-08-22
Updated: 2026-08-22

## Goal

- Make hosted device-sync pass logs distinguish a shrinking queue from a
  replenishing or repeatedly stuck queue, without changing scheduling,
  retries, provider behavior, or the 90-second pass budget.

## Success criteria

- Each finished pass records one secret-safe, bounded before/after snapshot of
  the selected account's local job queue when that queue is available.
- The snapshot reports capped counts, truncation, queued/running counts,
  closed-vocabulary job-kind counts, oldest sampled job age, maximum sampled
  attempt count, and whether the pass reached its existing 100-job limit.
- Timeout/yield and later-stage failure logs retain the last completed queue
  snapshot.
- Existing wake ownership, foreground preemption, follow-up scheduling,
  provider inputs, and runtime-log event taxonomy remain unchanged.
- Focused tests and the assistant-runtime typecheck pass, exact-head review and
  required CI are green, and the reviewed head is deployed and observed in
  production.

## Scope

- In scope:
  - enrich the existing `device-sync.pass_finished` redacted metadata;
  - reuse the current bounded local SQLite pending-job reader;
  - add focused lifecycle coverage for the new metadata;
  - deploy the exact reviewed runner bundle and verify emitted fields.
- Out of scope:
  - changing the 90-second timeout or the 100-job pass limit;
  - adding a queue, retry owner, scheduler, persisted state, provider-specific
    recovery, or new runtime-log event code;
  - treating provider webhook activity as proof that a stale source recovered.

## Constraints

- Technical constraints:
  - inspect at most `HOSTED_DEVICE_SYNC_PASS_JOB_LIMIT + 1` pending rows per
    snapshot and label truncation explicitly;
  - log only counts, ages, attempt counts, and closed code-owned job-kind
    labels;
  - keep info logging best-effort and off the foreground reply path.
- Product/process constraints:
  - production rows and member identifiers stay out of repository artifacts;
  - use the isolated PR lane, routed ReviewGPT gates, exact-head CI, protected
    production deployment, and post-deploy runtime-log proof.

## Risks and mitigations

1. Risk: bounded samples could be mistaken for exact totals.
   Mitigation: record the sample limit and independent before/after truncation
   flags with every snapshot.
2. Risk: extra inspection adds material maintenance work.
   Mitigation: reuse two local indexed, account-scoped reads capped at 101 rows;
   do not add an aggregate scan or remote callback.
3. Risk: diagnostics expose provider payload or member identity.
   Mitigation: never log job ids, account ids, payloads, resources, timestamps,
   or provider prose; map job kinds to a closed seven-label diagnostic vocabulary.
4. Risk: rollout leaves warm runners on the old logging contract.
   Mitigation: deploy the runner bundle with immediate container convergence
   and verify the exact bundle plus new production log fields.

## Tasks

1. [x] Trace the current pass, store, logging, and deployment owners and prove the
   missing queue evidence.
2. [x] Add the bounded queue snapshot and propagate it only to the existing pass
   lifecycle log.
3. [x] Add focused coverage for completed and yielded/failed lifecycle visibility.
4. [x] Run focused tests, typecheck, inspect the diff, and complete the PR review
   and CI gates.
5. [x] Merge, deploy the exact reviewed head, verify the new production fields,
   and use them to evaluate whether any timeout increase is justified.

## Decisions

- Keep `device-sync.pass_finished` as the sole event owner; adding an event code
  would require needless cross-plane parser and rollout complexity.
- Sample existing local queue rows instead of adding another store query or
  persisted metric owner.
- Keep timeout and job-limit policy unchanged until the new evidence separates
  finite backlog from repeatedly stuck work.
- Run queue reads only when the wake lane has an active runtime-log port, so
  callers that do not emit pass telemetry pay no diagnostic read cost.
- Keep kind-count summaries inside the existing runtime-log parser contract:
  map current and supported legacy kinds to seven fixed parser-safe labels,
  collapse unknowns to `other`, and emit deterministic scalar `kind=count`
  strings. The closed vocabulary stays below the parser cap without a shared
  compactor, object-array allowlist, or coordinated Web-first deployment.

## Verification

- Commands to run:
  - focused Vitest selection for hosted device-sync maintenance lifecycle;
  - `pnpm --dir packages/assistant-runtime typecheck`;
  - routed exact-head ReviewGPT specialist and final gates plus required PR CI;
  - protected Cloudflare production deploy workflow and managed-container smoke;
  - bounded production aggregate over new `device-sync.pass_finished` fields.
- Expected outcomes:
  - all local and exact-head gates pass;
  - finished pass logs expose bounded queue deltas with no private fields;
  - production smoke proves the reviewed runner bundle is active;
  - live logs provide enough evidence to distinguish recovery from stuck work.
Completed: 2026-08-22
