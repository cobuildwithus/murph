## Title

Expose hosted-local Linq typing traffic in the test harness, stabilize the local wake waiters, and prevent same-event cleanup races from replaying Linq side effects.

## Goal

Make the hosted-local Linq harness observe `/typing` start/stop traffic so the investigation can reproduce and assert the visible typing pulse pattern around one inbound Linq message, then fix the local hosted-runner race that let same-event cleanup steal the active lease and replay Linq typing/message side effects.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/test/helpers/{hosted-local-dev-harness,hosted-local-full-stack-scenario,hosted-local-linq-support}.ts`
- focused hosted-local Linq E2E coverage under `apps/cloudflare/test/hosted-local-linq-*.test.ts`

## Constraints

- Preserve existing Linq send/create-chat assertions and behavior.
- Mirror the Telegram harness shape only as far as needed for Linq typing visibility.
- Keep the runtime fix narrow to same-event pending-commit cleanup ownership; do not broaden hosted wake scheduling behavior without proof.

## Verification

- `env MURPH_DEV_SKIP_RUNNER_BUNDLE=1 pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts -t "routes a signed Linq webhook through apps/web and delivers the follow-up reply" --no-coverage`
- `env MURPH_DEV_SKIP_RUNNER_BUNDLE=1 pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts --no-coverage`
- `pnpm typecheck`

## Notes

- The original harness issue was real: `waitForAdditionalSend()` returned the latest matching send instead of the first new send beyond the baseline, so overshoot made the test window nondeterministic.
- The production-like race was also real in local hosted execution: status/alarm-driven pending-commit cleanup could run while the same event still owned the active lease, which let a later `assistant.cron.tick` path replay Linq typing and message sends before the obsolete-run warning surfaced.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
