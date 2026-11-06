# Preserve canonical evidence across uncertain publication and operational restore failure

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and ownership

Preserve evidence when canonical publication may have committed, stop the current
invocation, and let cold restore follow Web. Operational receipt replay failures
must discard partial local state without retiring Web's acknowledged log.
Core owns write evidence; the runtime publication owner owns the abort fence;
the engine owns tool admission/results; restore owns replay error classification.

## Scope and decisions

Use one core error and the existing invocation abort path. Delete the obsolete
runtime error and transient-pair classifier. No wire, receipt, database, Web,
package, or reconciliation changes. Preserve deterministic invalid-history
fallback and ordinary pre-submission rollback.

## Proof and progress

- Red proofs observed core deleting the committed journal; ambiguous checkpoint
  responses losing uncertainty; automation catch failing to propagate the fence;
  effects continuing after publication; and partial ENOSPC/EIO/materializer
  replay falling back to base-only state. The pre-submission rollback control
  remained passing.
- Implemented the typed outcome, synchronous abort and marker clearing, engine
  result/admission fence, and cause-chain operational replay classification.
- Added cold restore proof for both possible Web outcomes and exact once replay.
- Added two-response fault injection and an opt-in real automation E2E. A scratch
  canary checks cold replacement; a shell probe checks automation and audit count;
  provider requests check that the fenced call has no output; delivery stays once.

## Verification

All commands use package Vitest with `--no-coverage`, or the package's
`typecheck` script.

- Core: `pnpm --dir packages/core exec vitest run --config vitest.config.ts
  --no-coverage test/write-batch-hosted-runtime-state.test.ts
  test/operations-thresholds.test.ts --maxWorkers=1` — exit 0, 53 tests.
- Engine: `pnpm --dir packages/assistant-engine exec vitest run --config
  vitest.config.ts --no-coverage test/assistant-codex-runtime-tools.test.ts` —
  exit 0, 38 tests. The separate `test/dynamic-tool-interruption.test.ts` adds
  uncaught-outcome coverage — exit 0, 3 tests.
- Runtime: `pnpm --dir packages/assistant-runtime exec vitest run --config
  vitest.config.ts --no-coverage
  test/hosted-runtime-workspace-entrypoint-receipts.test.ts
  test/device-sync-service.test.ts` — exit 0, 31 tests.
- Cloudflare: `pnpm exec vitest run --config
  apps/cloudflare/vitest.node.workspace.ts --no-coverage
  apps/cloudflare/test/runner-platform.test.ts
  apps/cloudflare/test/hosted-local-test-runner-container.test.ts
  --maxWorkers=1` — exit 0, 367 tests. The existing
  `apps/cloudflare/test/hosted-local-e2e-support.test.ts` checks helper compatibility
  — exit 0, 40 tests.
- `pnpm --dir <package> typecheck` for core, assistant-engine,
  assistant-runtime and apps/cloudflare — exit 0. This includes the unrun E2E.
- `pnpm complexity:diff` — exit 0 after replacing redundant cleanup metadata
  persistence with the existing best-effort helper. No increased complexity debt.
- `git diff --check` — exit 0.

Red boundary runs exited 1 before fixes. Intermediate fixture corrections also
exited 1; runtime typecheck first exited 2 for fixture return types, then passed.
Complexity first exited 1, then passed after the deletion described above.

- Hosted-local E2E: `pnpm hosted-local e2e canonical-receipt-lost-ack-recovery`,
  3 tests passed, run against a Temporal worker built from current private main.
  The new test proves the fenced call gets no tool output, the local canary is
  gone after cold restore, the automation exists once and one reply is sent. Its
  positive controls show the output filter matches a real call and the canary
  was written. The local run set the scenario's existing
  `resetLocalDatabase: false` input without committing it: Prisma refuses
  `db push --force-reset` from an agent, and the scenario database is created
  empty, so that reset does nothing there.

Deep review before PR review found two gaps, both fixed with red and green
proof. The integration-ingest archive reader relabelled a real read failure as
invalid data, which took the fallback that retires acknowledged writes; it now
rethrows errors carrying `syscall`, and the restore classifier requires
`syscall` so a zlib decode error, which has `errno`, stays invalid history. A fence
landing during tool admission still dispatched the tool; the check now runs
immediately before dispatch. Parent review also made an explicit `retryable`
disposition win over any cause, so a terminal artifact read stays terminal.

The six adapter assertions changed because a retry cannot prove rejection of the
first request. The device-sync test now uses the core error while keeping the
same code, status and retryability assertions. Existing one-lost-ack,
terminal-read and invalid-history proofs were retained.

Completed: 2026-11-06
