# PR 521 Serialized Tail Proof

Status: completed
Updated: 2026-07-12

## Why

PR 521 needs exact retries and archived target shards to converge as well as
bounded live-tail scans. ReviewGPT also found that metadata was omitted from
deterministic input identity, and the latest base changed the typed replay
contract to return a no-op result.

## Goal

Make device ingest storage idempotency hold for exact retries, partial evidence
retention, bounded live tails, and bounded gzip/ZIP target archives without a
new index or persisted state.

## Invariants

- Missing, corrupt, unreadable, or incomplete history still fails
  open and retains incoming evidence.
- Exact provider/account/content and canonical-output association checks remain
  required before suppressing evidence.
- The ordinary scan stays bounded; an oversized unrelated tail row must not
  authorize older history or unbounded traversal.
- Keep the existing integration-ingest journal as the only source of truth.

## Work

1. Cover exact retries beyond the live-tail budget, history-dependent partial
   retention, evidence metadata identity, and gzip/ZIP archive novelty.
2. Short-circuit an existing deterministic input id before novelty filtering,
   and reuse the existing bounded archive reader for archived target shards.
3. Run focused tests, the diff verification lane, completion audits, pushed-head
   ReviewGPT, and required PR checks.

## Verification

- `pnpm --dir packages/core test` — 41 files, 621 tests passed after the
  coverage-write addition.
- `pnpm --dir packages/core typecheck` — passed.
- `pnpm --dir packages/importers test` — 15 files, 352 tests passed.
- `pnpm --dir packages/importers typecheck` — passed.
- `pnpm test:scenario-integrity` — 205 scenarios, 11 sample inputs, and 28
  golden-output directories passed.
- Required `coverage-write` audit added one focused missing-output invariant
  test; no other proof gaps remained.
- `git diff --check` and the identifier/privacy scan passed.

## Deployment

No coordinated app deployment is expected; this changes local journal read
optimization behavior only.
Completed: 2026-07-12
