# Foreground Mailbox Budget

## Goal

Prevent hosted active-turn follow-up messages from being starved when the initial
mailbox catch-up pass exhausts its import budget.

## Success Criteria

- Foreground runtime wakes can import same-conversation mailbox items after the
  initial catch-up budget is exhausted.
- The normal catch-up budget remains bounded and still reports exhaustion.
- Regression coverage uses synthetic mailbox items only.
- No real member identifiers, message text, secrets, or raw payloads are logged
  or fixtureed.

## Scope

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`

## Out Of Scope

- Changing production model selection.
- Cloudflare deploy/config changes.
- Broad mailbox scheduling refactors.
- The separate container destroy/500 retry loop.

## Plan

1. Add a bounded foreground mailbox import reserve for runtime-wake imports.
2. Route active-turn imports through that foreground reserve.
3. Add a focused regression for catch-up exhaustion plus a same-turn follow-up.
4. Run focused package verification and report any unrelated dirty-tree blockers.

## Verification

- `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts -t "foreground runtime wake imports conversation input after initial mailbox budget exhaustion"` passed.
- `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` passed.
- `pnpm exec tsc --noEmit --pretty false --project packages/assistant-runtime/tsconfig.json` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` passed.
- `git diff --check -- packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts agent-docs/exec-plans/active/2026-05-13-foreground-mailbox-budget.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `security-privacy-review` completed with no findings.
- `coverage-write` added checkpoint/durable-state assertions and completed with no remaining coverage gaps.
- `task-finish-review` completed with no findings; a small foreground fetch-cap assertion was added afterward and the focused checks above were rerun.
Status: completed
Updated: 2026-05-13
Completed: 2026-05-13
