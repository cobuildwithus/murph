# Fail fast on missing entrypoint projection worker builds

Status: completed
Created: 2026-10-09
Updated: 2026-10-09

## Goal

Direct assistant-runtime entrypoint tests must identify a missing compiled
projection worker before reporting delivery timeouts. Preserve the real isolated
worker and all runtime behavior.

## Scope and evidence

Frog #4095 maps to the committed foreground-input report and #4077 maps to the
committed system-mailbox-projection report. Both execute vault-share projection
through a native Worker using the published package entrypoint. Native Worker
resolution does not use Vitest source aliases. The background owner catches
worker failure as a best-effort projection error, so absent builds resemble
runtime regressions. The prepared-build owner already builds this worker.

## Design

Validate the worker artifact in the shared test platform factory only when a
vault-share port is supplied. Keep the prerequisite test-only and use the same
public package resolution as the runtime. Add synthetic missing/present artifact
proof and document the focused-test requirement. No new runtime state, fallback,
source-loader substitution, dependency, or deployment change.

## Tasks

1. Reproduce both reported suites without assistant-runtime dist.
2. Add the smallest test prerequisite and focused regression coverage.
3. Prove missing-build diagnostics, build, and rerun both real suites plus typecheck.
4. Review diff, complexity, and privacy; commit a scoped candidate and open a draft PR.
5. Complete requested ReviewGPT and exact-head CI, then guarded low-risk landing,
   verify closure, and retire the clean worktree.

## Verification

- Fresh base without assistant-runtime dist: foreground suite reproduced all
  five reported failures; the four selected system projection cases also failed.
  The unbounded full unbuilt system run was stopped; the selected rerun used a
  15-second case timeout and completed with exactly four failures.
- Missing-build candidate: the actual public worker resolution produced the
  actionable build assertion for the selected foreground case and all four
  system cases, before any projection-delivery wait. Synthetic missing/present
  artifact cases passed.
- `pnpm --dir packages/assistant-runtime build`: passed.
- Direct Vitest run of worker-build, foreground-input, and system-preemption
  suites with `--no-coverage --testTimeout=30000`: 65 tests passed across 3 files.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed; the guard excludes test-only files and found
  no authored production JavaScript/TypeScript changes. The added preflight has
  no branch or new runtime owner.
- `pnpm docs:drift`: passed. `git diff --check`: passed.

The parent reviewed the full candidate and confirmed the shared harness uses the
same native public-entrypoint resolution as the runtime. The existing Frog
reports are reused without changing reconciliation-owned bindings. The change
is developer-test-only and has no Product UX, provider-input, hot-path, or
deployment impact. Requested ReviewGPT, exact-head CI and guarded landing remain
PR completion gates; their final receipts belong to the PR.
Completed: 2026-10-09
