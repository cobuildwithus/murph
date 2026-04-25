# Stop hosted Telegram cleanup from deleting chat messages

Status: completed
Created: 2026-04-25
Updated: 2026-04-26

## Goal

- Stop hosted Telegram conversation cleanup from deleting provider-visible user and assistant messages after a run completes, while preserving the existing Linq privacy cleanup behavior.

## Success criteria

- Telegram hosted runs no longer call the Telegram Bot API `deleteMessages` endpoint after normal successful sends.
- Linq cleanup still deletes inbound and outbound Linq messages when cleanup runs.
- Pending cleanup recovery no longer persists or retries Telegram message deletion work; legacy Telegram-only cleanup state can be cleared safely.
- Focused tests cover the Telegram retention behavior and Linq cleanup retention.

## Scope

- In scope: hosted Cloudflare run cleanup and its directly coupled tests/stub expectations.
- Out of scope: Telegram partial-send rollback inside the send adapter, Linq provider cleanup, email raw-message cleanup, channel typing behavior.

## Constraints

- Technical constraints: preserve run-finalization cleanup recovery for email/Linq; do not weaken secrets or contact-identifier redaction.
- Product/process constraints: preserve unrelated active ledger work and avoid touching broad hosted typing/runtime lanes.

## Risks and mitigations

1. Risk: Removing Telegram cleanup could accidentally disable Linq or email cleanup recovery.
   Mitigation: keep Linq/email cleanup code paths and tests explicit.
2. Risk: Existing persisted cleanup sidecars with Telegram refs could block finalize resume.
   Mitigation: normalize/clear Telegram cleanup refs without calling provider delete.

## Tasks

1. Trace hosted cleanup call path and identify Telegram deletion source.
2. Remove Telegram provider deletion from hosted cleanup and pending cleanup creation.
3. Update focused Cloudflare runner cleanup and Telegram E2E expectations.
4. Run focused tests, typecheck, required audit passes, and finish with a scoped commit if safe.

## Decisions

- 2026-04-25: Keep Telegram send-adapter partial rollback unchanged because it only attempts to clean up bot chunks after a failed multi-part send and does not delete the user's inbound chat message.
- 2026-04-25: Hosted runner cleanup now ignores Telegram wake, cleanup-target, and delivery-outcome message ids. Legacy pending Telegram cleanup refs are cleared locally without calling provider deletion.

## Verification

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-run-processor.test.ts -t "cleanupTransientWakeDataBestEffortForRunDrain"`.
- Passed: `MURPH_DEV_SKIP_RUNNER_BUNDLE=1 pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts -t "sends Telegram typing and a reply after an inbound Telegram message" --no-coverage`.
- Passed: `pnpm --dir apps/cloudflare typecheck`.
- Passed: `git diff --check -- apps/cloudflare/src/user-runner/runner-cleanup.ts apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts`.
- Blocked by unrelated Health Commons content state: root `pnpm typecheck` and `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-cleanup.ts apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/hosted-local-telegram-first-contact-e2e.test.ts`, both during Health Commons generation due a duplicate source identity in untracked collagen content.
- Required security/privacy and task-finish audit passes completed with no findings.
Completed: 2026-04-26
