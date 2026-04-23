# Redact Telegram identifiers from hosted operator logs

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Remove raw Telegram routing identifiers from hosted/operator failure logs without changing Telegram delivery or cleanup behavior.

## Success criteria

- `packages/operator-config/src/telegram-runtime.ts` no longer attaches raw Telegram thread targets or migrated chat ids to thrown `VaultCliError` contexts.
- `packages/hosted-execution/src/observability.ts` sanitizes Telegram identifiers that still arrive through structured log details when the log context is clearly Telegram-related.
- Cloudflare runner cleanup or assistant-notification failure logs no longer surface raw chat ids, business connection ids, or `:topic:` / `:dm-topic:` composites.
- Focused tests cover both the source-side Telegram error redaction and the hosted structured-log sanitizer.

## Scope

- In scope:
- `packages/operator-config/src/telegram-runtime.ts`
- `packages/hosted-execution/src/observability.ts`
- focused `packages/operator-config/test/runtime-helpers.test.ts`
- focused `packages/hosted-execution/test/hosted-execution-observability-side-effects.test.ts`
- directly coupled Cloudflare or assistant-runtime tests only if a focused assertion is needed for the hosted failure path
- `agent-docs/exec-plans/active/{2026-04-23-telegram-log-redaction.md,COORDINATION_LEDGER.md}`
- Out of scope:
- delivery semantics, retry policy, or cleanup target selection
- assistant-engine local Telegram send-path refactors outside whatever the hosted structured-log sanitizer already covers
- broader provider-id redaction beyond the Telegram leak described in the task

## Constraints

- Technical constraints:
- Preserve current Telegram API request payloads and migration handling; only observability payloads should change.
- Keep the hosted structured-log sanitizer privacy-bounded without dropping useful operational shape such as whether a Telegram target used business or topic routing.
- Avoid introducing new package dependencies for this slice.
- Product/process constraints:
- Preserve unrelated dirty-tree edits, especially the in-progress Cloudflare runner split, hosted observability lane, and operator-config boundary work.
- Treat this as a high-risk trust-boundary/privacy fix: run truthful owner verification, capture direct proof from the focused tests, and complete the required `coverage-write` plus `task-finish-review` audit passes before handoff.

## Risks and mitigations

1. Risk: redacting too aggressively removes the shape operators still need to debug Telegram routing failures.
   Mitigation: replace raw identifiers with bounded summaries that preserve route shape such as plain-thread vs topic vs business routing.
2. Risk: source-side redaction in `telegram-runtime.ts` diverges from the hosted structured-log sanitizer and leaves a second leak path.
   Mitigation: add focused tests on both seams and keep the hosted sanitizer as the backstop for error details emitted outside the operator-config helper.
3. Risk: overlap with the dirty Cloudflare runner split makes a direct cleanup-file edit risky.
   Mitigation: keep the fix centered in shared hosted observability and Telegram runtime helpers so the active runner split can consume it without file conflict.

## Tasks

1. Completed: inspect the current Telegram runtime and hosted observability seams, confirm the raw-target leak, and scope the fix away from unrelated runner refactors.
2. In progress: add Telegram-target redaction helpers in `operator-config` and extend hosted structured-log sanitization for Telegram-specific details.
3. Pending: add focused regression coverage for Telegram runtime errors and hosted observability redaction.
4. Pending: run truthful verification, then the required `coverage-write` and `task-finish-review` audit passes, and rerun affected checks.
5. Pending: create a scoped commit only if exact staging is possible in the current dirty tree.

## Decisions

- Keep the operator-config fix source-local so raw Telegram identifiers stop propagating from the runtime helper itself.
- Use hosted-execution observability as the backstop so already-annotated Telegram error details are still redacted even when they originate outside `telegram-runtime.ts`.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/operator-config/src/telegram-runtime.ts packages/operator-config/test/runtime-helpers.test.ts packages/hosted-execution/src/observability.ts packages/hosted-execution/test/hosted-execution-observability-side-effects.test.ts`
- `git diff --check`
- required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- Focused Telegram runtime tests assert redacted error contexts instead of raw ids.
- Hosted observability tests prove raw Telegram identifiers are collapsed before structured-log emission or extraction.

## Outcome

- Completed in the shared working tree without a scoped commit.
- Raw Telegram identifiers are now redacted in operator-config Telegram error contexts and in hosted structured-log details when the log context indicates Telegram or the error code is Telegram-specific.
- Focused regression coverage now includes invalid target, migrated chat-id, delete failure, structured-detail, and business-connection redaction assertions.

## Audits

- Completed:
- `coverage-write` added one focused hosted-execution assertion for `businessConnectionId` redaction and did not change production code.
- `task-finish-review` reported no findings in the reviewed slice; the only noted residual risk is that future Telegram log paths still need one of the recognized Telegram hint keys to trigger the hosted sanitizer.

## Commit note

- No scoped commit was created. The shared dirty `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` already contains unrelated concurrent changes, so staging this task's exact file set would have absorbed other in-flight work.
Completed: 2026-04-24
