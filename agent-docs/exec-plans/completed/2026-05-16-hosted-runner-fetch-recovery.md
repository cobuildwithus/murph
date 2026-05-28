# Hosted Runner Fetch Recovery

## Goal

Stop hosted runner attempts from failing an entire invocation on a single transient, replay-safe artifact read failure, and move high-cardinality hosted device-sync dirty freshness/recovery onto dirty state plus the existing `device_sync_recovery` runtime-control demand instead of `device-sync.wake` mailbox pointers.

## Scope

- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/test/runner-platform.test.ts`
- `apps/web/src/lib/device-sync/dirty-sweeper.ts`
- `apps/web/src/lib/device-sync/due-reconcile-sweeper.ts`
- `apps/web/src/lib/device-sync/recovery-sweeper.ts`
- `apps/web/src/lib/device-sync/wake-service.ts`
- `apps/web/src/lib/hosted-orchestration/signal-runtime.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-workflow-steps.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-workflow-types.ts`
- `apps/web/test/hosted-device-sync-dirty-sweeper.test.ts`
- `apps/web/test/hosted-device-sync-due-reconcile-sweeper.test.ts`
- `apps/web/test/hosted-device-sync-recovery-sweeper.test.ts`
- `apps/web/test/device-sync-dirty-wake-event-id.test.ts`
- `apps/web/test/hosted-onboarding-webhook-workflows.test.ts`
- focused tests for the changed behavior

## Constraints

- Metadata-only logging; no payloads, prompts, transcripts, raw user ids, account ids, or local paths.
- Retry only replay-safe reads. Do not retry writes or auth/authority failures.
- Keep the fix small and composable; no new queue/table/scheduler plane.
- Keep explicit lifecycle `device-sync.wake` compatibility for connect/disconnect/deployed mailbox drain.
- Preserve unrelated dirty worktree edits.

## Current Evidence

- Production failures are classified as control-plane artifact/workspace read failures with fetch cause `fetch_failed`, followed by container cleanup and outer retry.
- The affected large workspace has many external artifacts, which amplifies the chance that one transient artifact fetch aborts restore.
- The original phone-backed member has a large system-lane `device-sync.wake` backlog and no current conversation-lane messages; latest texts are routed to a separate iCloud/email-backed member.
- Dirty state already carries pending work when `dirty_revision > processed_revision` or dirty payload rows remain.
- `runtime.device-sync-recovery-requested` already provides durable web-owned background demand, and Temporal/Cloudflare/runtime already preserve `source: "device_sync_recovery"` into the assistant phase.
- Dirty freshness/recovery does not need a separate `device-sync.wake` mailbox pointer once it can create the existing runtime-control recovery demand.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-platform.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-webhook-workflows.test.ts apps/web/test/device-sync-dirty-wake-event-id.test.ts apps/web/test/hosted-device-sync-dirty-sweeper.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-hosted-wake.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/hosted-device-sync-dirty-sweeper.test.ts apps/web/test/hosted-device-sync-due-reconcile-sweeper.test.ts apps/web/test/hosted-device-sync-recovery-sweeper.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-dirty-wake-event-id.test.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/hosted-device-sync-dirty-sweeper.test.ts apps/web/test/hosted-device-sync-due-reconcile-sweeper.test.ts apps/web/test/hosted-device-sync-recovery-sweeper.test.ts apps/web/test/hosted-orchestration-signal-runtime.test.ts apps/web/test/hosted-orchestration-demand.test.ts`
- `pnpm --dir apps/web exec eslint src/lib/device-sync/wake-service.ts src/lib/device-sync/dirty-sweeper.ts src/lib/device-sync/due-reconcile-sweeper.ts src/lib/device-sync/recovery-sweeper.ts test/device-sync-hosted-wake.test.ts test/hosted-device-sync-dirty-sweeper.test.ts test/hosted-device-sync-due-reconcile-sweeper.test.ts test/hosted-device-sync-recovery-sweeper.test.ts`
- `pnpm --filter @murphai/cloudflare-runner typecheck`
- `pnpm --filter @murphai/hosted-web typecheck:prepared` currently blocked by unrelated dirty `apps/web/test/hosted-crypto-domain-root-store.test.ts` missing `markEnvelopeActive` / `markEnvelopeInactive` on test transaction helpers.
- `git diff --check -- <changed-files>`
- `bash scripts/workspace-verify.sh test:diff <changed-files>` passed for apps/cloudflare and apps/web.
