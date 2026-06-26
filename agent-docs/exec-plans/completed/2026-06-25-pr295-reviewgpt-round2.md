# PR 295 ReviewGPT Round 2

## Goal

Resolve accepted ReviewGPT round-2 findings on PR 295:

- Do not expose `murph.create_phone_call` during hosted automation turns.
- Remove the production `resultHandler` callback branch from Retell result
  handling so `call_analyzed` uses one terminal update/notification path.

## Constraints

- Preserve user-approved/manual-only outbound phone-call authority.
- Keep result handling to one `HostedPhoneCall` row plus the existing mailbox
  notification dedupe path.
- Do not add new durable state, approval tables, queues, or reconciliation loops.

## Key Decisions

- Treat only manual/member turn triggers as phone-call authority.
- Keep the Retell result handler transaction-local by giving the narrow
  transaction adapter one `appendResultNotification` method instead of a public
  test hook.

## Plan

1. Gate phone-call accepted inputs by manual turn trigger before source checks.
2. Collapse the Retell result callback branch into the transaction adapter.
3. Add focused regressions and rerun affected tests/typechecks.
4. Commit, push, and rerun ReviewGPT.

## Verification

- Passed: `pnpm --dir packages/assistant-engine exec vitest run test/assistant-phone-calls.test.ts`
- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-retell-routes.test.ts --no-coverage`
- Passed: `pnpm --filter @murphai/hosted-web typecheck`
- Passed: `pnpm --filter @murphai/assistant-engine typecheck`
- Passed: `git diff --check`
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
