# Latency alert Resend email

Status: completed
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
- Focused tests, direct lost-acknowledgement proof, preliminary specialist
  review, final ReviewGPT, CI, and mergeability pass; any unrelated canonical
  verification admission blocker is documented with next-best proof.

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
   new key within its provider retention window; do not claim provider-side
   exactly-once behavior beyond that external window.
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
- Accept the preliminary coverage finding: directly prove that rotating the
  configured sender and recipient preserves the incident key and message, and
  that the provider's changed-payload conflict remains sanitized. This closes a
  proof gap without adding production state or changing the delivery design.
- Parent final review kept the durable contract honest about Resend's external
  idempotency retention window and removed the test suite's duplicated send
  input shape in favor of the transport's owned type.

## Verification

- Passed focused Web Vitest coverage for latency alert configuration, delivery,
  provider failure metadata, pacing, mutable-configuration retry identity,
  caller abort propagation, and sanitized provider failures (35 tests).
- Passed the focused hosted-local Resend stub suite (2 tests), Web prepared
  typecheck, and the full foreground-priority hosted-local scenario (5 tests)
  with real PostgreSQL, authenticated cron HTTP, accepted-but-lost
  acknowledgement replay, and no Linq/iMessage fallback.
- `pnpm test:diff` passed global guards and selected both touched app owners, but
  its bounded local attempt could not enter the exclusive shared-host slot.
  `pnpm verify:acceptance` was also run and kept waiting across multiple
  unrelated acceptance owners before the owned waiter was stopped. The
  documented Crabbox fallback failed before provisioning because the installed
  delegate rejects the dispatcher's required `--stop-after` contract. GitHub CI
  and the focused direct proofs are the independent final validation for this
  host-capacity exception.
Completed: 2026-07-28
