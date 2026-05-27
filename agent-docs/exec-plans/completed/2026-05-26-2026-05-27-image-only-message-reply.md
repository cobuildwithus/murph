# Image-only message reply fix

Status: completed
Created: 2026-05-26
Updated: 2026-05-27

## Goal

- Diagnose and fix the regression where an inbound message containing images
  but no text is accepted by ingress but fails before Murph can reply.

## Success criteria

- Image-only inbound messages with supported attachments create an assistant
  input event that can trigger a normal reply.
- Text-empty / attachment-empty inbound messages still stay suppressed.
- The fix is covered by focused regression tests and required type/test checks.
- No raw message bodies, attachment URLs, local paths, account ids, or user ids
  are logged, fixture'd, or exposed.

## Scope

- In scope:
  - Message part extraction / supported-message classification.
  - Hosted mailbox bootstrap ordering, conversation import, and assistant
    input event admission.
  - Focused tests for image-only or attachment-only message handling.
- Out of scope:
  - Provider API configuration, live provider sends, or broad hosted scheduler
    changes unless the evidence proves they are the cause.

## Constraints

- Technical constraints:
  - Preserve the assistant input spine: source adapter -> assistant input event
    -> runtime scanner.
  - Keep inbox projection helpful but not the gate for Codex admission.
  - Preserve empty/no-content suppression for true no-op messages.
- Product/process constraints:
  - Treat message content, attachments, identifiers, and mailbox metadata as
    high-sensitivity.
  - Coordinate with active hosted inbox/runtime rows before touching overlapping
    files.

## Risks and mitigations

1. Risk: A permissive fix could make no-content provider noise trigger replies.
   Mitigation: Require supported attachment evidence or text readiness, and add
   a negative test for true empty messages.
2. Risk: Logging or test fixtures could expose sensitive message material.
   Mitigation: Use synthetic metadata-only fixtures and assert counts/types
   rather than raw payloads.

## Tasks

1. Trace current image-only ingress through provider parsing, mailbox import,
   and assistant input admission. Done.
2. Identify the narrow runtime import ordering bug that prevents cold vault
   bootstrap before conversation import. Done.
3. Patch initial mailbox import lane selection while preserving no-op
   suppression. Done.
4. Add focused tests for cold image-only conversation bootstrap ordering. Done.
5. Run required verification and completion audits. Done.
6. Close the active plan with a scoped commit or report any safe-commit blocker.
   Done: safe scoped commit is blocked by overlapping unrelated dirty work.

## Decisions

- The empty-parts webhook guard was not the failing path for the observed
  message: local metadata showed the conversation item was appended and the
  runtime woke.
- The runtime failed during `mailbox.import.initial` because a cold vault with
  no metadata imported only the conversation lane while its bootstrap
  `member.activated` item was still pending in the system lane.
- Use the smallest owner-level fix: include `system` before `conversation`
  only when the restored vault has not been bootstrapped yet.
- Final review found that a combined `system` + `conversation` import still
  needed a bootstrap barrier when the system item is deferred or blocked. Add
  the barrier before conversation payload/import, and return a mailbox retry
  instead of entering assistant execution while bootstrap remains pending.
- The bootstrap-pending runtime return is based on the cold-vault invariant:
  after an initial bootstrap import, if metadata is still missing and a blocked
  item is on `system` or marked `bootstrap.pending`, the runtime does not enter
  sidecar, CLI, or assistant execution.
- The pre-payload conversation deferral also covers sidecar-backed
  conversation items when metadata is still missing, avoiding premature payload
  fetch/decode before bootstrap exists.

## Verification

- Passed:
  - `pnpm exec vitest run test/hosted-runtime-workspace-entrypoint.test.ts --no-coverage`
  - `pnpm exec vitest run test/hosted-runtime-mailbox-conversation-import.test.ts --no-coverage`
  - `git diff --check`
  - `pnpm typecheck`
  - `pnpm test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts agent-docs/exec-plans/active/2026-05-26-2026-05-27-image-only-message-reply.md`
- Required audits:
  - Security/privacy review: no findings.
  - Coverage/write review: added restored-metadata and deferral coverage.
  - Task-finish correctness review: no findings. Residual gap: no live Linq
    provider round trip was run.
Completed: 2026-05-27
