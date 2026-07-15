# Persist privacy-safe hosted runtime failure diagnostics

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Make accepted hosted-runtime attempt failures operationally diagnosable by
  persisting the bounded detail and cause already produced by the shared safe
  error-diagnostics owner.

## Success criteria

- `runner.accepted_attempt_failed` retains `safeErrorDetail` and
  `safeErrorCause` when present, alongside the stable summary and code.
- Hosted member IDs, workflow IDs, paths, URLs, credentials, contact details,
  and tokens remain redacted before the diagnostic crosses the runtime-log
  boundary.
- The shared runtime-log parser accepts the new values and focused tests prove
  the failure record contains useful sanitized detail without raw identifiers.
- Required Cloudflare/shared-package verification, coverage review, CI, and
  exact-head ReviewGPT complete before the production deploy.

## Scope

- In scope: the shared hosted-execution text redactor and matching persisted-log
  parser contract, Cloudflare runner diagnostic projection, and focused
  regression tests.
- Out of scope: runtime repair operations, runner lifecycle or retry behavior,
  mailbox semantics, database schema, and user-facing Web behavior.

## Constraints

- Reuse the existing bounded safe-error diagnostics rather than introducing a
  second sanitizer, persisted state owner, or raw exception channel.
- Persist no stack preview, nested error object, payload, workspace path, or
  direct member identifier.
- Avoid files owned by active runner lifecycle and container-entrypoint lanes.

## Risks and mitigations

1. Risk: diagnostic text can contain a hosted opaque identifier not covered by
   the existing `member_` and `user_` patterns.
   Mitigation: redact the canonical hosted prefixed-ID shape in the shared
   sanitizer and cover it with a synthetic identifier regression test.
2. Risk: an otherwise safe diagnostic key can make Web reject the complete log
   request.
   Mitigation: use the already allowlisted `safeErrorDetail` and
   `safeErrorCause` keys, keep the parser fail-closed for raw secret-shaped
   values while accepting exact redaction sentinels, and parse the resulting
   request in focused coverage. Deploy the backward-compatible Web parser
   before the Cloudflare producer starts sending the enriched values.
3. Risk: widening observability changes the runtime behavior or retry loop.
   Mitigation: change only metadata projection; leave invocation, fence,
   checkpoint, and retry control flow untouched.

## Tasks

1. Add hosted opaque-ID redaction coverage to the shared sanitizer.
2. Project shared sanitized error detail and cause into persisted runner logs.
3. Run focused and owner verification, required coverage review, and parent
   final review.
4. Finish the scoped commit, push and open the PR, then run ReviewGPT and CI in
   parallel, merge, and deploy the exact merged main revision immediately.

## Verification

- Focused hosted-execution observability test.
- Focused Cloudflare accepted-attempt transport-failure test.
- Cloudflare/shared-owner typecheck and acceptance verification routed by the
  repository verification map.
- `git diff --check`, required `coverage-write` pass, exact-head ReviewGPT, PR
  CI, and clean merge proof against current `main`.

Completed locally:

- Focused hosted-execution tests: 53 passed.
- Focused Cloudflare transport-failure tests: 22 passed.
- Hosted-execution and Cloudflare typechecks passed.
- Cloudflare owner verification: 105 files and 1,806 tests passed.
- A full acceptance run passed before the final parser hardening. The repeated
  acceptance run passed all changed owners, Cloudflare verification, Web tests,
  lint, and production build; one unrelated CLI expansion test timed out under
  concurrent coverage load, and the command was stopped after its remaining
  workspace tail produced no output for more than 90 seconds.
- `git diff --check` passed.

## Audit outcomes

- Coverage-write added production-path proof at the accepted-attempt harness.
  It exposed a shared sanitizer/parser mismatch where exact `[redacted]`
  credential sentinels were rejected as secret-shaped content. The parser now
  accepts only bounded exact sentinels while continuing to reject raw and
  suffix-adjacent secret values.
- The enriched harness serializes and reparses the real runtime-log request and
  proves hosted IDs, paths, URLs, email, phone, tokens, and bearer credentials
  do not survive into persisted diagnostics. No coverage finding remains.
Completed: 2026-07-15
