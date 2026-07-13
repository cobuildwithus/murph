# PR 521 ReviewGPT Round 6

## Goal

Close the exact-head Round 6 findings without new durable state: preserve the
current event-spine owner for historical external references, prevent audit-only
writes, and allow one deterministic append across malformed newline-framed
dedupe history when the live target remains structurally appendable.

## Invariants

- A moved historical reference resolves to its unique current event spine.
- Ambiguous or protected historical owners remain raw-only and never mint or relink.
- A write with zero ingest, event, and sample appends is a no-op with no audit.
- Multiple physical representations, requested-ID conflicts, I/O failures, and
  incomplete final rows remain fail-closed.
- A malformed non-final row cannot block every future delivery to that month.

## Work

1. Make the transient historical fingerprint index owner-bearing.
2. Reuse that owner in exact matching, association planning, and reconciliation.
3. Add the final zero-append no-op guard.
4. Add tolerant requested-ID inspection for a single live JSONL representation.
5. Add focused regression proof, verify, audit, and rerun exact-head ReviewGPT.

## Verification

- Focused device-import and integration-ingest matrix: 13 passed
- `pnpm --filter @murphai/core test:coverage`: 644 passed; 90.39% statements,
  81.95% branches, 95.78% functions, 90.46% lines
- `pnpm --filter @murphai/core typecheck`: passed
- Security/privacy specialist: zero medium-or-higher findings
- Coverage-write specialist: two focused regressions added; no unresolved gaps
- `pnpm test:diff`: guards passed; blocked by the unchanged hosted-execution
  test import for `@murphai/hosted-execution/clinical-records`
- Exact-head ReviewGPT: pending pushed commit
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
