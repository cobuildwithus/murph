# Drain hosted system-mailbox notification outbox effects

Status: active
Created: 2026-04-28
Updated: 2026-05-01

## Goal

- Fix hosted first-contact notification delivery so a system-mailbox
  `assistant.notification.requested` wake can create, checkpoint, and drain the
  assistant outbox send in the same production path that processes the mailbox
  item.

## Success criteria

- Production-shaped Linq hosted local E2E imports `member.activated` and
  `assistant.notification.requested` before the first runner wake and sends the
  welcome through Linq.
- Assistant-runtime unit coverage proves system-mailbox notification processing
  prepares and drains delivery effects after checkpoint.
- Existing system-mailbox receipt and retry invariants remain intact.

## Scope

- In scope:
  - `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
  - Direct assistant-runtime and hosted Linq E2E coverage.
- Out of scope:
  - Cloudflare Durable Object scheduling changes.
  - Hosted web onboarding/account creation behavior.
  - Provider prompt/copy changes.

## Constraints

- Technical constraints:
  - Preserve the mailbox/workspace checkpoint protocol: side effects are
    prepared before checkpoint and external delivery happens only after the
    workspace checkpoint commits.
  - Do not make web or Cloudflare own outbox truth.
- Product/process constraints:
  - Keep logs redacted and do not persist plaintext messages or direct contact
    identifiers in new observability.

## Risks and mitigations

1. Risk: Draining a notification outbox intent before its containing workspace
   state is committed.
   Mitigation: Reuse the existing prepare-before-checkpoint and drain-after-
   checkpoint flow from the normal assistant pass.
2. Risk: Accidentally dispatching unrelated pending outbox while processing a
   non-notification system mailbox item.
   Mitigation: Only collect delivery side effects for processed
   `dispatch-assistant-notification` items.

## Tasks

1. Add a focused assistant-runtime regression for system-mailbox notification
   delivery effects.
2. Patch the system-mailbox branch to prepare and drain notification outbox
   effects through the existing checkpointed delivery primitive.
3. Adjust the Linq hosted local E2E to enqueue activation and signup welcome
   before the first worker wake.
4. Run focused unit and hosted Linq E2E checks.
5. Run required completion audits and scoped repo verification.

## 2026-05-01 debug note

- Added the missing bridge from system-mailbox assistant-notification
  `redactedLogEntries` into the existing durable `assistant.automation_detail`
  runtime log path.
- Focused proof now covers a skipped first-contact-style notification failure
  and verifies disallowed local path previews are not persisted.
- This is observability for the current no-outreach repro; it does not by itself
  prove the hosted-local Linq E2E or production welcome delivery is fixed.

## Decisions

- The fix belongs in `packages/assistant-runtime`, because the failing path
  already reaches notification execution and provider response handling; the
  missing step is local outbox effect draining.

## Verification

- Commands to run:
  - `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`
  - `pnpm typecheck`
  - Scoped diff/app verification as required by final touched files.
- Expected outcomes:
  - Focused unit and Linq E2E pass.
  - Any broader red checks are identified as unrelated before handoff.
