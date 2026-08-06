# Linq attachment delivery recovery

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Make private generated-image delivery recover automatically from transient
  Linq attachment-reservation and byte-upload failures without regenerating the
  canonical image, widening retry policy for unrelated POST operations, or
  introducing another queue or state owner.

## Success criteria

- A retryable attachment-stage failure leaves the existing outbox intent
  eligible for bounded automatic retry with the same canonical `vault_image`
  artifact and delivery identity.
- An ambiguous attachment-reservation failure never blindly repeats a
  potentially completed non-idempotent provider effect unless the provider
  contract or a narrower reconciliation proof makes that safe.
- Secret-safe hosted diagnostics distinguish reservation, upload, and final
  message-send failures and retain timeout/transport classification without
  message content, provider paths, private identifiers, or credentials.
- Direct tests prove successful recovery, bounded attempts, stable artifact
  reuse, and fail-closed ambiguous-delivery behavior.
- Required exact-head ReviewGPT and CI gates complete with no unresolved
  findings.

## Scope

- In scope: Linq attachment creation/upload retry classification, the existing
  assistant outbox recovery path, structured runtime-log projection, focused
  unit/integration tests, and the owning reliability documentation.
- Out of scope: automatic group failure notices, image regeneration, a new
  scheduler or persisted state owner, public image URLs, broad POST retry
  policy, or unrelated messaging transports.

## Constraints

- Reuse the canonical vault image, current outbox lifecycle, and stable
  delivery identity.
- Preserve the invariant that an ambiguous non-idempotent provider call cannot
  be blindly replayed.
- Keep observability best-effort and off the user-facing delivery path.
- Prefer deletion or a narrow policy correction over a new abstraction.

## Production evidence

- Two image-provider calls completed successfully in the affected turn.
- The first delivery failed before Linq returned a response to attachment
  creation and was classified terminal after one attempt.
- A later delivery through the same route succeeded, and no other matching
  attachment-creation failure appeared in the bounded production window.
- Existing logs preserve the high-level operation but discard enough safe
  transport classification to distinguish DNS, TLS, socket, and worker aborts.

## Tasks

1. [complete] Delegate an evidence-backed implementation patch to ReviewGPT.
2. [complete] Inspect the returned patch and align it with current owner and
   provider ambiguity contracts.
3. [complete] Run focused recovery, logging, typecheck, and direct call-path
   proof.
4. [in progress] Commit, push, open a PR, and complete preliminary specialist,
   final ReviewGPT, and exact-head CI gates.
5. [pending] Close the plan through the scoped final commit path.

## Decisions

- Do not add automatic group failure notices; the requested recovery is silent
  transport recovery of an already-authorized reply.
- Do not regenerate an image to recover delivery. The canonical capture and
  hash-bound response-media descriptor are the existing source of truth.
- Treat provider documentation as insufficient evidence for blindly retrying
  a lost-response attachment-creation POST; ReviewGPT must either find a safe
  existing retry seam or preserve confirmation-pending behavior for that case.

## Verification

- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/http-linq-device-runtime.test.ts`
  from `packages/operator-config`: 51 tests passed.
- `pnpm exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts`
  from `packages/assistant-runtime`: 276 tests passed.
- `pnpm --dir packages/operator-config typecheck`: passed.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
