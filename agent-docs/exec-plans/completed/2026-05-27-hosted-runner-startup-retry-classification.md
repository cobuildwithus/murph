# Hosted Runner Startup Handoff Hardening

## Goal

Make `runtime_processing_accepted` cover the real pre-handoff boundary for a
fresh hosted runner start. Workspace reads, workspace-version binding,
runtime config/secrets construction, and job construction should finish before
Temporal receives `runtime_processing_accepted`; failures in that path should
clear the fresh write fence and return `retry_later`.

Also keep startup-confirmation retry reasons classified by actual failure shape
so timeouts keep the short retry cadence while missing/unsupported container
RPC surfaces use the generic RPC-error cadence.

Success criteria:

- Fresh starts do not return `runtime_processing_accepted` until workspace
  state is read, the write fence is bound to the workspace version, runtime
  config/secrets are built, the job is constructed, and container readiness is
  confirmed.
- Workspace read, workspace ownership validation, runtime config/secrets, or job
  construction failures clear the fresh write fence and return `retry_later`.
- Timeout or abort-timeout startup confirmation failures return
  `container_rpc_timeout`.
- Missing `ensureReadyForProcessing`, unsupported operation, and other
  non-timeout RPC failures return `container_rpc_error`.
- Missing container binding continues to return `missing_container_binding`.
- Focused tests prove the retry delays and log classification.

## Constraints

- Preserve unrelated hosted-runner active work.
- Preserve write-fence clearing semantics: failed fresh starts clear only the
  owned fresh fence; completed background runtime execution still clears on
  completion.
- Do not add new persisted state, logging payloads, or Cloudflare API surfaces.
- Keep runtime completion asynchronous; do not wait for Murph runtime or Codex
  completion before returning accepted.
- Cloudflare Durable Object RPC methods must be invoked directly on the stub.
  Detaching a method and using `.call` can make the runtime try to serialize the
  Durable Object stub itself before the container method runs.

## Plan

1. Add a prepared runtime invocation helper.
2. Move workspace read, workspace-version bind, runtime config/secrets, and job
   construction before accepted fresh starts.
3. Wire pre-handoff failures and missing-method/caught readiness failures
   through retry classification.
4. Add focused `apps/cloudflare` regressions for pre-handoff failures, accepted
   timing, timeout, missing method, and unsupported/non-timeout RPC failures.
5. Run focused Cloudflare verification, required audits, and scoped commit if no
   overlapping dirty work blocks it.

## Verification

- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/user-runner-source-shape.test.ts --no-coverage`
  with 27 tests.
- Passed: `pnpm --dir apps/cloudflare typecheck`
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts --no-coverage --cache=false`
  with 14 tests.
- Passed: `pnpm test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/user-runner-source-shape.test.ts`
  including the Cloudflare verifier and repo guards.
- Passed: local hosted runtime proof reached container readiness, confirmed
  readiness, and accepted runtime processing after the direct Durable Object RPC
  invocation fix.
- Pending: required completion audits.
Status: completed
Updated: 2026-05-27
Completed: 2026-05-27
