# Runtime-Owned Idle Checkpoint

## Goal

Move idle checkpoint ownership into the foreground hosted runtime invocation.
RunnerContainer activity expiry becomes cleanup-only, while the runtime waits
for an idle window or host deadline under the normal foreground write fence and
returns success only after dirty local state is checkpointed.

Success criteria:

- Hosted runtime accepts a generic host deadline and one idle checkpoint delay
  knob, derives forced checkpoint timing from the deadline plus existing commit
  timeout, and does not add `maxUncheckpointedMs` or a separate checkpoint
  budget policy.
- Foreground runtime receives real workspace read/checkpoint ports and tracks
  dirty state locally; a successful invocation means either no state changed or
  changed state was durably checkpointed.
- Runtime wake signals reset the idle wait before checkpointing; wake signals
  during checkpoint do not abort the checkpoint and rely on durable wake retry
  for follow-up work.
- UserRunner keeps one foreground write fence through idle wait and final
  checkpoint, passes a host deadline to the job, clears the fence only after a
  clean runtime result, and records retry/backoff on checkpoint failure.
- RunnerContainer no longer owns pending checkpoint state or posts
  host-owned idle checkpoint work from activity expiry; expiry only yields to
  active invocations or stops the warm shell best-effort.
- Hosted runtime protocol docs and focused tests describe runtime-owned idle
  checkpointing, no success while dirty, host cleanup-only expiry, and the
  deleted host-owned checkpoint concepts.

## Constraints

- Preserve unrelated dirty test edits in `apps/cloudflare`.
- Do not weaken runtime write-fence validation or callback authority.
- Do not add durable idle-checkpoint scheduler state, pending checkpoint rows,
  checkpoint alarms, a second checkpoint lease, or Cloudflare-specific runtime
  job semantics.
- Keep the architecture minimal: use local in-memory dirty/checkpointing state
  and existing workspace snapshot/checkpoint ports.

## Plan

1. Register this plan in the coordination ledger.
2. Replace foreground checkpoint deferral with runtime-local dirty tracking and
   one final idle/deadline checkpoint under the existing write fence.
3. Pass a generic `deadlineAt` and `idleCheckpointDelayMs` from Cloudflare's
   foreground coordinator into the runtime job.
4. Make RunnerContainer activity expiry cleanup-only and remove host-owned
   pending idle checkpoint behavior.
5. Delete or quarantine obsolete idle-checkpoint lease/invocation plumbing once
   callers and tests no longer need it.
6. Update hosted runtime docs and run focused verification/audits.

## Verification

Completed:

- `pnpm --filter @murphai/hosted-execution typecheck`
- `pnpm --filter @murphai/assistant-runtime typecheck`
- `pnpm --filter @murphai/cloudflare-runner typecheck`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-workspace-entrypoint.test.ts --isolate=true --no-coverage`
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts test/hosted-runtime-control.test.ts test/hosted-execution.test.ts --no-coverage`
- `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/runner-container-runtime-callback.test.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/index-backpressure.test.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/helpers/hosted-local-dev-harness.test.ts --no-coverage`
- `pnpm test:diff -- packages/assistant-runtime packages/hosted-execution apps/cloudflare agent-docs/references/hosted-runtime-protocol.md apps/cloudflare/README.md ARCHITECTURE.md`
- `git diff --check`
Status: completed
Updated: 2026-05-13
Completed: 2026-05-13
