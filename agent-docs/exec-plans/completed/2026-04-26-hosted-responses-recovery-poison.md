# Hosted Responses Recovery Poison

## Goal

Stop stale hosted assistant auto-reply receipts with terminal Responses request-shape failures from being retried on every hosted run.

Success criteria:

- Terminal provider validation failures are not selected by startup auto-reply recovery.
- Retry-safe failed receipts still recover normally.
- Focused assistant-engine coverage proves the skip behavior.

## Scope

- `packages/assistant-engine/src/assistant/automation/startup-recovery.ts`
- `packages/assistant-engine/test/assistant-automation-runtime.test.ts`

## Constraints

- Do not log raw provider payloads, contact identifiers, local paths, or secrets.
- Keep the classifier narrow to request-shape failures that retrying the same persisted receipt cannot repair.
- Preserve existing delayed retry behavior for transient provider failures.

## Progress

- Live DB and Cloudflare logs show the hosted runtime is completing runs, while old failed auto-reply receipts are retried repeatedly with `input.N.output` provider validation failures.
- Fresh replies are succeeding but slow; current runs spend about a minute-plus inside the hosted runner/model path before finalization.

## Verification

- Passed `pnpm --dir packages/assistant-engine test -- assistant-automation-runtime.test.ts -t "assistant auto-reply receipt recovery"`.
- Passed `pnpm --dir packages/assistant-engine typecheck`.
- Passed `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/automation/startup-recovery.ts packages/assistant-engine/test/assistant-automation-runtime.test.ts agent-docs/exec-plans/active/2026-04-26-hosted-responses-recovery-poison.md`.
- Passed `git diff --check -- packages/assistant-engine/src/assistant/automation/startup-recovery.ts packages/assistant-engine/test/assistant-automation-runtime.test.ts agent-docs/exec-plans/active/2026-04-26-hosted-responses-recovery-poison.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
