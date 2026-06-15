Goal (incl. success criteria):
- Get the hosted-local `telegram-scheduled-reminder` E2E to run locally through the full stack.
- Success means the local MinIO startup blocker is root-caused and fixed or worked around in the harness, and the scenario reaches the Telegram scheduled-reminder path with useful pass/fail evidence.

Constraints/Assumptions:
- Preserve hosted ownership: Temporal wakes, Cloudflare executes, runtime owns scheduled automation and `nextWakeAt`.
- Keep diagnostics metadata-only; use synthetic local credentials and ids only.
- Preserve unrelated working-tree artifacts and active hosted-runtime lanes.

Key decisions:
- Debug the local MinIO sidecar first because prior full-stack attempts failed before the test body.
- MinIO did not reproduce on rerun; keep the fix scoped to the first full-stack failure actually observed.
- Treat the Telegram E2E's one-minute reminder lead as too fragile for cold hosted assistant/tool-call startup.
- Treat earlier runtime-maintenance wakes as valid arming for the scheduled reminder as long as they are future wakes not later than the automation due time; the final delivery assertion still proves the due reminder path.

State:
- Complete locally; the full Telegram scheduled-reminder E2E passed through the real web webhook, Temporal, Cloudflare runner, and Telegram mock path, and a focused fake-clock cron regression now covers the June 13 Warsaw 32-minute-overdue thread-only route shape.

Done:
- Refreshed hosted-runtime, security, reliability, verification, and coordination docs.
- Confirmed checkout is clean except unrelated untracked image artifacts.
- Re-ran `telegram-scheduled-reminder`; MinIO started and the full stack reached the hosted Telegram scenario.
- The first clean scenario run failed before final delivery because `workspace.nextWakeAt` never matched the expected fixed `automation save --schedule-at` timestamp; captured status showed a later assistant wake instead.
- After increasing runway, the scenario checkpointed setup successfully and armed a future assistant wake earlier than the one-shot automation timestamp, so exact equality was the wrong local E2E guard.
- Root-caused the local MinIO startup flake: the Docker CLI child can exit after starting a healthy MinIO container, so the stack must not treat that child exit as a sidecar failure after readiness passes.
- Switched the Telegram setup from direct mailbox/wake injection to the real web Telegram webhook path with seeded Telegram routing.
- Tightened the final Telegram send waiter to require the scheduled reminder text and no `reply_to_message_id`; a path-only "any new send" assertion can pick up late setup replies.
- Added post-send hosted completion proof and exact-one scheduled-send settling to the Telegram E2E.
- Added `processDueAssistantCronJobsLocal` coverage for `2026-06-13T22:15:00+02:00` due at `2026-06-13T20:47:00.000Z` with Telegram `threadId` only, `deliveryTarget: null`, `participantId: null`, and `continuityPolicy: fresh`. The test uses synthetic route ids instead of the real debug packet ids.
- Hardened MinIO startup-failure cleanup after readiness so the detached Docker CLI child is explicitly terminated before best-effort container cleanup.
- `pnpm hosted-local e2e telegram-scheduled-reminder --no-bundle` passed on the full local stack.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-cron-runtime.test.ts --no-coverage` passed.
- `pnpm --dir packages/hosted-local-harness exec vitest run --config vitest.config.ts test/dev-hosted-local/stack.test.ts --no-coverage` passed.
- Typechecks passed for `packages/assistant-engine`, `packages/hosted-local-harness`, and `apps/cloudflare`.
- `git diff --check` passed for the scoped diff.
- `apps/web typecheck:prepared` passed.
- `bash scripts/workspace-verify.sh test:diff ...` failed in `packages/cli/test/vault-cli-import-surface-contract.test.ts` because the vault-less probe `wearables day 2026-01-01 --format json` exited zero; there is no diff under `packages/cli`, `packages/query`, or `packages/importers` in this task.

Now:
- Run final scoped verification/audit and commit the hosted-local E2E changes without including unrelated dirty files.

Next:
- Close/archive this plan with the scoped commit.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether the original June 13 production miss was due to production scheduler/executor logs versus an external Telegram delivery failure; local due-selection and thread-only delivery behavior now pass for the exact 32-minute-overdue shape.

Working set (files/ids/commands):
- `packages/hosted-local-harness/src/dev-hosted-local/minio.ts`
- `packages/hosted-local-harness/test/dev-hosted-local/minio.test.ts`
- `packages/hosted-local-harness/src/dev-hosted-local/stack.ts`
- `packages/hosted-local-harness/test/dev-hosted-local/stack.test.ts`
- `packages/assistant-engine/test/assistant-cron-runtime.test.ts`
- `apps/cloudflare/test/hosted-local-telegram-scheduled-reminder-e2e.test.ts`
- `apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.ts`
- `apps/web/test/support/hosted-member-seeds.ts`
- `apps/web/test/support/hosted-web-testkit.ts`
- `pnpm hosted-local e2e telegram-scheduled-reminder --no-bundle`
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
