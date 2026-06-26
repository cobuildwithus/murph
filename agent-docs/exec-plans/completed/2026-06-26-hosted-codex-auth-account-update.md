# Hosted Codex Auth Account Update

## Goal

Fix hosted Codex ChatGPT connect so Murph waits for Codex app-server's durable account update signal before declaring the managed account connected.

Success criteria:

- A successful device-code login no longer fails when `account/read` is stale immediately after `account/login/completed`.
- Failed or cancelled login attempts still fail closed.
- The fix stays inside the existing Codex app-server protocol wrapper with no feature flags or alternate auth path.

## Constraints

- Do not edit the sibling Codex checkout.
- Keep the fix simple and protocol-aligned: `account/updated` is the readiness signal after device-code login.
- Preserve existing warm app-server isolation for managed account operations.
- Avoid logging or exposing auth tokens, device codes beyond the existing UI callback, local usernames, or home paths.

## Plan

1. Extend `executeCodexManagedAccountOperation` to observe `account/updated` with `authMode: "chatgpt"` after successful `account/login/completed`.
2. Buffer account-update notifications that arrive before the login completion await resumes.
3. Keep the existing final `account/read` verification after the account update signal.
4. Add a focused assistant-engine regression test for the stale-read race while preserving the existing failed-login path.
5. Run targeted assistant-engine verification and required repo checks.

## Verification

- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine test -- assistant-codex-runtime.test.ts -t "waits for the Codex account update"` passed.
- `pnpm test:diff packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts agent-docs/exec-plans/active/2026-06-26-hosted-codex-auth-account-update.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` ran the routed checks and failed in unrelated `packages/cli/test/release-script-coverage-audit.test.ts` on an existing review-gpt prompt assertion outside this task's changed files.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
