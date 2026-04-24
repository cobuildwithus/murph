# Fix hosted assistant-runtime retry, idempotency, cursor, acknowledgement, and env concurrency issues

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Fix the hosted assistant-runtime findings around finalize-resume metadata preservation, hosted email idempotency/threading, turn-input high-water cursor handling, export acknowledgement dedupe, in-process env concurrency, and the reported simplification seams.

## Success criteria

- Finalize-resume uses the original committed runner result metadata rather than synthesizing metrics.
- Hosted email send requests preserve delivery idempotency and parent-message threading fields through the effects port.
- Hosted turn-input refresh advances `afterSeq` as a high-water mark over all returned events while keeping ingress-id dedupe separate.
- Usage and issue export acknowledgements cannot overcount duplicate ids.
- In-process hosted jobs cannot overlap process-global hosted env mutation.
- Child-process launcher policy lives in the Cloudflare app while shared runtime env sanitization remains in `@murphai/assistant-runtime`.
- Hosted auto-reply desired channel topology flows through resolved runtime config instead of a fixed runtime-local channel list.
- The unused hosted-runtime string normalizer is gone.
- Focused assistant-runtime tests, package typecheck/coverage, root typecheck, and required completion audits are recorded.

## Scope

- In scope: `packages/assistant-runtime`, the directly coupled hosted-execution run-drain request contract, and the Cloudflare runner handoff/launcher policy needed to carry the original committed result and keep child process topology app-owned.
- Out of scope: deployment rewrites and channel product behavior changes beyond the normalized runtime configuration seam needed for the reported findings.

## Constraints

- Technical constraints: preserve hosted-run protocol ownership; do not introduce ambient process env dependence beyond the existing legacy wrapper; keep sibling package imports on public entrypoints.
- Product/process constraints: preserve unrelated dirty work, coordinate with active hosted-runtime rows, run the required audit passes before handoff, and create a scoped commit only if safe.

## Risks and mitigations

1. Risk: The touched files overlap active hosted-runtime lanes.
   Mitigation: keep the diff narrow, read current clean state before editing, and avoid unrelated hosted-run/device-sync/Linq behavior.
2. Risk: Env serialization can accidentally hide errors or leave global env changed.
   Mitigation: add direct concurrency/restoration coverage around the process env wrapper.

## Tasks

1. Inspect current hosted-runtime execution, callback, turn-input, export, env, and context seams.
2. Implement runtime fixes, app-owned launcher extraction, normalized managed-channel config, and focused regression tests.
3. Run focused assistant-runtime/hosted-execution/Cloudflare verification and root typecheck.
4. Run required `coverage-write` and `task-finish-review` audit passes.
5. Finish or close the execution plan and commit if scoped staging is safe.

## Decisions

- Treat the in-process env mutation API as legacy and serialize callers instead of redesigning the runtime context in this patch.
- Carry the prepared committed result through the existing Cloudflare pending-cleanup sidecar and `runDrain.committedResult`; this is the smallest durable handoff that preserves finalize metadata without moving the full hosted-run protocol.
- Move the child process launcher directory/env/tsx policy into `apps/cloudflare/src/runner-child-launcher.ts`; keep the shared forwarded-env sanitizer exported from assistant-runtime.
- Keep hosted bootstrap result fields compatible while resolving desired managed auto-reply channels from app-provided `managedAutoReplyChannels`.
- Track runtime-ingested adopted turn-input event results through the runner result and merge only those reported event results into the Cloudflare commit; do not infer completion from refreshed run membership alone.

## Verification

- Green commands: `git diff --check`, `pnpm --filter @murphai/hosted-execution test`, `pnpm --filter @murphai/assistant-runtime test`, `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/runner-child-launcher.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts apps/cloudflare/test/runner-env.test.ts`, `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts apps/cloudflare/test/runner-platform.test.ts`, `pnpm --filter @murphai/hosted-execution typecheck`, `pnpm --filter @murphai/assistant-runtime typecheck`, `pnpm --filter @murphai/cloudflare-runner typecheck`, and `pnpm typecheck`.
- Required audit status: `coverage-write` completed with no edits; first `task-finish-review` found the adopted turn-input commit gap; a second review found the app-layer email transport and adopted cleanup-target gaps; both were fixed. Final `task-finish-review` rerun reported no blockers.
- Commit status: no scoped commit created because this dirty checkout has overlapping pre-existing edits in the same Cloudflare/assistant-runtime files and shared ledger state; closing the plan without staging avoids absorbing unrelated work.
Completed: 2026-04-24
