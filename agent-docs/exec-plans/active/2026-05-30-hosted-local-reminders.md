# Hosted local reminder delivery investigation

Status: active
Created: 2026-05-30
Updated: 2026-06-01

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
- Keep the strengthened E2E on the normal hosted `member.activated` bootstrap
  path before the setup conversation. Synthetic checkpoint seeding bypassed
  ordinary member activation state and could leave the setup turn waiting on a
  runner child timeout before the assistant-created reminder was exercised.
- Keep the reminder lead at five minutes in this hosted-local suite. The full
  E2E run showed the seven-minute variant could reach the due wake close to the
  project-level Vitest timeout under full-suite contention, leaving retries to
  report a cron enqueue failure instead of proving the delivery path.
- Acceptance exposed an unrelated CLI setup-test flake: one test launched five
  `murph` alias subprocesses concurrently while each helper verified runtime
  artifacts. Run those alias checks serially and bound each subprocess so the
  acceptance lane is deterministic under package coverage fanout.
- Keep the hosted Codex E2E app-server shim test-only and explicit about its
  trusted package CLI path. The stub no longer derives a package root from the
  child process working directory; tests pass an already validated local CLI
  binary, while the container fallback resolves only from `/app`.

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
  2026-05-31 after the E2E used the normal member activation bootstrap; it
  proved assistant-created reminder setup, natural due wake, Linq send, and
  final hosted completion with no next wake.
- Full `pnpm test:e2e:hosted-local` then narrowed to one scheduled-reminder
  failure near the suite timeout. The scenario now uses a five-minute reminder
  lead so the same natural-wake proof has enough end-to-end budget in the full
  hosted-local suite.
- Full `pnpm test:e2e:hosted-local` passed after the lead-time reduction:
  11 files, 26 passed, 1 skipped.
- `pnpm verify:acceptance` exposed the CLI alias setup-test timeout described
  above. The test now keeps each child invocation bounded and gives the serial
  parent test enough budget for all five alias checks.
- Re-ran `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-codex-config.test.ts`
  after the trusted package-CLI shim regression was tightened; it passed.
- Re-ran `pnpm --dir packages/cli test -- test/setup-cli.test.ts -t "murph alias routes empty and help invocations to onboarding help"`;
  the package CLI workspace suite passed: 98 files, 852 tests.
- Re-ran `pnpm --dir apps/web verify` after one transient Google Fonts fetch
  failure during Next build; the web verify lane passed.
- `pnpm verify:acceptance` passed after the CLI alias setup-test stabilization.
- Coverage-write review added final scheduler quiescence proof to the hosted
  local Linq scheduled-reminder E2E: completion now requires both no pending
  hosted `nextWakeAt` and no Cloudflare `nextAlarmAt`.
- Focused security/privacy re-review found no high or medium findings after the
  trusted CLI path change. Residual assumption: the trusted CLI path environment
  variable remains controlled by the test harness, not member/user input.
- Final focused checks passed after the E2E shim hardening:
  `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-codex-config.test.ts`,
  `pnpm --filter @murphai/assistant-runtime exec tsc -p tsconfig.typecheck.json --pretty false`,
  `pnpm hosted-local e2e --no-bundle linq-scheduled-reminder`, `pnpm typecheck`,
  and `git diff --check`.
- Final `pnpm test:diff` passed for the active plan, coordination ledger, hosted
  local reminder E2E, hosted Codex E2E shim, shim regression test, and CLI setup
  alias test. The selected owners were `apps/cloudflare`,
  `packages/assistant-runtime`, and `packages/cli`; this included the serialized
  CLI alias coverage and `apps/cloudflare verify`.
