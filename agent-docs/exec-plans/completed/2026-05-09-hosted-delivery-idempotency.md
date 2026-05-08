# Hosted Delivery Idempotency

## Goal

Make hosted outbound delivery idempotency a delivery-layer invariant instead of a caller-owned best effort.

Success criteria:

- Hosted Linq/email sends that claim transport idempotency never reach transport without a non-null deterministic idempotency key.
- Notification/system-mailbox delivery paths are covered by focused tests.
- Existing local/non-hosted delivery behavior is preserved.

## Scope

- Assistant delivery-layer and hosted delivery id helpers.
- Focused assistant runtime/engine tests covering hosted delivery send paths.
- Durable docs only if the implementation changes the documented hosted protocol.

## Constraints

- Preserve unrelated dirty worktree edits.
- Do not expose secrets, contact identifiers, raw message contents, local usernames, or home paths in code, docs, tests, logs, or commits.
- Prefer existing hosted metadata and helper shapes; avoid new persisted state.
- Fail closed only when hosted execution is attempting a provider-visible delivery without enough metadata for a stable key.

## Verification

- Focused tests for hosted Linq/email delivery idempotency, including notification/system-mailbox paths when present.
- `pnpm typecheck` plus `pnpm test:diff` or owner package coverage if the diff-aware lane is not truthful.
- Security/privacy and completion review because this touches external delivery replay safety and contact-sensitive outbound paths.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
