# Retell System Mailbox Wake

## Goal

Ensure imported hosted system-mailbox notifications, including Retell phone-call results, always schedule an assistant wake when mailbox import progress is checkpointed before the assistant phase can drain the item.

## Constraints

- Keep the fix in the hosted runtime owner boundary.
- Do not hard-code Retell or phone-call behavior into the generic runtime path.
- Preserve foreground conversation priority and existing mailbox budget behavior.

## Plan

1. Add system-mailbox wake preservation to import-only/deferred mailbox checkpoint paths.
2. Add an entrypoint regression covering a system-lane item imported before assistant phase execution.
3. Run focused hosted-runtime tests and typecheck.

## Verification

- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-workspace-entrypoint.test.ts -t "schedules a system-mailbox wake"`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
