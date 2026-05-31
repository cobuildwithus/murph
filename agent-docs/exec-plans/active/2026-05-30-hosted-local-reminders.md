# Hosted local reminder delivery investigation

Status: active
Created: 2026-05-30
Updated: 2026-05-31

## Goal

- Reproduce and fix hosted-local scheduled reminder delivery so a user request
  like "remind me to do pushups in seven minutes" results in an outbound
  reminder through the hosted local runtime after the due time.
- Diagnose from durable evidence first: hosted-local E2E behavior, local
  container/runtime logs, Temporal/web demand state, and local database state.

## Success criteria

- A hosted-local E2E scenario proves reminder creation, scheduled wake/demand,
  runtime processing after the due time, and outbound delivery to the original
  requester.
- The root cause is explained with code/log/database evidence, not guessed.
- The fix preserves the existing ownership model: canonical reminders stay in
  vault automation/runtime-owned state, Temporal only orchestrates pointer-like
  wakeups, web owns hosted demand/status, and Cloudflare remains an execution
  adapter.
- Verification includes focused tests, the hosted-local reminder scenario, and
  the required repo checks/audits for the touched surfaces.

## Scope

- In scope:
  - Hosted local reminder scheduling and due-wake delivery.
  - Assistant/runtime handling of due canonical automations or scheduled
    assistant prompts.
  - Temporal/web/cloudflare demand and `nextWakeAt` plumbing if evidence points
    there.
  - Focused hosted-local E2E coverage for the reminder path.
- Out of scope:
  - Broad scheduler rewrites or new queue/worker systems.
  - iMessage/computer-use proof while local SMS/iMessage delivery is not
    available.
  - Unrelated device-sync dirty-ack, retention, or Murph Age work.

## Constraints

- Technical constraints:
  - Keep logs and artifacts metadata-only and redacted.
  - Do not move raw prompts, transcripts, provider payloads, or vault contents
    into Temporal state or logs.
  - Preserve foreground conversation priority over background work.
  - Do not introduce fallback schedulers until the existing runtime, web,
    Temporal, and Cloudflare ownership boundaries are ruled out.
- Product/process constraints:
  - Maintain simple, composable primitives with minimal new abstraction.
  - Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: Live hosted-local E2E may require real provider credentials.
   Mitigation: Prefer existing hosted-local stub scenarios for deterministic
   reproduction, then run opt-in live proof only when configured.
2. Risk: Fixing due wake behavior in Temporal can affect workflow replay.
   Mitigation: Avoid command-ordering changes where possible; if unavoidable,
   add required replay/versioning evidence.
3. Risk: Diagnostic logs could expose sensitive content.
   Mitigation: Inspect metadata, ids, and counts only; redact any copied output.

## Tasks

1. Inspect current reminder/automation/runtime code and hosted-local scenarios.
2. Run the closest existing hosted-local scheduled reminder scenario and inspect
   redacted logs/database state for the failing boundary.
3. Add or update a deterministic E2E/regression that reproduces the bug.
4. Fix the root cause in the owning subsystem with the smallest durable change.
5. Run focused checks, hosted-local scenario proof, required typecheck/test
   lanes, and completion audits.

## Decisions

- Use hosted-local E2E instead of iMessage/computer-use proof unless local
  iMessage/SMS becomes available during the task.
- Existing `linq-scheduled-reminder` passed for a pre-seeded canonical
  automation. Strengthen that scenario to prove the assistant-side
  `vault-cli automation save` step through the hosted Codex E2E shim, because
  the likely gap is creation from a conversation turn rather than due delivery.
- The assistant-created scenario reproduced a due-wake failure: Temporal/web
  demand fired and cron found the canonical reminder, but the queued Linq
  reminder did not reach the requester. The durable fix is in the outbox target
  primitive: persist inferred binding delivery for queued route fields so later
  outbox dispatch receives a complete delivery candidate.
- A follow-up failure after the outbox fix showed delivery reached the Linq
  stub but the E2E shim stripped ordinary JSON assistant responses before the
  notification decision parser could read them. Treat only explicit
  `__murphE2eToolCalls` or `__murphE2eVaultCliCommands` payloads as E2E
  directives; preserve ordinary JSON model text.
- A no-bundle hosted-local rerun on 2026-05-31 proved the post-send dirty
  checkpoint path: `outbox.delivery_finished` sent one Linq thread message,
  then `idle_shutdown` checkpointed workspace version 3 with no next wake.

## Verification

- Commands to run:
  - Focused reminder/runtime tests determined by touched files.
  - `pnpm hosted-local e2e linq-scheduled-reminder` or a narrower reminder
    scenario that proves due delivery.
  - `pnpm typecheck`.
  - `pnpm test:diff <touched paths>` or owner coverage commands for touched
    packages/apps.
- Expected outcomes:
  - Reminder due time produces a scheduled runtime wake.
  - The hosted runtime processes the wake after due time and emits one outbound
    reminder for the original requester.
  - No raw sensitive payloads appear in logs, fixtures, or committed artifacts.

## Progress

- Focused regression added in `packages/assistant-engine/test/assistant-outbox-runtime.test.ts`.
- `pnpm --filter @murphai/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-outbox-runtime.test.ts` passed.
- E2E shim regression added in `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`.
- `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-codex-config.test.ts` passed.
- `pnpm hosted-local e2e --no-bundle linq-scheduled-reminder` passed on
  2026-05-31 and proved assistant-created reminder setup, natural due wake,
  Linq send, and final `idle_shutdown` checkpoint.
