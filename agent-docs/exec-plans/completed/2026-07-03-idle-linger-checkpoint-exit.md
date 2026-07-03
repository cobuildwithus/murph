Goal (incl. success criteria):
- Prevent due assistant wakes from being stranded after a deferred or forced hosted idle checkpoint.
- Preserve the existing architecture: runtime owns checkpoint timing and wake projection, web owns checkpoint CAS/foreground-pending policy, Cloudflare stays a snapshot bridge.
- Success means due deferred wakes run in-process after checkpointing, forced pre-wake checkpoints can complete behind already-imported fresh input, and ordinary idle checkpoints still yield to new foreground input.

Constraints/Assumptions:
- Keep `idle_shutdown` as the only live hosted workspace snapshot producer.
- Do not add a scheduler, queue, lifecycle manager, durable status flag, or new persisted state.
- Foreground replies remain highest priority; the bypass is request-scoped and only for forced pre-wake checkpoints after fresh input is already imported.
- Preserve deploy-skew compatibility across web, Worker, and warm runner containers.

Key decisions:
- Model the foreground-pending exception as optional `continueOnForegroundPending` on the existing checkpoint request.
- Forward the flag through assistant-runtime, hosted-execution parsing, Cloudflare snapshot completion, and web checkpoint storage.
- Document the flag as request-scoped protocol behavior, not a new snapshot reason or persisted state.

State:
- In progress.

Done:
- Added focused regressions for deferred due assistant wakes, forced pre-wake checkpointing, parser validation, web route forwarding, web store behavior, and Cloudflare snapshot bridge propagation.
- Added the hosted-runtime protocol/index note for request-scoped forced pre-wake continuation.

Now:
- Run final verification, review the diff, commit, push, and rerun ReviewGPT for PR 380.

Next:
- Resolve any new CI or ReviewGPT findings.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- PR 380.
- packages/assistant-runtime/src/hosted-runtime.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts
- packages/assistant-runtime/src/hosted-runtime/snapshot-bridge.ts
- packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts
- packages/hosted-execution/src/runtime-control.ts
- packages/hosted-execution/src/parsers/runtime-control.ts
- packages/hosted-execution/test/hosted-runtime-control.test.ts
- apps/web/app/api/internal/hosted-workspace/checkpoint/route.ts
- apps/web/src/lib/hosted-workspace/store.ts
- apps/web/test/hosted-runtime-internal-routes.test.ts
- apps/web/test/hosted-workspace-store.test.ts
- apps/cloudflare/test/runtime-bridge-workspace.test.ts
- agent-docs/references/hosted-runtime-protocol.md
- agent-docs/index.md
Status: completed
Updated: 2026-07-03
Completed: 2026-07-03
