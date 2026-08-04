# Hosted usage-denial direct-wake recovery

## Goal

Fix the hosted direct-wake race where a managed AI usage denial observed during
fresh invocation preparation is recorded as a transport `runtime_error` even
though Web has already classified the mailbox as product-blocked work.

Success criteria:

- Managed provider egress remains fail-closed when the latest workspace
  projection denies platform AI usage.
- A racing payloadless direct wake releases without recording a runtime
  failure, consuming mailbox work, or calling the assistant provider.
- The focused usage-limit hosted-local scenario and the private hosted
  integration matrix pass on the corrected public head.

## Constraints

- Preserve Web as the usage-policy owner and Cloudflare as the execution
  adapter.
- Keep Temporal signals and workflow state pointer-only.
- Reuse the existing denied-mailbox empty-prefix and write-fenced provider
  egress behavior; do not add another scheduler, queue, response kind, or
  usage-policy projection.
- Keep diagnostics metadata-only and preserve unrelated checkout changes.

## Approach

1. Add focused controller proof that a fresh direct wake with
   `platformAiUsageAllowed: false` runs under a denied fence and completes
   without persisting a transport failure.
2. Replace the early managed-route preparation throw with the existing
   deny-bound write-fence path so the runtime can observe the canonical empty
   mailbox prefix and release cleanly while provider egress stays blocked.
3. Update the preparation-level contract test to assert the denied allowance
   is bound to the active fence.
4. Run focused Cloudflare tests and typecheck, then the hosted usage-limit
   scenario when feasible.
5. Commit, open the public PR, complete required review/CI gates, merge, and
   rerun the private protected-deploy PR integration against corrected public
   main.

## Verification

- Focused invocation/controller unit tests.
- Cloudflare typecheck.
- Hosted-local usage-limit ambiguous-send E2E when the local harness is
  available.
- Preliminary specialist ReviewGPT coverage pass.
- Final ReviewGPT cross-cutting gate and exact-head CI.
- Private hosted integration matrix after the public fix merges.

## State

Implemented and locally verified:

- `pnpm --dir apps/cloudflare typecheck`
- Four focused Cloudflare test files: 348 tests passed.
- `pnpm hosted-local e2e usage-limit-ambiguous-send --no-bundle`: 2 tests
  passed against the local Postgres, Temporal, hosted-web, Worker, and runner
  stack after supplying the existing external worker package.

Public PR review/CI and the private integration rerun remain pending.
Status: completed
Updated: 2026-08-04
Completed: 2026-08-04
