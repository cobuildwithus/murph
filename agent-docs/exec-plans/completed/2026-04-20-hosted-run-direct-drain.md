## Title

Drain newly accepted hosted runs directly from the Cloudflare worker and close the fresh-user alarm bootstrap gap.

## Goal

Make immediate hosted ingress start draining through the Cloudflare worker request path instead of bouncing through an alarm-only handoff, while ensuring a newly bootstrapped Durable Object cannot accept a nudge and then silently no-op because `runtimeBootstrapped` was never marked.

## Scope

- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- focused `apps/cloudflare` tests that cover the run route, backpressure route contract, email ingress handoff, and fresh-user bootstrap/alarm behavior

## Constraints

- Keep this as a narrow hosted-run hot-path fix only.
- Preserve unrelated dirty-tree edits and overlapping Cloudflare/web lanes.
- Keep alarms for future runtime wakes, retry, and backpressure; do not remove the retry alarm path in this slice.
- Do not reopen the hosted-run architecture or shared hosted-execution naming in this lane.

## Verification

- passed: `git diff --check -- apps/cloudflare/src/index.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/hosted-email/worker-ingress.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/index-backpressure.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-04-20-hosted-run-direct-drain.md`
- passed earlier in turn: `pnpm typecheck`
- passed earlier in turn: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/index.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/hosted-email/worker-ingress.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/index-backpressure.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts`
- passed: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/index.test.ts -t "accepts run requests by starting a direct background drain" --no-coverage`
- passed: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts -t "marks bootstrap state as runtime-ready so later alarms can drain" --no-coverage`
- passed: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/index-backpressure.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts --no-coverage`
- blocked by unrelated pre-existing dirty-tree errors outside this task: rerunning `pnpm typecheck` or `bash scripts/workspace-verify.sh test:diff ...` after the final follow-up fix now fails in `apps/cloudflare/test/helpers/hosted-local-{full-stack-scenario,test-worker-fixture,wake,wake.test}.ts` because those files still reference removed hosted-wake symbols and one deleted worker helper module. Those files are outside this change.

## Notes

- `POST /internal/users/:userId/run` currently schedules an immediate alarm through `nudgeHostedRun()` instead of starting a direct background drain.
- `HostedUserRunner.bootstrapUser()` still persists the user id without marking `runtimeBootstrapped`, while `alarm()` returns early when that flag is false.
- The intended end state is direct drain for newly accepted ingress and alarms reserved for future runtime timers, retry, and backpressure.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
