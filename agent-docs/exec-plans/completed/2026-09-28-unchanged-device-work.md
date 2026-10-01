# Skip empty Junction summary continuation imports

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Outcome and invariant

Remove canonical import work for Junction continuation passes that fetched no summary collection. Preserve provider observation evidence, source authority, canonical empty-day corrections, retries, foreground yield, and reconciliation cadence.

## Owner and causal evidence

`packages/device-syncd/src/providers/junction.ts` owns the summary fetch and continuation. A completed summary phase creates `summaries: {}` yet invokes the importer. The existing bounded scenario performs four imports for three fetched summary units. The Junction normalizer gives the fourth snapshot no health outputs or authoritative sets, but importer preparation still adds a receipt. Junction raw sanitization removes the empty snapshot, so there is no evidence artifact. A real canonical import confirms this synthetic snapshot can report applied progress.

## Smallest correction

For reconcile jobs, require a resource key at the existing canonical summary call; backfill keeps its existing fetched-record predicate. Explicit fetched `resource: []` collections still follow the existing importer path. No persisted state, cache, helper, scheduling policy, public contract, or new owner is needed. Existing import, checkpoint, retry, and source fences remain authoritative. Older and newer runners can consume the same continuation payloads.

## Scope

- Change the summary-only import boundary and focused regression expectations.
- Prove no-output normalization, fetched-empty imports, unchanged preflight proof, and complete-day correction behavior.
- Document the owner behavior and measured call-count result.
- Do not change complete-source-day imports or webhook/cadence scheduling.

## Verification

- Passed: `pnpm --dir packages/device-syncd test test/junction-provider-backfill.test.ts test/junction-timeseries-source-reuse.test.ts test/junction-reconcile-preflight.test.ts test/junction-empty-reconcile-reads.test.ts test/junction-provider-history.test.ts` (172 tests).
- Passed: `pnpm --dir packages/device-syncd typecheck`.
- Passed: `git diff --check`.
- Passed: `pnpm complexity:diff`; debt 315 → 315, maximum 96 → 96. The local predicate stays in the existing owner; splitting unrelated provider hotspots would broaden this patch.
- Bounded three-unit reconciliation performs three canonical imports instead of four, preserving all continuation payloads and unchanged-content proof.
- A local synthetic real-import experiment with 100 historical receipts measured the omitted replay import at median 1.29 ms wall / 1.75 ms CPU over ten warmed samples. Its initial empty receipt import applied; all identical replays were no-ops. These measure removed work only, not overall production cost savings.
- Existing hourly preflight already avoids unchanged wakes. Webhook lookahead has a wake-versus-processing tradeoff that requires operational evidence before changing policy. This patch does not claim fewer runtime starts.

## Handoff

Parent owns candidate review, complexity/docs guards, plan closure, commit, PR creation, and exact-head ReviewGPT/CI. No production mutation or deployment was performed.
Completed: 2026-09-28
