# Hard cut hosted execution to a single vault bundle

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Remove the dead hosted `agentState` bundle lane so hosted execution persists, restores, journals, and reports exactly one workspace bundle: `vault`.

## Success criteria

- Hosted runtime-state snapshot/restore helpers expose only the `vault` hosted workspace bundle and no `agentStateBundle` compatibility input/output.
- Shared hosted-execution contracts and parsers no longer model per-slot `bundleRefs`; they represent one nullable `bundleRef` for the hosted workspace snapshot.
- Assistant-runtime hosted execution requests/results and commit/finalize callbacks use one bundle payload slot and one bundle ref.
- Cloudflare runner state, bundle store, execution journal, queue storage, bundle GC, and worker/container tests no longer branch over two hosted bundle lanes.
- Hosted web dispatch/tests and runtime-state/hosted-execution tests no longer assert two-slot semantics.
- Required verification passes.

## Scope

- In scope:
  - `packages/runtime-state/**`
  - `packages/hosted-execution/**`
  - `packages/assistant-runtime/**`
  - `apps/cloudflare/**`
  - `apps/web/**`
  - Related tests and durable docs that must move with the contract change
- Out of scope:
  - Any new migration shim for old two-slot hosted payloads
  - Unrelated hosted execution orchestration refactors

## Constraints

- Hard cut the contract; do not preserve `agentState` as an accepted or emitted compatibility slot.
- Keep hosted bundle semantics explicit and fail closed when stale two-slot inputs appear.
- Preserve unrelated worktree edits.

## Risks and mitigations

1. Risk: Partial removal leaves mixed single-bundle and two-slot callers.
   Mitigation: Trace every `agentStateBundle`, `bundleRefs.agentState`, and hosted bundle-slot helper before editing.
2. Risk: Cloudflare queue/journal/storage code still assumes slot iteration and silently keeps dead state.
   Mitigation: Collapse stored state and helpers to one explicit bundle ref/version pair instead of generic slot maps.
3. Risk: Tests still pass stale two-slot payloads and mask real contract drift.
   Mitigation: Update fixtures to canonical single-bundle payloads in the same change.

## Tasks

1. Collapse runtime-state hosted snapshot/restore helpers to a single `vault` bundle API.
2. Remove hosted-execution bundle slot maps and update shared contracts/parsers to one `bundleRef`.
3. Update assistant-runtime hosted request/result and callback models to one bundle payload/ref.
4. Update Cloudflare runner state, bundle storage/journaling, bundle GC, and hosted web dispatch/tests to the single-bundle contract.
5. Run required verification, close the plan, and commit the scoped diff.

## Decisions

- Hosted execution will treat the vault workspace snapshot as the only persisted hosted bundle; assistant state and operator-home content stay inside that one bundle root layout.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
- Expected outcomes:
  - Typecheck passes.
  - Repo tests pass.
- Outcomes:
  - `pnpm typecheck` passed.
  - `pnpm test` passed.
Completed: 2026-04-06
