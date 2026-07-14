# PR 603 ReviewGPT Round 8 Remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Close the validated hosted Telegram business-message deletion authority gap.
- Require every hosted mutating Telegram provider request to carry the concrete chat and topic routing fields that are compared with the current bound target.
- Preserve direct-token/local business-message cleanup without adding message-ownership state.
- Keep failed hosted partial-delivery cleanup in the existing ambiguous, non-resendable disposition.

## Accepted finding

1. Hosted `deleteBusinessMessages` carries only a business connection and caller-selected message IDs, so the signed delivery-target header can substitute for chat/topic routing that the provider request does not prove.

## Constraints

- Remove the unsafe hosted operation instead of adding a message-ID ownership store or compatibility machinery.
- Keep ordinary hosted `deleteMessages` bound to an exact `chat_id` and keep rich business send operations bound to every actual routing field.
- Preserve direct-token/local `deleteBusinessMessages` behavior.
- Fail before both current-route authorization and Telegram provider entry for the unsupported hosted operation.

## Tasks

1. Remove `deleteBusinessMessages` from the hosted Telegram egress allowlist and delete the business-only target-matching branch.
2. Add focused Worker coverage for fail-before-authority/provider behavior and exact-chat `deleteMessages` authorization.
3. Prove direct-token/local business cleanup remains available and hosted cleanup failure retains ambiguous outbox disposition.
4. Run focused owner verification, rerun affected coverage and security/privacy audits, finish-task, push, CI, and exact-head ReviewGPT until clean.

## Verification log

- ReviewGPT round 8 on `44584533a9a8`: one High/invariant finding received and accepted after tracing the actual Worker token-rewrite and operator cleanup path.
- Cloudflare provider-entry tests: 230 passed, including rejection before write-fence/callback/provider entry and matching-versus-mismatched `deleteMessages.chat_id` proof.
- Operator Telegram runtime helpers: 32 passed; direct-token business cleanup remains available and sends no hosted routing headers.
- Assistant channel runtime and outbox tests: 106 passed; rejected hosted business cleanup becomes ambiguous and the existing outbox path is abandoned without resend.
- Cloudflare, operator-config, and assistant-engine typechecks passed; `git diff --check` passed.
- Coverage-write re-audit: one missing mismatched-chat negative case added; no unresolved findings.
- Security/privacy re-audit: no validated Medium-or-higher findings; hosted rejection precedes authority/token/provider entry, remaining mutations require exact routing, and no sensitive logging/header regression was found.
- `pnpm test:diff` passed syntax, architecture, privacy, dependency, workspace-boundary, cycle, and all affected typechecks. Its broad parallel package-test phase was blocked by unrelated timing failures in assistant-runtime, assistant-engine, and CLI expansion tests.
- Sequential reruns cleared the unrelated assistant-runtime failures (91 passed) and assistant-engine failures (177 passed). Eight CLI expansion command tests continued to hit their existing 60-second timeout while 14 neighboring tests passed; no touched Telegram owner is involved.
Completed: 2026-07-14
