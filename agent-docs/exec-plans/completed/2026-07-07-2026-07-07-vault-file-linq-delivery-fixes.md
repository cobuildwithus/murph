# Vault file Linq delivery failure feedback fixes

Status: completed
Created: 2026-07-07
Updated: 2026-07-07

## Goal

- Fix hosted vault-file delivery over Linq/iMessage so presigned attachment uploads use public fetch, terminal non-retryable delivery failures become model-visible pending input, and the send-vault-file tool wording does not imply confirmed delivery before transport completion.

## Success criteria

- Vault-file Linq attachment delivery performs the provider `POST /attachments` with provider fetch and the presigned storage `PUT` with `publicInternetFetch` in hosted runtime.
- Generated voice memo and vault-file attachment uploads share one operator-config helper with local/unhosted fallback semantics.
- A terminal non-retryable outbox failure stages exactly one assistant-facing pending input event per intent and wakes the hosted assistant without duplicating on re-observation.
- `send_vault_file` approved tool and prompt wording says approval succeeded and delivery is queued, not confirmed delivered.
- Hosted Linq send failure rows include a sanitized `failure_reason` for trusted `VaultCliError` messages.
- Focused tests and required typecheck/scoped package verification pass or any unrelated blocker is documented.

## Scope

- In scope:
  - `packages/operator-config` Linq upload helper and tests.
  - `packages/assistant-engine` voice memo/vault-file media upload wiring, tool wording, prompt wording, and focused tests.
  - `packages/assistant-runtime` hosted Linq dependency plumbing, terminal failure pending-input staging, sanitized failure reason, and focused tests.
- Out of scope:
  - New retry queues, delivery polling, approval un-consumption, Telegram/WhatsApp media behavior, or broad outbox refactors.

## Constraints

- Technical constraints:
  - Preserve existing atomic send behavior for multi-file messages.
  - Do not add persisted state classes; reuse assistant input and pending-input primitives.
  - Keep public fetch unrestricted only for the presigned storage upload; do not carry internal authority headers.
  - Avoid `as any` and cross-package internal imports.
- Product/process constraints:
  - Do not commit; supervising agent handles commits, audits, and PR.
  - Keep failure notes assistant-facing only, secret-safe, and not outbound copy.
  - Preserve iMessage delivery safety; retryable failures must not stage user-visible recovery pressure.

## Risks and mitigations

1. Risk: Public fetch is accidentally used for Linq provider API calls.
   Mitigation: Keep helper split explicit and test provider fetch for POST vs public fetch for PUT.
2. Risk: Terminal failure observations duplicate pending input across drain re-entry.
   Mitigation: Derive a deterministic assistant input id from the outbox intent id and upsert before enqueue.
3. Risk: Failure feedback leaks sensitive transport details.
   Mitigation: Include only channel kind, failure code, and attachment filenames; no URLs, headers, phone numbers, or raw payloads.

## Tasks

1. Inspect existing Linq upload helpers, voice memo upload path, vault-file media preparation path, hosted send dependency plumbing, and outbox drain failure handling.
2. Add `uploadLinqAttachment` in `packages/operator-config` and switch voice memo plus vault-file callers to it.
3. Thread `publicInternetFetch` through hosted Linq send dependencies to `prepareLinqMessageMedia`.
4. Stage deterministic pending assistant input for terminal non-retryable outbox failures using the existing hosted mailbox assistant-input pattern.
5. Reword `send_vault_file` approved result and matching system prompt contract.
6. Populate sanitized `failure_reason` from trusted `VaultCliError` messages.
7. Add/extend focused tests and run required verification.

## Decisions

- Use the generated plan filename with the repeated date segment rather than renaming it, to avoid unnecessary workflow churn.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff <touched paths>` if truthful, otherwise package-level coverage commands for `packages/operator-config`, `packages/assistant-engine`, and `packages/assistant-runtime`.
  - Focused tests for Linq attachment fetch split, vault-file public fetch plumbing, and terminal failed intent pending-input dedupe/wake behavior.
- Expected outcomes:
  - Typecheck passes.
  - Focused package tests cover the incident and edge cases listed in the task.

## Verification results

- `pnpm --dir packages/operator-config test http-linq-device-runtime.test.ts`: passed.
- `pnpm --dir packages/assistant-engine test assistant-channels-runtime.test.ts assistant-codex-generate-voice-memo-tool.test.ts assistant-vault-file-send.test.ts model-behavior.test.ts`: passed.
- `pnpm --dir packages/assistant-runtime test hosted-runtime-callbacks.test.ts hosted-runtime-workspace-assistant-phase.test.ts`: passed.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm typecheck`: passed after rebuilding missing local dist artifacts for `packages/operator-config`, `packages/exercise-library`, `packages/assistant-engine`, `packages/setup-cli`, and `packages/assistant-runtime`.
- `pnpm --dir packages/assistant-runtime test hosted-runtime-workspace-entrypoint.test.ts -t "reports mailbox budget exhaustion only after deferring an overflow item"`: passed after the diff run surfaced a suite-level fake-timer/temp-dir failure in that test.
- `pnpm --dir packages/assistant-runtime test`: passed.
- `pnpm --dir packages/hosted-local-harness test`: passed after building `packages/assistant-runtime/dist`.
- `pnpm test:diff <touched paths>`: run multiple times; blocked by the same unrelated `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` fake-timer/temp-dir failure (`reports mailbox budget exhaustion only after deferring an overflow item`) before later packages completed. The failing test passed isolated and the full assistant-runtime suite passed separately.
- `git diff --check`: passed.
Completed: 2026-07-07
