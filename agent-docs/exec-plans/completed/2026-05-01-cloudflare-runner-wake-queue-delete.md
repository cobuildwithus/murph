# Cloudflare Runner Wake Queue Delete

## Goal

Remove the unused Cloudflare runner wake Queue path so hosted execution has one runner trigger surface: direct Durable Object nudge plus Durable Object alarm recovery.

## Scope

- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/runner-wake-queue.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- `apps/cloudflare/wrangler.jsonc`
- `apps/cloudflare/scripts/deploy-automation/**`
- Direct Cloudflare tests and docs that only describe the runner wake Queue.

## Constraints

- Preserve the direct `nudgeHostedRunner()` path and DO alarm recovery.
- Do not touch hosted web producers or assistant-runtime execution behavior.
- Keep Cloudflare as execution coordination only, not a second product queue owner.
- Preserve unrelated concurrent work in the shared checkout.

## State

- Implemented: deleted the runner wake Queue module, Worker queue handler, Queue binding/config/deploy workflow env, generated Wrangler Queue config, Queue contract types, Queue docs, and Queue-specific tests.
- Legal subprocessor source and generated PDFs were updated in the working tree to drop Cloudflare Queues, but they overlap unrelated active Vercel Workflow disclosure edits and should not be included in the scoped Queue-deletion commit.
- Direct Durable Object nudge plus Durable Object alarm recovery remain the only runner wake path.
- Security/privacy review raised an existing-deploy decommission concern. The task is greenfield, so there is no deployed Queue holding real user wake messages and no migration/decommission step is needed.

## Verification Plan

- Residue scan for `RUNNER_WAKE_QUEUE`, `runner-wake-queue`, and queue handler references.
- Run focused Cloudflare deploy automation/index tests where updated.
- Run `pnpm --dir apps/cloudflare typecheck` if feasible.

## Verification Results

- Passed: `pnpm --dir apps/web legal:pdf`
- Passed: residue scans for runner wake Queue names across Cloudflare, deploy workflow, architecture docs, operations docs, and legal/subprocessor surfaces.
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/index-backpressure.test.ts apps/cloudflare/test/hosted-email-worker-ingress.test.ts apps/cloudflare/test/container-image-contract.test.ts`
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/legal-html-pages.test.ts`
- Passed: `pnpm --dir apps/web typecheck`
- Passed: `git diff --check` on the touched paths.
- Blocked unrelated: `pnpm --dir apps/cloudflare typecheck` fails in active assistant-engine input/capture rename work under `packages/assistant-engine/src/assistant/automation/reply.ts` and `packages/assistant-engine/src/assistant/automation/startup-recovery.ts`.
- Coverage-write audit: no additional tests needed.
- Final review: only existing-deploy cleanup note; closed by greenfield scope.
- Security/privacy review: only existing-deploy retained Queue data concern; closed by greenfield scope.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
