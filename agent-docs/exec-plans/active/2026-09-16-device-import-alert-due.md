# Respect scheduled device import wake grace

Status: active
Created: 2026-09-16
Updated: 2026-09-16

## Goal

Avoid paging about a silent device import queue while its canonical scheduled wake is still within the existing 15-minute stall allowance. Preserve detection of overdue silent work and repeated no-progress passes.

## Scope and owner

The Web diagnostic reader already selects the canonical workspace wake time. Apply the existing stall duration to that selection; retain the connection-owned health reducer and operational incident sender. No new persistence, queries, dependencies, runtime protocols, or timers. Temporal response compatibility is outside this patch.

## Evidence and decisions

A synthetic pending observation and accepted checkpoint followed by a planned idle interval become anomalous at the wake deadline under the prior reader. Requiring the silent queue wake to be 15 minutes overdue prevents counting the planned wait as failed processing. Recent repeated no-progress observations remain eligible through the existing active-evidence path.

## Risks and mitigations

- Delaying genuine stalls: test the exact overdue boundary and active no-progress path.
- Hiding unsaved progress: retain existing same-attempt accepted-checkpoint and independent-connection tests.
- Deployment skew: Web-only read policy change; unchanged stored shapes and runner diagnostics support old and new Web readers.
- Privacy: use synthetic tests only; publish no production diagnostic records.

## Tasks

1. Update the existing silent queue admission predicate and reliability contract.
2. Verify scheduled grace, exact boundary, genuine stalls, bounded reads, and existing incident behavior.
3. Review, commit, open PR, run required review and CI, then merge and verify the authorized production deployment.

## Verification

- Regression proof against the old predicate: three scheduled-wake grace cases fail as expected.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-device-import-alert-monitor.test.ts apps/web/test/hosted-device-import-health.test.ts`: 32 passed.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm complexity:diff`: passed, zero debt and zero hotspots; maximum source complexity remains 5.
- Parent review: the existing timestamp and duration are sufficient; query count, access admission, checkpoint ownership, and schemas are unchanged.
- Pending: required ReviewGPT, exact-head CI, and production deployment verification.

## Product UX and changelog

Internal operator alert correctness only; no member-facing UI, assistant behavior, or public changelog entry.
