# Foreground causal audience context

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Let an already-imported legacy usage-referral notification recover during the
  lightweight causal-only pass without weakening direct-message audience
  verification.

## Success criteria

- The causal-only system-mailbox pass supplies an execution context bound to
  the runtime request member.
- A genuine mismatch between that request member and the queued wake still
  fails the existing audience guard.
- Focused runtime tests and typecheck pass, ReviewGPT and exact-head CI pass,
  and the deployed durable retry delivers the two retained notifications.

## Scope

- In scope: the minimal system-mailbox execution-context builder, its
  causal-only call site, and focused regression coverage.
- Out of scope: changing the audience guard, rewriting encrypted mailbox
  payloads, adding a recovery queue, or manually mutating production state.

## Constraints

- Technical constraints: derive authority from the runtime request member, not
  from the queued wake; reuse the existing context shape and retry owner.
- Product/process constraints: preserve automatic delivery, exact destination,
  idempotency, and strict cross-member rejection.

## Risks and mitigations

1. Risk: a wake could gain authority by asserting its own member identity.
   Mitigation: bind the minimal context to `request.userId`; the existing guard
   still compares it with the wake and route authority.
2. Risk: the causal-only pass could gain the full foreground setup path.
   Mitigation: reuse only the minimal system-mailbox context and retain the
   existing early return.

## Tasks

1. Extract the existing minimal system-mailbox context builder around an
   explicit member id and use it in the causal-only pass.
2. Add focused regression coverage for request-bound context selection and
   preserved mismatch rejection.
3. Run focused tests, typecheck, ReviewGPT, exact-head CI, merge, deploy, and
   observe automatic retry completion.

## Decisions

- Keep the audience guard unchanged.
- Do not reissue, clear, or manually signal production mailbox data.

## Verification

- Commands to run: focused Vitest files for system-mailbox notification and
  workspace assistant phase; assistant-runtime typecheck; required PR CI.
- Expected outcomes: request-bound context reaches the causal-only mailbox
  preparation, genuine mismatch remains rejected, and production records two
  automatic delivery completions with no remaining referral mailbox items.
