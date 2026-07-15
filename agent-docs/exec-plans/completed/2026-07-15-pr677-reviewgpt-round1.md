# PR 677 ReviewGPT Round 1 Remediation

## Goal

Resolve the accepted ReviewGPT finding that failed multi-action canonical receipt
replay could expose and checkpoint a partial mutation while losing its durable
retry reference.

## Constraints

- Preserve the foreground reply authority invariant in
  `docs/contracts/00-invariants.md`.
- Preserve fail-stop receipt replay: never checkpoint a partially applied receipt.
- Keep the original receipt log durable as inert repair metadata without
  allowing it to retain foreground write authority.
- Reuse the authoritative workspace snapshot as the rollback boundary; add no new
  persisted state, queue, recovery service, or compatibility layer.
- Rethrow cancellation exactly and keep diagnostics secret-safe and non-blocking.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/canonical-write-receipt-log.ts`
- `packages/hosted-execution/src/runtime-control.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `agent-docs/references/hosted-runtime-protocol.md`
- focused supporting tests only if required by the correction

## Verification Plan

- Focused receipt replay and foreground-authority regressions, including partial
  multi-action rollback, repair-log retention, unreadable-log isolation, clean
  replay, and cancellation.
- Assistant-runtime and core coverage suites and affected package typechecks.
- Required coverage-write completion audit.
- `pnpm test:diff`.
- ReviewGPT round 2 on the exact pushed remediation head, started alongside CI.

## Outcome

- Failed replay now discards the mutated local tree and reloads the authoritative
  snapshot before foreground admission.
- The failed active receipt log becomes inert repair metadata; fresh foreground
  canonical writes use an independent active log.
- Partial multi-action, unreadable-log, cancellation, and foreground-write
  regressions pass, including durable repair-reference retention.
- Assistant-runtime, core, and hosted-execution coverage pass. The exact final
  diff passes `pnpm test:diff` after preparing its required workspace build
  artifacts. The required coverage-write audit found no unresolved gap.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
