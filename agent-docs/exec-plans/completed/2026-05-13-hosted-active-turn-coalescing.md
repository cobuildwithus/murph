# Hosted Active-Turn Coalescing

## Goal

Move hosted same-conversation webhook/mailbox coalescing onto the local
assistant active-turn input spine.

Success criteria:

- Cloudflare only records durable runner wake state and sends a payloadless
  invocation-local runtime wake to an active child when one exists.
- The hosted child exposes a small coalescing `RuntimeWakeSignal` to
  `packages/assistant-runtime`.
- `workspace-runner` owns a foreground conversation-mailbox import loop during
  assistant work, using existing mailbox import and input-store semantics.
- Imported conversation input notifies the assistant active-turn controller
  after best-effort prompt-preparation effects.
- `assistant-engine` owns active-turn admission through separate event,
  boundary, and live-poll flags, with hosted queue-only auto-replies disabling
  only live polling while preserving event-driven and provider-boundary
  admission.
- Hosted active-turn mailbox refresh/checkpoint ports are deleted as
  correctness paths.
- Tests and docs assert one coherent outbound reply/coalesced logical turn,
  not exact provider request count.

## Constraints

- Preserve unrelated dirty work in the current checkout.
- Keep runtime wakes payloadless: no conversation, prompt, provider, or message
  payload in Cloudflare wake routes or child IPC.
- Do not add new durable Cloudflare state beyond the existing wake/alarm
  coordination.
- Keep mailbox payload decode, import watermarks, accepted-input journal,
  transcript, checkpoint, outbox, and delivery ownership in their existing
  packages.
- Prefer small owner-local primitives over hosted-specific assistant-engine
  APIs or Cloudflare steering bridges.

## Plan

1. Split active-turn controller flags and add the local-service pre-provider
   drain.
2. Add `RuntimeWakeSignal` in assistant-runtime and pass it through hosted
   runtime job inputs.
3. Add container and child-process payloadless wake plumbing with child
   readiness acknowledgement.
4. Add the foreground hosted conversation-mailbox import loop in
   `workspace-runner`.
5. Delete hosted active-turn refresh/checkpoint ports and skip flags.
6. Update focused package/app tests and durable architecture docs.
7. Run required verification and completion audits, then close this plan through
   `scripts/finish-task` if a scoped commit is safe.

## Verification

Completed:

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff <task paths>`
- Focused assistant-engine, assistant-runtime, and Cloudflare tests added or
  updated for the wake/import/admission behavior.
- Completion audit passes required for high-risk runtime/trust-boundary work.
  Security/privacy, simplify, coverage-write, and task-finish-review completed;
  no blocking findings remained after the simplify fix preserving
  provider-boundary admission for hosted queue-only auto-replies.
Status: completed
Updated: 2026-05-13
Completed: 2026-05-13
