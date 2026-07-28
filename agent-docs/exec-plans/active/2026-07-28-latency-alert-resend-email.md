# Latency alert Resend email

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Deliver hosted reply-latency operator alerts through the existing Resend
  plain-text email transport instead of a Linq/iMessage chat.

## Success criteria

- The existing latency incident state machine remains the sole owner of health,
  quiet hours, pacing, coalescing, send admission, and retry state.
- A configured incident sends only through Resend to the operational alert
  mailbox; the removed Linq chat setting cannot become a fallback.
- Ambiguous retries replay the exact same body and incident-scoped Resend key,
  while later incidents receive a distinct key and mutable configuration cannot
  create a second identity for the earlier effect.
- Provider failures persist only sanitized error codes and HTTP status.
- Focused tests, direct lost-acknowledgement proof, canonical verification,
  preliminary specialist review, final ReviewGPT, CI, and mergeability pass.

## Scope

- In scope: latency monitor delivery adapter and configuration, the shared
  plain-text Resend boundary when required for abort-safe calls, focused tests,
  hosted-local direct proof, and current owner documentation.
- Out of scope: latency classification, schema changes, new queues or retry
  services, Linq delivery behavior outside latency paging, and user-facing UI.

## Constraints

- Reuse the current `HostedLinqAlert` incident row and Resend transport.
- Add no dependency, schema, notification framework, fallback channel, or new
  long-lived state owner.
- Keep secrets, recipients, provider bodies, and private trace data out of
  persisted diagnostics and repository artifacts.
- Treat the supplied patch as behavioral intent; reconcile it against current
  `main` rather than applying stale hunks blindly.

## Risks and mitigations

1. Risk: an accepted email with a lost acknowledgement is sent twice.
   Mitigation: persist and replay one exact incident request identity, and prove
   the real boundary with a Resend lost-acknowledgement stub.
2. Risk: mutable email configuration changes the payload behind an existing
   idempotency key.
   Mitigation: keep the incident key independent of configuration so Resend
   rejects a changed-payload replay instead of accepting a duplicate under a
   new key.
3. Risk: delivery migration accidentally retains a phone fallback.
   Mitigation: remove the production chat configuration and assert that setting
   it cannot trigger a Linq send.
4. Risk: a broad notification abstraction increases ownership complexity.
   Mitigation: keep the change at the existing latency incident and shared
   Resend transport boundaries.

## Tasks

1. Audit the supplied patch and current provider/configuration seams.
2. Implement the smallest Resend-only delivery change and focused tests.
3. Run focused and direct scenario proof plus canonical verification.
4. Complete the preliminary specialist review and resolve accepted findings.
5. Run parent final review, close this plan with the final scoped commit, then
   complete final ReviewGPT, CI, and mergeability.

## Decisions

- Select the final PR-lane ReviewGPT gate because this changes an external
  operational egress path and replay semantics; do not also run local
  `deep-review`.
- Apply the coverage lens in the preliminary specialist pass. Prompt,
  frontend, and product-experience lenses are not applicable.
- Keep the existing historical operational-email environment names unless a
  narrower current owner is already available; avoid a configuration migration
  solely for naming.

## Verification

- Focused Vitest coverage for latency alert configuration, delivery, provider
  failure metadata, pacing, and exact ambiguous retry identity.
- Focused Resend transport coverage for caller abort propagation and sanitized
  provider failures.
- Hosted-local direct proof for accepted-but-lost acknowledgement replay and no
  Linq/iMessage fallback.
- `pnpm test:diff` for every touched owner when it truthfully covers the change.
- `pnpm verify:acceptance`.
