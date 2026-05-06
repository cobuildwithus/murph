# Idle checkpoint result marker

## Goal

Make hosted idle-shutdown cleanup depend on an explicit runtime result marker proving the idle-shutdown checkpoint committed, rather than inferring success from the invocation reason.

## Success criteria

- The hosted workspace invocation result contract can carry `idleShutdownCheckpointed: true`.
- The assistant runtime sets the marker only after an idle-shutdown workspace checkpoint successfully commits.
- The Cloudflare runner destroys the warm container only when the marker is present.
- Scheduled/no-op idle-shutdown results preserve runner alarms and do not run cleanup.
- Focused tests cover committed, scheduled, and no-workspace idle-shutdown results.

## Scope

- `packages/hosted-execution/src/runtime-control.ts`
- `packages/hosted-execution/src/parsers/runtime-control.ts`
- `packages/hosted-execution/test/hosted-runtime-control.test.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`

## Constraints

- Preserve unrelated dirty worktree edits, including active liveness-race and checkpoint-reason-split changes.
- Do not broaden into a generic result-effects framework.
- Do not use workspace version as the checkpoint marker.
- Do not expose secrets, user identifiers, local usernames, or home paths in committed text.

## Plan

1. Register this active plan in the coordination ledger.
2. Add optional result marker parsing and type support.
3. Set the marker only in the committed idle-shutdown checkpoint runtime path.
4. Gate Cloudflare idle-shutdown cleanup on the marker and preserve scheduling otherwise.
5. Add focused tests for runtime and runner behavior.
6. Run scoped verification, required audits, and diff/privacy checks.
7. Close the plan with a scoped commit if unrelated overlap allows it.

## Verification

- PASS: `pnpm --dir packages/hosted-execution exec vitest run test/hosted-runtime-control.test.ts --no-coverage`
- PASS: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint.test.ts --no-coverage -t "idle-shutdown"`
- PASS: `pnpm --dir apps/cloudflare test:node apps/cloudflare/test/user-runner-alarm.test.ts`
- PASS: `pnpm --dir packages/hosted-execution typecheck`
- PASS: `pnpm --dir packages/assistant-runtime typecheck`
- PASS: initial `pnpm --dir apps/cloudflare typecheck`; later rerun was blocked by unrelated dirty `packages/operator-config/src/hosted-assistant-config.ts` type error from active provider setup work.
- PASS: `git diff --check -- packages/hosted-execution/src/runtime-control.ts packages/hosted-execution/src/parsers/runtime-control.ts packages/hosted-execution/test/hosted-runtime-control.test.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/completed/2026-05-06-idle-checkpoint-result-marker.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- BLOCKED/UNRELATED: `pnpm test:diff packages/hosted-execution/src/runtime-control.ts packages/hosted-execution/src/parsers/runtime-control.ts packages/hosted-execution/test/hosted-runtime-control.test.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts` passed dependency policy, boundary checks, stale-name guard, log guard, affected typechecks through hosted-execution, and affected tests through assistant-runtime, then failed in unrelated active setup/provider work: `packages/cli/test/setup-cli.test.ts` expected no `modelProvider` field while current dirty setup code returns `modelProvider: null`.
- BLOCKED/UNRELATED: `pnpm --dir apps/cloudflare verify` passed app typecheck and most tests but failed on unrelated `apps/cloudflare/test/container-entrypoint.test.ts` cases. Each reported failing container-entrypoint test passed when rerun in isolation.
- AUDIT: `security-privacy-review` found malformed marker cleanup risk; fixed by parser invariant plus runner defensive gate and regression coverage.
- AUDIT: `coverage-write` added one minimal shared-contract assertion and reported unrelated root typecheck failure in active setup-cli work.
- AUDIT: `task-finish-review` found no correctness issues; noted this plan verification section needed updating and full lanes remain blocked by unrelated failures.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
