# PR 585 Stable Join-Offer Effect Identity

## Goal

Make one accepted join-offer operation retain one durable effect and provider
idempotency key across tool-call recovery, while a later accepted operation
remains distinct even when it renders identical text.

## Scope

- Derive the effect from the existing accepted-input request-key scope and the
  normalized join-offer intent instead of the Codex tool-call id.
- Carry the effect in a signed, old-web-compatible request query and require it
  before web mutates group or offer authority.
- Delete the rendered-content fallback and canonical-offer alias machinery that
  compensated for unstable attempt identity.
- Add response-loss, replay, distinct-input, and rollout compatibility proof.

## Constraints

- Reuse the existing accepted-input scope, group/offer owner, transaction, and
  provider idempotency boundary.
- Add no table, queue, scheduler, manager, retry state, or second owner.
- Preserve the existing join-offer flow during bounded web/runner skew and keep
  exact thread, message digest, permission snapshot, and target binding.
- Keep deploy skew explicit with one temporary web activation gate; add no
  compatibility state or content-derived request identity.
- Treat every provider dispatch that may have started but lacks a durable bound
  outcome as retryable through the same offer and provider idempotency key.
- Terminalize only a proven nonretryable provider rejection by revoking the
  exact pending offer; do not add dispatch state or retry ownership.

## Verification

- Focused assistant-engine, hosted-execution, Cloudflare transport, web route,
  group-tool, and group-store tests.
- Affected package/app typechecks and truthful diff verification.
- Required post-fix coverage and security/privacy reviews.
- Record the ReviewGPT hard-cap disposition without starting an invalid
  eleventh round.

## Progress

- [x] Reproduced the attempt-key duplicate-send and legacy-key suppressed-send
  paths from ReviewGPT Round 8.
- [x] Add failing accepted-operation identity and transport compatibility proof.
- [x] Replace attempt identity and delete compensating alias/fallback state.
- [x] Reproduce ReviewGPT Round 9 template, rollout, and pending-binding paths.
- [x] Share template normalization, gate stable-effect enforcement, and keep a
  pending visible offer retryable with the same provider idempotency key.
- [x] Reproduce ReviewGPT Round 10 post-dispatch ambiguity across send, empty or
  malformed success, bind-state read, callback-route, and assistant-tool paths.
- [x] Route ambiguous dispatch through one retryable error and revoke only the
  exact pending offer after a proven nonretryable Linq rejection.
- [x] Pass pre-integration focused checks, full `pnpm test:diff`, coverage
  review, and security/privacy review.
- [x] Integrate the current stacked base while preserving its privacy-safe
  provider-event key and current-participant normalization.
- [x] Re-run exact integrated-head verification and completion audits.
- [x] Integrate the final base-only update and pass its focused automation,
  hosted-runtime, and reaction-context suites.
- [x] Prepare scoped plan closure and record that the ten valid ReviewGPT
  rounds reached the repository hard cap.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
