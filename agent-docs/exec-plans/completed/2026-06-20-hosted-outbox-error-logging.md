# Hosted outbox error logging

## Goal

Make hosted outbox delivery failures log the actual redacted error diagnostics
needed to debug provider failures.

Success criteria:

- Remove provider-specific delivery error summary allowlists.
- Log bounded redacted delivery error entries with code, status, channel,
  retryability, and message.
- Add regression coverage for Telegram reaction delivery and redacted error
  logging.
- Update invariants so repo logs default to shared redaction plus complete error
  diagnostics instead of caller-local redaction policy.

## Constraints

- Preserve unrelated worktree edits and active plans.
- Do not expose secrets, raw provider payloads, local paths, home paths, or
  direct user identifiers in logs, tests, docs, or handoff.
- Keep the change narrow and avoid new logging abstractions unless existing
  parser shape requires them.

## Approach

1. Replace split internal/external delivery error summaries with direct redacted
   diagnostics.
2. Keep runtime log parser/store validation shallow and bounded.
3. Update focused runtime and hosted-local Telegram tests.
4. Run scoped verification and required audits.

## State

Ready for commit.

## Notes

- Live local evidence showed the reaction tool queued a Telegram delivery
  effect, then `outbox.delivery_finished` hid the provider failure behind
  `external_code`.
- Implemented ephemeral dispatch diagnostics, shared-redacted hosted delivery
  error summaries, Telegram Bot API failure details, parser/store bounds, and
  hosted-local Telegram success/failure E2E coverage.
- Verification passed: hosted-local Telegram reaction failure E2E, focused
  operator-config/hosted-execution/web/assistant-runtime/assistant-engine tests,
  `pnpm typecheck`, and `git diff --check`.
- Required completion audits completed with no medium-or-higher findings.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
