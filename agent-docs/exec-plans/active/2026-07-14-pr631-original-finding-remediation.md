# PR 631 original-finding remediation

Status: active
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Make the unshipped Clinical Records SMART producer safe to retry and resume:
  preserve already checkpointed families across authorization loss, distinguish
  retryable infrastructure failures from terminal provider state, narrow refresh
  invalidation to actual authorization failures, and keep provider base URLs out
  of plaintext persisted control-plane rows.

## Success criteria

- Authorization-required termination retains the last durable checkpoint outcome.
- Transient secure-box failures remain retryable and do not clear credentials or
  discard checkpoint progress.
- Refresh HTTP 400 responses require an OAuth authorization error before the
  connection is marked for reauthorization; unrelated 400s remain retryable.
- OAuth sessions and connections persist only encrypted provider base URLs, with
  no compatibility machinery because the feature and migration are unshipped.
- Focused production-owner tests, package typechecks, scoped diff verification,
  required completion audits, CI, and the capped ReviewGPT disposition are complete.

## Scope

- In scope: existing clinical retrieval/control-plane owners, unshipped Prisma
  schema/migration, runtime checkpoint handoff, focused tests, and matching docs.
- Out of scope: new queues, state owners, compatibility shims, provider-specific
  refresh policy beyond the OAuth error response, UI work, and unrelated clinical
  mapping behavior.

## Constraints

- Technical constraints: reuse the existing encrypted secure-box boundary and
  checkpoint/result owners; preserve fail-closed URL validation and exact run fences.
- Product/process constraints: no automatic sixth substantive ReviewGPT round;
  preserve existing browser runs and record the explicit continuation decision.

## Risks and mitigations

1. Risk: treating authorization loss as retryable could loop forever.
   Mitigation: keep proven authorization failures terminal while returning the
   last durable checkpoint outcome to the runtime.
2. Risk: encrypting base URLs can create a second source of truth.
   Mitigation: replace the unshipped plaintext columns in place and decrypt only
   through the existing control-plane owner.

## Tasks

1. Add focused failing coverage for the four evidence-backed mechanisms.
2. Implement the smallest owner-boundary corrections without new lifecycle state.
3. Run focused verification and required completion audits; reconcile findings.
4. Close the plan, commit/push, update PR intent and review disposition, and land
   the stack only after required CI and review gates are satisfied.

## Decisions

- Continue the indivisible dormant backend slice after the required anomaly
  retrospective; the current user instruction is the explicit continuation decision.
- Treat the invalid recovered response as adversarial evidence, not a counted
  substantive ReviewGPT round; do not automatically launch round six.

## Verification

- Commands to run: focused web and assistant-runtime clinical tests/typechecks,
  then shared-host `pnpm test:diff` for the touched owners.
- Expected outcomes: all focused checks and required audits pass with zero
  unresolved accepted findings; CI is green on the pushed head.
