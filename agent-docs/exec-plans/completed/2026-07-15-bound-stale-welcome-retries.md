# Bound stale signup welcome retries

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Stop an obsolete signup welcome from retrying after the member has already
  established a healthy conversation, and give automatically scheduled assistant
  outbox sends a finite no-progress exit without weakening foreground reply delivery.

## Success criteria

- A pending or retryable signup welcome is durably superseded when existing
  outbox truth proves a newer accepted reply for the same recipient route.
- An automatically retried outbox send that never makes progress reaches a
  documented terminal state after a finite persisted attempt bound, including
  newsletter parent and recipient replay.
- Fresh welcomes and foreground replies retain their current delivery,
  idempotency, confirmation-pending, and restart behavior.
- Focused unit and hosted-runtime scenario coverage proves both the incident
  recovery path and the generic retry bound.
- Required repository verification, coverage audit, PR ReviewGPT, and PR CI pass.

## Scope

- In scope: the existing assistant outbox retry/dispatch owner, signup-welcome
  validity reconciliation, newsletter replay ownership, focused runtime tests,
  and the durable reliability documentation that describes the bound.
- Out of scope: a new queue, scheduler, repair service, database state owner,
  changes to provider retry semantics, or manual production-state mutation.

## Constraints

- Technical constraints: derive recovery from persisted outbox facts; preserve
  safe-to-retry versus ambiguous-dispatch handling; make foreground replies the
  highest-priority work; do not add cross-package internal imports.
- Product/process constraints: do not disable signup welcomes or current-inbound
  replies; preserve unrelated working-tree changes; use the isolated PR lane and
  the required operational verification and review gates.

## Risks and mitigations

1. Risk: a broad expiry rule could discard a legitimate foreground message
   during a provider outage.
   Mitigation: keep semantic supersession specific to obsolete signup welcomes,
   preserve confirmation-pending effects, and regression-test the persisted
   attempt bound.
2. Risk: an old retry record may survive deployment and continue waking the
   runtime.
   Mitigation: reconcile from durable outbox history on ordinary runtime passes
   so the deployed fix self-heals the incident without an operator rewrite.
3. Risk: mixed runner versions could observe different retry behavior.
   Mitigation: keep the persisted intent schema compatible, deploy the runner
   bundle with immediate convergence, and verify the deployed fingerprint.

## Tasks

1. Trace the durable outbox state and test seams for same-route delivered replies.
2. Add incident reproduction coverage before the production correction.
3. Implement stale signup-welcome supersession and the finite retry fallback in
   the existing outbox owner.
4. Run focused tests, typechecks, direct hosted-runtime proof, and coverage audit.
5. Commit, push, open the PR, run ReviewGPT with CI, and resolve accepted findings.

## Decisions

- The root cause is an unbounded retry schedule combined with a stale-welcome
  suppressor that only compared candidates in one collection pass. A previously
  persisted retryable welcome was therefore invisible after a later reply won.
- Reuse persisted outbox history as the recovery source of truth; do not create a
  second reconciliation ledger or queue.
- Bound definite automatic sends at 48 persisted attempts. Preserve ambiguous
  non-idempotent delivery as parked confirmation work with no automatic wake,
  and reconcile replay-safe evidence before terminalizing an exhausted claim.

## Verification

- Commands to run: focused assistant-engine/runtime tests selected after tracing,
  `pnpm test:diff` for all touched owner paths, relevant typechecks, one hosted
  retry/restart scenario, coverage-write, ReviewGPT, and PR CI.
- Expected outcomes: the reproduced stale welcome becomes terminal without a
  provider call, definite automatic retry exhaustion is finite across fan-out
  replay, foreground delivery remains green, and all required gates pass on the
  pushed head.
Completed: 2026-07-15
