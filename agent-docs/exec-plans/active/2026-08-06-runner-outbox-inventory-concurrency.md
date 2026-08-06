# Bound concurrent outbox inventory reads

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Remove the sequential per-file I/O chain from the foreground assistant
  outbox inventory scan.
- Preserve exact parsing, quarantine, sorting, and delivery behavior.

## Success criteria

- Outbox JSON files are read with a small fixed concurrency bound.
- Malformed files are still quarantined, missing-file races are still ignored,
  and returned intents retain deterministic delivery order.
- A delayed-I/O reproduction proves that the inventory no longer pays one
  file-latency interval per entry.
- Focused tests, typechecking, exact-head CI, and required reviews pass.

## Evidence

- The investigated cold start spent 1.026 seconds in the outbox scan, around
  the 99th percentile.
- `listAssistantOutboxIntentsLocal` currently awaits every file read and schema
  parse inside a serial loop.
- Terminal retention is bounded to 100 entries, but the inventory reader also
  includes active entries and should not schedule an unbounded number of open
  files.

## Scope

- In scope:
  - Add fixed-width concurrent inventory reads in the existing store owner.
  - Add direct delayed-read proof for the bound and semantic regression tests.
- Out of scope:
  - A second index, status-specific directory layout, migration, watcher, or
    persisted cache.
  - Outbox schema, delivery, retry, pruning, or retention changes.
  - Runner JavaScript lazy-loading and snapshot composition.

## Constraints

- Keep `store.ts` as the sole file-inventory owner.
- Do not add a dependency or long-lived cache/state owner.
- Do not let one malformed file prevent other inventory reads from completing.

## Tasks

1. Capture a delayed-read baseline and choose the smallest useful bound.
2. Implement fixed-width inventory batches in `store.ts`.
3. Prove the concurrency ceiling plus existing order/quarantine behavior.
4. Run focused package proof, commit, push, and open an isolated PR.
5. Complete exact-head CI and the ReviewGPT completion gates, then close this
   plan with `scripts/finish-task`.

## Decisions

- Use fixed batches in the existing loop rather than a general concurrency
  helper. The outbox inventory is the only demonstrated need, and batching
  keeps the failure and ordering semantics explicit.
- Wait for every read in the active batch to settle before surfacing a hard
  inventory error. This prevents quarantine or read work from escaping the
  caller after a sibling file fails.

## Verification

- The direct delayed-read regression created 17 valid files, held their reads,
  observed exactly 16 active operations, then proved the final read began only
  after the first batch released.
- Assistant Engine typecheck passed.
- Focused outbox runtime, outbox threshold, and runtime threshold suites passed:
  125 tests.
- Workspace boundary and package-cycle checks passed.
- Existing malformed-file ordering/quarantine and hard rename-error tests pass
  through the same focused suites.
