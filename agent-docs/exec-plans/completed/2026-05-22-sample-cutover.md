# Sample Cutover

## Goal

Land the hard cut described in `agent-docs/exec-plans/completed/SAMPLE_CUTOVER.md`.

Success means default query/read/browser/assistant paths no longer depend on generic dense sample rows:

- `readVault()` returns sparse canonical product records, not generic sample-ledger rows.
- `query_sample_points` is removed from the query projection schema/readback path.
- Browser-vault metrics are built from stored projection metric points, not from rehydrated samples.
- Relevant CLI/tests/docs reflect the new explicit boundary.

## Scope

Primary files:

- `packages/query/src/query-projection.ts`
- `packages/query/src/vault-source.ts`
- `packages/query/src/browser-replica/**`
- `packages/assistant-runtime/src/hosted-runtime/browser-vault-replica.ts`
- focused query/browser-vault/assistant-runtime tests
- durable architecture docs if the sample boundary changes

Out of scope:

- Unrelated Cloudflare hosted snapshot abort work already active in the worktree.
- Broad provider ingestion rewrite unless required to keep the hard cut internally coherent.

## Verification

- Focused tests for query projection/readVault/browser-vault behavior.
- Package typecheck/test commands covering touched packages.
- Repo-required completion audits before final commit.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
